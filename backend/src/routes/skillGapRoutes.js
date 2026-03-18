/**
 * Skill Gap Routes
 * GET  /skillgap
 * POST /skillgap
 * GET  /skillgap/peers
 */

const express = require('express')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const SkillGap = require('../models/skillgap.model')
const { recalculateUserScore } = require('../services/scoring/scoreService')
const { awardBadge } = require('../services/badges/badgeService')

// Get or create skill gap analysis
router.get('/skillgap', verifyToken, async (req, res, next) => {
    try {
        let skillGap = await SkillGap.findOne({ user: req.user.id })
        if (!skillGap) {
            skillGap = await SkillGap.create({ user: req.user.id, targetRole: 'Software Engineer' })
        }
        return res.json({ skillGap })
    } catch (err) {
        next(err)
    }
})

// Update skill gap analysis
router.post('/skillgap', verifyToken, async (req, res, next) => {
    try {
        const { targetRole, userSkills } = req.body
        if (!targetRole) return res.status(400).json({ error: 'targetRole required' })

        let skillGap = await SkillGap.findOne({ user: req.user.id })
        if (!skillGap) skillGap = await SkillGap.create({ user: req.user.id })

        skillGap.targetRole = targetRole
        if (userSkills) skillGap.userSkills = userSkills

        const gaps = []
        const targetSkillsMap = {}
        if (skillGap.targetSkills) {
            for (const ts of skillGap.targetSkills) targetSkillsMap[ts.skill] = ts.importance
        }

        for (const skill of Object.keys(targetSkillsMap)) {
            const userSkill = skillGap.userSkills.find(s => s.skill === skill)
            const userProf = userSkill ? userSkill.proficiency : 0
            const importance = targetSkillsMap[skill]
            const gapScore = Math.max(0, importance - userProf)
            gaps.push({ skill, userProficiency: userProf, targetImportance: importance, gapScore })
        }

        skillGap.gaps = gaps
        skillGap.overallGapScore = gaps.length ? Math.round(gaps.reduce((sum, g) => sum + g.gapScore, 0) / gaps.length) : 0
        skillGap.lastAnalyzedAt = new Date()
        await skillGap.save()

        await awardBadge(req.user.id, 'skill_seeker', { targetRole })
        await recalculateUserScore(req.user.id)

        return res.json({ skillGap })
    } catch (err) {
        next(err)
    }
})

// Get peer comparison
router.get('/skillgap/peers', verifyToken, async (req, res, next) => {
    try {
        const userSkillGap = await SkillGap.findOne({ user: req.user.id })
        if (!userSkillGap) return res.status(404).json({ error: 'Skill gap not found' })

        const peerSkillGaps = await SkillGap.find({
            targetRole: userSkillGap.targetRole,
            user: { $ne: req.user.id },
        }).limit(10)

        const comparison = peerSkillGaps.map(p => ({ overallGapScore: p.overallGapScore, skillCount: p.gaps.length }))
        const avgPeerGap = comparison.length
            ? Math.round(comparison.reduce((sum, c) => sum + c.overallGapScore, 0) / comparison.length)
            : 0

        return res.json({ userGapScore: userSkillGap.overallGapScore, avgPeerGapScore: avgPeerGap, peerCount: comparison.length })
    } catch (err) {
        next(err)
    }
})

module.exports = router
