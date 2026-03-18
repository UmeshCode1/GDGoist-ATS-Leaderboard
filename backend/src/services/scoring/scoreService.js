/**
 * PHASE 2: Centralized Score Aggregation Service
 * 
 * This module provides the SINGLE SOURCE OF TRUTH for score calculation.
 * All score updates MUST go through this service to ensure consistency.
 * 
 * Formula (FROZEN):
 * Total Score = (0.5 * ATS) + (0.3 * GitHub) + (0.2 * Badges)
 * 
 * Where:
 * - ATS: 0-100 (from resume analysis)
 * - GitHub: 0-100 (from GitHub activity)
 * - Badges: 0-100 (from badge achievements, max 20 points = 10 badges)
 */

const Resume = require('../../models/resume.model')
const GitHub = require('../../models/github.model')
const Badge = require('../../models/badge.model')
const BadgeDefinition = require('../../models/badgeDefinition.model')
const Score = require('../../models/score.model')
const User = require('../../models/user.model')
const logger = require('../../utils/logger')

// FROZEN WEIGHTS - DO NOT MODIFY
const WEIGHTS = {
    ATS: 0.5,
    GITHUB: 0.3,
    BADGES: 0.2,
}

// FROZEN SCORING PARAMETERS
const GITHUB_SCORING = {
    COMMITS: { weight: 0.4, max: 100 },  // 40 points max
    PRS: { weight: 0.3, max: 50 },       // 30 points max
    STARS: { weight: 0.2, max: 500 },    // 20 points max
    LANGUAGES: { weight: 0.1, max: 5 },  // 10 points max
}

const BADGE_SCORING = {
    POINTS_PER_BADGE: 2,
    MAX_BADGES: 10,
    MAX_POINTS: 20,
}

/**
 * Calculate ATS component score (0-100)
 * Uses most recent scored resume
 */
async function calculateATSComponent(userId) {
    const latest = await Resume.findOne({
        user: userId,
        status: 'scored'
    }).sort({ uploadedAt: -1, updatedAt: -1 })

    if (!latest || typeof latest.atsScore !== 'number') {
        return 0
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, latest.atsScore))
}

/**
 * Calculate GitHub component score (0-100)
 * Weighted by commits, PRs, stars, and languages
 */
async function calculateGitHubComponent(userId) {
    const githubData = await GitHub.findOne({ user: userId })

    if (!githubData || !githubData.stats) {
        return 0
    }

    const { totalCommits = 0, totalPullRequests = 0, totalStars = 0 } = githubData.stats
    const languages = (githubData.stats.languages || []).length

    // Apply fork penalty if detected
    let forkPenalty = 0
    if (githubData.stats.forkRatio && githubData.stats.forkRatio > 0.5) {
        forkPenalty = 10 // Reduce score by 10 points if >50% are forks
    }

    // Calculate weighted components
    const commitScore = Math.min(
        GITHUB_SCORING.COMMITS.weight * 100,
        (totalCommits / GITHUB_SCORING.COMMITS.max) * GITHUB_SCORING.COMMITS.weight * 100
    )

    const prScore = Math.min(
        GITHUB_SCORING.PRS.weight * 100,
        (totalPullRequests / GITHUB_SCORING.PRS.max) * GITHUB_SCORING.PRS.weight * 100
    )

    const starScore = Math.min(
        GITHUB_SCORING.STARS.weight * 100,
        (totalStars / GITHUB_SCORING.STARS.max) * GITHUB_SCORING.STARS.weight * 100
    )

    const langScore = Math.min(
        GITHUB_SCORING.LANGUAGES.weight * 100,
        (languages / GITHUB_SCORING.LANGUAGES.max) * GITHUB_SCORING.LANGUAGES.weight * 100
    )

    const rawScore = commitScore + prScore + starScore + langScore
    const finalScore = Math.max(0, rawScore - forkPenalty)

    return Math.round(finalScore)
}

/**
 * Calculate Badge component score (0-20, scaled to 0-100 for consistency)
 * Each badge = 2 points, max 10 badges = 20 points
 */
