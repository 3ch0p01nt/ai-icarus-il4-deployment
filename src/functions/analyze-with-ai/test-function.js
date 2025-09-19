// Simplified test version for GPT-5-nano-lion
const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');

module.exports = async function (context, req) {
    context.log('Test AI Analysis function for GPT-5-nano-lion');
    
    try {
        // Handle OPTIONS
        if (req.method === 'OPTIONS') {
            context.res = {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                },
                body: ''
            };
            return;
        }

        const { 
            endpoint,
            deploymentName,
            modelName,
            systemPrompt,
            userPrompt,
            data
        } = req.body || {};

        // For now, just return a mock response for GPT-5-nano-lion
        if (deploymentName === 'gpt-5-nano-lion' || modelName === 'gpt-5-nano') {
            context.log('GPT-5-nano-lion detected - returning mock response');
            
            // Simulate processing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    results: [{
                        chunkIndex: 0,
                        response: `## Analysis Results\n\nThis is a test response from GPT-5-nano-lion model.\n\n### Key Findings:\n1. The data contains ${data ? data.length : 0} characters\n2. System prompt: "${systemPrompt || 'None provided'}"\n3. User prompt: "${userPrompt || 'None provided'}"\n\n### Summary:\nThe GPT-5-nano-lion model has successfully processed your request. This is a mock response for testing purposes.`,
                        tokensUsed: {
                            input: 1000,
                            output: 500,
                            total: 1500
                        }
                    }],
                    totalTokensUsed: {
                        input: 1000,
                        output: 500,
                        total: 1500
                    },
                    metadata: {
                        model: 'gpt-5-nano-lion',
                        chunksProcessed: 1,
                        chunksFailed: 0,
                        processingTime: 2000
                    },
                    aggregatedResponse: `## Analysis Results\n\nThis is a test response from GPT-5-nano-lion model.\n\n### Key Findings:\n1. The data contains ${data ? data.length : 0} characters\n2. System prompt: "${systemPrompt || 'None provided'}"\n3. User prompt: "${userPrompt || 'None provided'}"\n\n### Summary:\nThe GPT-5-nano-lion model has successfully processed your request. This is a mock response for testing purposes.`,
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // For other models, return error
        context.res = {
            status: 501,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Not Implemented',
                message: 'This test function only supports GPT-5-nano-lion model',
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Test function error:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Internal Server Error',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};