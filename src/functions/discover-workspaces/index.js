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
        // For now, return the actual workspaces from your subscription
        // In production, this would use the caller's token for delegation
        const workspaces = [
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/sentinel_encalve_airs/providers/Microsoft.OperationalInsights/workspaces/Sentinel-Airs',
                workspaceName: 'Sentinel-Airs',
                location: 'eastus',
                resourceGroup: 'sentinel_encalve_airs',
                customerId: 'ec548bdd-38db-4ea3-bb39-c38f6b769191',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/ThreatIntel/providers/Microsoft.OperationalInsights/workspaces/TISentinel',
                workspaceName: 'TISentinel',
                location: 'eastus',
                resourceGroup: 'ThreatIntel',
                customerId: 'a7ce4114-4728-471a-af7f-6c32074c61c5',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/IdentityPlayground/providers/Microsoft.OperationalInsights/workspaces/IdentityPlayground',
                workspaceName: 'IdentityPlayground',
                location: 'eastus',
                resourceGroup: 'IdentityPlayground',
                customerId: '60fcf840-1818-4e28-a7ce-1957032b64ee',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/AIStudio/providers/Microsoft.OperationalInsights/workspaces/aistudio2227594025',
                workspaceName: 'aistudio2227594025',
                location: 'eastus',
                resourceGroup: 'AIStudio',
                customerId: 'f9607b7d-2427-486a-aa8f-92827caf115f',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/CISA-IdentityAbuse/providers/Microsoft.OperationalInsights/workspaces/data-collection',
                workspaceName: 'data-collection',
                location: 'eastus',
                resourceGroup: 'CISA-IdentityAbuse',
                customerId: '55e48bbd-7b29-42c8-8472-ba2991bd78ac',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/CISA-IdentityAbuse/providers/Microsoft.OperationalInsights/workspaces/AbuseLAW',
                workspaceName: 'AbuseLAW',
                location: 'eastus',
                resourceGroup: 'CISA-IdentityAbuse',
                customerId: '320e735d-b0a5-40ea-ad62-29e21ee5fd1b',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/RG-Azure-MachineLearning/providers/Microsoft.OperationalInsights/workspaces/azuremlworkspa2653257936',
                workspaceName: 'azuremlworkspa2653257936',
                location: 'eastus',
                resourceGroup: 'RG-Azure-MachineLearning',
                customerId: '02ab745f-f195-4ba9-9e8d-4a388bfc6d8c',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/ai_ubiquiti-syslog-collector-1754489033-ins_a22b0638-ec30-4ab0-9266-3f92f04b2983_managed/providers/Microsoft.OperationalInsights/workspaces/managed-ubiquiti-syslog-collector-1754489033-insights-ws',
                workspaceName: 'managed-ubiquiti-syslog-collector-1754489033-insights-ws',
                location: 'eastus',
                resourceGroup: 'ai_ubiquiti-syslog-collector-1754489033-ins_a22b0638-ec30-4ab0-9266-3f92f04b2983_managed',
                customerId: '5fc251d5-c43e-4cdf-8838-b9645def6745',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/rg-ai-icarus-dev/providers/Microsoft.OperationalInsights/workspaces/ai-icarus-dev1-la',
                workspaceName: 'ai-icarus-dev1-la',
                location: 'eastus',
                resourceGroup: 'rg-ai-icarus-dev',
                customerId: '6fd212af-05a2-4c8b-9d30-32ccd4b4741b',
                subscription: 'HoneyBadger-- AIRS'
            },
            {
                workspaceId: '/subscriptions/6c030f14-7442-4249-b372-d5628d7cb080/resourceGroups/rg-passivedns/providers/Microsoft.OperationalInsights/workspaces/law-passivedns',
                workspaceName: 'law-passivedns',
                location: 'eastus2',
                resourceGroup: 'rg-passivedns',
                customerId: 'eb6759b8-8308-42e6-b6c2-5d568adbdbdf',
                subscription: 'HoneyBadger-- AIRS'
            }
        ];

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
                workspaces: workspaces,
                count: workspaces.length,
                timestamp: new Date().toISOString()
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
                timestamp: new Date().toISOString()
            }
        };
    }
};