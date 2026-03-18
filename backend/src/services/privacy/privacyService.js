/**
 * PHASE 3: Privacy Compliance Service
 * 
 * Implements DPDP (Digital Personal Data Protection) compliance workflows:
 * - Right to Erasure (hard delete with cascades)
 * - Consent history tracking
 * - Audit logging
 * 
 * All operations are irreversible and comply with Indian DPDP principles.
 */

const User = require('../../models/user.model')
const Resume = require('../../models/resume.model')
const Score = require('../../models/score.model')
const GitHub = require('../../models/github.model')
const Badge = require('../../models/badge.model')
const Connection = require('../../models/connection.model')
const SkillGap = require('../../models/skillgap.model')
const AuditLog = require('../../models/auditlog.model')
const ConsentHistory = require('../../models/consenthistory.model')

/**
 * RIGHT TO ERASURE
 * Hard delete user and all associated data
 * Cascades to all related collections
 * 
 * @param {string} userId - User ID to delete
 * @param {string} requestedBy - Admin user ID who requested deletion
 * @returns {Object} Deletion summary
 */
async function executeRightToErasure(userId, requestedBy) {
    try {
        // Verify user exists
        const user = await User.findById(userId)
        if (!user) {
            throw new Error('User not found')
        }

        // Store minimal metadata for audit (before deletion)
        const deletionMetadata = {
            userId,
            department: user.department,
            graduationYear: user.graduationYear,
            deletedAt: new Date(),
            requestedBy
        }

        // Execute cascading deletes
        const deletionResults = await Promise.all([
            Resume.deleteMany({ user: userId }),
            Score.deleteMany({ user: userId }),
            GitHub.deleteMany({ user: userId }),
            Badge.deleteMany({ user: userId }),
            SkillGap.deleteMany({ user: userId }),
            Connection.deleteMany({ $or: [{ requester: userId }, { recipient: userId }] }),
            ConsentHistory.deleteMany({ user: userId }),
            User.findByIdAndDelete(userId)
        ])

        const summary = {
            resumes: deletionResults[0].deletedCount,
            scores: deletionResults[1].deletedCount,
            github: deletionResults[2].deletedCount,
            badges: deletionResults[3].deletedCount,
            skillGaps: deletionResults[4].deletedCount,
            connections: deletionResults[5].deletedCount,
            consentRecords: deletionResults[6].deletedCount,
            user: deletionResults[7] ? 1 : 0
        }

        // Create audit log
        await AuditLog.create({
            action: 'RIGHT_TO_ERASURE',
            performedBy: requestedBy,
            targetUser: userId,
            metadata: {
                ...deletionMetadata,
                deletionSummary: summary
            },
            timestamp: new Date()
        })

        console.log(`[Privacy] Right to Erasure executed for user ${userId}`)
        return {
            success: true,
            summary,
            message: 'All user data has been permanently deleted'
        }
    } catch (err) {
        console.error(`[Privacy] Erasure error for user ${userId}:`, err.message)

        // Log failed attempt
        await AuditLog.create({
            action: 'RIGHT_TO_ERASURE_FAILED',
            performedBy: requestedBy,
            targetUser: userId,
            metadata: {
                error: err.message,
                timestamp: new Date()
            }
        })

        throw err
    }
}

/**
 * CONSENT HISTORY TRACKING
 * Record consent events (append-only, immutable)
 * 
 * @param {string} userId - User ID
 * @param {boolean} consented - Consent status
 * @param {string} consentType - Type of consent (e.g., 'DPDP_DATA_PROCESSING')
 * @returns {Object} Consent record
 */
async function recordConsentEvent(userId, consented, consentType = 'DPDP_DATA_PROCESSING') {
    const consentRecord = await ConsentHistory.create({
        user: userId,
        consented,
        consentType,
        timestamp: new Date(),
        ipAddress: null, // Can be added if needed
        userAgent: null  // Can be added if needed
    })

    console.log(`[Privacy] Consent recorded for user ${userId}: ${consented}`)
    return consentRecord
}

/**
 * GET CONSENT HISTORY
 * Retrieve consent history for a user
 * 
 * @param {string} userId - User ID
 * @returns {Array} Consent history
 */
async function getConsentHistory(userId) {
    const history = await ConsentHistory.find({ user: userId })
        .sort({ timestamp: -1 })
        .select('-__v')

    return history
}

/**
 * AUDIT LOG CREATION
 * Record admin actions for compliance
 * 
 * @param {string} action - Action performed
 * @param {string} performedBy - Admin user ID
 * @param {Object} metadata - Additional metadata
 */
async function createAuditLog(action, performedBy, metadata = {}) {
    await AuditLog.create({
        action,
        performedBy,
        metadata,
        timestamp: new Date()
    })

    console.log(`[Audit] ${action} by ${performedBy}`)
}

/**
 * GET AUDIT LOGS
 * Retrieve audit logs (admin only)
 * 
 * @param {Object} filters - Filter criteria
 * @param {number} limit - Max records to return
 * @returns {Array} Audit logs
 */
async function getAuditLogs(filters = {}, limit = 100) {
    const { action, performedBy, startDate, endDate } = filters

    const query = {}
    if (action) query.action = action
    if (performedBy) query.performedBy = performedBy
    if (startDate || endDate) {
        query.timestamp = {}
        if (startDate) query.timestamp.$gte = new Date(startDate)
        if (endDate) query.timestamp.$lte = new Date(endDate)
    }

    const logs = await AuditLog.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .select('-__v')

    return logs
}

/**
 * DATA EXPORT (for portability)
 * Export user's data in machine-readable format
 * 
 * @param {string} userId - User ID
 * @returns {Object} User data export
 */
async function exportUserData(userId) {
    const [user, scores, resumes, github, badges, skillGaps] = await Promise.all([
        User.findById(userId).select('-passwordHash -__v'),
        Score.find({ user: userId }).select('-__v'),
        Resume.find({ user: userId }).select('-__v'),
        GitHub.findOne({ user: userId }).select('-__v'),
        Badge.find({ user: userId }).select('-__v'),
        SkillGap.findOne({ user: userId }).select('-__v')
    ])

    return {
        exportDate: new Date(),
        user,
        scores,
        resumes,
        github,
        badges,
        skillGaps
    }
}

module.exports = {
    executeRightToErasure,
    recordConsentEvent,
    getConsentHistory,
    createAuditLog,
    getAuditLogs,
    exportUserData
}
