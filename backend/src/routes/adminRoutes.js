/**
 * Admin Routes
 * GET    /admin/users
 * GET    /admin/users/export
 * GET    /admin/analytics/platform
 * GET    /admin/analytics/cohorts
 * GET    /admin/analytics/skills
 * GET    /admin/analytics/at-risk
 * GET    /admin/analytics/trends
 * DELETE /admin/privacy/erase/:userId
 * GET    /admin/privacy/consent/:userId
 * GET    /admin/privacy/export/:userId
 * GET    /admin/audit-logs
 * GET    /admin/badges
 * POST   /admin/badges
 * DELETE /admin/badges/:badgeId
 * POST   /admin/users/:userId/badges
 * DELETE /admin/users/:userId/badges/:badgeId
 */

const express = require('express')
const router = express.Router()
const { verifyToken, requireRole } = require('../middleware/auth')
const { adminLimiter } = require('../middleware/rateLimit')
const {
    getCohortAnalytics, getSkillIntelligence, getAtRiskCohorts, getTrendAnalysis, getPlatformStats,
} = require('../services/analytics/adminAnalytics')
const {
    executeRightToErasure, getConsentHistory, createAuditLog, getAuditLogs, exportUserData,
} = require('../services/privacy/privacyService')
const { withCache } = require('../services/analytics/analyticsCache')
const { getUsers, exportUsersCsv, createBadgeDefinition, assignBadge, removeBadge } = require('../controllers/adminController')
const logger = require('../utils/logger')

// Apply rate limiting to all admin routes
router.use(adminLimiter)

// Get all users (admin)
router.get('/admin/users', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await getUsers(req.query)
        await createAuditLog('ADMIN_VIEW_USERS', req.user.id, req.query)
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Export users CSV
router.get('/admin/users/export', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const csv = await exportUsersCsv(req.query)
        await createAuditLog('ADMIN_EXPORT_USERS', req.user.id, req.query)
        res.header('Content-Type', 'text/csv')
        res.attachment(`users_export_${Date.now()}.csv`)
        return res.send(csv)
    } catch (err) {
        next(err)
    }
})

// Platform overview
router.get('/admin/analytics/platform', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const stats = await withCache('getPlatformStats', {}, async () => getPlatformStats())
        await createAuditLog('ADMIN_VIEW_PLATFORM_STATS', req.user.id)
        return res.json(stats)
    } catch (err) {
        next(err)
    }
})

// Cohort analytics
router.get('/admin/analytics/cohorts', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { department, graduationYear } = req.query
        const analytics = await withCache('getCohortAnalytics', { department, graduationYear }, async () => getCohortAnalytics({ department, graduationYear }))
        await createAuditLog('ADMIN_VIEW_COHORT_ANALYTICS', req.user.id, { department, graduationYear })
        return res.json({ cohorts: analytics })
    } catch (err) {
        next(err)
    }
})

// Skill intelligence
router.get('/admin/analytics/skills', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { department, graduationYear } = req.query
        const skills = await withCache('getSkillIntelligence', { department, graduationYear }, async () => getSkillIntelligence({ department, graduationYear }))
        await createAuditLog('ADMIN_VIEW_SKILL_INTELLIGENCE', req.user.id, { department, graduationYear })
        return res.json(skills)
    } catch (err) {
        next(err)
    }
})

// At-risk cohorts
router.get('/admin/analytics/at-risk', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const atRisk = await withCache('getAtRiskCohorts', {}, async () => getAtRiskCohorts())
        await createAuditLog('ADMIN_VIEW_AT_RISK_COHORTS', req.user.id)
        return res.json({ atRiskCohorts: atRisk })
    } catch (err) {
        next(err)
    }
})

// Trend analysis
router.get('/admin/analytics/trends', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { department, graduationYear, months } = req.query
        const trends = await withCache('getTrendAnalysis', { department, graduationYear, months }, async () => getTrendAnalysis({ department, graduationYear, months: months ? Number(months) : 6 }))
        await createAuditLog('ADMIN_VIEW_TRENDS', req.user.id, { department, graduationYear, months })
        return res.json({ trends })
    } catch (err) {
        next(err)
    }
})

// Right to erasure
router.delete('/admin/privacy/erase/:userId', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await executeRightToErasure(req.params.userId, req.user.id)
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Consent history
router.get('/admin/privacy/consent/:userId', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const history = await getConsentHistory(req.params.userId)
        await createAuditLog('ADMIN_VIEW_CONSENT_HISTORY', req.user.id, { targetUser: req.params.userId })
        return res.json({ consentHistory: history })
    } catch (err) {
        next(err)
    }
})

// Export user data
router.get('/admin/privacy/export/:userId', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const data = await exportUserData(req.params.userId)
        await createAuditLog('ADMIN_EXPORT_USER_DATA', req.user.id, { targetUser: req.params.userId })
        return res.json(data)
    } catch (err) {
        next(err)
    }
})

// Audit logs
router.get('/admin/audit-logs', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { action, performedBy, startDate, endDate, limit } = req.query
        const logs = await getAuditLogs({ action, performedBy, startDate, endDate }, limit ? Number(limit) : 100)
        return res.json({ logs })
    } catch (err) {
        next(err)
    }
})

// Create badge definition (with icon upload)
router.post('/admin/badges', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { name, description, criteria, points } = req.body
        if (!req.files || !req.files.icon) return res.status(400).json({ error: 'Icon image is required' })
        
        const badgeDef = await createBadgeDefinition(
            { name, description, criteria, points },
            req.files.icon,
            req.protocol,
            req.get('host')
        )
        
        await createAuditLog('ADMIN_CREATE_BADGE', req.user.id, { badgeName: name })
        return res.json({ badge: badgeDef })
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: 'Badge name already exists' })
        if (err.message.includes('required') || err.message.includes('must be')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Soft-delete badge definition
router.delete('/admin/badges/:badgeId', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await removeBadge(req.params.badgeId)
        await createAuditLog('ADMIN_DELETE_BADGE', req.user.id, { badgeId: req.params.badgeId })
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Assign badge to user
router.post('/admin/users/:userId/badges', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await assignBadge(req.params.userId, req.body.badgeDefId)
        await createAuditLog('ADMIN_ASSIGN_BADGE', req.user.id, { targetUser: req.params.userId, badgeDefId: req.body.badgeDefId })
        return res.json({ badge: result })
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('already has')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Remove badge from user
router.delete('/admin/users/:userId/badges/:badgeId', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await removeBadge(req.params.userId, req.params.badgeId)
        await createAuditLog('ADMIN_REMOVE_BADGE', req.user.id, { targetUser: req.params.userId, badgeId: req.params.badgeId })
        return res.json(result)
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('does not belong')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

module.exports = router
