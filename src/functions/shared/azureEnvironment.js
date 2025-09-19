/**
 * Azure Environment Configuration for Function Apps
 * Provides environment-specific endpoints and configuration
 */

const getEnvironmentConfig = (environmentName) => {
    const environments = {
        AzureCloud: {
            name: 'Azure Public Cloud',
            management: 'https://management.azure.com',
            authority: 'https://login.microsoftonline.com',
            openaiSuffix: '.openai.azure.com',
            graph: 'https://graph.microsoft.com',
            resourceManager: 'https://management.azure.com/',
            authentication: {
                scope: 'https://management.azure.com/.default'
            }
        },
        AzureUSGovernment: {
            name: 'Azure US Government',
            management: 'https://management.usgovcloudapi.net',
            authority: 'https://login.microsoftonline.us',
            openaiSuffix: '.openai.azure.us',
            graph: 'https://graph.microsoft.us',
            resourceManager: 'https://management.usgovcloudapi.net/',
            authentication: {
                scope: 'https://management.usgovcloudapi.net/.default'
            }
        },
        AzureDoD: {
            name: 'Azure DoD (IL4/IL5)',
            management: 'https://management.usgovcloudapi.net',
            authority: 'https://login.microsoftonline.us',
            openaiSuffix: '.openai.azure.us',
            graph: 'https://dod-graph.microsoft.us',
            resourceManager: 'https://management.usgovcloudapi.net/',
            authentication: {
                scope: 'https://management.usgovcloudapi.net/.default'
            }
        }
    };

    return environments[environmentName] || environments.AzureCloud;
};

const getCredentialOptions = (environment) => {
    const config = getEnvironmentConfig(environment);
    
    // Configure the credential options based on environment
    const options = {
        authorityHost: config.authority
    };
    
    // Add additional options for Government/DoD environments
    if (environment !== 'AzureCloud') {
        options.loggingOptions = {
            allowLoggingAccountIdentifiers: false,
            enableUnsafeSupportLogging: false
        };
    }
    
    return options;
};

const getClientOptions = (environment) => {
    const config = getEnvironmentConfig(environment);
    
    return {
        endpoint: config.resourceManager,
        credential: {
            authorityHost: config.authority
        }
    };
};

module.exports = {
    getEnvironmentConfig,
    getCredentialOptions,
    getClientOptions
};