/**
 * Resume Routes
 * POST /resumes/upload
 * POST /resumes/upload-url
 * POST /resumes/complete
 * POST /resumes/ats-result
 * POST /resumes/parse
 */

const express = require('express')
const router = express.Router()
const { verifyToken } = require('../middleware/auth')
const { requireConsent } = require('../middleware/consent')
const Resume = require('../models/resume.model')
const { uploadResumeDirect, getResumeUploadUrl, completeResumeUpload, getUserResumeStatus, getResumeFile, deleteResume, submitAtsResult } = require('../controllers/resumeController')
const { processResume } = require('../services/scoring/resumeProcessingService')
const logger = require('../utils/logger')

// Upload resume directly (with file)
router.post('/resumes/upload', verifyToken, requireConsent, async (req, res, next) => {
    try {
        if (!req.files || !req.files.resume) {
            return res.status(400).json({ error: 'No resume file uploaded' })
        }
        
        const result = await uploadResumeDirect(req.user.id, req.files.resume)
        return res.json(result)
    } catch (err) {
        if (err.message.includes('Invalid file type') || err.message.includes('too large')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Generate pre-signed S3 upload URL
router.post('/resumes/upload-url', verifyToken, requireConsent, async (req, res, next) => {
    try {
        const { filename, contentType } = req.body
        if (!filename || !contentType) {
            return res.status(400).json({ error: 'filename and contentType are required' })
        }
        
        const result = await getResumeUploadUrl(req.user.id, filename, contentType)
        return res.json(result)
    } catch (err) {
        if (err.message.includes('Invalid file type') || err.message.includes('filename')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Mark resume upload as complete (client finished PUT to S3)
router.post('/resumes/complete', verifyToken, requireConsent, async (req, res, next) => {
    try {
        const { resumeId, fileKey } = req.body
        if (!resumeId) {
            return res.status(400).json({ error: 'resumeId required' })
        }
        
        const result = await completeResumeUpload(req.user.id, resumeId, fileKey)
        return res.json(result)
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('pending upload')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// ATS service callback (POST scoring results back to backend)
router.post('/resumes/ats-result', async (req, res, next) => {
    try {
        const { resumeId, ...atsData } = req.body
        if (!resumeId) {
            return res.status(400).json({ error: 'resumeId is required' })
        }
        
        // This endpoint is called by external ATS service, so we don't verify token
        const result = await submitAtsResult(null, resumeId, atsData)
        return res.json(result)
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('Invalid ATS score')) {
            return res.status(400).json({ error: err.message })
        }
        next(err)
    }
})

// Parse resume — proxy to Python ATS microservice
router.post('/resumes/parse', verifyToken, async (req, res, next) => {
    try {
        const { resumeId, job_description } = req.body

        if (!resumeId) {
            return res.status(400).json({ error: 'resumeId is required' })
        }

        const resume = await Resume.findById(resumeId)
        if (!resume) {
            return res.status(404).json({ error: 'Resume not found' })
        }

        if (resume.user.toString() !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to access this resume' })
        }

        const result = await processResume({
            resumeId: resume._id.toString(),
            fileKey: resume.fileKey,
            originalFilename: resume.originalFilename,
            jobDescription: job_description,
            userId: req.user.id,
        })

        return res.json({ ...result, modelInfo: result.model_info, similarityMethod: result.similarity_method })
    } catch (err) {
        next(err)
    }
})

module.exports = router
