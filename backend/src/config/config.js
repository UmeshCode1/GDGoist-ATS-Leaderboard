/**
 * Application Configuration
 *
 * Single source of truth for all environment-level settings.
 * Import from here instead of reading process.env directly in route/service files.
 */

const { validateEnv } = require('./envValidator')
validateEnv() // Fail fast if required environment variables are missing

module.exports = {
    // ── Server ───────────────────────────────────────────────────
    PORT: process.env.PORT || 4000,
    NODE_ENV: process.env.NODE_ENV || 'development',

    // ── Database ─────────────────────────────────────────────────
    MONGO_URI: process.env.MONGO_URI,

    // ── Auth ─────────────────────────────────────────────────────
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

    // ── Domain / Admin ────────────────────────────────────────────
    UNIVERSITY_DOMAIN: process.env.UNIVERSITY_DOMAIN || null,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS || '',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174',

    // ── External Services ─────────────────────────────────────────
    ATS_SERVICE_URL: process.env.ATS_SERVICE_URL || 'http://localhost:8000',

    // ── AWS / S3 ──────────────────────────────────────────────────
    AWS_REGION: process.env.AWS_REGION || 'ap-south-1',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,

    // ── GitHub OAuth ──────────────────────────────────────────────
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL,

    // ── Scoring weights (read-only — frozen in scoreService.js) ───
    // These are documented here for visibility; the authoritative
    // values live in scoreService.js (WEIGHTS constant).
    SCORE_WEIGHT_ATS: 0.5,
    SCORE_WEIGHT_GITHUB: 0.3,
    SCORE_WEIGHT_BADGES: 0.2,
}
