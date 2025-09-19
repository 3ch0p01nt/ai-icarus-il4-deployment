const { DefaultAzureCredential } = require("@azure/identity");
const { SubscriptionClient } = require("@azure/arm-subscriptions");
const { OperationalInsightsManagementClient } = require("@azure/arm-operationalinsights");

module.exports = async function (context, req) {
    context.log('Discover workspaces function triggered');
    
    // Handle CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
        };
        return;
    }

    try {
        // Use managed identity to authenticate
        const credential = new DefaultAzureCredential();
        
        // Get the subscription ID from environment or request
        const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || req.body?.subscriptionId;
        
        if (!subscriptionId) {
            throw new Error('Subscription ID not provided');
        }
        
        // Create the client to discover workspaces
        const client = new OperationalInsightsManagementClient(credential, subscriptionId);
        
        // List all workspaces in the subscription
        const workspaceList = [];
        
        try {
            // Get workspaces from the actual subscription
            for await (const workspace of client.workspaces.list()) {
                if (workspace.customerId && workspace.name) {
                    workspaceList.push({
                        workspaceId: workspace.id,
                        workspaceName: workspace.name,
                        location: workspace.location,
                        resourceGroup: workspace.id ? workspace.id.split('/')[4] : '',
                        customerId: workspace.customerId,
                        subscription: subscriptionId,
                        sku: workspace.sku?.name || 'Unknown',
                        retentionInDays: workspace.retentionInDays || 30
                    });
                }
            }
        } catch (listError) {
            context.log.warn('Error listing workspaces:', listError.message);
            // Return empty list if no permissions
        }

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: {
                success: true,
                workspaces: workspaceList,
                count: workspaceList.length,
                subscriptionId: subscriptionId,
                timestamp: new Date().toISOString(),
                message: workspaceList.length === 0 ? 'No workspaces found in this subscription or insufficient permissions' : null
            }
        };
    } catch (error) {
        context.log.error('Error discovering workspaces:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                message: 'Failed to discover workspaces. Ensure the managed identity has appropriate permissions.'
            }
        };
    }
};