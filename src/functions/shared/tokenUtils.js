const { encode } = require('gpt-tokenizer');

/**
 * Token calculation utilities ported from C# AIIcarus application
 * Provides accurate token counting and chunking strategies
 */

// Model-specific token limits and configurations
const MODEL_CONFIGS = {
    'gpt-4-turbo': { contextWindow: 128000, outputReserved: 4096 },
    'gpt-4o': { contextWindow: 128000, outputReserved: 4096 },
    'gpt-4o-mini': { contextWindow: 128000, outputReserved: 16384 },
    'gpt-5': { contextWindow: 400000, outputReserved: 32000 },
    'gpt-5-mini': { contextWindow: 400000, outputReserved: 32000 },
    'gpt-5-nano': { contextWindow: 272000, outputReserved: 32000 }, // Based on Azure error message
    'o1-preview': { contextWindow: 200000, outputReserved: 100000, reasoningOverhead: 0.1 },
    'o1-mini': { contextWindow: 200000, outputReserved: 65536, reasoningOverhead: 0.1 },
    'gpt-35-turbo': { contextWindow: 16385, outputReserved: 4096 },
    'gpt-35-turbo-16k': { contextWindow: 16385, outputReserved: 4096 }
};

/**
 * Count tokens in a text string
 * @param {string} text - The text to count tokens for
 * @returns {number} Number of tokens
 */
function countTokens(text) {
    if (!text) return 0;
    
    try {
        // Use gpt-tokenizer for accurate counting
        const tokens = encode(text);
        return tokens.length;
    } catch (error) {
        // Fallback to approximation if encoding fails
        console.warn('Token encoding failed, using approximation:', error.message);
        return Math.ceil(text.length / 4); // Approximate 4 characters per token
    }
}

/**
 * Calculate optimal chunk size based on model and prompts
 * @param {string} modelName - The model deployment name
 * @param {number} maxTokens - Maximum context window
 * @param {string} systemPrompt - System prompt text
 * @param {string} userPrompt - User prompt text
 * @returns {Object} Chunking strategy with sizes and estimates
 */
function calculateOptimalChunkSize(modelName, maxTokens, systemPrompt, userPrompt) {
    // Get model configuration
    const modelKey = Object.keys(MODEL_CONFIGS).find(key => 
        modelName.toLowerCase().includes(key.toLowerCase())
    );
    
    const config = MODEL_CONFIGS[modelKey] || {
        contextWindow: maxTokens || 4096,
        outputReserved: Math.min(4096, Math.floor((maxTokens || 4096) * 0.25))
    };
    
    // Count tokens in prompts
    const systemTokens = countTokens(systemPrompt);
    const userTokens = countTokens(userPrompt);
    
    // Calculate overhead
    const messageOverhead = 100; // JSON structure, role labels, etc.
    const quotaUtilization = 0.60; // Use only 60% of available quota for safety
    const safetyMargin = 0.01; // Additional 1% safety buffer
    
    // Handle reasoning models with additional overhead
    let reasoningOverhead = 0;
    if (config.reasoningOverhead) {
        reasoningOverhead = Math.ceil(config.contextWindow * config.reasoningOverhead);
    }
    
    // Calculate available tokens for content
    const totalOverhead = systemTokens + userTokens + config.outputReserved + 
                         messageOverhead + reasoningOverhead;
    
    const availableTokens = config.contextWindow - totalOverhead;
    // Apply 60% quota utilization first, then safety margin
    const quotaLimitedTokens = Math.floor(availableTokens * quotaUtilization);
    const safeTokens = Math.floor(quotaLimitedTokens * (1 - safetyMargin));
    
    // Ensure minimum viable chunk size
    const optimalChunkSize = Math.max(500, safeTokens);
    
    return {
        modelName: modelName,
        contextWindow: config.contextWindow,
        systemTokens: systemTokens,
        userTokens: userTokens,
        outputReserved: config.outputReserved,
        reasoningOverhead: reasoningOverhead,
        messageOverhead: messageOverhead,
        totalOverhead: totalOverhead,
        availableTokens: availableTokens,
        quotaUtilization: quotaUtilization,
        quotaLimitedTokens: quotaLimitedTokens,
        optimalChunkSize: optimalChunkSize,
        safetyMargin: Math.floor(config.contextWindow * safetyMargin),
        isReasoningModel: !!config.reasoningOverhead
    };
}

