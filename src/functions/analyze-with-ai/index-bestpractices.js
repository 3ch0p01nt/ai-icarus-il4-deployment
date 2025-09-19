/**
 * Azure OpenAI Analysis Function - Best Practices Implementation
 * Implements Microsoft's recommended patterns for Azure OpenAI integration
 * 
 * Key improvements:
 * - Microsoft Entra ID authentication (token-based)
 * - Intelligent rate limiting with x-ratelimit headers
 * - Smart model selection and fallback chains
 * - Proper retry logic with exponential backoff
 * - Enhanced error handling with specific Azure OpenAI error codes
 * - Optimized token management for GPT-5 and reasoning models
 * - Latest API version support (2025-04-01-preview)
 */

const https = require('https');
const { 
    calculateOptimalChunkSize, 
    createSemanticChunks,
    countTokens,
    estimateCosts,
    analyzeAndRecommendChunking,
    aggregateChunkResponses
} = require('../shared/tokenUtils');

const { getAuthHeader, getEnvironmentConfig } = require('../shared/azureAuth');
const { AzureOpenAIRateLimiter, RateLimitInfo } = require('../shared/rateLimiter');
const { 
    parseAzureOpenAIError, 
    RetryStrategy, 
    CircuitBreaker,
    DEGRADATION_STRATEGIES 
} = require('../shared/errorHandler');
const { defaultSelector } = require('../shared/modelSelector');

// Initialize rate limiter and circuit breaker
const rateLimiter = new AzureOpenAIRateLimiter({
    maxRequestsPerMinute: 60,
    maxTokensPerMinute: 90000,
    maxConcurrent: 3
});

const circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 60000
});

const retryStrategy = new RetryStrategy({
    maxRetries: 3,
    baseDelay: 2000,
    maxDelay: 32000
});

