// Using built-in fetch (available in Node.js 18+)
// const fetch = require('node-fetch');

/**
 * Azure REST API Client Helper
 * Provides direct REST API calls to Azure Resource Manager
 * Supports both user delegation tokens and managed identity
 */

class AzureRestClient {
    constructor(credential, subscriptionId) {
        this.credential = credential;
        this.subscriptionId = subscriptionId;
        this.apiVersion = {
            workspaces: '2021-06-01',
            cognitiveServices: '2023-05-01',
            resources: '2021-04-01'
        };
    }

    /**
     * Get access token from credential
     */
    async getAccessToken() {
        // For user token credential (simple object with getToken method)
        if (typeof this.credential.getToken === 'function') {
            const tokenResponse = await this.credential.getToken(['https://management.azure.com/.default']);
            return tokenResponse.token;
        }
        
        // For string token (direct Bearer token)
        if (typeof this.credential === 'string') {
            return this.credential;
        }
        
        throw new Error('Invalid credential type');
    }

    /**
     * Make REST API request with timeout protection
     */
    async makeRequest(url, options = {}, timeoutMs = 10000) {
        const token = await this.getAccessToken();
        const startTime = Date.now();
        
        // Log token info for debugging
        console.log(`[REST] Token length: ${token ? token.length : 0}`);
        console.log(`[REST] Token preview: ${token ? token.substring(0, 20) + '...' : 'NO TOKEN'}`);
        
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, timeoutMs);
        
        try {
            console.log(`[REST] Making request to: ${url}`);
            console.log(`[REST] Subscription ID: ${this.subscriptionId}`);
            
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            const elapsed = Date.now() - startTime;
            console.log(`[REST] Response received in ${elapsed}ms - Status: ${response.status}`);
            
            const data = await response.text();
            
            if (response.ok) {
                const parsed = JSON.parse(data);
                console.log(`[REST] Success - Found ${parsed.value ? parsed.value.length : 0} items`);
                return parsed;
            } else {
                console.error(`[REST] Error response status: ${response.status}`);
                console.error(`[REST] Error response body: ${data.substring(0, 1000)}`);
                throw new Error(`HTTP ${response.status}: ${data}`);
            }
        } catch (error) {
            clearTimeout(timeout);
            const elapsed = Date.now() - startTime;
            
            if (error.name === 'AbortError' || elapsed >= timeoutMs) {
                console.error(`[REST] Request timeout after ${elapsed}ms to ${url.substring(0, 100)}`);
                throw new Error(`Request timeout after ${timeoutMs}ms - URL: ${url.substring(0, 100)}`);
            }
            console.error(`[REST] Request failed after ${elapsed}ms:`, error.message);
            throw error;
        }
    }

    /**
     * List Log Analytics workspaces using REST API
     */
    async listWorkspaces() {
        const url = `https://management.azure.com/subscriptions/${this.subscriptionId}/providers/Microsoft.OperationalInsights/workspaces?api-version=${this.apiVersion.workspaces}`;
        
        try {
            const response = await this.makeRequest(url);
            
            if (!response.value) {
                return [];
            }
            
            return response.value.map(workspace => ({
                workspaceId: workspace.properties?.customerId,
                workspaceName: workspace.name,
                resourceGroup: workspace.id ? workspace.id.split('/')[4] : '',
                subscriptionId: this.subscriptionId,
                location: workspace.location,
                tags: workspace.tags || {},
                sku: workspace.properties?.sku?.name,
                retentionInDays: workspace.properties?.retentionInDays
            }));
        } catch (error) {
            console.error('Error listing workspaces via REST:', error.message);
            throw error;
        }
    }

    /**
     * List Azure OpenAI/Cognitive Services accounts using REST API
     */
    async listCognitiveServicesAccounts() {
        const url = `https://management.azure.com/subscriptions/${this.subscriptionId}/providers/Microsoft.CognitiveServices/accounts?api-version=${this.apiVersion.cognitiveServices}`;
        
        try {
            const response = await this.makeRequest(url);
            
            if (!response.value) {
                return [];
            }
            
            // Filter for OpenAI accounts
            const openAIAccounts = response.value.filter(account => 
                account.kind === 'OpenAI' || 
                account.properties?.apiProperties?.qnaAzureSearchEndpointId
            );
            
            return openAIAccounts.map(account => ({
                id: account.id,
                name: account.name,
                location: account.location,
                resourceGroup: account.id ? account.id.split('/')[4] : '',
                endpoint: account.properties?.endpoint,
                kind: account.kind,
                sku: account.sku,
                tags: account.tags || {},
                properties: account.properties
            }));
        } catch (error) {
            console.error('Error listing cognitive services via REST:', error.message);
            throw error;
        }
    }

    /**
     * Get deployments for a specific OpenAI resource using REST API
     */
    async getOpenAIDeployments(resourceGroup, accountName) {
        const url = `https://management.azure.com/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${accountName}/deployments?api-version=${this.apiVersion.cognitiveServices}`;
        
        try {
            const response = await this.makeRequest(url);
            
            if (!response.value) {
                return [];
            }
            
            return response.value.map(deployment => ({
                id: deployment.id,
                name: deployment.name,
                model: deployment.properties?.model,
                scaleSettings: deployment.properties?.scaleSettings,
                provisioningState: deployment.properties?.provisioningState
            }));
        } catch (error) {
            console.error(`Error getting deployments for ${accountName}:`, error.message);
            return [];
        }
    }

    /**
     * Handle paginated results
     */
    async getAllPages(initialUrl) {
        const results = [];
        let nextLink = initialUrl;
        
        while (nextLink) {
            try {
                const response = await this.makeRequest(nextLink);
                
                if (response.value && Array.isArray(response.value)) {
                    results.push(...response.value);
                }
                
                nextLink = response.nextLink || null;
            } catch (error) {
                console.error('Error fetching page:', error.message);
                break;
            }
        }
        
        return results;
    }
}

module.exports = AzureRestClient;