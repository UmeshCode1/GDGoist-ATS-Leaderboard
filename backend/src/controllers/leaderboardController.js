/**
 * Leaderboard Controller
 * 
 * Business logic for leaderboard operations extracted from route handlers
 * Follows Controller Pattern: Route → Controller → Service → Model
 */

const crypto = require('crypto')
const User = require('../models/user.model')
const Score = require('../models/score.model')
const { resolveAvatar } = require('../utils/avatarResolver')
const { formatBadges } = require('../utils/badgeFormatter')

/**
 * Get public leaderboard with pagination and filtering
 */
async function getPublicLeaderboard(filters) {
    const { department, graduationYear, limit = 50, page = 1 } = filters
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50))

    // Build match stage for filtering
    const matchStage = {}
    if (department) matchStage['userDoc.department'] = department
    if (graduationYear) matchStage['userDoc.graduationYear'] = Number(graduationYear)

    // Build aggregation pipeline
    const facet = {
        $facet: {
            data: [{ $sort: { totalScore: -1 } }, { $skip: (pageNum - 1) * lim }, { $limit: lim }],
            totalCount: [{ $count: 'count' }],
        },
    }

    const pipeline = [
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userDoc' } },
        { $unwind: '$userDoc' },
        { $lookup: { from: 'githubs', localField: 'user', foreignField: 'user', as: 'githubDoc' } },
        { $unwind: { path: '$githubDoc', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'badges',
                let: { userId: '$user' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
                    { $lookup: { from: 'badgedefinitions', localField: 'definitionId', foreignField: '_id', as: 'definition' } },
                    { $unwind: { path: '$definition', preserveNullAndEmptyArrays: true } },
                ],
                as: 'badges',
            },
        },
    ]
    
    if (Object.keys(matchStage).length) pipeline.push({ $match: matchStage })
    pipeline.push(facet)

    // Execute aggregation
    const agg = await Score.aggregate(pipeline)
    const data = (agg[0] && agg[0].data) || []
    const totalCount = (agg[0] && agg[0].totalCount[0] && agg[0].totalCount[0].count) || 0
    const rankOffset = (pageNum - 1) * lim

    // Format entries with badges and avatars
    const entries = data.map((d, i) => {
        const finalAvatar = resolveAvatar(d.userDoc, d.githubDoc)
        return {
            rank: rankOffset + i + 1,
            userId: d.userDoc._id,
            totalScore: d.totalScore,
            name: d.userDoc.name || 'Anonymous',
            department: d.userDoc.department || null,
            graduationYear: d.userDoc.graduationYear || null,
            profilePicture: finalAvatar,
            badges: formatBadges(d.badges || [], 'http://localhost:4000').slice(0, 3),
        }
    })

    return { totalCount, page: pageNum, limit: lim, entries }
}

/**
 * Get admin leaderboard with PII (Personally Identifiable Information)
 */
async function getAdminLeaderboard(filters) {
    const { department, graduationYear, limit = 200, page = 1 } = filters
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const lim = Math.max(1, Math.min(1000, parseInt(limit, 10) || 200))

    // Build match stage for filtering
    const matchStage = {}
    if (department) matchStage['userDoc.department'] = department
    if (graduationYear) matchStage['userDoc.graduationYear'] = Number(graduationYear)

    // Build aggregation pipeline for admin (includes PII)
    const pipeline = [
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userDoc' } },
        { $unwind: '$userDoc' },
    ]
    
    if (Object.keys(matchStage).length) pipeline.push({ $match: matchStage })
    pipeline.push({
        $facet: {
            data: [{ $sort: { totalScore: -1 } }, { $skip: (pageNum - 1) * lim }, { $limit: lim }],
            totalCount: [{ $count: 'count' }],
        },
    })

    // Execute aggregation
    const agg = await Score.aggregate(pipeline)
    const data = (agg[0] && agg[0].data) || []
    const totalCount = (agg[0] && agg[0].totalCount[0] && agg[0].totalCount[0].count) || 0
    const rankOffset = (pageNum - 1) * lim

    // Format entries with PII
    const entries = data.map((d, i) => ({
        rank: rankOffset + i + 1,
        totalScore: d.totalScore,
        user: { id: d.userDoc._id, name: d.userDoc.name, email: d.userDoc.email },
        department: d.userDoc.department || null,
        graduationYear: d.userDoc.graduationYear || null,
    }))

    return { totalCount, page: pageNum, limit: lim, entries }
}

