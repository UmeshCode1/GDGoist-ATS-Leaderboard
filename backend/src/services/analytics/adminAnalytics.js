/**
 * PHASE 3: Admin Analytics Service
 * 
 * Provides aggregated, anonymized analytics for institutional intelligence.
 * NO PERSONALLY IDENTIFIABLE INFORMATION (PII) is exposed.
 * 
 * All queries use MongoDB aggregation pipelines for performance.
 */

const Score = require('../../models/score.model')
const User = require('../../models/user.model')
const Resume = require('../../models/resume.model')
const GitHub = require('../../models/github.model')
const SkillGap = require('../../models/skillgap.model')

/**
 * Score bands for employability classification
 * FROZEN - DO NOT MODIFY
 */
const SCORE_BANDS = {
    LOW: { min: 0, max: 40, label: 'Developing' },
    MEDIUM: { min: 40, max: 70, label: 'Progressing' },
    HIGH: { min: 70, max: 100, label: 'Advanced' },
}

/**
 * Get cohort-level analytics by department and/or graduation year
 * Returns aggregated metrics with NO PII
 */
async function getCohortAnalytics(filters = {}) {
    const { department, graduationYear } = filters

    // Build match stage for user filtering
    const userMatch = {}
    if (department) userMatch.department = department
    if (graduationYear) userMatch.graduationYear = Number(graduationYear)

    const pipeline = [
        // Join scores with users
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userDoc'
            }
        },
        { $unwind: '$userDoc' },

        // Apply filters
        ...(Object.keys(userMatch).length > 0 ? [{ $match: { ...Object.keys(userMatch).reduce((acc, key) => ({ ...acc, [`userDoc.${key}`]: userMatch[key] }), {}) } }] : []),

        // Group by cohort (department + year)
        {
            $group: {
                _id: {
                    department: '$userDoc.department',
                    graduationYear: '$userDoc.graduationYear'
                },
                totalStudents: { $sum: 1 },
                avgTotalScore: { $avg: '$totalScore' },
                avgATSScore: { $avg: '$atsComponent' },
                avgGitHubScore: { $avg: '$gitComponent' },
                avgBadgeScore: { $avg: '$badgeComponent' },
                minScore: { $min: '$totalScore' },
                maxScore: { $max: '$totalScore' },
                scores: { $push: '$totalScore' }
            }
        },

        // Sort by department and year
        { $sort: { '_id.department': 1, '_id.graduationYear': 1 } }
    ]

    const results = await Score.aggregate(pipeline)

    // Calculate distribution for each cohort
    return results.map(cohort => {
        const { scores, ...rest } = cohort

        // Calculate score band distribution
        const distribution = {
            low: scores.filter(s => s < SCORE_BANDS.MEDIUM.min).length,
            medium: scores.filter(s => s >= SCORE_BANDS.MEDIUM.min && s < SCORE_BANDS.HIGH.min).length,
            high: scores.filter(s => s >= SCORE_BANDS.HIGH.min).length
        }

        return {
            cohort: {
                department: cohort._id.department || 'Unknown',
                graduationYear: cohort._id.graduationYear || 'Unknown'
            },
            metrics: {
                totalStudents: cohort.totalStudents,
                averageScores: {
                    total: Number(cohort.avgTotalScore?.toFixed(2) || 0),
                    ats: Number(cohort.avgATSScore?.toFixed(2) || 0),
                    github: Number(cohort.avgGitHubScore?.toFixed(2) || 0),
                    badges: Number(cohort.avgBadgeScore?.toFixed(2) || 0)
                },
                scoreRange: {
                    min: Number(cohort.minScore?.toFixed(2) || 0),
                    max: Number(cohort.maxScore?.toFixed(2) || 0)
                },
                distribution: {
                    developing: { count: distribution.low, percentage: Number(((distribution.low / cohort.totalStudents) * 100).toFixed(1)) },
                    progressing: { count: distribution.medium, percentage: Number(((distribution.medium / cohort.totalStudents) * 100).toFixed(1)) },
                    advanced: { count: distribution.high, percentage: Number(((distribution.high / cohort.totalStudents) * 100).toFixed(1)) }
                }
            }
        }
    })
}

/**
 * Get skill intelligence for a cohort
 * Returns top skills and skill gaps (NO PII)
 */
