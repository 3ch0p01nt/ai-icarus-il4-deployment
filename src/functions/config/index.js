/**
 * Configuration endpoint for AI-Icarus IL4
 * Returns environment-specific configuration for the frontend
 * This is a public endpoint (no authentication required)
 */

module.exports = async function (context, req) {
    context.log('Config endpoint called');

    // Handle CORS
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: corsHeaders,
            body: ''
        };
        return;
    }

    // Get environment from Azure Function settings
    const environment = process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment';
    const tenantId = process.env.AZURE_TENANT_ID || '';
    const useManagedIdentity = process.env.USE_MANAGED_IDENTITY === 'true';
    const functionAppUrl = process.env.WEBSITE_HOSTNAME ? `https://${process.env.WEBSITE_HOSTNAME}` : '';
    const staticWebAppUrl = process.env.STATIC_WEB_APP_URL || '';

    // Define endpoints based on environment
    const endpoints = {
        AzureCloud: {
            management: 'https://management.azure.com',
            authentication: 'https://login.microsoftonline.com',
            graph: 'https://graph.microsoft.com',
            logAnalytics: 'https://api.loganalytics.io',
            logAnalyticsOds: 'https://ods.opinsights.azure.com',
            cognitive: 'https://cognitiveservices.azure.com',
            openAI: 'openai.azure.com',
            portal: 'https://portal.azure.com'
        },
        AzureUSGovernment: {
            management: 'https://management.usgovcloudapi.net',
            authentication: 'https://login.microsoftonline.us',
            graph: 'https://graph.microsoft.us',
            logAnalytics: 'https://api.loganalytics.us',
            logAnalyticsOds: 'https://ods.opinsights.azure.us',
            cognitive: 'https://cognitiveservices.azure.us',
            openAI: 'openai.azure.us',
            portal: 'https://portal.azure.us'
        },
        AzureDoD: {
            management: 'https://management.usgovcloudapi.net',
            authentication: 'https://login.microsoftonline.us',
            graph: 'https://dod-graph.microsoft.us',
            logAnalytics: 'https://api.loganalytics.us',
            logAnalyticsOds: 'https://ods.opinsights.azure.us',
            cognitive: 'https://cognitiveservices.azure.us',
            openAI: 'openai.azure.us',
            portal: 'https://portal.azure.us'
        }
    };

    // Define scopes based on environment
    const scopes = {
        AzureCloud: {
            management: 'https://management.azure.com/.default',
            graph: 'https://graph.microsoft.com/.default',
            logAnalytics: 'https://api.loganalytics.io/.default',
            cognitive: 'https://cognitiveservices.azure.com/.default'
        },
        AzureUSGovernment: {
            management: 'https://management.usgovcloudapi.net/.default',
            graph: 'https://graph.microsoft.us/.default',
            logAnalytics: 'https://api.loganalytics.us/.default',
            cognitive: 'https://cognitiveservices.azure.us/.default'
        },
        AzureDoD: {
            management: 'https://management.usgovcloudapi.net/.default',
            graph: 'https://dod-graph.microsoft.us/.default',
            logAnalytics: 'https://api.loganalytics.us/.default',
            cognitive: 'https://cognitiveservices.azure.us/.default'
        }
    };

    // Build configuration response
    const config = {
        environment: environment,
        subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || '',
        auth: {
            useManagedIdentity: useManagedIdentity,
            tenantId: tenantId,
            authority: `${endpoints[environment].authentication}/${tenantId}`,
            authType: useManagedIdentity ? 'managed-identity' : 'interactive'
        },
        api: {
            functionAppUrl: functionAppUrl,
            staticWebAppUrl: staticWebAppUrl
        },
        endpoints: endpoints[environment] || endpoints.AzureDoD,
        scopes: scopes[environment] || scopes.AzureDoD,
        features: {
            enableM365Defender: true,
            enableLocalFiles: true,
            enableKQLEditor: true,
            enableAIAnalysis: true
        },
        ui: {
            appName: 'AI-Icarus',
            appVersion: '1.0.0',
            environment: environment === 'AzureDoD' ? 'DoD IL4' : 'GCC High'
        },
        security: {
            tlsVersion: '1.2',
            requireMFA: true,
            sessionTimeout: 3600000, // 1 hour in milliseconds
            enableAuditLogging: true
        }
    };

    // Log configuration (without sensitive data)
    context.log(`Returning configuration for environment: ${environment}`);

    // Return configuration
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
        },
        body: config
    };
};