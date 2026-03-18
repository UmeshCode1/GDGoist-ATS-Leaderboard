/**
 * Peer Controller
 * 
 * Business logic for peer operations extracted from route handlers
 * Follows Controller Pattern: Route → Controller → Service → Model
 */

const mongoose = require('mongoose')
const User = require('../models/user.model')
const Connection = require('../models/connection.model')
const Score = require('../models/score.model')
const { recalculateUserScore } = require('../services/scoring/scoreService')
const { awardBadge } = require('../services/badges/badgeService')
const { resolveAvatar } = require('../utils/avatarResolver')

/**
 * Search peers by skills, name, or keywords
 */
async function searchPeers(query, baseUrl) {
    const { q, skills, limit = 20, page = 1 } = query
    const searchQuery = q || (Array.isArray(skills) ? skills.join(' ') : skills) || ''
    
    if (!searchQuery.trim()) {
        return { peers: [], totalCount: 0 }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const lim = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))

    // Build search pipeline
    const pipeline = [
        // Match students only (exclude admins)
        { $match: { role: { $ne: 'admin' } } },
        // GitHub lookup for skills
        {
            $lookup: {
                from: 'githubs',
                localField: '_id',
                foreignField: 'user',
                as: 'githubDoc'
            }
        },
        { $unwind: { path: '$githubDoc', preserveNullAndEmptyArrays: true } },
        // Score lookup
        {
            $lookup: {
                from: 'scores',
                localField: '_id',
                foreignField: 'user',
                as: 'scores'
            }
        },
        // Search across name, email, department, and GitHub skills
        {
            $match: {
                $or: [
                    { name: { $regex: searchQuery, $options: 'i' } },
                    { email: { $regex: searchQuery, $options: 'i' } },
                    { department: { $regex: searchQuery, $options: 'i' } },
                    { 'githubDoc.stats.languages': { $regex: searchQuery, $options: 'i' } }
                ]
            }
        },
        // Add search score for ranking
        {
            $addFields: {
                searchScore: {
                    $add: [
                        { $cond: [{ $regexMatch: { input: '$name', regex: searchQuery, options: 'i' } }, 3, 0] },
                        { $cond: [{ $regexMatch: { input: '$department', regex: searchQuery, options: 'i' } }, 2, 0] },
                        { $cond: [{ $regexMatch: { input: { $arrayElemAt: ['$githubDoc.stats.languages', 0] }, regex: searchQuery, options: 'i' } }, 1, 0] }
                    ]
                }
            }
        },
        // Sort by search score, then by total score
        { $sort: { searchScore: -1, 'scores.0.totalScore': -1 } },
        // Pagination
        { $skip: (pageNum - 1) * lim },
        { $limit: lim },
        // Project final fields
        {
            $project: {
                _id: 1,
                name: 1,
                email: 1,
                department: 1,
                graduationYear: 1,
                profilePicture: 1,
                githubDoc: 1,
                searchScore: 1
            }
        }
    ]

    const agg = await User.aggregate(pipeline)
    const users = agg[0]?.data || agg // Handle both facet and direct results
    const totalCount = agg[0]?.totalCount?.[0]?.count || users.length

    // Format results
    const peers = await Promise.all(
        users.map(async (u) => {
            const latestScore = await Score.findOne({ user: u._id }).sort({ createdAt: -1 })
            const finalAvatar = resolveAvatar(u, u.githubDoc)
            
            // Fix relative avatar URLs
            if (finalAvatar && finalAvatar.startsWith('/')) {
                finalAvatar = `${baseUrl}${finalAvatar}`
            }
            
            return {
                id: u._id,
                name: u.name,
                email: u.email,
                department: u.department,
                graduationYear: u.graduationYear,
                profilePicture: finalAvatar,
                skills: u.githubDoc?.stats?.languages || [],
                score: latestScore ? latestScore.totalScore : 0,
                searchScore: u.searchScore || 0
            }
        })
    )

    return { peers, totalCount, page: pageNum, totalPages: Math.ceil(totalCount / lim) }
}

/**
 * Send connection request to a peer
 */
async function sendConnectionRequest(fromUserId, toUserId, message) {
    if (!mongoose.Types.ObjectId.isValid(toUserId)) {
        throw new Error('Invalid user ID')
    }

    // Check if target user exists and is not admin
    const targetUser = await User.findOne({ _id: toUserId, role: { $ne: 'admin' } })
    if (!targetUser) {
        throw new Error('User not found')
    }

    // Check if connection already exists
    const existingConnection = await Connection.findOne({
        $or: [
            { from: fromUserId, to: toUserId },
            { from: toUserId, to: fromUserId }
        ]
    })

    if (existingConnection) {
        throw new Error('Connection already exists')
    }

    // Create connection request
    const connection = await Connection.create({
        from: fromUserId,
        to: toUserId,
        message: message || '',
        status: 'pending'
    })

    // Award networking badge after 3 connections
    const connectionCount = await Connection.countDocuments({
        from: fromUserId,
        status: 'accepted'
    })

    if (connectionCount >= 2) { // This will be the 3rd connection when accepted
        await awardBadge(fromUserId, 'networking_ninja', {
            context: 'peer_connections',
            connectionCount: connectionCount + 1
        })
    }

    return connection
}

/**
 * Get user's connections (both sent and received)
 */
async function getUserConnections(userId, status) {
    const matchStage = { 
        $or: [{ from: new mongoose.Types.ObjectId(userId) }, { to: new mongoose.Types.ObjectId(userId) }] 
    }
    
    if (status) {
        matchStage.status = status
    }

    const connections = await Connection.find(matchStage)
        .populate('from', 'name email department graduationYear profilePicture')
        .populate('to', 'name email department graduationYear profilePicture')
        .sort({ createdAt: -1 })

    // Format connections to show the other user
    const formattedConnections = connections.map(conn => {
        const isFromMe = conn.from._id.toString() === userId
        const otherUser = isFromMe ? conn.to : conn.from
        
        return {
            id: conn._id,
            user: {
                id: otherUser._id,
                name: otherUser.name,
                email: otherUser.email,
                department: otherUser.department,
                graduationYear: otherUser.graduationYear,
                profilePicture: otherUser.profilePicture
            },
            status: conn.status,
            message: conn.message,
            createdAt: conn.createdAt,
            direction: isFromMe ? 'sent' : 'received'
        }
    })

    return formattedConnections
}

/**
 * Respond to connection request (accept/reject)
 */
async function respondToConnection(connectionId, userId, action) {
    const connection = await Connection.findById(connectionId)
    
    if (!connection) {
        throw new Error('Connection not found')
    }

    // Verify user is the recipient
    if (connection.to.toString() !== userId) {
        throw new Error('Not authorized to respond to this request')
    }

    if (connection.status !== 'pending') {
        throw new Error('Connection already processed')
    }

    // Update connection status
    connection.status = action === 'accept' ? 'accepted' : 'rejected'
    await connection.save()

    // If accepted, award networking badge
    if (action === 'accept') {
        try {
            await awardBadge(userId, 'networking_ninja', {
                context: 'peer_connections',
                connectionId: connection._id
            })
        } catch (badgeErr) {
            // Badge awarding is optional, don't fail the request
            console.warn('Failed to award networking badge:', badgeErr.message)
        }
    }

    return connection
}

module.exports = {
    searchPeers,
    sendConnectionRequest,
    getUserConnections,
    respondToConnection
}
