/**
 * PHASE 2: GitHub Sync Scheduler
 * 
 * Handles periodic GitHub data synchronization for all connected users.
 * Ensures GitHub scores stay up-to-date without manual intervention.
 */

const GitHub = require('../../models/github.model')
const { syncGitHubData } = require('./githubApi')
const { recalculateUserScore } = require('../scoring/scoreService')
const { checkAndAwardBadges } = require('../badges/badgeService')

// Sync interval: 24 hours (in milliseconds)
const SYNC_INTERVAL = 24 * 60 * 60 * 1000

// Maximum concurrent syncs to avoid rate limiting
const MAX_CONCURRENT_SYNCS = 5

// Minimum time between syncs for a single user (6 hours)
const MIN_SYNC_INTERVAL = 6 * 60 * 60 * 1000

/**
 * Sync GitHub data for a single user
 */
async function syncUserGitHub(userId, githubDoc) {
    try {
        console.log(`[GitHub Sync] Starting sync for user ${userId}`)

        // Check if sync is too recent
        const timeSinceLastSync = Date.now() - new Date(githubDoc.lastSyncedAt).getTime()
        if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
            console.log(`[GitHub Sync] Skipping user ${userId} - synced ${Math.round(timeSinceLastSync / 1000 / 60)} minutes ago`)
            return { skipped: true, reason: 'too_recent' }
        }

        // Update sync status
        githubDoc.syncStatus = 'syncing'
        await githubDoc.save()

        // Fetch fresh data from GitHub
        const syncResult = await syncGitHubData(
            githubDoc.githubUsername || 'unknown',
            githubDoc.accessToken
        )

        // Detect forks
        const forkRatio = detectForkRatio(syncResult.stats)

        // Update GitHub document
        githubDoc.profile = syncResult.profile
        githubDoc.stats = {
            ...syncResult.stats,
            forkRatio,
        }
        githubDoc.lastSyncedAt = new Date()
        githubDoc.syncStatus = 'completed'
        githubDoc.lastSyncError = null
        await githubDoc.save()

        // Check for new badges
        await checkAndAwardBadges(userId)

        // Recalculate score
        await recalculateUserScore(userId)

        console.log(`[GitHub Sync] Completed sync for user ${userId}`)
        return { success: true, stats: syncResult.stats }
    } catch (err) {
        console.error(`[GitHub Sync] Error syncing user ${userId}:`, err.message)

        // Update error status
        githubDoc.syncStatus = 'failed'
        githubDoc.lastSyncError = err.message
        await githubDoc.save()

        return { success: false, error: err.message }
    }
}

/**
 * Detect fork ratio in repositories
 * Returns ratio of forked repos to total repos
 */
function detectForkRatio(stats) {
    if (!stats.topRepositories || stats.topRepositories.length === 0) {
        return 0
    }

    // This is a simplified version - in production, you'd check the 'fork' field
    // For now, we'll return 0 as we don't have fork data in the current structure
    return 0
}

/**
 * Sync all users with GitHub connections
 */
async function syncAllUsers() {
    try {
        console.log('[GitHub Sync] Starting batch sync for all users')

        // FIXED: Query User collection for github.connected flag
        const User = require('./models/user.model')
        const connectedUsers = await User.find({
            'github.connected': true
        }).select('_id github')

        console.log(`[GitHub Sync] Found ${connectedUsers.length} users with GitHub connections`)

        // Get GitHub documents for these users
        const githubDocs = []
        for (const user of connectedUsers) {
            const githubDoc = await GitHub.findOne({ user: user._id })
            if (githubDoc) {
                githubDocs.push(githubDoc)
            }
        }

        console.log(`[GitHub Sync] Found ${githubDocs.length} GitHub documents to sync`)

        // Process in batches to avoid rate limiting
        const results = {
            total: githubDocs.length,
            success: 0,
            failed: 0,
            skipped: 0,
        }

        for (let i = 0; i < githubDocs.length; i += MAX_CONCURRENT_SYNCS) {
            const batch = githubDocs.slice(i, i + MAX_CONCURRENT_SYNCS)

            const batchResults = await Promise.allSettled(
                batch.map(doc => syncUserGitHub(doc.user.toString(), doc))
            )

            // Count results
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    if (result.value.success) {
                        results.success++
                    } else if (result.value.skipped) {
                        results.skipped++
                    } else {
                        results.failed++
                    }
                } else {
                    results.failed++
                }
            }

            // Wait between batches to respect rate limits
            if (i + MAX_CONCURRENT_SYNCS < githubDocs.length) {
                await new Promise(resolve => setTimeout(resolve, 2000))
            }
        }

        console.log('[GitHub Sync] Batch sync completed:', results)
        return results
    } catch (err) {
        console.error('[GitHub Sync] Batch sync error:', err.message)
        throw err
    }
}

/**
 * Start periodic GitHub sync scheduler
 */
function startScheduler() {
    console.log('[GitHub Sync] Starting scheduler (24h interval)')

    // Run initial sync after 5 minutes
    setTimeout(() => {
        syncAllUsers().catch(err => {
            console.error('[GitHub Sync] Scheduled sync error:', err.message)
        })
    }, 5 * 60 * 1000)

    // Schedule periodic syncs
    setInterval(() => {
        syncAllUsers().catch(err => {
            console.error('[GitHub Sync] Scheduled sync error:', err.message)
        })
    }, SYNC_INTERVAL)
}

/**
 * Manually trigger sync for a specific user
 */
async function triggerUserSync(userId) {
    const githubDoc = await GitHub.findOne({ user: userId })

    if (!githubDoc) {
        throw new Error('GitHub not connected for this user')
    }

    return await syncUserGitHub(userId, githubDoc)
}

module.exports = {
    syncUserGitHub,
    syncAllUsers,
    startScheduler,
    triggerUserSync,
    SYNC_INTERVAL,
    MIN_SYNC_INTERVAL,
}