async function getSkillIntelligence(filters = {}) {
    const { department, graduationYear } = filters

    // Build user match
    const userMatch = {}
    if (department) userMatch.department = department
    if (graduationYear) userMatch.graduationYear = Number(graduationYear)

    // Get skills from resumes
    const resumeSkillsPipeline = [
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userDoc'
            }
        },
        { $unwind: '$userDoc' },
        ...(Object.keys(userMatch).length > 0 ? [{ $match: { ...Object.keys(userMatch).reduce((acc, key) => ({ ...acc, [`userDoc.${key}`]: userMatch[key] }), {}) } }] : []),
        { $match: { parsedSkills: { $exists: true, $ne: [] } } },
        { $unwind: '$parsedSkills' },
        {
            $group: {
                _id: '$parsedSkills',
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
    ]

    // Get languages from GitHub
    const githubLangsPipeline = [
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userDoc'
            }
        },
        { $unwind: '$userDoc' },
        ...(Object.keys(userMatch).length > 0 ? [{ $match: { ...Object.keys(userMatch).reduce((acc, key) => ({ ...acc, [`userDoc.${key}`]: userMatch[key] }), {}) } }] : []),
        { $match: { 'stats.languages': { $exists: true, $ne: [] } } },
        { $unwind: '$stats.languages' },
        {
            $group: {
                _id: '$stats.languages',
                count: { $sum: 1 }
            }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
    ]

    const [resumeSkills, githubLanguages] = await Promise.all([
        Resume.aggregate(resumeSkillsPipeline),
        GitHub.aggregate(githubLangsPipeline)
    ])

    return {
        topSkills: resumeSkills.map(s => ({
            skill: s._id,
            frequency: s.count
        })),
        topLanguages: githubLanguages.map(l => ({
            language: l._id,
            frequency: l.count
        }))
    }
}

/**
 * Identify at-risk cohorts (cohorts with >50% students in "Developing" band)
 * Returns cohort identifiers only (NO PII)
 */
async function getAtRiskCohorts() {
    const allCohorts = await getCohortAnalytics()

    // Filter cohorts where >50% are in developing band
    const atRisk = allCohorts.filter(cohort => {
        const developingPercentage = cohort.metrics.distribution.developing.percentage
        return developingPercentage > 50 && cohort.metrics.totalStudents >= 5 // Min 5 students for statistical relevance
    })

    return atRisk.map(cohort => ({
        cohort: cohort.cohort,
        totalStudents: cohort.metrics.totalStudents,
        developingPercentage: cohort.metrics.distribution.developing.percentage,
        averageScore: cohort.metrics.averageScores.total,
        recommendation: 'Consider targeted skill development workshops or resume review sessions'
    }))
}

/**
 * Get trend analysis over time
 * Returns score evolution by month (NO PII)
 */
async function getTrendAnalysis(filters = {}) {
    const { department, graduationYear, months = 6 } = filters

    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - months)

    // Build match
    const userMatch = {}
    if (department) userMatch.department = department
    if (graduationYear) userMatch.graduationYear = Number(graduationYear)

    const pipeline = [
        {
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userDoc'
            }
        },
        { $unwind: '$userDoc' },
        ...(Object.keys(userMatch).length > 0 ? [{ $match: { ...Object.keys(userMatch).reduce((acc, key) => ({ ...acc, [`userDoc.${key}`]: userMatch[key] }), {}) } }] : []),
        {
            $match: {
                updatedAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    year: { $year: '$updatedAt' },
                    month: { $month: '$updatedAt' }
                },
                avgScore: { $avg: '$totalScore' },
                count: { $sum: 1 }
            }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]

    const results = await Score.aggregate(pipeline)

    return results.map(r => ({
        period: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
        averageScore: Number(r.avgScore?.toFixed(2) || 0),
        studentCount: r.count
    }))
}

/**
 * Get platform-wide statistics (NO PII)
 */
async function getPlatformStats() {
    const [totalUsers, totalScores, totalResumes, totalGitHubConnections] = await Promise.all([
        User.countDocuments(),
        Score.countDocuments(),
        Resume.countDocuments({ status: 'scored' }),
        GitHub.countDocuments()
    ])

    const avgScorePipeline = [
        {
            $group: {
                _id: null,
                avgTotal: { $avg: '$totalScore' },
                avgATS: { $avg: '$atsComponent' },
                avgGitHub: { $avg: '$gitComponent' },
                avgBadges: { $avg: '$badgeComponent' }
            }
        }
    ]

    const avgScores = await Score.aggregate(avgScorePipeline)
    const scores = avgScores[0] || { avgTotal: 0, avgATS: 0, avgGitHub: 0, avgBadges: 0 }

    return {
        platform: {
            totalUsers,
            totalScores,
            totalResumes,
            totalGitHubConnections,
            engagementRate: totalUsers > 0 ? Number(((totalScores / totalUsers) * 100).toFixed(1)) : 0
        },
        averageScores: {
            total: Number(scores.avgTotal?.toFixed(2) || 0),
            ats: Number(scores.avgATS?.toFixed(2) || 0),
            github: Number(scores.avgGitHub?.toFixed(2) || 0),
            badges: Number(scores.avgBadges?.toFixed(2) || 0)
        }
    }
}

module.exports = {
    getCohortAnalytics,
    getSkillIntelligence,
    getAtRiskCohorts,
    getTrendAnalysis,
    getPlatformStats,
    SCORE_BANDS
}