/**
 * Split text into optimal chunks for processing
 * @param {string} text - The text to chunk
 * @param {number} maxChunkTokens - Maximum tokens per chunk
 * @param {number} overlapTokens - Overlap between chunks for context
 * @returns {Array} Array of text chunks
 */
function createChunks(text, maxChunkTokens, overlapTokens = 50) {
    if (!text || maxChunkTokens <= 0) {
        return [];
    }
    
    // Check if the text appears to be JSON data
    const isJsonData = text.includes('Data (JSON Format):') || 
                      (text.trim().startsWith('[') && text.trim().endsWith(']')) ||
                      (text.trim().startsWith('{') && text.trim().endsWith('}'));
    
    if (isJsonData) {
        // Use JSON-aware chunking to preserve object integrity
        return createJsonAwareChunks(text, maxChunkTokens, overlapTokens);
    }
    
    // Original line-based chunking for non-JSON data
    const chunks = [];
    const lines = text.split('\n');
    let currentChunk = '';
    let currentTokens = 0;
    let overlap = '';
    
    for (const line of lines) {
        const lineTokens = countTokens(line);
        
        // If single line exceeds max, split it
        if (lineTokens > maxChunkTokens) {
            // Save current chunk if it has content
            if (currentChunk) {
                chunks.push({
                    text: currentChunk,
                    tokens: currentTokens,
                    index: chunks.length
                });
                
                // Keep last part for overlap
                const overlapLines = currentChunk.split('\n').slice(-3).join('\n');
                overlap = overlapLines.substring(0, overlapTokens * 4); // Approximate
                currentChunk = overlap;
                currentTokens = countTokens(overlap);
            }
            
            // Split long line by sentences or words
            const sentences = line.match(/[^.!?]+[.!?]+/g) || [line];
            for (const sentence of sentences) {
                const sentenceTokens = countTokens(sentence);
                
                if (currentTokens + sentenceTokens <= maxChunkTokens) {
                    currentChunk += (currentChunk ? '\n' : '') + sentence;
                    currentTokens += sentenceTokens;
                } else {
                    // Save current chunk
                    chunks.push({
                        text: currentChunk,
                        tokens: currentTokens,
                        index: chunks.length
                    });
                    
                    currentChunk = overlap + '\n' + sentence;
                    currentTokens = countTokens(currentChunk);
                }
            }
        } else {
            // Check if adding line exceeds limit
            if (currentTokens + lineTokens <= maxChunkTokens) {
                currentChunk += (currentChunk ? '\n' : '') + line;
                currentTokens += lineTokens;
            } else {
                // Save current chunk
                chunks.push({
                    text: currentChunk,
                    tokens: currentTokens,
                    index: chunks.length
                });
                
                // Start new chunk with overlap
                const overlapLines = currentChunk.split('\n').slice(-3).join('\n');
                overlap = overlapLines.substring(0, overlapTokens * 4);
                currentChunk = overlap + '\n' + line;
                currentTokens = countTokens(currentChunk);
            }
        }
    }
    
    // Add final chunk
    if (currentChunk && currentChunk !== overlap) {
        chunks.push({
            text: currentChunk,
            tokens: currentTokens,
            index: chunks.length
        });
    }
    
    return chunks;
}

/**
 * JSON-aware chunking that preserves complete JSON objects
 * @param {string} text - The text containing JSON data
 * @param {number} maxChunkTokens - Maximum tokens per chunk
 * @param {number} overlapTokens - Number of objects to overlap between chunks
 * @returns {Array} Array of text chunks with complete JSON objects
 */
