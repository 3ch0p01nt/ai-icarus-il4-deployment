const https = require('https');
const { 
    calculateOptimalChunkSize, 
    createChunks, 
    countTokens 
} = require('../shared/tokenUtils');

module.exports = async function (context, req) {
    context.log('AI Analysis function processing request');
    
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
            maxTokens = 2000, // Reduced from 4096 per Microsoft best practices - lower max_tokens improves latency
            temperature = 0.7,
            stream = false, // Enable streaming for better perceived performance
            stopSequences = [] // Add stop sequences to prevent over-generation
        } = req.body;

        context.log(`Processing request for deployment: ${deploymentName}`);
        
        // Model optimization suggestion (Microsoft best practice: use fastest model that meets requirements)
        const modelSuggestion = {
            suggested: false,
            reason: '',
            alternativeModel: ''
        };
        
        // Suggest GPT-4o mini for better latency if using larger models for small data
        if (data && countTokens(data) < 10000 && deploymentName) {
            const lowerName = deploymentName.toLowerCase();
            if (lowerName.includes('gpt-5') || lowerName.includes('gpt-4-turbo')) {
                modelSuggestion.suggested = true;
                modelSuggestion.reason = 'Data size is small (<10K tokens). Consider using GPT-4o mini for 2-3x faster response times.';
                modelSuggestion.alternativeModel = 'gpt-4o-mini';
                context.log.warn(`[Performance Tip] ${modelSuggestion.reason}`);
            }
        }

        // Validate required parameters
        if (!deploymentName || !data) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Missing required parameters',
                    message: 'deploymentName and data are required',
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // Check if data is too large (over 50MB) and suggest using smaller chunks
        const dataSize = JSON.stringify(req.body).length;
        if (dataSize > 50 * 1024 * 1024) {
            context.log.warn(`Request size too large: ${dataSize} bytes (${Math.round(dataSize / 1024 / 1024)}MB)`);
            context.res = {
                status: 413,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Request too large',
                    message: `Request size ${Math.round(dataSize / 1024 / 1024)}MB exceeds maximum 50MB. Please reduce the amount of data or use fewer rows.`,
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // Use environment variables as fallback
        const envApiKey = process.env.AZURE_OPENAI_API_KEY;
        const envEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        
        // Determine endpoint and API key
        const finalApiKey = apiKey || envApiKey;
        let finalEndpoint = endpoint || envEndpoint;
        
        if (customSubdomainName && !finalEndpoint) {
            finalEndpoint = `https://${customSubdomainName}.openai.azure.com`;
        }
        
        if (!finalApiKey || !finalEndpoint) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    error: 'Configuration error',
                    message: 'API key and endpoint are required',
                    timestamp: new Date().toISOString()
                }
            };
            return;
        }

        // Prepare data for analysis
        let dataText = '';
        if (typeof data === 'string') {
            dataText = data;
        } else if (typeof data === 'object') {
            dataText = JSON.stringify(data, null, 2);
        }

        // Use tokenUtils to calculate optimal chunk size based on model
        const chunkingStrategy = calculateOptimalChunkSize(
            deploymentName,
            maxTokens, // This is output tokens, the function will look up the actual context window
            systemPrompt,
            userPrompt
        );

        context.log('Chunking strategy:', {
            modelName: chunkingStrategy.modelName,
            contextWindow: chunkingStrategy.contextWindow,
            optimalChunkSize: chunkingStrategy.optimalChunkSize,
            totalOverhead: chunkingStrategy.totalOverhead,
            availableTokens: chunkingStrategy.availableTokens
        });

        // Create chunks using the tokenUtils function
        // For GPT-5 and GPT-4o models, use full optimal chunk size (no artificial cap)
        // For older models, cap at 30K for stability
        const isModernModel = deploymentName && (
            deploymentName.toLowerCase().includes('gpt-5') ||
            deploymentName.toLowerCase().includes('gpt-4o') ||
            deploymentName.toLowerCase().includes('o1')
        );
        const maxChunkSize = isModernModel 
            ? chunkingStrategy.optimalChunkSize  // Use full capacity for modern models
            : Math.min(chunkingStrategy.optimalChunkSize, 30000); // 30K cap for older models
        context.log(`Using chunk size: ${maxChunkSize} tokens (optimal was ${chunkingStrategy.optimalChunkSize})`);
        const chunkResults = createChunks(dataText, maxChunkSize, 50);
        
        // Convert to simple array if needed (createChunks returns objects with metadata)
        const chunks = chunkResults.map ? chunkResults : [chunkResults];
        
        context.log(`Created ${chunks.length} chunks using optimal size of ${chunkingStrategy.optimalChunkSize} tokens`);

        // Log actual token counts for debugging
        if (chunks.length > 0 && chunks[0].text) {
            const firstChunkTokens = countTokens(chunks[0].text);
            context.log(`First chunk actual tokens: ${firstChunkTokens}`);
        }

        // Parse endpoint URL
        const endpointUrl = new URL(finalEndpoint);
        const hostname = endpointUrl.hostname;
        
        // Prepare API path - use latest API version for GPT-5 support
        const apiPath = `/openai/deployments/${deploymentName}/chat/completions?api-version=2024-10-01-preview`;
        
        // Prepare request body - GPT-5 and reasoning models have special requirements
        const isGPT5Model = deploymentName && (
            deploymentName.toLowerCase().includes('gpt-5') ||
            deploymentName.toLowerCase().includes('gpt5')
        );
        const isReasoningModel = deploymentName && (
            deploymentName.toLowerCase().includes('o1') ||
            deploymentName.toLowerCase().includes('o3')
        );
        const isNewerModel = isGPT5Model || isReasoningModel;
        
        // gpt-5-nano models only support default temperature (1)
        const isNanoModel = deploymentName && deploymentName.toLowerCase().includes('nano');
        const finalTemperature = isNanoModel ? 1 : temperature;

        // Process chunks with LIMITED PARALLELISM like C# implementation
        // C# uses SemaphoreSlim(2,2) or (3,3) for limited concurrency
        const results = [];
        const MAX_PROCESSING_TIME = 8 * 60 * 1000; // 8 minutes max (function timeout is 10 minutes)
        const startProcessingTime = Date.now();
        
        // Adjust concurrency based on chunk size - Conservative per Microsoft best practices
        // Microsoft recommends "avoid sharp changes in workload" and gradual scaling
        const avgChunkSize = chunks.length > 0 ? 
            Math.floor(chunks.reduce((sum, c) => sum + countTokens(c.text || c), 0) / chunks.length) : 0;
        const MAX_CONCURRENT_CHUNKS = avgChunkSize > 100000 ? 1 :  // Very large: sequential only
                                      avgChunkSize > 50000 ? 1 :   // Large: sequential (Microsoft: avoid sharp changes)
                                      avgChunkSize > 20000 ? 2 :   // Medium: 2 concurrent max
                                      avgChunkSize > 10000 ? 3 :   // Small-medium: 3 concurrent
                                      4; // Small: 4 concurrent (reduced from 5)
        
        // Microsoft recommends 3-6 second delays when approaching limits
        const DELAY_BETWEEN_BATCHES = avgChunkSize > 50000 ? 3000 :  // 3s for large chunks
                                      avgChunkSize > 20000 ? 2000 :   // 2s for medium
                                      avgChunkSize > 10000 ? 1000 :   // 1s for small-medium
                                      500; // 500ms for small
        
        context.log(`[LIMITED PARALLEL MODE] Processing ${chunks.length} chunks with max ${MAX_CONCURRENT_CHUNKS} concurrent`);
        
        // Process chunks in small batches with limited parallelism
        for (let batchStart = 0; batchStart < chunks.length; batchStart += MAX_CONCURRENT_CHUNKS) {
            // Check if we're approaching timeout
            if (Date.now() - startProcessingTime > MAX_PROCESSING_TIME) {
                context.log.warn(`Approaching timeout limit. Processed ${results.length} of ${chunks.length} chunks`);
                break;
            }
            
            const batchEnd = Math.min(batchStart + MAX_CONCURRENT_CHUNKS, chunks.length);
            const batch = chunks.slice(batchStart, batchEnd);
            const batchNumber = Math.floor(batchStart / MAX_CONCURRENT_CHUNKS) + 1;
            const totalBatches = Math.ceil(chunks.length / MAX_CONCURRENT_CHUNKS);
            
            context.log(`[Batch ${batchNumber}/${totalBatches}] Processing chunks ${batchStart + 1}-${batchEnd} (${batch.length} chunks)`);
            
            // Add delay between batches (except for first batch)
            if (batchStart > 0) {
                context.log(`[Rate Limiting] Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
            
            // Process batch of chunks in parallel
            const batchPromises = batch.map(async (chunk, batchIndex) => {
                const chunkIndex = batchStart + batchIndex;
                context.log(`[Batch ${batchNumber}] Starting chunk ${chunkIndex + 1}/${chunks.length}`);
                
                try {
                    const chunkResult = await (async () => {
                // Handle both object format (from createChunks) and string format
                const chunkText = chunk.text || chunk;
                // Prepare messages for OpenAI
                const messages = [];
                if (systemPrompt) {
                    messages.push({ role: 'system', content: systemPrompt });
                }
                
                const chunkContext = chunks.length > 1 
                    ? `${userPrompt}\n\n[Chunk ${chunkIndex + 1} of ${chunks.length}]\n\n${chunkText}`
                    : `${userPrompt}\n\n${chunkText}`;
                    
                messages.push({ 
                    role: 'user', 
                    content: chunkContext
                });
                
                // Build request body - GPT-5 models work best without max_tokens parameter
                const requestBodyObj = {
                    messages: messages,
                    temperature: finalTemperature,
                    stream: stream // Enable streaming if requested
                };
                
                // Only add max_tokens for non-GPT5/non-reasoning models
                // GPT-5 and reasoning models should use API defaults
                if (!isGPT5Model && !isReasoningModel) {
                    requestBodyObj.max_tokens = maxTokens;
                }
                
                // Add stop sequences to prevent over-generation (Microsoft best practice)
                if (stopSequences && stopSequences.length > 0) {
                    requestBodyObj.stop = stopSequences;
                }
                
                const requestBody = JSON.stringify(requestBodyObj);
                
                // Log request details for debugging GPT-5 issues
                if (chunkIndex === 0 && isGPT5Model) {
                    context.log(`[GPT-5 Debug] Request body for ${deploymentName}:`, JSON.stringify(requestBodyObj, null, 2));
                }

                context.log(`Processing chunk ${chunkIndex + 1}/${chunks.length} (${countTokens(chunkText)} tokens)`);
                
                // Log the endpoint being called for debugging
                if (chunkIndex === 0) {
                    context.log(`Calling Azure OpenAI endpoint: https://${hostname}${apiPath}`);
                    context.log(`API Key present: ${!!finalApiKey}, Key length: ${finalApiKey ? finalApiKey.length : 0}`);
                    context.log(`Model type - GPT-5: ${isGPT5Model}, Reasoning: ${isReasoningModel}, Nano: ${isNanoModel}`);
                    context.log(`Temperature: ${finalTemperature}, Max tokens: ${requestBodyObj.max_tokens || 'not set (using API default)'}`);  
                }

                // Create timeout wrapper for the HTTPS request
                // Scale timeout based on chunk size (larger chunks need more time)
                const chunkTokens = countTokens(chunkText);
                const baseTimeout = 90000; // 90 seconds base (increased from 30s)
                const timeoutPerThousandTokens = 2000; // 2 seconds per 1K tokens (increased from 1s)
                const timeoutMs = Math.min(
                    baseTimeout + Math.floor(chunkTokens / 1000) * timeoutPerThousandTokens,
                    240000 // Max 4 minutes per chunk (increased from 2 minutes)
                );
                context.log(`[Chunk ${chunkIndex + 1}] Timeout set to ${timeoutMs}ms for ${chunkTokens} tokens`);
                
                // Retry logic with exponential backoff per Microsoft best practices
                const MAX_RETRIES = 3; // Microsoft recommends proper retry attempts
                const BASE_DELAY = 2000; // 2 seconds base delay
                let lastError = null;
                
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        if (attempt > 1) {
                            // Microsoft-recommended exponential backoff: 2s, 4s, 8s
                            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
                            context.log(`[Retry ${attempt}/${MAX_RETRIES}] Waiting ${delay}ms before retry (exponential backoff)...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                        
                        context.log(`[Chunk ${chunkIndex + 1}] Attempt ${attempt}/${MAX_RETRIES}`);
                        
                        // Make HTTPS request to Azure OpenAI with timeout
                        const response = await Promise.race([
                    // The actual request
                    new Promise((resolve, reject) => {
                        const startTime = Date.now();
                        context.log(`[Chunk ${chunkIndex + 1}] Starting request to OpenAI...`);
                        
                        const options = {
                            hostname: hostname,
                            port: 443,
                            path: apiPath,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': finalApiKey,
                                'Content-Length': Buffer.byteLength(requestBody)
                            },
                            timeout: timeoutMs // Add timeout to the request itself
                        };

                        const req = https.request(options, (res) => {
                            let data = '';
                            
                            res.on('data', (chunk) => {
                                data += chunk;
                            });
                            
                            res.on('end', () => {
                                const elapsed = Date.now() - startTime;
                                context.log(`[Chunk ${chunkIndex + 1}] Response received in ${elapsed}ms, status: ${res.statusCode}`);
                                
                                // Log full response for GPT-5 debugging
                                if (isGPT5Model && chunkIndex === 0) {
                                    context.log(`[GPT-5 Debug] Full response (first 1000 chars): ${data.substring(0, 1000)}`);
                                }
                                
                                if (res.statusCode === 200) {
                                    try {
                                        const result = JSON.parse(data);
                                        if (isGPT5Model && chunkIndex === 0) {
                                            context.log(`[GPT-5 Debug] Success! Model: ${result.model}, Usage: ${JSON.stringify(result.usage)}`);
                                        }
                                        resolve(result);
                                    } catch (e) {
                                        context.log.error(`[Chunk ${chunkIndex + 1}] Failed to parse response: ${data.substring(0, 200)}`);
                                        reject(new Error('Failed to parse OpenAI response'));
                                    }
                                } else {
                                    context.log.error(`[Chunk ${chunkIndex + 1}] API error ${res.statusCode}: ${data}`);
                                    // Log full error for GPT-5 models
                                    if (isGPT5Model) {
                                        context.log.error(`[GPT-5 Debug] Full error response: ${data}`);
                                    }
                                    reject(new Error(`OpenAI API error: ${res.statusCode} - ${data.substring(0, 500)}`));
                                }
                            });
                        });

                        req.on('error', (error) => {
                            const elapsed = Date.now() - startTime;
                            context.log.error(`[Chunk ${chunkIndex + 1}] Request error after ${elapsed}ms: ${error.message}`);
                            reject(error);
                        });
                        
                        req.on('timeout', () => {
                            const elapsed = Date.now() - startTime;
                            context.log.error(`[Chunk ${chunkIndex + 1}] Request timeout after ${elapsed}ms`);
                            req.destroy();
                            reject(new Error(`Request timeout after ${timeoutMs}ms`));
                        });

                        req.write(requestBody);
                        req.end();
                    }),
                    // Timeout promise
                    new Promise((_, reject) => {
                        setTimeout(() => {
                            context.log.error(`[Chunk ${chunkIndex + 1}] Timeout reached (${timeoutMs}ms)`);
                            reject(new Error(`Chunk ${chunkIndex + 1} timed out after ${timeoutMs}ms`));
                        }, timeoutMs);
                    })
                ]);

                        // Extract response - if we got here, request succeeded
                        const aiResponse = response.choices[0].message.content;
                        const usage = response.usage || {};
                        
                        // Success - return immediately
                        return {
                            chunkIndex: chunkIndex,
                            response: aiResponse,
                            tokensUsed: {
                                input: usage.prompt_tokens || 0,
                                output: usage.completion_tokens || 0
                            },
                            success: true
                        };
                        
                    } catch (error) {
                        lastError = error;
                        context.log.error(`[Chunk ${chunkIndex + 1}] Attempt ${attempt} failed: ${error.message}`);
                        
                        // Check if it's a rate limit error (429) or service unavailable (503)
                        const isRetryableError = error.message && (
                            error.message.includes('429') || 
                            error.message.includes('503') ||
                            error.message.includes('rate')
                        );
                        
                        if (isRetryableError) {
                            context.log.warn(`[Retryable Error] Chunk ${chunkIndex + 1} hit rate limit or service issue, will retry with backoff`);
                        } else if (error.message && error.message.includes('timeout')) {
                            // Don't retry on legitimate timeouts (Microsoft best practice)
                            context.log.warn(`[Timeout] Chunk ${chunkIndex + 1} timed out - not retrying (likely legitimate timeout for large chunk)`);
                            return {
                                chunkIndex: chunkIndex,
                                response: null,
                                error: `Chunk ${chunkIndex + 1} timed out after ${timeoutMs}ms`,
                                success: false
                            };
                        }
                        
                        // If this was the last attempt or not retryable, return error
                        if (attempt === MAX_RETRIES || !isRetryableError) {
                            context.log.error(`[Chunk ${chunkIndex + 1}] Failed after ${attempt} attempt(s)`);
                            return {
                                chunkIndex: chunkIndex,
                                response: null,
                                error: lastError.message,
                                success: false
                            };
                        }
                        // Otherwise, loop will continue with next attempt
                    }
                }
                
                // Shouldn't reach here, but handle just in case
                return {
                    chunkIndex: chunkIndex,
                    response: null,
                    error: lastError ? lastError.message : 'Unknown error',
                    success: false
                };
            })(); // End of async function
                    return chunkResult;
                } catch (unexpectedError) {
                    context.log.error(`[Batch ${batchNumber}] Unexpected error in chunk ${chunkIndex + 1}: ${unexpectedError.message}`);
                    return {
                        chunkIndex: chunkIndex,
                        response: null,
                        error: `Unexpected error: ${unexpectedError.message}`,
                        success: false
                    };
                }
            });
            
            // Wait for all chunks in batch to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Add batch results to overall results
            for (const chunkResult of batchResults) {
                results.push(chunkResult);
                
                // Log progress
                if (chunkResult.success) {
                    context.log(`[Batch ${batchNumber}] Chunk ${chunkResult.chunkIndex + 1} completed successfully`);
                } else {
                    context.log.error(`[Batch ${batchNumber}] Chunk ${chunkResult.chunkIndex + 1} failed: ${chunkResult.error}`);
                }
            }
            
            context.log(`[Batch ${batchNumber}/${totalBatches}] Completed. Total processed: ${results.length}/${chunks.length}`);
        }

        // Calculate totals
        const successfulChunks = results.filter(r => r.success).length;
        const failedChunks = results.filter(r => !r.success).length;
        const timedOutChunks = results.filter(r => !r.success && r.error && r.error.includes('timeout')).length;
        const totalInputTokens = results.reduce((sum, r) => sum + (r.tokensUsed?.input || 0), 0);
        const totalOutputTokens = results.reduce((sum, r) => sum + (r.tokensUsed?.output || 0), 0);

        context.log(`Analysis complete. Successful: ${successfulChunks}/${chunks.length}, Failed: ${failedChunks}, Timed out: ${timedOutChunks}`);
        context.log(`Tokens used: Input=${totalInputTokens}, Output=${totalOutputTokens}`);

        // Return successful response
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: successfulChunks > 0,
                results: results,
                summary: {
                    totalChunks: chunks.length,
                    successfulChunks: successfulChunks,
                    failedChunks: failedChunks,
                    timedOutChunks: timedOutChunks,
                    totalTokensUsed: {
                        input: totalInputTokens,
                        output: totalOutputTokens
                    },
                    modelUsed: deploymentName,
                    chunkingStrategy: {
                        contextWindow: chunkingStrategy.contextWindow,
                        optimalChunkSize: chunkingStrategy.optimalChunkSize,
                        quotaUtilization: chunkingStrategy.quotaUtilization
                    },
                    performanceOptimization: modelSuggestion
                },
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Error in AI Analysis function:', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Internal server error',
                message: error.message || 'Failed to complete AI analysis',
                timestamp: new Date().toISOString()
            }
        };
    }
};