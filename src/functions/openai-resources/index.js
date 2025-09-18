const { DefaultAzureCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const { CognitiveServicesManagementClient } = require("@azure/arm-cognitiveservices");

module.exports = async function (context, req) {
    context.log('OpenAI resources discovery endpoint called');

    // Set CORS headers for Government cloud
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: headers,
            body: ''
        };
        return;
    }

    try {
        // Get subscription ID from environment or query parameter
        const subscriptionId = req.query.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
        
        if (!subscriptionId) {
            context.res = {
                status: 400,
                headers: headers,
                body: JSON.stringify({
                    error: 'Subscription ID is required',
                    message: 'Please provide subscriptionId as a query parameter'
                })
            };
            return;
        }

        // Use managed identity for authentication
        const credential = new DefaultAzureCredential();
        
        // Configure for Government cloud endpoints
        const armEndpoint = process.env.ManagementEndpoint || 'https://management.usgovcloudapi.net';
        const openAIDomain = process.env.OpenAIDomain || 'openai.azure.us';
        
        // Create clients
        const resourceClient = new ResourceManagementClient(credential, subscriptionId, {
            endpoint: armEndpoint
        });
        
        const cognitiveClient = new CognitiveServicesManagementClient(credential, subscriptionId, {
            endpoint: armEndpoint
        });

        const openAIResources = [];
        
        try {
            // List all resources and filter for OpenAI
            for await (const resource of resourceClient.resources.list()) {
                // Check if it's an OpenAI resource
                if (resource.type === 'Microsoft.CognitiveServices/accounts' && 
                    resource.kind === 'OpenAI') {
                    
                    // Get detailed information about the OpenAI resource
                    const resourceGroup = resource.id.split('/')[4];
                    const accountName = resource.name;
                    
                    try {
                        // Get account details including deployments
                        const account = await cognitiveClient.accounts.get(resourceGroup, accountName);
                        
                        // Get deployments for this OpenAI resource
                        const deployments = [];
                        try {
                            for await (const deployment of cognitiveClient.deployments.list(resourceGroup, accountName)) {
                                deployments.push({
                                    name: deployment.name,
                                    model: deployment.properties?.model?.name,
                                    version: deployment.properties?.model?.version,
                                    status: deployment.properties?.provisioningState,
                                    capacity: deployment.sku?.capacity,
                                    scaleType: deployment.sku?.name
                                });
                            }
                        } catch (depError) {
                            context.log.warn(`Could not list deployments for ${accountName}:`, depError.message);
                        }
                        
                        openAIResources.push({
                            id: resource.id,
                            name: resource.name,
                            location: resource.location,
                            resourceGroup: resourceGroup,
                            endpoint: `https://${resource.name}.${openAIDomain}`,
                            provisioningState: account.properties?.provisioningState,
                            deployments: deployments,
                            sku: account.sku,
                            tags: resource.tags || {}
                        });
                    } catch (detailError) {
                        context.log.warn(`Could not get details for ${accountName}:`, detailError.message);
                        // Add basic info even if we can't get full details
                        openAIResources.push({
                            id: resource.id,
                            name: resource.name,
                            location: resource.location,
                            resourceGroup: resourceGroup,
                            endpoint: `https://${resource.name}.${openAIDomain}`,
                            deployments: [],
                            tags: resource.tags || {}
                        });
                    }
                }
            }

            context.log(`Found ${openAIResources.length} OpenAI resources`);

            context.res = {
                status: 200,
                headers: headers,
                body: JSON.stringify({
                    resources: openAIResources,
                    count: openAIResources.length,
                    subscriptionId: subscriptionId,
                    environment: process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment',
                    openAIDomain: openAIDomain
                })
            };
            
        } catch (listError) {
            context.log.error('Error listing resources:', listError);
            
            if (listError.statusCode === 403) {
                context.res = {
                    status: 403,
                    headers: headers,
                    body: JSON.stringify({
                        error: 'Access denied',
                        message: 'You do not have permission to list resources. Ensure you have Reader role on the subscription.',
                        details: listError.message
                    })
                };
            } else {
                throw listError;
            }
        }

    } catch (error) {
        context.log.error('Error in OpenAI resource discovery:', error);
        
        context.res = {
            status: 500,
            headers: headers,
            body: JSON.stringify({
                error: 'Failed to discover OpenAI resources',
                message: error.message,
                environment: process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment'
            })
        };
    }
};