/**
 * Azure OpenAI Error Handling Module
 * Implements comprehensive error handling for Azure OpenAI API
 * Based on Microsoft's error handling best practices
 */

/**
 * Azure OpenAI specific error codes and their handling strategies
 */
const ERROR_CODES = {
    // Authentication errors
    '401': {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed. Please check your credentials.',
        retryable: false,
        action: 'CHECK_AUTH'
    },
    '403': {
        code: 'FORBIDDEN',
        message: 'Access denied. Check your permissions for this resource.',
        retryable: false,
        action: 'CHECK_PERMISSIONS'
    },
    
    // Rate limiting errors
    '429': {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please retry after the specified time.',
        retryable: true,
        action: 'RETRY_WITH_BACKOFF'
    },
    
    // Client errors
    '400': {
        code: 'BAD_REQUEST',
        message: 'Invalid request. Please check your request parameters.',
        retryable: false,
        action: 'FIX_REQUEST'
    },
    '404': {
        code: 'NOT_FOUND',
        message: 'Resource not found. Check deployment name and endpoint.',
        retryable: false,
        action: 'CHECK_RESOURCE'
    },
    '422': {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Request validation failed. Check model capabilities.',
        retryable: false,
        action: 'VALIDATE_REQUEST'
    },
    
    // Server errors
    '500': {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Azure OpenAI service error. Please retry.',
        retryable: true,
        action: 'RETRY_WITH_BACKOFF'
    },
    '502': {
        code: 'BAD_GATEWAY',
        message: 'Gateway error. Service temporarily unavailable.',
        retryable: true,
        action: 'RETRY_WITH_BACKOFF'
    },
    '503': {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please retry.',
        retryable: true,
        action: 'RETRY_WITH_BACKOFF'
    },
    '504': {
        code: 'GATEWAY_TIMEOUT',
        message: 'Request timeout. Consider reducing payload size.',
        retryable: true,
        action: 'RETRY_WITH_SMALLER_PAYLOAD'
    }
};

/**
 * Specific Azure OpenAI error types
 */
const AZURE_OPENAI_ERRORS = {
    'content_filter': {
        message: 'Content was filtered due to policy violations.',
        userMessage: 'Your request was blocked by content filters. Please modify your input.',
        action: 'MODIFY_CONTENT'
    },
    'context_length_exceeded': {
        message: 'Request exceeds maximum context length.',
        userMessage: 'Your request is too long. Please reduce the input size.',
        action: 'REDUCE_TOKENS'
    },
    'deployment_not_found': {
        message: 'Deployment not found.',
        userMessage: 'The AI model deployment was not found. Please check configuration.',
        action: 'CHECK_DEPLOYMENT'
    },
    'invalid_api_version': {
        message: 'Invalid API version specified.',
        userMessage: 'Invalid API version. Please update to a supported version.',
        action: 'UPDATE_API_VERSION'
    },
    'model_not_supported': {
        message: 'Model not supported for this operation.',
        userMessage: 'This operation is not supported by the selected model.',
        action: 'CHANGE_MODEL'
    },
    'quota_exceeded': {
        message: 'Quota exceeded for this resource.',
        userMessage: 'Usage quota exceeded. Please wait or upgrade your plan.',
        action: 'WAIT_OR_UPGRADE'
    },
    'token_limit_exceeded': {
        message: 'Token limit exceeded for model.',
        userMessage: 'Request exceeds token limits. Please reduce input or output size.',
        action: 'REDUCE_TOKENS'
    }
};

/**
 * Enhanced error class for Azure OpenAI errors
 */
class AzureOpenAIError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'AzureOpenAIError';
        this.code = code;
        this.statusCode = details.statusCode;
        this.retryable = details.retryable || false;
        this.retryAfter = details.retryAfter;
        this.action = details.action;
        this.userMessage = details.userMessage || message;
        this.timestamp = new Date().toISOString();
        this.requestId = details.requestId;
        this.details = details;
    }
    
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            retryable: this.retryable,
            retryAfter: this.retryAfter,
            action: this.action,
            userMessage: this.userMessage,
            timestamp: this.timestamp,
            requestId: this.requestId,
            details: this.details
        };
    }
}

/**
 * Parse Azure OpenAI error response
 */
function parseAzureOpenAIError(error, response) {
    // Extract error details from response
    let errorDetails = {};
    
    try {
        if (typeof response === 'string') {
            errorDetails = JSON.parse(response);
        } else if (response && typeof response === 'object') {
            errorDetails = response;
        }
    } catch (e) {
        // If parsing fails, use raw response
        errorDetails = { message: response };
    }
    
    // Extract error code and message
    const errorCode = errorDetails.error?.code || errorDetails.code;
    const errorMessage = errorDetails.error?.message || errorDetails.message || error.message;
    const innerError = errorDetails.error?.innererror;
    
    // Check for specific Azure OpenAI errors
    const specificError = AZURE_OPENAI_ERRORS[errorCode];
    if (specificError) {
        return new AzureOpenAIError(
            specificError.message,
            errorCode,
            {
                statusCode: error.statusCode || error.status,
                userMessage: specificError.userMessage,
                action: specificError.action,
                retryable: false,
                details: errorDetails
            }
        );
    }
    
    // Check for HTTP status code errors
    const statusCode = error.statusCode || error.status;
    const statusError = ERROR_CODES[statusCode];
    if (statusError) {
        return new AzureOpenAIError(
            errorMessage || statusError.message,
            statusError.code,
            {
                statusCode: statusCode,
                userMessage: statusError.message,
                action: statusError.action,
                retryable: statusError.retryable,
                retryAfter: error.headers?.['retry-after'],
                requestId: error.headers?.['x-ms-request-id'],
                details: errorDetails
            }
        );
    }
    
    // Default error
    return new AzureOpenAIError(
        errorMessage || 'An unexpected error occurred',
        'UNKNOWN_ERROR',
        {
            statusCode: statusCode,
            retryable: statusCode >= 500,
            details: errorDetails
        }
    );
}

