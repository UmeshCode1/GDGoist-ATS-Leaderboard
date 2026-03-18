const axios = require('axios')

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'your_client_id'
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'your_client_secret'

// Get GitHub OAuth authorization URL
function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:5173/github-callback',
    scope: 'user:email read:user public_repo',
    state,
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

// Exchange code for access token
async function getAccessToken(code) {
  try {
    const response = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }, {
      headers: { Accept: 'application/json' }
    })
    return response.data.access_token
  } catch (err) {
    console.error('GitHub token exchange error:', err.message)
    throw err
  }
}

// Fetch user profile from GitHub
async function getUserProfile(accessToken) {
  try {
    const response = await axios.get(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return response.data
  } catch (err) {
    console.error('GitHub profile fetch error:', err.message)
    throw err
  }
}

// Fetch user repositories with stats
async function getUserRepositories(username, accessToken) {
  try {
    const response = await axios.get(`${GITHUB_API_BASE}/users/${username}/repos`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { per_page: 100, sort: 'stars', direction: 'desc' }
    })
    return response.data
  } catch (err) {
    console.error('GitHub repos fetch error:', err.message)
    throw err
  }
}

// Fetch user commits (last 12 months)
async function getUserCommits(username, accessToken) {
  try {
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const query = `author:${username} created:>${oneYearAgo.toISOString().split('T')[0]}`
    
    const response = await axios.get(`${GITHUB_API_BASE}/search/commits`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { q: query, per_page: 1 }
    })
    return response.data.total_count || 0
  } catch (err) {
    console.error('GitHub commits fetch error:', err.message)
    return 0
  }
}

// Fetch user pull requests
async function getUserPullRequests(username, accessToken) {
  try {
    const response = await axios.get(`${GITHUB_API_BASE}/search/issues`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { q: `author:${username} is:pr is:merged`, per_page: 1 }
    })
    return response.data.total_count || 0
  } catch (err) {
    console.error('GitHub PRs fetch error:', err.message)
    return 0
  }
}

// Calculate GitHub score (0-100)
function calculateGitHubScore(stats) {
  // Weighted scoring:
  // Commits: 40% (max 100 commits = 40 points)
  // PRs: 30% (max 50 PRs = 30 points)
  // Stars: 20% (max 500 stars = 20 points)
  // Languages: 10% (max 5 languages = 10 points)

  const commitScore = Math.min(40, (stats.totalCommits / 100) * 40)
  const prScore = Math.min(30, (stats.totalPullRequests / 50) * 30)
  const starScore = Math.min(20, (stats.totalStars / 500) * 20)
  const langScore = Math.min(10, (stats.languages.length / 5) * 10)

  return Math.round(commitScore + prScore + starScore + langScore)
}

// Extract languages from repositories
function extractLanguages(repos) {
  const languages = new Set()
  for (const repo of repos) {
    if (repo.language) languages.add(repo.language)
  }
  return Array.from(languages)
}

// Sync GitHub data for a user
async function syncGitHubData(username, accessToken) {
  try {
    const profile = await getUserProfile(accessToken)
    const repos = await getUserRepositories(username, accessToken)
    const commits = await getUserCommits(username, accessToken)
    const prs = await getUserPullRequests(username, accessToken)
    
    const languages = extractLanguages(repos)
    const topRepos = repos.slice(0, 5).map(r => ({
      name: r.name,
      stars: r.stargazers_count,
      language: r.language,
      url: r.html_url,
    }))

    const totalStars = repos.reduce((sum, r) => sum + r.stargazers_count, 0)

    const stats = {
      totalCommits: commits,
      totalPullRequests: prs,
      totalStars,
      languages,
      topRepositories: topRepos,
    }

    return {
      profile: {
        name: profile.name,
        bio: profile.bio,
        avatarUrl: profile.avatar_url,
        publicRepos: profile.public_repos,
        followers: profile.followers,
        following: profile.following,
      },
      stats,
      score: calculateGitHubScore(stats),
    }
  } catch (err) {
    console.error('GitHub sync error:', err.message)
    throw err
  }
}

module.exports = {
  getAuthorizationUrl,
  getAccessToken,
  getUserProfile,
  getUserRepositories,
  getUserCommits,
  getUserPullRequests,
  calculateGitHubScore,
  extractLanguages,
  syncGitHubData,
}
