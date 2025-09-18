const { DefaultAzureCredential } = require("@azure/identity");
const { OperationalInsightsManagementClient } = require("@azure/arm-operationalinsights");

module.exports = async function (context, req) {
    context.log('Workspace discovery endpoint called');

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

        // Use managed identity for authentication in Government cloud
        const credential = new DefaultAzureCredential();
        
        // Configure for Government cloud endpoints
        const armEndpoint = process.env.ManagementEndpoint || 'https://management.usgovcloudapi.net';
        
        // Create client for Log Analytics workspaces
        const client = new OperationalInsightsManagementClient(credential, subscriptionId, {
            endpoint: armEndpoint
        });

        // List all workspaces in the subscription
        const workspaces = [];
        
        try {
            // Get all workspaces
            for await (const workspace of client.workspaces.list()) {
                workspaces.push({
                    id: workspace.id,
                    name: workspace.name,
                    location: workspace.location,
                    resourceGroup: workspace.id.split('/')[4], // Extract RG from resource ID
                    customerId: workspace.customerId,
                    provisioningState: workspace.provisioningState,
                    sku: workspace.sku,
                    retentionInDays: workspace.retentionInDays,
                    tags: workspace.tags || {}
                });
            }

            context.log(`Found ${workspaces.length} workspaces`);

            context.res = {
                status: 200,
                headers: headers,
                body: JSON.stringify({
                    workspaces: workspaces,
                    count: workspaces.length,
                    subscriptionId: subscriptionId,
                    environment: process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment'
                })
            };
        } catch (listError) {
            context.log.error('Error listing workspaces:', listError);
            
            // Check if it's a permissions issue
            if (listError.statusCode === 403) {
                context.res = {
                    status: 403,
                    headers: headers,
                    body: JSON.stringify({
                        error: 'Access denied',
                        message: 'You do not have permission to list workspaces. Ensure you have Reader role on the subscription.',
                        details: listError.message
                    })
                };
            } else {
                throw listError;
            }
        }

    } catch (error) {
        context.log.error('Error in workspace discovery:', error);
        
        context.res = {
            status: 500,
            headers: headers,
            body: JSON.stringify({
                error: 'Failed to discover workspaces',
                message: error.message,
                environment: process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment'
            })
        };
    }
};