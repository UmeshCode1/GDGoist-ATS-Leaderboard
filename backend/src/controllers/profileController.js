/**
 * Profile Controller
 * 
 * Business logic for profile operations extracted from route handlers
 * Follows Controller Pattern: Route → Controller → Service → Model
 */

const path = require('path')
const User = require('../models/user.model')
const Resume = require('../models/resume.model')
const Score = require('../models/score.model')
const Badge = require('../models/badge.model')
const GitHub = require('../models/github.model')
const { recalculateUserScore } = require('../services/scoring/scoreService')
const { analyticsCache } = require('../services/analytics/analyticsCache')
const { recordConsentEvent } = require('../services/privacy/privacyService')
const { uploadFile, getFile } = require('../infrastructure/s3')
const { resolveAvatar } = require('../utils/avatarResolver')
const { formatBadges } = require('../utils/badgeFormatter')
const logger = require('../utils/logger')

// Allowed fields for profile updates
const ALLOWED_PROFILE_FIELDS = [
    'name', 'bio', 'department', 'graduationYear', 
    'socialLinks', 'projects', 'experiences', 'profileVisibility'
]

/**
 * Update user profile with allowed fields only
 */
async function updateProfile(userId, updates) {
    // Filter only allowed fields
    const filteredUpdates = {}
    ALLOWED_PROFILE_FIELDS.forEach(field => {
        if (updates[field] !== undefined) {
            filteredUpdates[field] = updates[field]
        }
    })

    if (Object.keys(filteredUpdates).length === 0) {
        throw new Error('No valid profile fields to update')
    }

    // Update user
    const user = await User.findByIdAndUpdate(
        userId, 
        filteredUpdates, 
        { new: true, runValidators: true }
    )

    if (!user) {
        throw new Error('User not found')
    }

    // Recalculate score if relevant fields changed
    const scoreRelevantFields = ['department', 'graduationYear']
    const hasScoreRelevantChanges = scoreRelevantFields.some(field => filteredUpdates[field] !== undefined)
    
    if (hasScoreRelevantChanges) {
        await recalculateUserScore(userId)
        // Clear analytics cache
        analyticsCache.clear()
    }

    return user
}

/**
 * Upload avatar with S3 and local fallback
 */
async function uploadAvatar(userId, file, protocol, host) {
    if (!file) {
        throw new Error('No file uploaded')
    }

    const fileExt = path.extname(file.name)
    const avatarFilename = `avatar_${userId}_${Date.now()}${fileExt}`
    let avatarUrl

    // Try S3 upload first, fallback to local
    try {
        const s3Key = `avatars/${avatarFilename}`
        await uploadFile(file.data, s3Key, file.mimetype)
        avatarUrl = `${protocol}://${host}/files/${s3Key}`
        logger.info(`[Profile] Avatar uploaded to S3: ${avatarUrl}`)
    } catch (s3Err) {
        logger.warn('S3 Avatar upload failed, falling back to local', { error: s3Err.message })
        const uploadPath = path.join(__dirname, '../../uploads/avatars', avatarFilename)
        const avatarDir = path.dirname(uploadPath)
        if (!require('fs').existsSync(avatarDir)) {
            require('fs').mkdirSync(avatarDir, { recursive: true })
        }
        await file.mv(uploadPath)
        avatarUrl = `/uploads/avatars/${avatarFilename}`
    }

    // Update user's profile picture
    const user = await User.findByIdAndUpdate(
        userId,
        { profilePicture: avatarUrl },
        { new: true }
    )

    if (!user) {
        throw new Error('User not found')
    }

    return { profilePicture: avatarUrl }
}

/**
 * Get public user profile with enrichment
 */
async function getPublicProfile(userId, baseUrl) {
    // Get user data
    const user = await User.findById(userId)
    if (!user) {
        throw new Error('User not found')
    }

    // Handle private profiles
    if (user.profileVisibility === 'private') {
        return {
            id: user._id, 
            name: user.name, 
            department: user.department, 
            graduationYear: user.graduationYear, 
            isPrivate: true 
        }
    }

    // Get enriched data
    const [latestScore, userBadges, githubDoc] = await Promise.all([
        Score.findOne({ user: userId }).sort({ createdAt: -1 }),
        Badge.find({ user: userId }).populate('definitionId').sort({ earnedAt: -1 }),
        GitHub.findOne({ user: userId })
    ])

    // Format badges and resolve avatar
    const formattedBadges = formatBadges(userBadges, baseUrl)
    const finalAvatar = resolveAvatar(user, githubDoc)

    return {
        profile: {
            id: user._id,
            name: user.name,
            department: user.department,
            graduationYear: user.graduationYear,
            bio: user.bio || '',
            profilePicture: finalAvatar,
            socialLinks: user.socialLinks || {},
            projects: user.projects || [],
            experiences: user.experiences || [],
            github: githubDoc ? { username: githubDoc.githubUsername } : (user.github?.username ? { username: user.github.username } : null),
            score: latestScore ? { 
                total: latestScore.totalScore, 
                ats: latestScore.atsComponent, 
                github: latestScore.githubScore, 
                badges: latestScore.badgesScore 
            } : null,
            badges: formattedBadges,
            isPrivate: false,
        }
    }
}

/**
 * Proxy S3 file with proper MIME type handling
 */
async function proxyS3File(key) {
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }

    const ext = path.extname(key).toLowerCase()
    const contentType = mimeTypes[ext] || 'application/octet-stream'

    try {
        const fileBuffer = await getFile(key)
        return { fileBuffer, contentType }
    } catch (err) {
        logger.error('S3 file fetch failed', { key, error: err.message })
        throw new Error('File not found')
    }
}

module.exports = {
    updateProfile,
    uploadAvatar,
    getPublicProfile,
    proxyS3File
}
