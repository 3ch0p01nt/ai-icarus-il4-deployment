/**
 * Azure OpenAI Rate Limiting Module
 * Implements intelligent rate limiting based on Microsoft best practices
 * Handles x-ratelimit headers, token bucket algorithm, and request pacing
 */

/**
 * Rate limit information extracted from Azure OpenAI response headers
 */
class RateLimitInfo {
    constructor(headers) {
        // Extract rate limit headers
        this.remainingTokens = parseInt(headers['x-ratelimit-remaining-tokens']) || null;
        this.remainingRequests = parseInt(headers['x-ratelimit-remaining-requests']) || null;
        this.resetTokens = headers['x-ratelimit-reset-tokens'] || null;
        this.resetRequests = headers['x-ratelimit-reset-requests'] || null;
        
        // Calculate reset times
        this.tokenResetTime = this.parseResetTime(this.resetTokens);
        this.requestResetTime = this.parseResetTime(this.resetRequests);
        
        // Retry-after header (in case of 429 responses)
        this.retryAfter = parseInt(headers['retry-after']) || null;
    }
    
    parseResetTime(resetString) {
        if (!resetString) return null;
        
        // Azure returns reset times in various formats
        // Could be seconds, ISO string, or Unix timestamp
        if (/^\d+$/.test(resetString)) {
            const value = parseInt(resetString);
            // If value is small, it's seconds until reset
            if (value < 1000000) {
                return Date.now() + (value * 1000);
            }
            // Otherwise it's a Unix timestamp
            return value * 1000;
        }
        
        // Try parsing as date string
        return Date.parse(resetString);
    }
    
    shouldThrottle() {
        // Throttle if we're below 20% of tokens or 10% of requests
        const tokenThreshold = this.remainingTokens !== null && this.remainingTokens < 10000;
        const requestThreshold = this.remainingRequests !== null && this.remainingRequests < 10;
        return tokenThreshold || requestThreshold;
    }
    
    getWaitTime() {
        if (this.retryAfter) {
            return this.retryAfter * 1000; // Convert to milliseconds
        }
        
        const now = Date.now();
        const tokenWait = this.tokenResetTime ? Math.max(0, this.tokenResetTime - now) : 0;
        const requestWait = this.requestResetTime ? Math.max(0, this.requestResetTime - now) : 0;
        
        return Math.max(tokenWait, requestWait);
    }
}

/**
 * Token bucket algorithm for request pacing
 * Prevents sudden bursts of requests that could trigger rate limits
 */
class TokenBucket {
    constructor(capacity, refillRate, refillInterval = 1000) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRate = refillRate;
        this.refillInterval = refillInterval;
        this.lastRefill = Date.now();
        
        // Start refill timer
        this.refillTimer = setInterval(() => this.refill(), refillInterval);
    }
    
    refill() {
        const now = Date.now();
        const timePassed = now - this.lastRefill;
        const tokensToAdd = (timePassed / this.refillInterval) * this.refillRate;
        
        this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    
    async consume(tokens = 1) {
        this.refill();
        
        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return true;
        }
        
        // Calculate wait time for tokens to be available
        const tokensNeeded = tokens - this.tokens;
        const waitTime = (tokensNeeded / this.refillRate) * this.refillInterval;
        
        // Wait and try again
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.consume(tokens);
    }
    
    destroy() {
        if (this.refillTimer) {
            clearInterval(this.refillTimer);
            this.refillTimer = null;
        }
    }
}

/**
 * Priority queue for managing requests with different priorities
 */
class PriorityQueue {
    constructor() {
        this.queues = {
            high: [],
            normal: [],
            low: []
        };
    }
    
    enqueue(item, priority = 'normal') {
        this.queues[priority].push(item);
    }
    
    dequeue() {
        // Process high priority first, then normal, then low
        for (const priority of ['high', 'normal', 'low']) {
            if (this.queues[priority].length > 0) {
                return this.queues[priority].shift();
            }
        }
        return null;
    }
    
    isEmpty() {
        return Object.values(this.queues).every(q => q.length === 0);
    }
    
    size() {
        return Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    }
}

/**
 * Rate limiter for Azure OpenAI API calls
 * Implements Microsoft's recommended patterns for handling rate limits
 */
class AzureOpenAIRateLimiter {
    constructor(options = {}) {
        // Configuration
        this.maxRequestsPerMinute = options.maxRequestsPerMinute || 60;
        this.maxTokensPerMinute = options.maxTokensPerMinute || 90000;
        this.maxConcurrent = options.maxConcurrent || 3;
        this.enablePriorityQueue = options.enablePriorityQueue !== false;
        
        // Token buckets for request pacing
        this.requestBucket = new TokenBucket(
            this.maxRequestsPerMinute,
            this.maxRequestsPerMinute / 60,
            1000
        );
        
        // Priority queue for requests
        this.queue = new PriorityQueue();
        
        // Track concurrent requests
        this.currentConcurrent = 0;
        
        // Rate limit info from last response
        this.lastRateLimitInfo = null;
        
        // Statistics
        this.stats = {
            totalRequests: 0,
            throttledRequests: 0,
            failedRequests: 0,
            totalWaitTime: 0
        };
    }
    