function createJsonAwareChunks(text, maxChunkTokens, overlapTokens = 2) {
    const chunks = [];
    
    // Extract metadata and JSON data
    let metadata = '';
    let jsonData = '';
    
    if (text.includes('Data (JSON Format):')) {
        const parts = text.split('Data (JSON Format):');
        metadata = parts[0].trim();
        jsonData = parts[1] ? parts[1].trim() : '';
    } else {
        jsonData = text.trim();
    }
    
    // Try to parse JSON array
    let jsonArray = [];
    try {
        // Handle both array and single object
        if (jsonData.startsWith('[')) {
            jsonArray = JSON.parse(jsonData);
        } else if (jsonData.startsWith('{')) {
            jsonArray = [JSON.parse(jsonData)];
        } else {
            // Not valid JSON, fall back to line-based chunking
            console.warn('Invalid JSON format, using line-based chunking');
            return createChunks(text, maxChunkTokens, 50);
        }
    } catch (error) {
        console.warn('Failed to parse JSON, using line-based chunking:', error.message);
        return createChunks(text, maxChunkTokens, 50);
    }
    
    // Calculate metadata tokens (included in each chunk)
    const metadataTokens = countTokens(metadata);
    const effectiveMaxTokens = maxChunkTokens - metadataTokens - 100; // Reserve space for JSON structure
    
    if (effectiveMaxTokens <= 0) {
        console.error('Metadata exceeds chunk size limit');
        return [{
            text: text,
            tokens: countTokens(text),
            index: 0
        }];
    }
    
    // Chunk the JSON array by complete objects
    let currentObjects = [];
    let currentTokens = 0;
    let overlapObjects = [];
    
    for (let i = 0; i < jsonArray.length; i++) {
        const obj = jsonArray[i];
        const objText = JSON.stringify(obj, null, 2);
        const objTokens = countTokens(objText);
        
        // If single object exceeds max tokens, it must go in its own chunk
        if (objTokens > effectiveMaxTokens) {
            // Save current chunk if it has objects
            if (currentObjects.length > 0) {
                const chunkText = formatJsonChunk(metadata, currentObjects);
                chunks.push({
                    text: chunkText,
                    tokens: countTokens(chunkText),
                    index: chunks.length,
                    objectCount: currentObjects.length,
                    startIndex: i - currentObjects.length,
                    endIndex: i - 1
                });
                
                // Keep last few objects for context overlap
                overlapObjects = currentObjects.slice(-Math.min(overlapTokens, currentObjects.length));
                currentObjects = [...overlapObjects];
                currentTokens = countTokens(JSON.stringify(currentObjects, null, 2));
            }
            
            // Add the large object as its own chunk
            const singleChunkText = formatJsonChunk(metadata, [obj]);
            chunks.push({
                text: singleChunkText,
                tokens: countTokens(singleChunkText),
                index: chunks.length,
                objectCount: 1,
                startIndex: i,
                endIndex: i,
                warning: 'Single object exceeds optimal chunk size'
            });
            
            // Reset for next chunk
            currentObjects = [];
            currentTokens = 0;
            overlapObjects = [obj]; // Include this object in overlap for context
        } else {
            // Check if adding object exceeds limit
            const newTokens = currentTokens + objTokens;
            
            if (newTokens <= effectiveMaxTokens) {
                currentObjects.push(obj);
                currentTokens = newTokens;
            } else {
                // Save current chunk
                const chunkText = formatJsonChunk(metadata, currentObjects);
                chunks.push({
                    text: chunkText,
                    tokens: countTokens(chunkText),
                    index: chunks.length,
                    objectCount: currentObjects.length,
                    startIndex: i - currentObjects.length,
                    endIndex: i - 1
                });
                
                // Start new chunk with overlap
                overlapObjects = currentObjects.slice(-Math.min(overlapTokens, currentObjects.length));
                currentObjects = [...overlapObjects, obj];
                currentTokens = countTokens(JSON.stringify(currentObjects, null, 2));
            }
        }
    }
    
    // Add final chunk
    if (currentObjects.length > overlapObjects.length) {
        const chunkText = formatJsonChunk(metadata, currentObjects);
        chunks.push({
            text: chunkText,
            tokens: countTokens(chunkText),
            index: chunks.length,
            objectCount: currentObjects.length,
            startIndex: jsonArray.length - currentObjects.length,
            endIndex: jsonArray.length - 1
        });
    }
    
    return chunks;
}

/**
 * Format a chunk with metadata and JSON objects
 * @param {string} metadata - The metadata header
 * @param {Array} objects - Array of JSON objects
 * @returns {string} Formatted chunk text
 */
function formatJsonChunk(metadata, objects) {
    if (!objects || objects.length === 0) {
        return metadata;
    }
    
    let formatted = metadata;
    if (metadata && !metadata.endsWith('\n')) {
        formatted += '\n';
    }
    formatted += 'Data (JSON Format):\n';
    formatted += JSON.stringify(objects, null, 2);
    
    return formatted;
}

/**
 * Calculate TPM-aware batch sizing
 * @param {number} tpmLimit - Tokens per minute limit
 * @param {number} tokensPerRequest - Average tokens per request
 * @param {number} processingTimeMs - Estimated processing time per request
 * @returns {Object} Batching strategy
 */
