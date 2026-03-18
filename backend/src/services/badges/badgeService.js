/**
 * PHASE 2: Badge System (HARDENED)
 * 
 * Deterministic badge evaluation and awarding system.
 * Prevents duplicate awards and ensures consistent scoring.
 */

const Badge = require('../../models/badge.model')
const Resume = require('../../models/resume.model')
const GitHub = require('../../models/github.model')
const Connection = require('../../models/connection.model')
const SkillGap = require('../../models/skillgap.model')

// FROZEN BADGE DEFINITIONS
const BADGE_DEFINITIONS = {
  resume_master: {
    name: 'Resume Master',
    description: 'Achieved ATS score > 80',
    icon: '📄',
    requirement: { type: 'atsScore', threshold: 80 },
    points: 2,
  },
  open_source_contributor: {
    name: 'Open Source Contributor',
    description: '10+ commits on GitHub',
    icon: '🚀',
    requirement: { type: 'commits', threshold: 10 },
    points: 2,
  },
  pull_request_pro: {
    name: 'Pull Request Pro',
    description: '5+ merged pull requests',
    icon: '🔀',
    requirement: { type: 'prs', threshold: 5 },
    points: 2,
  },
  polyglot_programmer: {
    name: 'Polyglot Programmer',
    description: 'Proficient in 3+ programming languages',
    icon: '🌐',
    requirement: { type: 'languages', threshold: 3 },
    points: 2,
  },
  star_collector: {
    name: 'Star Collector',
    description: '50+ stars on repositories',
    icon: '⭐',
    requirement: { type: 'stars', threshold: 50 },
    points: 2,
  },
  networking_ninja: {
    name: 'Networking Ninja',
    description: '10+ accepted connections',
    icon: '🥷',
    requirement: { type: 'connections', threshold: 10 },
    points: 2,
  },
  skill_seeker: {
    name: 'Skill Seeker',
    description: 'Completed skill gap analysis',
    icon: '📊',
    requirement: { type: 'skillGap', threshold: 1 },
    points: 2,
  },
}

/**
 * Check if a user meets badge requirements
 * Returns true if requirements are met
 */
async function checkBadgeRequirement(userId, badgeType) {
  const def = BADGE_DEFINITIONS[badgeType]
  if (!def) return false

  const { type, threshold } = def.requirement

  switch (type) {
    case 'atsScore': {
      const latestResume = await Resume.findOne({
        user: userId,
        status: 'scored'
      }).sort({ uploadedAt: -1 })
      return latestResume && latestResume.atsScore >= threshold
    }

    case 'commits': {
      const githubData = await GitHub.findOne({ user: userId })
      return githubData && githubData.stats && githubData.stats.totalCommits >= threshold
    }

    case 'prs': {
      const githubData = await GitHub.findOne({ user: userId })
      return githubData && githubData.stats && githubData.stats.totalPullRequests >= threshold
    }

    case 'languages': {
      const githubData = await GitHub.findOne({ user: userId })
      return githubData && githubData.stats && githubData.stats.languages &&
        githubData.stats.languages.length >= threshold
    }

    case 'stars': {
      const githubData = await GitHub.findOne({ user: userId })
      return githubData && githubData.stats && githubData.stats.totalStars >= threshold
    }

    case 'connections': {
      const acceptedConnections = await Connection.countDocuments({
        $or: [
          { requester: userId, status: 'accepted' },
          { recipient: userId, status: 'accepted' },
        ]
      })
      return acceptedConnections >= threshold
    }

    case 'skillGap': {
      const skillGapAnalysis = await SkillGap.findOne({ user: userId })
      return skillGapAnalysis !== null
    }

    default:
      return false
  }
}

/**
 * Award a badge to a user (idempotent - prevents duplicates)
 * Returns the badge if newly awarded, null if already exists
 */
async function awardBadge(userId, badgeType, metadata = {}) {
  try {
    // Check if already awarded (CRITICAL: prevents duplicates)
    const existing = await Badge.findOne({ user: userId, badgeType })
    if (existing) {
      return null // Already awarded
    }

    // Verify requirements are met
    const meetsRequirements = await checkBadgeRequirement(userId, badgeType)
    if (!meetsRequirements) {
      console.log(`[Badge] User ${userId} does not meet requirements for ${badgeType}`)
      return null
    }

    // Create badge
    const badge = await Badge.create({
      user: userId,
      badgeType,
      metadata,
      earnedAt: new Date(),
    })

    console.log(`[Badge] Awarded ${badgeType} to user ${userId}`)
    return badge
  } catch (err) {
    console.error(`[Badge] Error awarding badge ${badgeType}:`, err.message)
    return null
  }
}

