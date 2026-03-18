/**
 * API Base Configuration
 * Single source of truth for the backend API URL.
 */
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000') + '/api/v1'

export default API_BASE