module.exports = async function (context, req) {
    context.log('[Best Practices] AI Analysis function processing request');
    
    try {
        // Handle OPTIONS request for CORS
        if (req.method === 'OPTIONS') {
            context.res = {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: ''
            };
            return;
        }

        // Validate request
        if (!req.body) {
            throw new Error('Request body is required');
        }

        // Extract and validate parameters
        const {
            endpoint,
            deploymentName,
            apiKey, // Deprecated - will use token auth
            customSubdomainName,
            systemPrompt = 'You are a helpful assistant',
            userPrompt = 'Analyze the following data',
            data,
            maxTokens, // Will be optimized based on model
            temperature = 0.7,
            stream = true, // Enable by default for better UX
            stopSequences = [],
            taskType, // For intelligent model selection
            modelPreference, // User's preferred model
            fallbackModels = [], // User-specified fallback chain
            enableAutoModelSelection = true,
            maxLatencyMs = 30000,
            maxCostPer1K = 0.05,
            priority = 'normal' // high, normal, low
        } = req.body;

        // Validate required parameters
        if (!data) {
            throw new Error('Data is required for analysis');
        }

        // Get environment configuration
        const envConfig = getEnvironmentConfig();
        
        // Prepare endpoint
        let finalEndpoint = endpoint || process.env.AZURE_OPENAI_ENDPOINT;
        if (customSubdomainName && !finalEndpoint) {
            finalEndpoint = `https://${customSubdomainName}${envConfig.openAIEndpointSuffix}`;
        }
        
        if (!finalEndpoint) {
            throw new Error('Azure OpenAI endpoint is required');
        }

        // BEST PRACTICE 1: Use Microsoft Entra ID authentication
        context.log('[Auth] Getting authentication headers (preferring token-based auth)');
        const authHeaders = await getAuthHeader(apiKey); // Will prefer token over API key
        
        // BEST PRACTICE 2: Intelligent Model Selection
        let selectedModel = deploymentName;
        let modelFallbacks = fallbackModels;
        
        if (enableAutoModelSelection) {
            context.log('[Model Selection] Analyzing task requirements');
            const recommendation = defaultSelector.recommend({
                taskType,
                data,
                prompt: userPrompt,
                maxLatencyMs,
                maxCostPer1K,
                requiresStreaming: stream,
                requiresVision: false
            });
            
            selectedModel = modelPreference || recommendation.primary;
            modelFallbacks = fallbackModels.length > 0 ? fallbackModels : recommendation.fallbacks;
            
            context.log(`[Model Selection] Selected: ${selectedModel}, Fallbacks: ${modelFallbacks.join(', ')}`);
            context.log(`[Model Selection] Reasoning: ${recommendation.explanation}`);
        }

        // BEST PRACTICE 3: Optimize chunking strategy
        context.log('[Chunking] Analyzing data and determining optimal strategy');
        const chunkingAnalysis = analyzeAndRecommendChunking(data, selectedModel);
        const chunkingStrategy = calculateOptimalChunkSize(
            selectedModel,
            maxTokens || 4096,
            systemPrompt,
            userPrompt
        );
        
        context.log('[Chunking] Strategy:', {
            contentType: chunkingAnalysis.contentType,
            recommendedStrategy: chunkingAnalysis.recommendations.strategy,
            optimalChunkSize: chunkingStrategy.optimalChunkSize,
            contextWindow: chunkingStrategy.contextWindow
        });

        // Create semantic chunks (improved chunking)
        const chunkResult = createSemanticChunks(
            typeof data === 'string' ? data : JSON.stringify(data, null, 2),
            chunkingStrategy.optimalChunkSize,
            chunkingAnalysis.recommendations
        );
        
        const chunks = chunkResult.chunks;
        context.log(`[Chunking] Created ${chunks.length} semantic chunks, stats:`, chunkResult.stats);

        // BEST PRACTICE 4: Use latest API version for GPT-5 support
        const apiVersion = '2025-04-01-preview'; // Latest version for GPT-5 and new features
        
        // Process chunks with rate limiting and circuit breaker
        const results = [];
        let currentModelIndex = 0;
        let currentModel = selectedModel;
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkText = chunk.text || chunk;
            
            context.log(`[Processing] Chunk ${i + 1}/${chunks.length} with ${currentModel}`);
            
            // BEST PRACTICE 5: Circuit breaker pattern
            let chunkResult;
            try {
                chunkResult = await circuitBreaker.execute(async () => {
                    // BEST PRACTICE 6: Rate limiting with priority
                    return await rateLimiter.executeRequest(
                        async () => {
                            // BEST PRACTICE 7: Retry with exponential backoff
                            return await retryStrategy.execute(async () => {
                                return await processChunkWithAzureOpenAI({
                                    endpoint: finalEndpoint,
                                    deploymentName: currentModel,
                                    apiVersion,
                                    authHeaders,
                                    systemPrompt,
                                    userPrompt,
                                    chunkText,
                                    chunkIndex: i,
                                    totalChunks: chunks.length,
                                    maxTokens: optimizeMaxTokens(currentModel, maxTokens),
                                    temperature: optimizeTemperature(currentModel, temperature),
                                    stream,
                                    stopSequences,
                                    context
                                });
                            }, { modelName: currentModel, chunkIndex: i });
                        },
                        {
                            priority,
                            estimatedTokens: countTokens(chunkText)
                        }
                    );
                });
                
                results.push(chunkResult);
                
            } catch (error) {
                context.log.error(`[Error] Chunk ${i + 1} failed with ${currentModel}:`, error.message);
                
                // BEST PRACTICE 8: Model fallback on failure
                if (currentModelIndex < modelFallbacks.length) {
                    currentModel = modelFallbacks[currentModelIndex++];
                    context.log(`[Fallback] Switching to ${currentModel}`);
                    
                    // Reset circuit breaker for new model
                    circuitBreaker.reset();
                    
                    // Retry with fallback model
                    i--; // Retry the same chunk
                    continue;
                }
                
                // BEST PRACTICE 9: Graceful degradation
                const degraded = await tryDegradationStrategies(error, {
                    deploymentName: currentModel,
                    fallbackModel: modelFallbacks[0],
                    cache: null, // Could implement caching
                    maxTokens,
                    stream
                });
                
                if (degraded) {
                    results.push(degraded);
                } else {
                    results.push({
                        chunkIndex: i,
                        success: false,
                        error: error.message,
                        response: null
                    });
                }
            }
        }

        // Aggregate results intelligently
        const aggregatedResponse = aggregateChunkResponses(results, 'smartMerge');
        
        // Calculate costs
        const totalInputTokens = results.reduce((sum, r) => sum + (r.tokensUsed?.input || 0), 0);
        const totalOutputTokens = results.reduce((sum, r) => sum + (r.tokensUsed?.output || 0), 0);
        const costEstimate = estimateCosts(totalInputTokens, totalOutputTokens, currentModel);
        
        // Get rate limiter stats
        const rateLimitStats = rateLimiter.getStats();
        const circuitBreakerState = circuitBreaker.getState();
        
        // Prepare response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'X-Model-Used': currentModel,
                'X-API-Version': apiVersion
            },
            body: {
                success: true,
                response: aggregatedResponse,
                metadata: {
                    modelUsed: currentModel,
                    modelChain: [selectedModel, ...modelFallbacks],
                    chunksProcessed: results.length,
                    successfulChunks: results.filter(r => r.success).length,
                    failedChunks: results.filter(r => !r.success).length,
                    totalTokens: {
                        input: totalInputTokens,
                        output: totalOutputTokens
                    },
                    costEstimate,
                    chunkingStrategy: chunkResult.metadata,
                    performance: {
                        rateLimitStats,
                        circuitBreakerState,
                        averageLatency: calculateAverageLatency(results)
                    }
                },
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('[Fatal Error]', error);
        
        // Parse Azure OpenAI specific errors
        const parsedError = parseAzureOpenAIError(error, error.response || error.message);
        
        context.res = {
            status: parsedError.statusCode || 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: parsedError.code,
                message: parsedError.userMessage,
                details: parsedError.details,
                retryable: parsedError.retryable,
                retryAfter: parsedError.retryAfter,
                action: parsedError.action,
                timestamp: new Date().toISOString()
            }
        };
    }
};