function calculateBatchStrategy(tpmLimit, tokensPerRequest, processingTimeMs = 2000) {
    const minuteMs = 60000;
    const requestsPerMinute = Math.floor(minuteMs / processingTimeMs);
    const maxRequestsByTPM = Math.floor(tpmLimit / tokensPerRequest);
    const optimalBatchSize = Math.min(requestsPerMinute, maxRequestsByTPM);
    const concurrentBatches = Math.max(1, Math.floor(optimalBatchSize / 5)); // Max 5 concurrent
    
    return {
        tpmLimit: tpmLimit,
        tokensPerRequest: tokensPerRequest,
        maxRequestsPerMinute: maxRequestsByTPM,
        optimalBatchSize: optimalBatchSize,
        concurrentBatches: concurrentBatches,
        delayBetweenBatches: Math.ceil(minuteMs / optimalBatchSize),
        estimatedThroughput: optimalBatchSize * tokensPerRequest
    };
}

/**
 * Estimate token costs for analysis
 * @param {number} inputTokens - Total input tokens
 * @param {number} outputTokens - Total output tokens
 * @param {string} modelName - Model name for pricing
 * @returns {Object} Cost estimate
 */
function estimateCosts(inputTokens, outputTokens, modelName) {
    // Pricing per 1K tokens (approximate)
    const pricing = {
        'gpt-4-turbo': { input: 0.01, output: 0.03 },
        'gpt-4o': { input: 0.005, output: 0.015 },
        'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
        'gpt-5': { input: 0.02, output: 0.06 },
        'gpt-5-mini': { input: 0.001, output: 0.004 },
        'o1-preview': { input: 0.015, output: 0.06 },
        'o1-mini': { input: 0.003, output: 0.012 },
        'gpt-35-turbo': { input: 0.0005, output: 0.0015 }
    };
    
    const modelKey = Object.keys(pricing).find(key => 
        modelName.toLowerCase().includes(key.replace('-', ''))
    );
    
    const modelPricing = pricing[modelKey] || { input: 0.002, output: 0.006 };
    
    const inputCost = (inputTokens / 1000) * modelPricing.input;
    const outputCost = (outputTokens / 1000) * modelPricing.output;
    const totalCost = inputCost + outputCost;
    
    return {
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        inputCost: inputCost.toFixed(4),
        outputCost: outputCost.toFixed(4),
        totalCost: totalCost.toFixed(4),
        costPer1K: ((totalCost * 1000) / (inputTokens + outputTokens)).toFixed(4),
        modelPricing: modelPricing
    };
}

/**
 * Enhanced semantic chunking with automatic content type detection
 * Uses Microsoft's best practices for RAG applications
 * @param {string} text - The text to chunk
 * @param {number} maxChunkTokens - Maximum tokens per chunk
 * @param {Object} options - Chunking options
 * @returns {Array} Array of chunks with metadata and quality metrics
 */
