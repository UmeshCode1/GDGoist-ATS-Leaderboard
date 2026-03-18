/**
 * Backend Entry Point
 *
 * Responsibilities:
 *   1. Load environment configuration
 *   2. Connect to the database
 *   3. Create the Express server with middleware
 *   4. Register all routes
 *   5. Start listening
 */

require('dotenv').config()

const { PORT } = require('./config/config')
const { connect } = require('./infrastructure/db')
const createServer = require('./server/createServer')
const registerRoutes = require('./server/registerRoutes')
const { startScheduler: startGitHubScheduler } = require('./services/github/githubScheduler')
const logger = require('./utils/logger')

async function main() {
  await connect()

  const app = createServer()
  registerRoutes(app)

  app.listen(PORT, () => {
    logger.info(`Backend listening on port ${PORT}`)
    startGitHubScheduler()
    logger.info('GitHub sync scheduler started')
    logger.info('Score aggregation service ready')
    logger.info('Badge evaluation system ready')
    logger.info('Admin analytics & privacy APIs ready')
    logger.info('Rate limiting and audit logging active')
  })
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message })
  process.exit(1)
})
