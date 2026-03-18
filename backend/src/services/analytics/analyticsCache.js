/**
 * PHASE 3: Analytics Cache Service
 * 
 * Simple in-memory caching for heavy analytics queries.
 * Reduces database load for repeated admin dashboard requests.
 * 
 * Cache TTL: 5 minutes (configurable)
 * For production with multiple instances, consider Redis.
 */

class AnalyticsCache {
    constructor(ttlMinutes = 5) {
        this.cache = new Map()
        this.ttl = ttlMinutes * 60 * 1000 // Convert to milliseconds
    }

    /**
     * Generate cache key from function name and params
     */
    _generateKey(functionName, params) {
        return `${functionName}:${JSON.stringify(params)}`
    }

    /**
     * Get cached result if valid
     */
    get(functionName, params) {
        const key = this._generateKey(functionName, params)
        const cached = this.cache.get(key)

        if (!cached) {
            return null
        }

        // Check if expired
        if (Date.now() - cached.timestamp > this.ttl) {
            this.cache.delete(key)
            return null
        }

        console.log(`[Cache] HIT: ${functionName}`)
        return cached.data
    }

    /**
     * Set cache entry
     */
    set(functionName, params, data) {
        const key = this._generateKey(functionName, params)
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        })
        console.log(`[Cache] SET: ${functionName}`)
    }

    /**
     * Invalidate specific cache entry
     */
    invalidate(functionName, params) {
        const key = this._generateKey(functionName, params)
        this.cache.delete(key)
        console.log(`[Cache] INVALIDATE: ${functionName}`)
    }

    /**
     * Clear all cache
     */
    clear() {
        this.cache.clear()
        console.log('[Cache] CLEARED')
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            entries: this.cache.size,
            ttlMinutes: this.ttl / 60000
        }
    }

    /**
     * Cleanup expired entries (run periodically)
     */
    cleanup() {
        const now = Date.now()
        let removed = 0

        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.ttl) {
                this.cache.delete(key)
                removed++
            }
        }

        if (removed > 0) {
            console.log(`[Cache] Cleanup: removed ${removed} expired entries`)
        }
    }
}

// Create singleton instance
const analyticsCache = new AnalyticsCache(5) // 5 minutes TTL

// Run cleanup every 10 minutes
setInterval(() => {
    analyticsCache.cleanup()
}, 10 * 60 * 1000)

/**
 * Wrapper function to cache analytics results
 */
async function withCache(functionName, params, asyncFunction) {
    // Check cache first
    const cached = analyticsCache.get(functionName, params)
    if (cached !== null) {
        return cached
    }

    // Execute function
    const result = await asyncFunction()

    // Cache result
    analyticsCache.set(functionName, params, result)

    return result
}

module.exports = {
    analyticsCache,
    withCache
}
