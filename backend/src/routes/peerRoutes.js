/**
 * Peer Discovery & Connection Routes
 * GET  /peers/search
 * POST /connections/request
 * GET  /connections/pending
 * POST /connections/:connectionId/respond
 * GET  /connections
 */

const express = require('express')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const { searchPeers, sendConnectionRequest, getUserConnections, respondToConnection } = require('../controllers/peerController')

// Search peers by skills / name
router.get('/peers/search', verifyToken, async (req, res, next) => {
    try {
        const baseUrl = `${req.protocol}://${req.get('host')}`
        const result = await searchPeers(req.query, baseUrl)
        return res.json(result)
    } catch (err) {
        next(err)
    }
})

// Send connection request
router.post('/connections/request', verifyToken, async (req, res, next) => {
    try {
        const { recipientId, message } = req.body
        if (!recipientId) return res.status(400).json({ error: 'recipientId required' })
        if (recipientId === req.user.id) return res.status(400).json({ error: 'Cannot connect with yourself' })
        
        const connection = await sendConnectionRequest(req.user.id, recipientId, message)
        return res.status(201).json({ connection })
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('already exists')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Get pending connection requests
router.get('/connections/pending', verifyToken, async (req, res, next) => {
    try {
        const connections = await getUserConnections(req.user.id, 'pending')
        const pendingRequests = connections.filter(conn => conn.direction === 'received')
        return res.json({ requests: pendingRequests })
    } catch (err) {
        next(err)
    }
})

// Accept / reject a connection request
router.post('/connections/:connectionId/respond', verifyToken, async (req, res, next) => {
    try {
        const { connectionId } = req.params
        const { action } = req.body

        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'action must be accept or reject' })
        }

        const connection = await respondToConnection(connectionId, req.user.id, action)
        return res.json({ connection })
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('authorized') || err.message.includes('processed')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Get user's accepted connections
router.get('/connections', verifyToken, async (req, res, next) => {
    try {
        const connections = await getUserConnections(req.user.id, 'accepted')
        return res.json({ connections })
    } catch (err) {
        next(err)
    }
})

module.exports = router
