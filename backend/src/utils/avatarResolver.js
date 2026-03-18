/**
 * Avatar Resolver Utility
 * 
 * Provides centralized avatar resolution logic to eliminate duplication
 * across route files that need to determine a user's profile picture.
 */

/**
 * Resolves the appropriate avatar for a user
 * @param {Object} user - User document object
 * @param {Object} githubDoc - GitHub document object (optional)
 * @returns {string|null} Avatar URL or null if no avatar found
 */
function resolveAvatar(user, githubDoc) {
    if (user.profilePicture) return user.profilePicture
    if (githubDoc?.profile?.avatarUrl) return githubDoc.profile.avatarUrl
    return null
}

module.exports = { resolveAvatar }
