const https = require('https');
const { 
    calculateOptimalChunkSize, 
    createChunks, 
    countTokens 
} = require('../shared/tokenUtils');

// Retry logic with exponential backoff (mirrors C# SendWithRetryAsync)
async function sendWithRetry(options, requestBody, context, chunkIndex, maxRetries = 5) {
    let lastError = null;
    const baseDelay = 5000; // 5 seconds base delay
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            context.log(`[Chunk ${chunkIndex}] Attempt ${attempt}/${maxRetries}`);
            
            const result = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = '';
                    
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try {
                                const parsed = JSON.parse(data);
                                resolve(parsed);
                            } catch (e) {
                                reject(new Error(`Failed to parse response: ${e.message}`));
                            }
                        } else if (res.statusCode === 429) {
                            // Rate limit - extract retry-after if available
                            const retryAfter = res.headers['retry-after'] || 
                                              res.headers['x-ratelimit-reset-after'] || 
                                              Math.pow(2, attempt) * baseDelay / 1000;
                            reject({ 
                                statusCode: 429, 
                                message: 'Rate limit exceeded',
                                retryAfter: parseInt(retryAfter)
                            });
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        }
                    });
                });
                
                req.on('error', reject);
                req.write(requestBody);
                req.end();
            });
            
            return result; // Success!
            
        } catch (error) {
            lastError = error;
            
            if (error.statusCode === 429 && attempt < maxRetries) {
                // Rate limit - implement exponential backoff
                const delay = error.retryAfter ? error.retryAfter * 1000 : Math.pow(2, attempt) * baseDelay;
                context.log(`[Chunk ${chunkIndex}] Rate limited. Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (attempt < maxRetries) {
                // Other error - exponential backoff
                const delay = Math.pow(2, attempt) * baseDelay;
                context.log(`[Chunk ${chunkIndex}] Error: ${error.message}. Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError || new Error('Max retries exceeded');
}

module.exports = async function (context, req) {
    context.log('AI Analysis Streaming function processing request');
    
    try {
        // Handle OPTIONS request for CORS
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

        // Validate request body
        if (!req.body) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Bad Request',
                    message: 'Request body is required',
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // Extract request parameters
        const {
            endpoint,
            deploymentName,
            apiKey,
            customSubdomainName,
            systemPrompt = 'You are a helpful assistant',
            userPrompt = 'Analyze the following data',
            data,
            maxTokens = 4096,
            temperature = 0.7,
            modelName,
            contextLength = 128000,
            stopSequences
        } = req.body;

        // Validate required fields - API key is optional, will use managed identity if not provided
        if (!deploymentName) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Bad Request',
                    message: 'Missing required field: deploymentName is required',
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // Configure API endpoint
        let hostname;
        context.log(`Received endpoint: "${endpoint}", customSubdomainName: "${customSubdomainName}"`);
        
        if (endpoint) {
            // Handle different endpoint formats
            if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
                // Parse the full URL to get the hostname
                try {
                    const endpointUrl = new URL(endpoint);
                    hostname = endpointUrl.hostname;
                    context.log(`Parsed hostname from URL: ${hostname}`);
                } catch (urlError) {
                    context.log.error(`Failed to parse endpoint URL: ${urlError.message}`);
                    // Try to extract hostname manually
                    const match = endpoint.match(/https?:\/\/([^\/]+)/);
                    if (match) {
                        hostname = match[1];
                        context.log(`Extracted hostname manually: ${hostname}`);
                    }
                }
            } else if (endpoint.includes('.openai.azure.')) {
                // Already a hostname
                hostname = endpoint;
                context.log(`Using endpoint as hostname directly: ${hostname}`);
            } else {
                // Assume it's just the subdomain
                hostname = `${endpoint}.openai.azure.com`;
                context.log(`Constructed hostname from subdomain: ${hostname}`);
            }
        } else if (customSubdomainName) {
            // Fallback to custom subdomain if no endpoint provided
            if (customSubdomainName.includes('.openai.azure.')) {
                hostname = customSubdomainName;
            } else {
                hostname = `${customSubdomainName}.openai.azure.com`;
            }
            context.log(`Using customSubdomainName: ${hostname}`);
        } else {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Bad Request',
                    message: 'No valid endpoint or customSubdomainName provided',
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }
        
        // Validate hostname
        if (!hostname || hostname === 'undefined' || hostname === 'null' || hostname === 'undefined.openai.azure.com') {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Bad Request',
                    message: `Invalid hostname: ${hostname}. Please provide a valid endpoint or customSubdomainName.`,
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }
        
        context.log(`Final hostname: ${hostname} for deployment: ${deploymentName}`);

        // Pre-request validation (like C# implementation)
        const totalDataTokens = data ? countTokens(data) : 0;
        const systemTokens = countTokens(systemPrompt);
        const userTokens = countTokens(userPrompt);
        const totalRequestTokens = totalDataTokens + systemTokens + userTokens;
        
        context.log(`Token counts - Data: ${totalDataTokens}, System: ${systemTokens}, User: ${userTokens}, Total: ${totalRequestTokens}`);
        
        // Check for oversized requests (C# style validation)
        const TPM_LIMIT = deploymentName.includes('gpt-5') ? 800000 : 150000;
        if (totalRequestTokens > TPM_LIMIT) {
            context.res = {
                status: 413,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Request Too Large',
                    message: `Request (${totalRequestTokens} tokens) exceeds deployment TPM limit (${TPM_LIMIT} tokens)`,
                    details: {
                        totalTokens: totalRequestTokens,
                        tpmLimit: TPM_LIMIT,
                        dataTokens: totalDataTokens,
                        systemTokens,
                        userTokens
                    }
                }
            };
            return;
        }

        // Calculate optimal chunk size
        const optimalChunkSize = calculateOptimalChunkSize(
            modelName || deploymentName,
            contextLength,
            systemPrompt,
            userPrompt
        );

        context.log(`Optimal chunk size calculated: ${optimalChunkSize} tokens`);

        // Create chunks if data is provided
        let chunks = [];
        if (data) {
            chunks = createChunks(data, optimalChunkSize);
            context.log(`Created ${chunks.length} chunks from input data`);
        } else {
            chunks = ['']; // Single empty chunk for non-data requests
        }

        const isNewerModel = deploymentName.includes('gpt-5') || deploymentName.includes('o1');
        const isNanoModel = deploymentName.includes('nano');
        const finalTemperature = isNanoModel ? 1 : temperature;

        // Process chunks with LIMITED parallelism (like C# SemaphoreSlim)
        const results = [];
        const MAX_CONCURRENT = 2; // Match C# SemaphoreSlim(2,2) for safety
        const BATCH_DELAY = 2000; // 2 second delay between batches
        
        // Track overall progress
        let completedChunks = 0;
        let failedChunks = 0;
        let totalTokensUsed = { input: 0, output: 0, total: 0 };
        const startTime = Date.now();
        
        // Process in controlled batches
        for (let batchStart = 0; batchStart < chunks.length; batchStart += MAX_CONCURRENT) {
            const batchEnd = Math.min(batchStart + MAX_CONCURRENT, chunks.length);
            const batch = chunks.slice(batchStart, batchEnd);
            const batchNumber = Math.floor(batchStart / MAX_CONCURRENT) + 1;
            const totalBatches = Math.ceil(chunks.length / MAX_CONCURRENT);
            
            context.log(`Processing batch ${batchNumber}/${totalBatches} with ${batch.length} chunks`);
            
            // Add delay between batches (except first)
            if (batchStart > 0) {
                context.log(`Waiting ${BATCH_DELAY}ms before batch ${batchNumber}`);
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
            
            // Process batch chunks in parallel
            const batchPromises = batch.map(async (chunk, batchIndex) => {
                const chunkIndex = batchStart + batchIndex;
                const chunkText = chunk.text || chunk;
                
                try {
                    context.log(`Processing chunk ${chunkIndex + 1}/${chunks.length}`);
                    
                    // Prepare messages
                    const messages = [];
                    if (systemPrompt) {
                        messages.push({ role: 'system', content: systemPrompt });
                    }
                    
                    const chunkContext = chunks.length > 1 
                        ? `${userPrompt}\n\n[Chunk ${chunkIndex + 1} of ${chunks.length}]\n\n${chunkText}`
                        : `${userPrompt}\n\n${chunkText}`;
                        
                    messages.push({ role: 'user', content: chunkContext });
                    
                    // Build request body
                    const requestBodyObj = {
                        messages: messages,
                        temperature: finalTemperature
                    };
                    
                    // Only add max_tokens for non-GPT5/non-reasoning models
                    if (!isNewerModel) {
                        requestBodyObj.max_tokens = maxTokens;
                    }
                    
                    if (stopSequences && stopSequences.length > 0) {
                        requestBodyObj.stop = stopSequences;
                    }
                    
                    const requestBody = JSON.stringify(requestBodyObj);
                    
                    // Configure request options
                    const headers = {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(requestBody)
                    };
                    
                    // Use API key if provided, otherwise rely on managed identity (would need different implementation)
                    if (apiKey) {
                        headers['api-key'] = apiKey;
                    } else {
                        // For now, use a placeholder key - in production this should use managed identity
                        // This would require using Azure SDK instead of direct HTTPS
                        context.log('[WARNING] No API key provided - using placeholder for testing');
                        headers['api-key'] = 'placeholder-key-for-testing';
                    }
                    
                    const options = {
                        hostname: hostname,
                        port: 443,
                        path: `/openai/deployments/${deploymentName}/chat/completions?api-version=2024-06-01`,
                        method: 'POST',
                        headers: headers
                    };
                    
                    // Send request with retry logic
                    const response = await sendWithRetry(options, requestBody, context, chunkIndex);
                    
                    // Extract result
                    const result = {
                        chunkIndex,
                        response: response.choices?.[0]?.message?.content || 'No response',
                        tokensUsed: response.usage ? {
                            input: response.usage.prompt_tokens || 0,
                            output: response.usage.completion_tokens || 0,
                            total: response.usage.total_tokens || 0
                        } : { input: 0, output: 0, total: 0 }
                    };
                    
                    // Update totals
                    completedChunks++;
                    totalTokensUsed.input += result.tokensUsed.input;
                    totalTokensUsed.output += result.tokensUsed.output;
                    totalTokensUsed.total += result.tokensUsed.total;
                    
                    context.log(`Chunk ${chunkIndex + 1} completed successfully`);
                    return result;
                    
                } catch (error) {
                    failedChunks++;
                    context.log.error(`[Chunk ${chunkIndex}] Failed:`, error);
                    
                    return {
                        chunkIndex,
                        error: error.message,
                        response: null,
                        tokensUsed: { input: 0, output: 0, total: 0 }
                    };
                }
            });
            
            // Wait for batch to complete
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            context.log(`Batch ${batchNumber} completed. Success: ${batchResults.filter(r => r.response).length}/${batchResults.length}`);
        }
        
        // Calculate aggregated response
        const successfulResults = results.filter(r => r.response);
        const aggregatedResponse = successfulResults.length > 0
            ? successfulResults.map(r => r.response).join('\n\n---\n\n')
            : 'No successful responses received';
        
        const processingTime = Date.now() - startTime;
        
        // Return the complete response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                results: results,
                totalTokensUsed,
                metadata: {
                    model: deploymentName,
                    chunksProcessed: completedChunks,
                    chunksFailed: failedChunks,
                    processingTime,
                    successRate: Math.round((completedChunks / chunks.length) * 100),
                    totalChunks: chunks.length,
                    chunkSizes: chunks.map(c => countTokens(c.text || c))
                },
                aggregatedResponse,
                timestamp: new Date().toISOString()
            }
        };
        
    } catch (error) {
        context.log.error('Stream processing error:', error);
        
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