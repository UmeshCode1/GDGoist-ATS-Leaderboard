/**
 * Resume Processing Service
 *
 * Orchestrates the end-to-end ATS pipeline:
 *   Resume (buffer from S3)
 *     ↓
 *   Build multipart FormData
 *     ↓
 *   POST to Python ATS microservice
 *     ↓
 *   Validate ATS response
 *     ↓
 *   Persist results to Resume model
 *     ↓
 *   Trigger score recalculation
 *
 * This service is the ONLY place that calls the ATS microservice.
 * It does NOT modify the ATS algorithm — only orchestrates the call.
 */

const axios = require('axios')
const FormData = require('form-data')
const config = require('../../config/config')
const logger = require('../../utils/logger')
const { normalizeATSScore } = require('./scoreNormalizationService')
const Resume = require('../../models/resume.model')
const { recalculateUserScore } = require('./scoreService')

/**
 * Process a resume through the ATS microservice and persist the result.
 *
 * @param {Object} params
 * @param {string}  params.resumeId       - MongoDB Resume document _id
 * @param {Buffer}  params.fileBuffer     - File contents from S3
 * @param {string}  params.originalFilename
 * @param {string}  params.contentType    - MIME type
 * @param {string}  [params.jobDescription] - Optional JD for relevance scoring
 * @param {string}  params.userId        - ID of the owning user
 *
 * @returns {Object} The ATS service response data
 */
async function processResume({ resumeId, fileBuffer, originalFilename, contentType, jobDescription, userId }) {
    const atsUrl = config.ATS_SERVICE_URL
    logger.info('[ATS] Starting resume processing', { resumeId, userId, atsUrl })

    // Build multipart payload for Python ATS service
    const formData = new FormData()
    formData.append('file', fileBuffer, {
        filename: originalFilename,
        contentType,
    })
    if (jobDescription) {
        formData.append('job_description', jobDescription)
    }

    // Call the ATS microservice
    let result
    try {
        const response = await axios.post(`${atsUrl}/parse`, formData, {
            headers: { ...formData.getHeaders() },
        })
        result = response.data
        logger.info('[ATS] Analysis complete', { resumeId, atsScore: result.atsScore })
    } catch (err) {
        logger.error('[ATS] Microservice call failed', { resumeId, error: err.message })
        throw new Error('ATS analysis failed: ' + err.message)
    }

    // Validate response
    if (typeof result.atsScore !== 'number') {
        throw new Error('ATS service returned invalid score format')
    }

    // Apply normalization layer (pass-through by default)
    const normalizedScore = normalizeATSScore(result.atsScore, {
        parsingErrors: result.parsingErrors,
    })

    // Persist to Resume document
    const resume = await Resume.findById(resumeId)
    if (!resume) throw new Error(`Resume ${resumeId} not found`)

    resume.atsScore = normalizedScore
    resume.parsedSkills = result.parsedSkills || []
    resume.parsingErrors = result.parsingErrors || []
    resume.status = 'scored'
    resume.analysisData = result
    if (result.feedback) resume.feedback = result.feedback
    if (result.breakdown) resume.breakdown = result.breakdown
    await resume.save()

    logger.info('[ATS] Resume saved', { resumeId, score: normalizedScore })

    // Trigger score recalculation
    try {
        await recalculateUserScore(userId)
        logger.info('[Score] Recalculated for user', { userId })
    } catch (err) {
        logger.error('[Score] Recalculation failed after ATS result', { userId, error: err.message })
    }

    return { ...result, atsScore: normalizedScore }
}

module.exports = { processResume }
