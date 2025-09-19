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
        // Get the user's access token from the Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('No authorization token provided. Please sign in.');
        }
        
        const accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix
        
        // Get the subscription ID from request
        const subscriptionId = req.body?.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
        
        if (!subscriptionId) {
            throw new Error('Subscription ID not provided');
        }
        
        // Create credential using the user's token
        const credential = {
            getToken: async () => ({
                token: accessToken,
                expiresOnTimestamp: Date.now() + 3600000 // 1 hour from now
            })
        };
        
        // Create the client using the user's credentials
        const client = new OperationalInsightsManagementClient(credential, subscriptionId);
        
        // List all workspaces the USER has access to
        const workspaceList = [];
        
        try {
            context.log('Listing workspaces with user credentials...');
            
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
            
            context.log(`Found ${workspaceList.length} workspace(s) accessible to the user`);
        } catch (listError) {
            context.log.warn('Error listing workspaces:', listError.message);
            // User might not have permissions - return empty list
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
                message: workspaceList.length === 0 ? 
                    'No workspaces found. Ensure you have permissions to view Log Analytics workspaces in this subscription.' : 
                    null
            }
        };
    } catch (error) {
        context.log.error('Error discovering workspaces:', error);
        
        let errorMessage = error.message;
        let statusCode = 500;
        
        if (error.message.includes('authorization token')) {
            errorMessage = 'Authentication required. Please sign in to discover workspaces.';
            statusCode = 401;
        }
        
        context.res = {
            status: statusCode,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: false,
                error: errorMessage,
                timestamp: new Date().toISOString()
            }
        };
    }
};