/**
 * Process a single chunk with Azure OpenAI
 */
async function processChunkWithAzureOpenAI(options) {
    const {
        endpoint,
        deploymentName,
        apiVersion,
        authHeaders,
        systemPrompt,
        userPrompt,
        chunkText,
        chunkIndex,
        totalChunks,
        maxTokens,
        temperature,
        stream,
        stopSequences,
        context
    } = options;
    
    const startTime = Date.now();
    
    // Parse endpoint
    const endpointUrl = new URL(endpoint);
    const hostname = endpointUrl.hostname;
    
    // Build API path with latest version
    const apiPath = `/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
    
    // Prepare messages
    const messages = [];
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    
    const chunkContext = totalChunks > 1 
        ? `${userPrompt}\n\n[Chunk ${chunkIndex + 1} of ${totalChunks}]\n\n${chunkText}`
        : `${userPrompt}\n\n${chunkText}`;
    
    messages.push({ role: 'user', content: chunkContext });
    
    // Build request body following Microsoft best practices
    const requestBody = {
        messages,
        temperature,
        stream,
        // Only set max_tokens for non-GPT5/non-reasoning models
        ...(shouldSetMaxTokens(deploymentName) && { max_tokens: maxTokens }),
        ...(stopSequences.length > 0 && { stop: stopSequences }),
        // Add response format for structured output (new feature)
        response_format: { type: 'text' }
    };
    
    // Make HTTPS request
    return new Promise((resolve, reject) => {
        const requestBodyStr = JSON.stringify(requestBody);
        
        const requestOptions = {
            hostname,
            port: 443,
            path: apiPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBodyStr),
                ...authHeaders
            }
        };
        
        const req = https.request(requestOptions, (res) => {
            let data = '';
            let rateLimitInfo = null;
            
            // Extract rate limit headers
            if (res.headers) {
                rateLimitInfo = new RateLimitInfo(res.headers);
            }
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                const latency = Date.now() - startTime;
                
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(data);
                        resolve({
                            chunkIndex,
                            success: true,
                            response: result.choices[0].message.content,
                            tokensUsed: result.usage || {},
                            model: result.model,
                            latency,
                            rateLimitInfo,
                            headers: res.headers
                        });
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else {
                    const error = new Error(`API error ${res.statusCode}: ${data}`);
                    error.statusCode = res.statusCode;
                    error.response = data;
                    error.headers = res.headers;
                    reject(error);
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout after ${options.timeout || 30000}ms`));
        });
        
        req.write(requestBodyStr);
        req.end();
    });
}

/**
 * Optimize max_tokens based on model
 */
function optimizeMaxTokens(modelName, requestedTokens) {
    // GPT-5 and reasoning models work better without explicit max_tokens
    if (!shouldSetMaxTokens(modelName)) {
        return undefined;
    }
    
    // For other models, use requested or default
    return requestedTokens || 4096;
}

/**
 * Check if max_tokens should be set for a model
 */
function shouldSetMaxTokens(modelName) {
    const modelLower = modelName.toLowerCase();
    // Don't set max_tokens for GPT-5 and reasoning models (o1, o3)
    return !(
        modelLower.includes('gpt-5') ||
        modelLower.includes('gpt5') ||
        modelLower.includes('o1') ||
        modelLower.includes('o3')
    );
}

/**
 * Optimize temperature based on model
 */
function optimizeTemperature(modelName, requestedTemp) {
    const modelLower = modelName.toLowerCase();
    
    // Nano models only support default temperature
    if (modelLower.includes('nano')) {
        return 1.0;
    }
    
    // Reasoning models work better with lower temperature
    if (modelLower.includes('o1') || modelLower.includes('o3')) {
        return Math.min(requestedTemp, 0.5);
    }
    
    return requestedTemp;
}

/**
 * Try degradation strategies on error
 */
async function tryDegradationStrategies(error, context) {
    for (const [strategyName, strategy] of Object.entries(DEGRADATION_STRATEGIES)) {
        try {
            const result = await strategy(error, context);
            if (result === true) {
                // Strategy suggests retry
                return null; // Caller should retry
            } else if (result) {
                // Strategy returned alternative result
                return result;
            }
        } catch (e) {
            // Strategy failed, try next
            continue;
        }
    }
    return null;
}

/**
 * Calculate average latency from results
 */
function calculateAverageLatency(results) {
    const latencies = results.filter(r => r.latency).map(r => r.latency);
    if (latencies.length === 0) return 0;
    return Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length);
}