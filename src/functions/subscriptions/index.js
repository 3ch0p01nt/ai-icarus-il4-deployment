module.exports = async function (context, req) {
    context.log('Subscriptions discovery function processing request');

    try {
        // Handle OPTIONS request for CORS
        if (req.method === 'OPTIONS') {
            context.res = {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: ''
            };
            return;
        }

        // Import required Azure SDKs
        const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');
        const { SubscriptionClient } = require('@azure/arm-subscriptions');

        // Use appropriate credential based on environment
        const credential = process.env.AZURE_CLIENT_ID 
            ? new DefaultAzureCredential()
            : new ManagedIdentityCredential();

        context.log('Discovering accessible Azure subscriptions');

        // Create subscription client
        const subscriptionClient = new SubscriptionClient(credential);
        
        const subscriptions = [];
        
        try {
            // List all subscriptions the identity has access to
            for await (const subscription of subscriptionClient.subscriptions.list()) {
                subscriptions.push({
                    id: subscription.subscriptionId,
                    name: subscription.displayName,
                    state: subscription.state,
                    tenantId: subscription.tenantId,
                    tags: subscription.tags || {}
                });
            }
            
            context.log(`Found ${subscriptions.length} accessible subscription(s)`);
        } catch (error) {
            context.log.error('Error listing subscriptions:', error.message);
            
            // Fallback to environment variable or default subscription
            const defaultSubId = process.env.AZURE_SUBSCRIPTION_ID || '6c030f14-7442-4249-b372-d5628d7cb080';
            subscriptions.push({
                id: defaultSubId,
                name: 'Default Subscription',
                state: 'Enabled',
                tenantId: process.env.AZURE_TENANT_ID || 'unknown'
            });
        }
        
        // Sort subscriptions by name
        subscriptions.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        
        // Prepare response
        const response = {
            subscriptions: subscriptions,
            count: subscriptions.length,
            timestamp: new Date().toISOString()
        };
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: response
        };
        
    } catch (error) {
        context.log.error('Error in Subscriptions function:', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Internal server error',
                message: error.message || 'Failed to discover subscriptions',
                timestamp: new Date().toISOString()
            }
        };
    }
};