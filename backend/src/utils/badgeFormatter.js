/**
 * Badge Formatter Utility
 * 
 * Provides centralized badge formatting logic to eliminate duplication
 * across route files that need to format badge data for API responses.
 */

/**
 * Formats badge data for API responses
 * @param {Array} badges - Array of badge documents
 * @param {string} baseUrl - Base URL for resolving relative icon paths
 * @returns {Array} Formatted badge objects
 */
function formatBadges(badges, baseUrl) {
    return badges.map(b => {
        const def = b.definitionId || b.definition
        let iconUrl = def ? def.icon : (b.metadata?.icon || '🏅')
        if (iconUrl && iconUrl.startsWith('/')) iconUrl = `${baseUrl}${iconUrl}`
        return { 
            name: def ? def.name : b.badgeType, 
            description: def ? def.description : (b.metadata?.description || 'Awarded badge'),
            icon: iconUrl, 
            earnedAt: b.earnedAt, 
            points: def ? def.points : 0 
        }
    })
}

module.exports = { formatBadges }