function createSemanticChunks(text, maxChunkTokens, options = {}) {
    // Simplified version - just use regular chunking
    const overlapTokens = Math.floor(maxChunkTokens * (options.overlapPercentage || 0.1));
    const chunks = createChunks(text, maxChunkTokens, overlapTokens);
    
    // Add simple statistics
    const stats = {
        totalChunks: chunks.length,
        totalTokens: chunks.reduce((sum, c) => sum + c.tokens, 0),
        avgTokensPerChunk: chunks.length > 0 ? Math.round(chunks.reduce((sum, c) => sum + c.tokens, 0) / chunks.length) : 0,
        avgQuality: 1.0, // Simplified - always return good quality
        contentType: 'text',
        strategy: 'traditional'
    };
    
    console.log('Chunking completed:', stats);
    
    return {
        chunks,
        stats,
        metadata: {
            chunker: 'traditional',
            version: '1.0',
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Analyze text and recommend optimal chunking strategy
 * @param {string} text - The text to analyze
 * @param {string} modelName - The model to use
 * @returns {Object} Recommended chunking parameters
 */
function analyzeAndRecommendChunking(text, modelName) {
    const analysis = {
        textLength: text.length,
        estimatedTokens: countTokens(text),
        contentType: detectContentType(text),
        structureComplexity: analyzeStructure(text),
        recommendations: {}
    };
    
    // Get model configuration
    const modelKey = Object.keys(MODEL_CONFIGS).find(key => 
        modelName.toLowerCase().includes(key.toLowerCase())
    );
    const modelConfig = MODEL_CONFIGS[modelKey] || { contextWindow: 128000, outputReserved: 4096 };
    
    // Base recommendations
    const baseChunkSize = Math.min(1000, modelConfig.contextWindow * 0.1);
    
    // Adjust based on content type
    switch (analysis.contentType) {
        case 'json':
            analysis.recommendations = {
                strategy: 'json-aware',
                chunkSize: baseChunkSize,
                overlap: 0.05, // Less overlap for structured data
                preserveObjects: true
            };
            break;
        case 'logs':
            analysis.recommendations = {
                strategy: 'time-window',
                chunkSize: baseChunkSize * 0.8,
                overlap: 0.1,
                groupByTime: true
            };
            break;
        case 'kql':
            analysis.recommendations = {
                strategy: 'query-preserve',
                chunkSize: baseChunkSize * 2, // Larger chunks for queries
                overlap: 0,
                preserveQueries: true
            };
            break;
        case 'markdown':
        case 'code':
            analysis.recommendations = {
                strategy: 'structure-aware',
                chunkSize: baseChunkSize,
                overlap: 0.15, // More overlap for complex structure
                preserveStructure: true
            };
            break;
        default:
            analysis.recommendations = {
                strategy: 'sentence-boundary',
                chunkSize: baseChunkSize,
                overlap: 0.1,
                preserveSentences: true
            };
    }
    
    // Adjust for text complexity
    if (analysis.structureComplexity.score > 0.7) {
        analysis.recommendations.chunkSize *= 0.8; // Smaller chunks for complex content
        analysis.recommendations.overlap *= 1.5; // More overlap for complex content
    }
    
    return analysis;
}

/**
 * Detect content type from text
 */
function detectContentType(text) {
    if (!text) return 'text';
    
    // Check for JSON
    try {
        JSON.parse(text);
        return 'json';
    } catch {}
    
    // Check for common patterns
    if (/^(search|where|project|summarize|extend|join|union|let)\s+/im.test(text)) return 'kql';
    if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/m.test(text)) return 'logs';
    if (/^#{1,6}\s+.+$/m.test(text)) return 'markdown';
    if (/^```[\s\S]*?```$/m.test(text)) return 'code';
    
    return 'text';
}

/**
 * Analyze text structure complexity
 */
function analyzeStructure(text) {
    const analysis = {
        hasHeaders: /^#{1,6}\s+.+$/m.test(text),
        hasList: /^[\s]*[-*+•]\s+.+$/m.test(text),
        hasCode: /^```[\s\S]*?```$/m.test(text),
        hasTable: /^\|.*\|$/m.test(text),
        hasNesting: /{[\s\S]*{[\s\S]*}[\s\S]*}/m.test(text),
        paragraphCount: (text.match(/\n\n/g) || []).length + 1,
        sentenceCount: (text.match(/[.!?]+[\s\u200B\u3000]*/g) || []).length,
        score: 0
    };
    
    // Calculate complexity score
    let score = 0;
    if (analysis.hasHeaders) score += 0.2;
    if (analysis.hasList) score += 0.15;
    if (analysis.hasCode) score += 0.25;
    if (analysis.hasTable) score += 0.2;
    if (analysis.hasNesting) score += 0.2;
    
    analysis.score = Math.min(1.0, score);
    
    return analysis;
}

/**
 * Aggregation strategies for combining chunk responses
 */
// Simplified aggregation strategies
const AggregationStrategies = {
    concatenate: (responses) => {
        return responses
            .filter(r => r.success && r.response)
            .map(r => r.response)
            .join('\n\n');
    },
    
    // Simplified smartMerge - just concatenate for now
    smartMerge: (responses) => {
        return responses
            .filter(r => r.success && r.response)
            .map(r => r.response)
            .join('\n\n');
    },
    
    // Simplified hierarchical - just use concatenate
    hierarchical: (responses) => {
        return responses
            .filter(r => r.success && r.response)
            .map(r => r.response)
            .join('\n\n');
    }
};

/**
 * Apply aggregation strategy to chunk responses
 */
function aggregateChunkResponses(responses, strategy = 'smartMerge') {
    if (!AggregationStrategies[strategy]) {
        console.warn(`Unknown aggregation strategy: ${strategy}, falling back to concatenate`);
        strategy = 'concatenate';
    }
    
    return AggregationStrategies[strategy](responses);
}

module.exports = {
    countTokens,
    calculateOptimalChunkSize,
    createChunks,
    createJsonAwareChunks,
    createSemanticChunks,
    analyzeAndRecommendChunking,
    formatJsonChunk,
    calculateBatchStrategy,
    estimateCosts,
    detectContentType,
    analyzeStructure,
    aggregateChunkResponses,
    AggregationStrategies,
    MODEL_CONFIGS
};