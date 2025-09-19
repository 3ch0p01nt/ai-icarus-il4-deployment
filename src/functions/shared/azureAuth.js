/**
 * Azure OpenAI Authentication Module
 * Implements Microsoft Entra ID (Azure AD) authentication best practices
 * Replaces API key authentication with token-based authentication
 */

const { DefaultAzureCredential, ManagedIdentityCredential, ClientSecretCredential } = require('@azure/identity');

/**
 * Gets the appropriate Azure credential based on environment
 * Priority order:
 * 1. Managed Identity (for production Azure environments)
 * 2. Service Principal (for CI/CD and specific service accounts)
 * 3. Default Azure Credential (for local development)
 */
function getAzureCredential() {
    // Primary: Check if running in Azure with Managed Identity
    // This is the recommended approach for production
    if (process.env.AZURE_USE_MANAGED_IDENTITY === 'true' || process.env.MSI_ENDPOINT) {
        console.log('Using Managed Identity for authentication');
        const clientId = process.env.AZURE_CLIENT_ID;
        if (clientId) {
            console.log(`Using specific Managed Identity with client ID: ${clientId}`);
            return new ManagedIdentityCredential({ clientId });
        } else {
            console.log('Using system-assigned Managed Identity');
            return new ManagedIdentityCredential();
        }
    }
    
    // Fallback: For local development only
    // Service Principal credentials are only for development/testing
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    
    if (tenantId && clientId && clientSecret) {
        console.warn('Using Service Principal credentials - for development only');
        return new ClientSecretCredential(tenantId, clientId, clientSecret);
    }
    
    // Last resort: DefaultAzureCredential for local development
    // This will try Azure CLI, VS Code, etc.
    console.log('Using DefaultAzureCredential for local development');
    return new DefaultAzureCredential();
}

/**
 * Gets an access token for Azure Cognitive Services
 * This token is used for authenticating Azure OpenAI API calls
 */
async function getAccessToken() {
    try {
        const credential = getAzureCredential();
        const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
        
        return {
            token: tokenResponse.token,
            expiresOnTimestamp: tokenResponse.expiresOnTimestamp
        };
    } catch (error) {
        console.error('Failed to get Azure access token:', error);
        throw new Error(`Authentication failed: ${error.message}`);
    }
}

/**
 * Creates authorization header for Azure OpenAI API calls
 * Uses Microsoft Entra ID (Azure AD) token-based authentication only
 * No API key fallback for security compliance
 */
async function getAuthHeader(apiKey = null) {
    // API keys are no longer supported for security reasons
    if (apiKey) {
        console.error('API key authentication is disabled for security compliance.');
        throw new Error('API key authentication is not supported. Please use Microsoft Entra ID (Managed Identity).');
    }
    
    // Use token-based authentication only (required for security)
    try {
        const tokenInfo = await getAccessToken();
        console.log('Successfully acquired token using Managed Identity');
        return { 'Authorization': `Bearer ${tokenInfo.token}` };
    } catch (error) {
        console.error('Failed to acquire token using Managed Identity:', error.message);
        throw new Error(`Authentication failed. Please ensure the Function App's Managed Identity has the 'Cognitive Services OpenAI User' role on the Azure OpenAI resource. Error: ${error.message}`);
    }
}

/**
 * Token cache management for performance optimization
 * Caches tokens to avoid unnecessary token requests
 */
class TokenCache {
    constructor() {
        this.cache = new Map();
    }
    
    async getToken(scope = 'https://cognitiveservices.azure.com/.default') {
        const cached = this.cache.get(scope);
        
        // Check if cached token is still valid (with 5-minute buffer)
        if (cached && cached.expiresOnTimestamp > Date.now() + 300000) {
            return cached.token;
        }
        
        // Get new token
        const credential = getAzureCredential();
        const tokenResponse = await credential.getToken(scope);
        
        // Cache the token
        this.cache.set(scope, {
            token: tokenResponse.token,
            expiresOnTimestamp: tokenResponse.expiresOnTimestamp
        });
        
        return tokenResponse.token;
    }
    
    clear() {
        this.cache.clear();
    }
}

// Singleton token cache instance
const tokenCache = new TokenCache();

/**
 * Environment-specific endpoint configuration
 * Supports Azure Public, Government, and DoD environments
 */
function getEnvironmentConfig() {
    const environment = process.env.AZURE_ENVIRONMENT || 'AzurePublicCloud';
    
    const configs = {
        'AzurePublicCloud': {
            managementEndpoint: 'https://management.azure.com',
            openAIEndpointSuffix: '.openai.azure.com',
            authority: 'https://login.microsoftonline.com',
            cognitiveServicesScope: 'https://cognitiveservices.azure.com/.default'
        },
        'AzureUSGovernment': {
            managementEndpoint: 'https://management.usgovcloudapi.net',
            openAIEndpointSuffix: '.openai.azure.us',
            authority: 'https://login.microsoftonline.us',
            cognitiveServicesScope: 'https://cognitiveservices.azure.us/.default'
        },
        'AzureDoD': {
            managementEndpoint: 'https://management.usgovcloudapi.net',
            openAIEndpointSuffix: '.openai.azure.us',
            authority: 'https://login.microsoftonline.us',
            cognitiveServicesScope: 'https://cognitiveservices.azure.us/.default'
        }
    };
    
    return configs[environment] || configs['AzurePublicCloud'];
}

module.exports = {
    getAzureCredential,
    getAccessToken,
    getAuthHeader,
    tokenCache,
    getEnvironmentConfig,
    TokenCache
};