/**
 * Retry strategy with exponential backoff and jitter
 */
class RetryStrategy {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.baseDelay = options.baseDelay || 2000;
        this.maxDelay = options.maxDelay || 32000;
        this.jitterRange = options.jitterRange || 1000;
        this.retryableErrors = options.retryableErrors || [429, 500, 502, 503, 504];
    }
    
    shouldRetry(error, attempt) {
        if (attempt >= this.maxRetries) {
            return false;
        }
        
        // Check if error is retryable
        if (error instanceof AzureOpenAIError) {
            return error.retryable;
        }
        
        // Check status code
        const statusCode = error.statusCode || error.status;
        return this.retryableErrors.includes(statusCode);
    }
    
    getDelay(attempt, error) {
        // Use retry-after header if available
        if (error.retryAfter) {
            return parseInt(error.retryAfter) * 1000;
        }
        
        // Calculate exponential backoff with jitter
        const exponentialDelay = Math.min(
            this.baseDelay * Math.pow(2, attempt),
            this.maxDelay
        );
        
        const jitter = Math.random() * this.jitterRange;
        
        return exponentialDelay + jitter;
    }
    
    async execute(fn, context = {}) {
        let lastError;
        
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                // Add delay before retry (skip on first attempt)
                if (attempt > 0) {
                    const delay = this.getDelay(attempt, lastError);
                    console.log(`Retry attempt ${attempt + 1}/${this.maxRetries}, waiting ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                
                // Execute function
                return await fn();
                
            } catch (error) {
                lastError = error;
                
                // Parse error if needed
                if (!(error instanceof AzureOpenAIError)) {
                    lastError = parseAzureOpenAIError(error, error.response || error.message);
                }
                
                // Check if we should retry
                if (!this.shouldRetry(lastError, attempt + 1)) {
                    throw lastError;
                }
                
                console.log(`Request failed (attempt ${attempt + 1}/${this.maxRetries}):`, lastError.message);
            }
        }
        
        // All retries exhausted
        throw lastError;
    }
}

/**
 * Circuit breaker pattern for handling persistent failures
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minute
        this.halfOpenRequests = options.halfOpenRequests || 1;
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
    }
    
    async execute(fn) {
        // Check circuit state
        if (this.state === 'OPEN') {
            // Check if we should try half-open
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
            } else {
                throw new AzureOpenAIError(
                    'Circuit breaker is open due to repeated failures',
                    'CIRCUIT_BREAKER_OPEN',
                    {
                        retryable: true,
                        retryAfter: Math.ceil((this.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000)
                    }
                );
            }
        }
        
        try {
            const result = await fn();
            
            // Success - update state
            if (this.state === 'HALF_OPEN') {
                this.successCount++;
                if (this.successCount >= this.halfOpenRequests) {
                    this.state = 'CLOSED';
                    this.failures = 0;
                    console.log('Circuit breaker closed after successful recovery');
                }
            } else if (this.state === 'CLOSED') {
                this.failures = 0; // Reset failures on success
            }
            
            return result;
            
        } catch (error) {
            // Failure - update state
            this.failures++;
            this.lastFailureTime = Date.now();
            
            if (this.state === 'HALF_OPEN') {
                this.state = 'OPEN';
                console.log('Circuit breaker opened again after failure in half-open state');
            } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
                this.state = 'OPEN';
                console.log(`Circuit breaker opened after ${this.failures} failures`);
            }
            
            throw error;
        }
    }
    
    getState() {
        return {
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
            timeUntilReset: this.state === 'OPEN' 
                ? Math.max(0, this.resetTimeout - (Date.now() - this.lastFailureTime))
                : 0
        };
    }
    
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
    }
}

/**
 * Graceful degradation strategies
 */
const DEGRADATION_STRATEGIES = {
    USE_FALLBACK_MODEL: async (error, context) => {
        if (context.fallbackModel) {
            console.log(`Falling back to ${context.fallbackModel} due to error`);
            context.deploymentName = context.fallbackModel;
            return true; // Retry with fallback
        }
        return false;
    },
    
    REDUCE_TOKENS: async (error, context) => {
        if (error.code === 'context_length_exceeded' || error.code === 'token_limit_exceeded') {
            const currentTokens = context.estimatedTokens || context.maxTokens;
            context.maxTokens = Math.floor(currentTokens * 0.75);
            console.log(`Reducing tokens from ${currentTokens} to ${context.maxTokens}`);
            return true; // Retry with reduced tokens
        }
        return false;
    },
    
    DISABLE_STREAMING: async (error, context) => {
        if (context.stream) {
            console.log('Disabling streaming due to error');
            context.stream = false;
            return true; // Retry without streaming
        }
        return false;
    },
    
    USE_CACHED_RESPONSE: async (error, context) => {
        if (context.cache && context.cacheKey) {
            const cached = await context.cache.get(context.cacheKey);
            if (cached) {
                console.log('Using cached response due to error');
                return cached; // Return cached response
            }
        }
        return false;
    }
};

module.exports = {
    AzureOpenAIError,
    parseAzureOpenAIError,
    RetryStrategy,
    CircuitBreaker,
    DEGRADATION_STRATEGIES,
    ERROR_CODES,
    AZURE_OPENAI_ERRORS
};