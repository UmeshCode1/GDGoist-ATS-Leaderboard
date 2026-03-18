/**
 * Resume Controller
 * 
 * Business logic for resume operations extracted from route handlers
 * Follows Controller Pattern: Route → Controller → Service → Model
 */

const path = require('path')
const Resume = require('../models/resume.model')
const { uploadFile, generateUploadUrl, getFile } = require('../infrastructure/s3')
const { recalculateUserScore } = require('../services/scoring/scoreService')
const { processResume } = require('../services/scoring/resumeProcessingService')

/**
 * Upload resume directly (with file)
 */
async function uploadResumeDirect(userId, file) {
    if (!file) {
        throw new Error('No resume file uploaded')
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowedTypes.includes(file.mimetype)) {
        throw new Error('Invalid file type. Only PDF and DOCX files are allowed')
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
        throw new Error('File too large. Maximum size is 10MB')
    }

    const fileExt = path.extname(file.name)
    const filename = `resume_${userId}_${Date.now()}${fileExt}`
    let fileUrl

    // Try S3 upload first, fallback to local
    try {
        const s3Key = `resumes/${filename}`
        await uploadFile(file.data, s3Key, file.mimetype)
        fileUrl = s3Key
    } catch (s3Err) {
        // Fallback to local storage
        const uploadPath = path.join(__dirname, '../../uploads/resumes', filename)
        const resumeDir = path.dirname(uploadPath)
        if (!require('fs').existsSync(resumeDir)) {
            require('fs').mkdirSync(resumeDir, { recursive: true })
        }
        await file.mv(uploadPath)
        fileUrl = `/uploads/resumes/${filename}`
    }

    // Create resume record
    const resume = await Resume.create({
        user: userId,
        originalFilename: file.name,
        fileKey: fileUrl,
        status: 'uploaded',
        uploadedAt: new Date()
    })

    // Trigger ATS processing
    setTimeout(async () => {
        try {
            await processResume(userId, resume._id.toString(), fileUrl)
        } catch (processErr) {
            console.error('Resume processing failed:', processErr)
        }
    }, 1000)

    return {
        resumeId: resume._id.toString(),
        filename: resume.originalFilename,
        status: resume.status,
        uploadedAt: resume.uploadedAt
    }
}

/**
 * Get presigned URL for direct S3 upload
 */
async function getResumeUploadUrl(userId, filename, contentType) {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowedTypes.includes(contentType)) {
        throw new Error('Invalid file type. Only PDF and DOCX files are allowed')
    }

    // Validate filename
    if (!filename || typeof filename !== 'string') {
        throw new Error('Valid filename is required')
    }

    const fileExt = path.extname(filename)
    const cleanFilename = `resume_${userId}_${Date.now()}${fileExt}`
    const s3Key = `resumes/${cleanFilename}`

    // Create placeholder resume record
    const resume = await Resume.create({
        user: userId,
        originalFilename: filename,
        fileKey: s3Key,
        status: 'pending_upload',
        createdAt: new Date()
    })

    // Generate presigned URL
    const uploadUrl = await generateUploadUrl(s3Key, contentType)

    return {
        uploadUrl,
        resumeId: resume._id.toString(),
        fileKey: s3Key,
        expiresIn: 3600 // 1 hour
    }
}

/**
 * Complete resume upload after S3 direct upload
 */
async function completeResumeUpload(userId, resumeId, fileKey) {
    const resume = await Resume.findOne({ _id: resumeId, user: userId })
    if (!resume) {
        throw new Error('Resume record not found')
    }

    if (resume.status !== 'pending_upload') {
        throw new Error('Resume is not in pending upload state')
    }

    // Update resume status
    resume.status = 'uploaded'
    resume.fileKey = fileKey
    resume.uploadedAt = new Date()
    await resume.save()

    // Trigger ATS processing
    setTimeout(async () => {
        try {
            await processResume(userId, resumeId, fileKey)
        } catch (processErr) {
            console.error('Resume processing failed:', processErr)
        }
    }, 1000)

    return {
        resumeId: resume._id.toString(),
        filename: resume.originalFilename,
        status: resume.status,
        uploadedAt: resume.uploadedAt
    }
}

/**
 * Get user's resume status and latest resume
 */
async function getUserResumeStatus(userId) {
    const latestResume = await Resume.findOne({ user: userId })
        .sort({ uploadedAt: -1, createdAt: -1 })
        .select('originalFilename fileKey status atsScore parsedSkills uploadedAt createdAt')

    if (!latestResume) {
        return { hasResume: false }
    }

    return {
        hasResume: true,
        resume: {
            resumeId: latestResume.fileKey || latestResume._id.toString(),
            filename: latestResume.originalFilename,
            status: latestResume.status,
            atsScore: latestResume.atsScore,
            parsedSkills: latestResume.parsedSkills,
            uploadedAt: latestResume.uploadedAt || latestResume.createdAt,
        }
    }
}

/**
 * Get resume file content for download/viewing
 */
async function getResumeFile(userId, resumeId) {
    const resume = await Resume.findOne({ _id: resumeId, user: userId })
    if (!resume) {
        throw new Error('Resume not found')
    }

    if (!resume.fileKey) {
        throw new Error('Resume file not available')
    }

    try {
        const fileBuffer = await getFile(resume.fileKey)
        const filename = resume.originalFilename || 'resume.pdf'
        
        // Determine content type
        const ext = path.extname(filename).toLowerCase()
        const contentTypes = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
        const contentType = contentTypes[ext] || 'application/octet-stream'

        return { fileBuffer, filename, contentType }
    } catch (err) {
        throw new Error('Resume file not found or inaccessible')
    }
}

/**
 * Delete resume
 */
async function deleteResume(userId, resumeId) {
    const resume = await Resume.findOne({ _id: resumeId, user: userId })
    if (!resume) {
        throw new Error('Resume not found')
    }

    // Delete resume record
    await Resume.findByIdAndDelete(resumeId)

    // Recalculate user score (without resume points)
    await recalculateUserScore(userId)

    return { message: 'Resume deleted successfully' }
}

/**
 * Submit ATS analysis results (from external ATS service)
 */
async function submitAtsResult(userId, resumeId, atsData) {
    const { score, skills, suggestions, analysis } = atsData

    if (!score || typeof score !== 'number' || score < 0 || score > 100) {
        throw new Error('Invalid ATS score. Must be a number between 0 and 100')
    }

    const resume = await Resume.findOne({ _id: resumeId, user: userId })
    if (!resume) {
        throw new Error('Resume not found')
    }

    // Update resume with ATS results
    resume.atsScore = score
    resume.parsedSkills = skills || []
    resume.atsSuggestions = suggestions || []
    resume.atsAnalysis = analysis || {}
    resume.status = 'processed'
    resume.processedAt = new Date()
    await resume.save()

    // Recalculate user score with new ATS score
    await recalculateUserScore(userId)

    return {
        resumeId: resume._id.toString(),
        atsScore: score,
        parsedSkills: skills,
        status: resume.status
    }
}

module.exports = {
    uploadResumeDirect,
    getResumeUploadUrl,
    completeResumeUpload,
    getUserResumeStatus,
    getResumeFile,
    deleteResume,
    submitAtsResult
}
