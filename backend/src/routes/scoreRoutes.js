/**
 * Score Routes
 * GET /score/breakdown
 */

const express = require('express')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const { getScoreBreakdown } = require('../services/scoring/scoreService')

router.get('/score/breakdown', verifyToken, async (req, res, next) => {
    try {
        const breakdown = await getScoreBreakdown(req.user.id)
        return res.json(breakdown)
    } catch (err) {
        next(err)
    }
})

module.exports = router