async function calculateBadgeComponent(userId) {
    const badges = await Badge.find({ user: userId }).populate('definitionId')

    // Sum points from dynamic definitions, fallback to 2 for legacy/system badges
    const totalPoints = badges.reduce((sum, b) => {
        const points = b.definitionId ? b.definitionId.points : (BADGE_SCORING.POINTS_PER_BADGE || 2)
        return sum + points
    }, 0)

    // Clamp to MAX_POINTS (20) for the 20% formula weight
    const points = Math.min(BADGE_SCORING.MAX_POINTS, totalPoints)

    // Scale to 0-100 for consistency with other components (ATS, GitHub)
    // 20 points = 100% component score
    return (points / BADGE_SCORING.MAX_POINTS) * 100
}

/**
 * MAIN FUNCTION: Recalculate and persist user score
 * This is the ONLY function that should update scores
 * 
 * @param {string} userId - User ID
 * @param {Object} options - Options for score calculation
 * @param {boolean} options.skipBadgeCheck - Skip badge evaluation (default: false)
 * @returns {Object} Updated score document
 */
async function recalculateUserScore(userId, options = {}) {
    try {
        // Calculate all components in parallel
        const [atsComponent, gitComponent, badgeComponentRaw] = await Promise.all([
            calculateATSComponent(userId),
            calculateGitHubComponent(userId),
            calculateBadgeComponent(userId),
        ])

        // Scale badge component back to 0-20 for final calculation
        const badgeComponent = (badgeComponentRaw / 100) * BADGE_SCORING.MAX_POINTS

        // Apply FROZEN formula
        const totalScore = Number(
            (WEIGHTS.ATS * atsComponent +
                WEIGHTS.GITHUB * gitComponent +
                WEIGHTS.BADGES * badgeComponent).toFixed(2)
        )

        // Atomic update or create
        const scoreDoc = await Score.findOneAndUpdate(
            { user: userId },
            {
                $set: {
                    totalScore,
                    atsComponent,
                    gitComponent,
                    badgeComponent,
                    lastUpdated: new Date(),
                }
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
            }
        )

        // SYNC: Update User model cache for fast access/sorting
        await User.findByIdAndUpdate(userId, {
            totalScore,
            atsScore: atsComponent,
            githubScore: gitComponent,
            badgesScore: badgeComponent
        })

        return scoreDoc
    } catch (err) {
        logger.error('Score recalculation error', { userId, error: err.message })
        throw err
    }
}

/**
 * Get current score breakdown for a user
 * Returns detailed component scores
 */
async function getScoreBreakdown(userId) {
    const [atsComponent, gitComponent, badgeComponentRaw] = await Promise.all([
        calculateATSComponent(userId),
        calculateGitHubComponent(userId),
        calculateBadgeComponent(userId),
    ])

    const badgeComponent = (badgeComponentRaw / 100) * BADGE_SCORING.MAX_POINTS

    const totalScore = Number(
        (WEIGHTS.ATS * atsComponent +
            WEIGHTS.GITHUB * gitComponent +
            WEIGHTS.BADGES * badgeComponent).toFixed(2)
    )

    return {
        totalScore,
        components: {
            ats: {
                score: atsComponent,
                weight: WEIGHTS.ATS,
                contribution: Number((WEIGHTS.ATS * atsComponent).toFixed(2)),
            },
            github: {
                score: gitComponent,
                weight: WEIGHTS.GITHUB,
                contribution: Number((WEIGHTS.GITHUB * gitComponent).toFixed(2)),
            },
            badges: {
                score: badgeComponent,
                weight: WEIGHTS.BADGES,
                contribution: Number((WEIGHTS.BADGES * badgeComponent).toFixed(2)),
            },
        },
    }
}

module.exports = {
    recalculateUserScore,
    getScoreBreakdown,
    calculateATSComponent,
    calculateGitHubComponent,
    calculateBadgeComponent,
    WEIGHTS,
    GITHUB_SCORING,
    BADGE_SCORING,
}
