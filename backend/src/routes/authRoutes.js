/**
 * Auth Routes
 * POST /auth/register
 * POST /auth/login
 * POST /auth/reset-password
 */

const express = require('express')
const bcrypt = require('bcryptjs')
const router = express.Router()
const User = require('../models/user.model')
const { generateToken, verifyToken, requireRole } = require('../middleware/auth')
const { determineUserRole } = require('../services/auth/authService')
const logger = require('../utils/logger')
const config = require('../config/config')

// Register
router.post('/auth/register', async (req, res, next) => {
    try {
        const { name, email, password } = req.body
        if (!email || !password) return res.status(400).json({ error: 'email and password required' })

        if (config.UNIVERSITY_DOMAIN && !email.toLowerCase().endsWith(config.UNIVERSITY_DOMAIN.toLowerCase())) {
            return res.status(400).json({ error: `email must be a ${config.UNIVERSITY_DOMAIN} address` })
        }

        const existing = await User.findOne({ email })
        if (existing) return res.status(409).json({ error: 'User already exists' })

        const role = determineUserRole(email)
        const passwordHash = await bcrypt.hash(password, 10)
        const user = await User.create({ name, email, passwordHash, role })
        const token = generateToken(user)

        logger.info(`[Auth] User registered: ${email} with role: ${role}`)
        return res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } })
    } catch (err) {
        next(err)
    }
})

// Login
router.post('/auth/login', async (req, res, next) => {
    try {
        const { email, password } = req.body
        if (!email || !password) return res.status(400).json({ error: 'email and password required' })

        const user = await User.findOne({ email })
        if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' })
        const ok = await bcrypt.compare(password, user.passwordHash)
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

        const expectedRole = determineUserRole(email)
        if (user.role !== expectedRole) {
            logger.info(`[Auth] Updating role for ${email}: ${user.role} -> ${expectedRole}`)
            user.role = expectedRole
            await user.save()
        }

        const token = generateToken(user)
        return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } })
    } catch (err) {
        next(err)
    }
})

// Password Reset (admin only)
router.post('/auth/reset-password', verifyToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { email, newPassword } = req.body
        if (!email || !newPassword) return res.status(400).json({ error: 'email and newPassword are required' })
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

        const user = await User.findOne({ email })
        if (!user) return res.status(404).json({ error: 'User not found' })

        user.passwordHash = await bcrypt.hash(newPassword, 10)
        await user.save()

        logger.info(`[Auth] Password reset successful for: ${email} (role: ${user.role})`)
        return res.json({ message: 'Password reset successful', user: { email: user.email, role: user.role, name: user.name } })
    } catch (err) {
        next(err)
    }
})

module.exports = router