/**
 * Check and award ALL eligible badges for a user
 * Returns array of newly awarded badge types
 */
async function checkAndAwardBadges(userId) {
  const awarded = []

  try {
    // Get user data once for efficiency
    const [latestResume, githubData, connectionCount, skillGapAnalysis] = await Promise.all([
      Resume.findOne({ user: userId, status: 'scored' }).sort({ uploadedAt: -1 }),
      GitHub.findOne({ user: userId }),
      Connection.countDocuments({
        $or: [
          { requester: userId, status: 'accepted' },
          { recipient: userId, status: 'accepted' },
        ]
      }),
      SkillGap.findOne({ user: userId }),
    ])

    // Resume Master
    if (latestResume && latestResume.atsScore >= 80) {
      const badge = await awardBadge(userId, 'resume_master', {
        atsScore: latestResume.atsScore
      })
      if (badge) awarded.push('resume_master')
    }

    // GitHub-based badges
    if (githubData && githubData.stats) {
      const { totalCommits, totalPullRequests, totalStars, languages } = githubData.stats

      // Open Source Contributor
      if (totalCommits >= 10) {
        const badge = await awardBadge(userId, 'open_source_contributor', {
          commits: totalCommits
        })
        if (badge) awarded.push('open_source_contributor')
      }

      // Pull Request Pro
      if (totalPullRequests >= 5) {
        const badge = await awardBadge(userId, 'pull_request_pro', {
          prs: totalPullRequests
        })
        if (badge) awarded.push('pull_request_pro')
      }

      // Polyglot Programmer
      if (languages && languages.length >= 3) {
        const badge = await awardBadge(userId, 'polyglot_programmer', {
          languages
        })
        if (badge) awarded.push('polyglot_programmer')
      }

      // Star Collector
      if (totalStars >= 50) {
        const badge = await awardBadge(userId, 'star_collector', {
          stars: totalStars
        })
        if (badge) awarded.push('star_collector')
      }
    }

    // Networking Ninja
    if (connectionCount >= 10) {
      const badge = await awardBadge(userId, 'networking_ninja', {
        connections: connectionCount
      })
      if (badge) awarded.push('networking_ninja')
    }

    // Skill Seeker
    if (skillGapAnalysis) {
      const badge = await awardBadge(userId, 'skill_seeker', {})
      if (badge) awarded.push('skill_seeker')
    }

    return awarded
  } catch (err) {
    console.error(`[Badge] Error checking badges for user ${userId}:`, err.message)
    return awarded
  }
}

/**
 * Get user badges with full definitions
 */
async function getUserBadges(userId) {
  const badges = await Badge.find({ user: userId }).sort({ earnedAt: -1 })
  return badges.map(b => ({
    type: b.badgeType,
    ...BADGE_DEFINITIONS[b.badgeType],
    earnedAt: b.earnedAt,
    metadata: b.metadata,
  }))
}

/**
 * Calculate badge contribution to score (0-20 points)
 * FROZEN FORMULA: Each badge = 2 points, max 10 badges = 20 points
 */
function calculateBadgeScore(badgeCount) {
  return Math.min(20, badgeCount * 2)
}

/**
 * Get badge progress for a user (for UI display)
 */
async function getBadgeProgress(userId) {
  const progress = {}

  for (const [badgeType, def] of Object.entries(BADGE_DEFINITIONS)) {
    const earned = await Badge.findOne({ user: userId, badgeType })
    const meetsRequirements = await checkBadgeRequirement(userId, badgeType)

    progress[badgeType] = {
      ...def,
      earned: !!earned,
      earnedAt: earned ? earned.earnedAt : null,
      eligible: meetsRequirements,
    }
  }

  return progress
}

module.exports = {
  BADGE_DEFINITIONS,
  checkBadgeRequirement,
  awardBadge,
  checkAndAwardBadges,
  getUserBadges,
  calculateBadgeScore,
  getBadgeProgress,
}
