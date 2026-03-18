/**
 * Leaderboard Routes
 * GET /leaderboard
 * GET /leaderboard/admin
 * GET /admin/stats/departments
 * GET /admin/stats/years
 * GET /admin/export/anonymized.csv
 */

const express = require('express')
const router = express.Router()
const { verifyToken, requireRole } = require('../middleware/auth')
const { getPublicLeaderboard, getAdminLeaderboard, getDepartmentStats, getYearStats, exportAnonymizedCsv } = require('../controllers/leaderboardController')

// Public leaderboard
router.get('/leaderboard', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    try {
        const result = await getPublicLeaderboard(req.query)
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Admin leaderboard (includes PII)
router.get('/leaderboard/admin', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await getAdminLeaderboard(req.query)
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Admin: department stats
router.get('/admin/stats/departments', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await getDepartmentStats()
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Admin: year-wise stats
router.get('/admin/stats/years', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const result = await getYearStats()
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Admin: anonymized CSV export
router.get('/admin/export/anonymized.csv', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const csv = await exportAnonymizedCsv(req.query)
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="leaderboard_anonymized.csv"')
        return res.send(csv)
    } catch (err) {
        next(err)
    }
})

module.exports = router
