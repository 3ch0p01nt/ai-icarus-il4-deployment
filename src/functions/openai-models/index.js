// Model capability definitions based on latest Azure OpenAI offerings
const MODEL_CAPABILITIES = {
    // GPT-4 Turbo models
    'gpt-4-turbo': {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1K: 0.01,
        outputCostPer1K: 0.03,
        supportsVision: true,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 150000
    },
    'gpt-4-turbo-2024-04-09': {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1K: 0.01,
        outputCostPer1K: 0.03,
        supportsVision: true,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 150000
    },
    
    // GPT-4o models
    'gpt-4o': {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCostPer1K: 0.005,
        outputCostPer1K: 0.015,
        supportsVision: true,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 300000
    },
    'gpt-4o-mini': {
        contextWindow: 128000,
        maxOutputTokens: 16384,
        inputCostPer1K: 0.00015,
        outputCostPer1K: 0.0006,
        supportsVision: true,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 200000
    },
    
    // GPT-5 models (future-proofing)
    'gpt-5': {
        contextWindow: 400000,
        maxOutputTokens: 32000,
        inputCostPer1K: 0.02,
        outputCostPer1K: 0.06,
        supportsVision: true,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 500000
    },
    'gpt-5-mini': {
        contextWindow: 400000,
        maxOutputTokens: 32000,
        inputCostPer1K: 0.001,
        outputCostPer1K: 0.004,
        supportsVision: true,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 400000
    },
    
    // O1 Reasoning models
    'o1-preview': {
        contextWindow: 200000,
        maxOutputTokens: 100000,
        inputCostPer1K: 0.015,
        outputCostPer1K: 0.06,
        supportsVision: false,
        supportsStreaming: false,
        isReasoningModel: true,
        reasoningOverhead: 0.1, // 10% additional tokens for reasoning
        tpmLimit: 100000
    },
    'o1-mini': {
        contextWindow: 200000,
        maxOutputTokens: 65536,
        inputCostPer1K: 0.003,
        outputCostPer1K: 0.012,
        supportsVision: false,
        supportsStreaming: false,
        isReasoningModel: true,
        reasoningOverhead: 0.1,
        tpmLimit: 150000
    },
    
    // GPT-3.5 models
    'gpt-35-turbo': {
        contextWindow: 16385,
        maxOutputTokens: 4096,
        inputCostPer1K: 0.0005,
        outputCostPer1K: 0.0015,
        supportsVision: false,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 90000
    },
    'gpt-35-turbo-16k': {
        contextWindow: 16385,
        maxOutputTokens: 4096,
        inputCostPer1K: 0.0005,
        outputCostPer1K: 0.0015,
        supportsVision: false,
        supportsStreaming: true,
        isReasoningModel: false,
        tpmLimit: 90000
    },
    
    // Embedding models
    'text-embedding-ada-002': {
        contextWindow: 8191,
        maxOutputTokens: 0,
        inputCostPer1K: 0.0001,
        outputCostPer1K: 0,
        supportsVision: false,
        supportsStreaming: false,
        isReasoningModel: false,
        isEmbedding: true,
        dimensions: 1536,
        tpmLimit: 350000
    },
    'text-embedding-3-small': {
        contextWindow: 8191,
        maxOutputTokens: 0,
        inputCostPer1K: 0.00002,
        outputCostPer1K: 0,
        supportsVision: false,
        supportsStreaming: false,
        isReasoningModel: false,
        isEmbedding: true,
        dimensions: 1536,
        tpmLimit: 350000
    },
    'text-embedding-3-large': {
        contextWindow: 8191,
        maxOutputTokens: 0,
        inputCostPer1K: 0.00013,
        outputCostPer1K: 0,
        supportsVision: false,
        supportsStreaming: false,
        isReasoningModel: false,
        isEmbedding: true,
        dimensions: 3072,
        tpmLimit: 350000
    }
};

module.exports = async function (context, req) {
    context.log('OpenAI Models function processing request');

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

        const { OpenAIClient } = require('@azure/openai');
        const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');

        // Get resource endpoint and deployment info from request
        const { endpoint, apiKey, deploymentName, testQuota } = req.body || {};

        if (!endpoint && !deploymentName) {
            // Return model capabilities catalog
            const models = Object.entries(MODEL_CAPABILITIES).map(([modelId, capabilities]) => ({
                modelId,
                ...capabilities,
                estimatedInputTokens: Math.floor(capabilities.contextWindow * 0.9), // 90% usable
                safeChunkSize: Math.floor(capabilities.contextWindow * 0.85), // 85% for safety
                concurrentRequests: Math.floor(capabilities.tpmLimit / (capabilities.contextWindow * 0.1)) // Estimate
            }));

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    models: models,
                    count: models.length,
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // Test actual deployment capabilities
        if (endpoint && deploymentName) {
            context.log(`Testing deployment ${deploymentName} at ${endpoint}`);

            let client;
            if (apiKey) {
                // Use API key authentication
                client = new OpenAIClient(endpoint, {
                    apiKey: apiKey
                });
            } else {
                // Use Azure AD authentication
                const credential = process.env.AZURE_CLIENT_ID 
                    ? new DefaultAzureCredential()
                    : new ManagedIdentityCredential();
                    
                client = new OpenAIClient(endpoint, credential);
            }

            // Detect model capabilities through test calls
            const capabilities = {
                deploymentName: deploymentName,
                endpoint: endpoint,
                detected: false,
                error: null
            };

            try {
                // Test with a minimal completion request
                if (testQuota) {
                    const testPrompt = "Test";
                    const result = await client.getCompletions(deploymentName, [testPrompt], {
                        maxTokens: 1,
                        temperature: 0
                    });

                    // Extract rate limit headers from response
                    if (result._response) {
                        const headers = result._response.headers;
                        capabilities.tpmLimit = parseInt(headers.get('x-ratelimit-remaining-tokens')) || null;
                        capabilities.rpmLimit = parseInt(headers.get('x-ratelimit-remaining-requests')) || null;
                    }
                }

                // Try to infer model type from deployment name
                const modelKey = Object.keys(MODEL_CAPABILITIES).find(key => 
                    deploymentName.toLowerCase().includes(key.toLowerCase().replace('-', ''))
                );

                if (modelKey) {
                    capabilities.modelType = modelKey;
                    capabilities.capabilities = MODEL_CAPABILITIES[modelKey];
                    capabilities.detected = true;
                } else {
                    // Default capabilities for unknown models
                    capabilities.modelType = 'unknown';
                    capabilities.capabilities = {
                        contextWindow: 4096,
                        maxOutputTokens: 2048,
                        supportsStreaming: true,
                        isReasoningModel: false,
                        tpmLimit: capabilities.tpmLimit || 60000
                    };
                    capabilities.detected = false;
                }

            } catch (error) {
                context.log.error('Error testing deployment:', error);
                capabilities.error = error.message;
                capabilities.detected = false;
            }

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: capabilities
            };
            return;
        }

        // Invalid request
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Invalid request',
                message: 'Provide either no parameters for model catalog, or endpoint and deploymentName for testing',
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Error in OpenAI Models function:', error);

        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Internal server error',
                message: error.message || 'Failed to get model capabilities',
                timestamp: new Date().toISOString()
            }
        };
    }
};