/**
 * Get department statistics with score distribution
 */
async function getDepartmentStats() {
    const docs = await Score.aggregate([
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userDoc' } },
        { $unwind: '$userDoc' },
        { $project: { totalScore: 1, department: '$userDoc.department', graduationYear: '$userDoc.graduationYear' } },
    ])

    // Group by department and calculate statistics
    const byDept = {}
    for (const d of docs) {
        const dept = d.department || 'Unknown'
        if (!byDept[dept]) byDept[dept] = { scores: [] }
        byDept[dept].scores.push(d.totalScore || 0)
    }

    // Create score distribution buckets (0-9, 10-19, ..., 90-100)
    const buckets = Array.from({ length: 11 }, (_, i) => ({ min: i * 10, max: i * 10 + 9 }))
    const result = []

    for (const [dept, info] of Object.entries(byDept)) {
        const scores = info.scores
        const count = scores.length
        const avg = count ? (scores.reduce((a, b) => a + b, 0) / count) : 0
        const min = count ? Math.min(...scores) : 0
        const max = count ? Math.max(...scores) : 0

        // Create histogram
        const hist = buckets.map(b => ({ range: `${b.min}-${b.max}`, count: 0 }))
        for (const s of scores) { 
            hist[Math.min(10, Math.floor((s || 0) / 10))].count += 1 
        }

        result.push({ 
            department: dept, 
            count, 
            avg: Number(avg.toFixed(2)), 
            min, 
            max, 
            histogram: hist 
        })
    }

    return { departments: result }
}

/**
 * Get graduation year statistics
 */
async function getYearStats() {
    const docs = await Score.aggregate([
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userDoc' } },
        { $unwind: '$userDoc' },
        { $project: { totalScore: 1, graduationYear: '$userDoc.graduationYear' } },
        { 
            $group: { 
                _id: '$graduationYear', 
                count: { $sum: 1 }, 
                avg: { $avg: '$totalScore' }, 
                min: { $min: '$totalScore' }, 
                max: { $max: '$totalScore' } 
            } 
        },
        { $sort: { _id: 1 } },
    ])

    return { 
        years: docs.map(d => ({ 
            graduationYear: d._id || 'Unknown', 
            count: d.count, 
            avg: Number((d.avg || 0).toFixed(2)), 
            min: d.min || 0, 
            max: d.max || 0 
        }))
    }
}

/**
 * Export anonymized leaderboard data as CSV
 */
async function exportAnonymizedCsv(filters) {
    const { department, graduationYear } = filters

    // Build match stage for filtering
    const matchStage = {}
    if (department) matchStage['userDoc.department'] = department
    if (graduationYear) matchStage['userDoc.graduationYear'] = Number(graduationYear)

    // Build aggregation pipeline
    const pipeline = [
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userDoc' } },
        { $unwind: '$userDoc' },
    ]
    
    if (Object.keys(matchStage).length) pipeline.push({ $match: matchStage })
    pipeline.push({ $sort: { totalScore: -1 } })

    // Execute aggregation
    const docs = await Score.aggregate(pipeline)

    // Generate CSV with anonymized IDs
    const rows = [['anon_id', 'department', 'graduationYear', 'rank', 'totalScore']]
    let rank = 1
    
    for (const d of docs) {
        // Create anonymized ID using SHA256 hash (first 12 characters)
        const hash = crypto.createHash('sha256').update(String(d.user)).digest('hex').slice(0, 12)
        rows.push([
            hash, 
            (d.userDoc && d.userDoc.department) || '', 
            (d.userDoc && d.userDoc.graduationYear) || '', 
            String(rank), 
            String(d.totalScore || 0)
        ])
        rank++
    }

    // Convert to CSV string
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    return csv
}

module.exports = {
    getPublicLeaderboard,
    getAdminLeaderboard,
    getDepartmentStats,
    getYearStats,
    exportAnonymizedCsv
}
