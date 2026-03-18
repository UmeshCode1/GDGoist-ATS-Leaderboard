/**
 * Badge Routes
 * GET /badges
 * GET /badges/definitions
 * GET /badges/all
 * GET /badges/progress
 * GET /me/badges
 */

const express = require('express')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const Badge = require('../models/badge.model')
const BadgeDefinition = require('../models/badgeDefinition.model')
const { getUserBadges, BADGE_DEFINITIONS, getBadgeProgress } = require('../services/badges/badgeService')
const { formatBadges } = require('../utils/badgeFormatter')

// Get user's earned badges
router.get('/badges', verifyToken, async (req, res, next) => {
    try {
        const badges = await getUserBadges(req.user.id)
        return res.json({ badges })
    } catch (err) {
        next(err)
    }
})

// Get static badge definitions
router.get('/badges/definitions', (_req, res) => {
    return res.json({ definitions: BADGE_DEFINITIONS })
})

// GET all active badge definitions (Admin/Public)
router.get('/badges/all', async (_req, res, next) => {
    try {
        const badges = await BadgeDefinition.find({ active: true }).sort('createdAt')
        return res.json({ badges })
    } catch (err) {
        next(err)
    }
})

// Get badge progress for current user
router.get('/badges/progress', verifyToken, async (req, res, next) => {
    try {
        const progress = await getBadgeProgress(req.user.id)
        return res.json({ progress })
    } catch (err) {
        next(err)
    }
})

// GET my badges (student, populated with definitions)
router.get('/me/badges', verifyToken, async (req, res, next) => {
    try {
        const badges = await getUserBadges(req.user.id)
        const baseUrl = `${req.protocol}://${req.get('host')}`
        const formattedBadges = formatBadges(badges, baseUrl)
        return res.json({ badges: formattedBadges, progress: await getBadgeProgress(req.user.id) })
    } catch (err) {
        next(err)
    }
})

module.exports = router
