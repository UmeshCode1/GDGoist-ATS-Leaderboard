/**
 * Environment Variable Validator
 * 
 * Validates required environment variables at startup
 * Fails fast for critical missing variables
 * Warns for optional but recommended variables
 */

require('dotenv').config();

const required = [
    'MONGO_URI',
    'JWT_SECRET'
];

const requiredForFeatures = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'S3_BUCKET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'ATS_SERVICE_URL'
];

const defaults = {
    PORT: '4000',
    NODE_ENV: 'development',
    JWT_EXPIRES_IN: '7d'
};

function validateEnv() {
    const errors = [];
    const warnings = [];

    // Check required variables
    required.forEach(key => {
        if (!process.env[key]) {
            errors.push(`❌ Missing required environment variable: ${key}`);
        }
    });

    // Special validation for JWT_SECRET
    if (process.env.JWT_SECRET) {
        if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'changeme') {
            errors.push('❌ JWT_SECRET cannot be "changeme" in production');
        }
        if (process.env.JWT_SECRET.length < 32) {
            warnings.push('⚠️  JWT_SECRET should be at least 32 characters for security');
        }
    }

    // Check feature-specific variables
    const missingFeatures = requiredForFeatures.filter(key => !process.env[key]);
    if (missingFeatures.length > 0) {
        warnings.push(`⚠️  Missing optional variables for full functionality: ${missingFeatures.join(', ')}`);
    }

    // Apply defaults
    Object.entries(defaults).forEach(([key, defaultValue]) => {
        if (!process.env[key]) {
            process.env[key] = defaultValue;
            console.log(`📝 Using default for ${key}: ${defaultValue}`);
        }
    });

    // Report results
    if (warnings.length > 0) {
        console.log('\n⚠️  Environment Warnings:');
        warnings.forEach(warning => console.log(`   ${warning}`));
    }

    if (errors.length > 0) {
        console.log('\n❌ Environment Errors:');
        errors.forEach(error => console.log(`   ${error}`));
        console.log('\n💡 Please set these environment variables and restart the server.');
        process.exit(1);
    }

    console.log('✅ Environment validation passed');
    return true;
}

module.exports = { validateEnv };
