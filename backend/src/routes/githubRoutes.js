/**
 * GitHub Routes
 * GET    /github/auth-url
 * POST   /github/callback
 * GET    /github/profile
 * POST   /github/connect
 * DELETE /github/disconnect
 * POST   /github/sync
 */

const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const GitHub = require('../models/github.model')
const User = require('../models/user.model')
const { getAuthorizationUrl, getAccessToken, syncGitHubData } = require('../services/github/githubApi')
const { checkAndAwardBadges } = require('../services/badges/badgeService')
const { recalculateUserScore } = require('../services/scoring/scoreService')
const { startScheduler: startGitHubScheduler, triggerUserSync } = require('../services/github/githubScheduler')
const logger = require('../utils/logger')

// Get GitHub OAuth URL
router.get('/github/auth-url', verifyToken, (req, res) => {
    const state = crypto.randomBytes(16).toString('hex')
    const url = getAuthorizationUrl(state)
    return res.json({ authUrl: url, state })
})

// GitHub OAuth callback handler
router.post('/github/callback', verifyToken, async (req, res, next) => {
    try {
        const { code } = req.body
        if (!code) return res.status(400).json({ error: 'code required' })

        const accessToken = await getAccessToken(code)
        const syncResult = await syncGitHubData(code.split('_')[0] || 'unknown', accessToken)

        let githubDoc = await GitHub.findOne({ user: req.user.id })
        if (!githubDoc) {
            githubDoc = await GitHub.create({
                user: req.user.id,
                githubUsername: syncResult.profile.name || 'unknown',
                accessToken,
                profile: syncResult.profile,
                stats: syncResult.stats,
                lastSyncedAt: new Date(),
                syncStatus: 'completed',
            })
        } else {
            githubDoc.accessToken = accessToken
            githubDoc.profile = syncResult.profile
            githubDoc.stats = syncResult.stats
            githubDoc.lastSyncedAt = new Date()
            githubDoc.syncStatus = 'completed'
            await githubDoc.save()
        }

        const user = await User.findById(req.user.id)
        user.githubProfile = syncResult.profile.name
        user.github = {
            username: syncResult.profile.login || syncResult.profile.name,
            connected: true,
            lastSyncedAt: new Date(),
        }
        await user.save()

        const newBadges = await checkAndAwardBadges(req.user.id)
        await recalculateUserScore(req.user.id)

        return res.json({ message: 'GitHub connected successfully', profile: syncResult.profile, stats: syncResult.stats, newBadges })
    } catch (err) {
        next(err)
    }
})

// Get user's GitHub profile
router.get('/github/profile', verifyToken, async (req, res, next) => {
    try {
        const githubData = await GitHub.findOne({ user: req.user.id })
        if (!githubData) return res.status(404).json({ error: 'GitHub not connected' })
        return res.json({ profile: githubData.profile, stats: githubData.stats, lastSyncedAt: githubData.lastSyncedAt })
    } catch (err) {
        next(err)
    }
})

// Connect GitHub (persist from frontend)
router.post('/github/connect', verifyToken, async (req, res, next) => {
    try {
        const { username, profile, stats } = req.body
        if (!username) return res.status(400).json({ error: 'GitHub username is required' })

        const githubData = await GitHub.findOneAndUpdate(
            { user: req.user.id },
            {
                user: req.user.id,
                githubUsername: username,
                profile: {
                    login: profile?.login || username,
                    name: profile?.name || username,
                    bio: profile?.bio || '',
                    avatarUrl: profile?.avatarUrl || '',
                    publicRepos: profile?.publicRepos || 0,
                    followers: profile?.followers || 0,
                    following: profile?.following || 0,
                    location: profile?.location || '',
                    company: profile?.company || '',
                },
                stats: {
                    totalCommits: stats?.totalCommits || 0,
                    totalPullRequests: stats?.totalPullRequests || 0,
                    totalStars: stats?.totalStars || 0,
                    languages: stats?.languages || [],
                    topRepositories: stats?.topRepositories || [],
                },
                lastSyncedAt: new Date(),
                syncStatus: 'completed',
            },
            { upsert: true, new: true },
        )

        await User.findByIdAndUpdate(req.user.id, {
            'github.username': username,
            'github.connected': true,
            'github.lastSyncedAt': new Date(),
        })

        logger.info(`[GitHub] Connected: ${username} for user ${req.user.id}`)

        return res.json({
            success: true,
            message: 'GitHub connected successfully',
            github: { username: githubData.githubUsername, profile: githubData.profile, stats: githubData.stats, lastSyncedAt: githubData.lastSyncedAt },
        })
    } catch (err) {
        next(err)
    }
})

// Disconnect GitHub
router.delete('/github/disconnect', verifyToken, async (req, res, next) => {
    try {
        await GitHub.findOneAndDelete({ user: req.user.id })
        await User.findByIdAndUpdate(req.user.id, {
            'github.username': null,
            'github.connected': false,
            'github.lastSyncedAt': null,
        })
        logger.info(`[GitHub] Disconnected for user ${req.user.id}`)
        return res.json({ success: true, message: 'GitHub disconnected successfully' })
    } catch (err) {
        next(err)
    }
})

// Manually trigger GitHub sync
router.post('/github/sync', verifyToken, async (req, res, next) => {
    try {
        const result = await triggerUserSync(req.user.id)
        if (result.skipped) return res.json({ message: 'Sync skipped - too recent', reason: result.reason })
        if (result.success) return res.json({ message: 'GitHub data synced successfully', stats: result.stats })
        return res.status(500).json({ error: result.error })
    } catch (err) {
        next(err)
    }
})

module.exports = router
