const jwt = require('jsonwebtoken')
const User = require('../models/user.model')
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/config')

function generateToken(user) {
  const payload = { sub: user._id.toString(), role: user.role, name: user.name }
  const opts = { expiresIn: JWT_EXPIRES_IN }
  return jwt.sign(payload, JWT_SECRET, opts)
}

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization || ''
  const match = auth.match(/^Bearer\s+(.*)$/i)
  if (!match) return res.status(401).json({ error: 'Missing token' })
  const token = match[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    // attach minimal user info to request
    req.user = { id: payload.sub, role: payload.role, name: payload.name }
    return next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Missing auth' })
    if (req.user.role !== role) return res.status(403).json({ error: 'Insufficient role' })
    return next()
  }
}

module.exports = { generateToken, verifyToken, requireRole }