    /**
     * Execute a request with rate limiting
     */
    async executeRequest(requestFn, options = {}) {
        const priority = options.priority || 'normal';
        const estimatedTokens = options.estimatedTokens || 1000;
        
        // Wait for available slot
        await this.waitForSlot();
        
        // Consume from token bucket
        await this.requestBucket.consume(1);
        
        // Check if we should add additional delay based on last rate limit info
        if (this.lastRateLimitInfo && this.lastRateLimitInfo.shouldThrottle()) {
            const waitTime = Math.min(this.lastRateLimitInfo.getWaitTime(), 5000);
            if (waitTime > 0) {
                console.log(`Rate limit approaching, waiting ${waitTime}ms`);
                this.stats.throttledRequests++;
                this.stats.totalWaitTime += waitTime;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        // Execute request
        this.currentConcurrent++;
        this.stats.totalRequests++;
        
        try {
            const response = await requestFn();
            
            // Update rate limit info from response headers
            if (response.headers) {
                this.lastRateLimitInfo = new RateLimitInfo(response.headers);
            }
            
            return response;
        } catch (error) {
            this.stats.failedRequests++;
            
            // Handle rate limit errors (429)
            if (error.status === 429 || error.message?.includes('429')) {
                const retryAfter = this.extractRetryAfter(error);
                const waitTime = retryAfter || this.calculateBackoffTime();
                
                console.log(`Rate limit hit (429), waiting ${waitTime}ms before retry`);
                this.stats.throttledRequests++;
                this.stats.totalWaitTime += waitTime;
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Retry the request
                return this.executeRequest(requestFn, options);
            }
            
            throw error;
        } finally {
            this.currentConcurrent--;
        }
    }
    
    async waitForSlot() {
        while (this.currentConcurrent >= this.maxConcurrent) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    extractRetryAfter(error) {
        // Try to extract retry-after from error
        if (error.headers && error.headers['retry-after']) {
            return parseInt(error.headers['retry-after']) * 1000;
        }
        
        // Try to parse from error message
        const match = error.message?.match(/retry after (\d+)/i);
        if (match) {
            return parseInt(match[1]) * 1000;
        }
        
        return null;
    }
    
    calculateBackoffTime() {
        // Exponential backoff with jitter
        const baseDelay = 2000;
        const maxDelay = 32000;
        const attempt = Math.min(this.stats.throttledRequests, 5);
        
        const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        const jitter = Math.random() * 1000; // Add 0-1 second jitter
        
        return exponentialDelay + jitter;
    }
    
    /**
     * Process queued requests with rate limiting
     */
    async processQueue() {
        while (!this.queue.isEmpty()) {
            const request = this.queue.dequeue();
            if (request) {
                await this.executeRequest(request.fn, request.options);
            }
        }
    }
    
    /**
     * Add request to queue
     */
    queueRequest(requestFn, options = {}) {
        return new Promise((resolve, reject) => {
            this.queue.enqueue({
                fn: async () => {
                    try {
                        const result = await requestFn();
                        resolve(result);
                        return result;
                    } catch (error) {
                        reject(error);
                        throw error;
                    }
                },
                options
            }, options.priority || 'normal');
            
            // Start processing if not already running
            this.processQueue().catch(console.error);
        });
    }
    
    getStats() {
        return {
            ...this.stats,
            currentConcurrent: this.currentConcurrent,
            queueSize: this.queue.size(),
            averageWaitTime: this.stats.throttledRequests > 0 
                ? this.stats.totalWaitTime / this.stats.throttledRequests 
                : 0
        };
    }
    
    destroy() {
        this.requestBucket.destroy();
    }
}

/**
 * Request coalescing to combine similar requests
 */
class RequestCoalescer {
    constructor(windowMs = 100) {
        this.windowMs = windowMs;
        this.pending = new Map();
    }
    
    async coalesce(key, requestFn) {
        // Check if there's already a pending request with the same key
        if (this.pending.has(key)) {
            return this.pending.get(key);
        }
        
        // Create new promise for this request
        const promise = requestFn();
        this.pending.set(key, promise);
        
        // Remove from pending after completion
        promise.finally(() => {
            setTimeout(() => this.pending.delete(key), this.windowMs);
        });
        
        return promise;
    }
}

module.exports = {
    RateLimitInfo,
    TokenBucket,
    PriorityQueue,
    AzureOpenAIRateLimiter,
    RequestCoalescer
};