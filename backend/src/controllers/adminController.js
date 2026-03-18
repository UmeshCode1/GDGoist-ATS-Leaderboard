/**
 * Admin Controller
 * 
 * Business logic for admin operations extracted from route handlers
 * Follows Controller Pattern: Route → Controller → Service → Model
 */

const path = require('path')
const fs = require('fs')
const User = require('../models/user.model')
const Badge = require('../models/badge.model')
const BadgeDefinition = require('../models/badgeDefinition.model')
const GitHub = require('../models/github.model')
const Score = require('../models/score.model')
const { recalculateUserScore } = require('../services/scoring/scoreService')
const { uploadFile } = require('../infrastructure/s3')
const { createAuditLog } = require('../services/privacy/privacyService')
const { resolveAvatar } = require('../utils/avatarResolver')
const logger = require('../utils/logger')

/**
 * Get paginated list of users with enrichment
 */
async function getUsers(query) {
    const { page = 1, limit = 20, search = '', department = '', graduationYear = '' } = query
    
    // Build query
    const userQuery = { role: { $ne: 'admin' } }
    if (search) userQuery.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }]
    if (department) userQuery.department = department
    if (graduationYear) userQuery.graduationYear = parseInt(graduationYear)

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const totalCount = await User.countDocuments(userQuery)
    const users = await User.find(userQuery)
        .select('name email department graduationYear totalScore atsScore githubScore badgesScore hasResume profilePicture createdAt')
        .sort({ totalScore: -1, createdAt: -1 }).skip(skip).limit(parseInt(limit))

    // Enrich users with badges and GitHub data
    const usersWithData = await Promise.all(users.map(async (u) => {
        const [badges, githubDoc] = await Promise.all([
            Badge.find({ user: u._id }).populate('definitionId'), 
            GitHub.findOne({ user: u._id })
        ])
        const finalAvatar = resolveAvatar(u, githubDoc)
        return {
            id: u._id, name: u.name || 'Anonymous', email: u.email, department: u.department || 'Not set',
            graduationYear: u.graduationYear || null, totalScore: u.totalScore || 0, atsScore: u.atsScore || 0,
            githubScore: u.githubScore || 0, badgesScore: u.badgesScore || 0, hasResume: !!u.hasResume,
            profilePicture: finalAvatar, githubUsername: githubDoc?.githubUsername || null, joinedAt: u.createdAt,
            badges: badges.map(b => { const bObj = b.toObject(); return { ...bObj, definition: bObj.definitionId } }) || [],
        }
    }))

    return { users: usersWithData, totalCount, page: parseInt(page), totalPages: Math.ceil(totalCount / parseInt(limit)) }
}

/**
 * Export users as CSV
 */
async function exportUsersCsv(query) {
    const { search = '', department = '', graduationYear = '' } = query
    
    // Build query
    const userQuery = { role: { $ne: 'admin' } }
    if (search) userQuery.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }]
    if (department) userQuery.department = department
    if (graduationYear) userQuery.graduationYear = parseInt(graduationYear)

    const users = await User.find(userQuery)
        .select('name email department graduationYear totalScore atsScore githubScore badgesScore bio profilePicture createdAt')
        .sort({ totalScore: -1 })

    // Generate CSV
    let csv = 'Name,Email,Department,Year,Total Score,ATS Score,GitHub Score,Badges Score,Bio,Profile Picture,Joined At\n'
    users.forEach(u => {
        const bio = (u.bio || '').replace(/"/g, '""')
        csv += [`"${u.name || 'Anonymous'}"`, `"${u.email}"`, `"${u.department || 'Not set'}"`,
        u.graduationYear || '', u.totalScore || 0, u.atsScore || 0, u.githubScore || 0, u.badgesScore || 0,
        `"${bio}"`, `"${u.profilePicture || ''}"`, `"${new Date(u.createdAt).toISOString()}"`].join(',') + '\n'
    })

    return csv
}

/**
 * Create new badge definition with icon upload
 */
async function createBadgeDefinition(data, file, protocol, host) {
    const { name, description, criteria, points } = data
    
    if (!file) throw new Error('Icon image is required')
    if (!file.mimetype.startsWith('image/')) throw new Error('File must be an image')

    const fileExt = path.extname(file.name)
    const iconFilename = `badge_${Date.now()}${fileExt}`
    let iconUrl

    // Try S3 upload first, fallback to local
    try {
        const s3Key = `badges/${iconFilename}`
        await uploadFile(file.data, s3Key, file.mimetype)
        iconUrl = `${protocol}://${host}/files/${s3Key}`
        logger.info(`[Badge] Icon uploaded to S3: ${iconUrl}`)
    } catch (s3Err) {
        logger.warn('S3 Badge Upload failed, falling back to local', { error: s3Err.message })
        const uploadPath = path.join(__dirname, '../../uploads/badges', iconFilename)
        const badgeDir = path.dirname(uploadPath)
        if (!fs.existsSync(badgeDir)) fs.mkdirSync(badgeDir, { recursive: true })
        await file.mv(uploadPath)
        iconUrl = `/uploads/badges/${iconFilename}`
    }

    const badgeDef = await BadgeDefinition.create({ 
        name, 
        description, 
        criteria, 
        icon: iconUrl, 
        points: points ? Number(points) : 2 
    })
    
    return badgeDef
}

/**
 * Assign badge to user
 */
async function assignBadge(userId, badgeDefId) {
    // Check if badge definition exists
    const badgeDef = await BadgeDefinition.findById(badgeDefId)
    if (!badgeDef) throw new Error('Badge definition not found')

    // Check if user already has this badge
    const existingBadge = await Badge.findOne({ user: userId, definitionId: badgeDefId })
    if (existingBadge) throw new Error('User already has this badge')

    // Create badge for user
    const badge = await Badge.create({
        user: userId,
        definitionId: badgeDefId,
        earnedAt: new Date(),
        metadata: { awardedBy: 'admin' }
    })

    // Recalculate user score
    await recalculateUserScore(userId)
    
    return badge
}

/**
 * Remove badge from user
 */
async function removeBadge(userId, badgeId) {
    // Find and verify badge ownership
    const badge = await Badge.findOne({ _id: badgeId, user: userId })
    if (!badge) throw new Error('Badge not found or does not belong to user')

    // Delete badge
    await Badge.findByIdAndDelete(badgeId)
    
    // Recalculate user score
    await recalculateUserScore(userId)
    
    return { message: 'Badge removed successfully' }
}

module.exports = {
    getUsers,
    exportUsersCsv,
    createBadgeDefinition,
    assignBadge,
    removeBadge
}
