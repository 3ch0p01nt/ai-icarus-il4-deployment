/**
 * Intelligent Model Selection Module
 * Implements Microsoft's best practices for selecting optimal Azure OpenAI models
 * Based on task requirements, token limits, and performance considerations
 */

const { countTokens } = require('./tokenUtils');

/**
 * Model capabilities and performance characteristics
 * Based on Microsoft's official Azure OpenAI documentation
 */
const MODEL_PROFILES = {
    'gpt-5-nano': {
        contextWindow: 272000,
        maxOutputTokens: 32000,
        performance: 'ultra-fast',
        costTier: 'low',
        strengths: ['speed', 'efficiency', 'large-context'],
        weaknesses: ['complex-reasoning'],
        bestFor: ['summarization', 'translation', 'simple-analysis'],
        tpmLimit: 400000,
        rpmLimit: 100,
        latencyMs: 500
    },
    'gpt-5-mini': {
        contextWindow: 400000,
        maxOutputTokens: 32000,
        performance: 'very-fast',
        costTier: 'low',
        strengths: ['speed', 'large-context', 'cost-effective'],
        weaknesses: ['advanced-reasoning'],
        bestFor: ['bulk-processing', 'data-extraction', 'classification'],
        tpmLimit: 400000,
        rpmLimit: 100,
        latencyMs: 800
    },
    'gpt-5': {
        contextWindow: 400000,
        maxOutputTokens: 32000,
        performance: 'fast',
        costTier: 'medium',
        strengths: ['large-context', 'reasoning', 'multimodal'],
        weaknesses: ['cost'],
        bestFor: ['complex-analysis', 'code-generation', 'creative-tasks'],
        tpmLimit: 500000,
        rpmLimit: 60,
        latencyMs: 1500
    },
    'gpt-4o-mini': {
        contextWindow: 128000,
        maxOutputTokens: 16384,
        performance: 'very-fast',
        costTier: 'very-low',
        strengths: ['speed', 'cost', 'efficiency'],
        weaknesses: ['context-size', 'complex-tasks'],
        bestFor: ['quick-tasks', 'chatbots', 'simple-queries'],
        tpmLimit: 200000,
        rpmLimit: 100,
        latencyMs: 400
    },
    'gpt-4o': {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        performance: 'fast',
        costTier: 'low',
        strengths: ['balanced', 'multimodal', 'reliable'],
        weaknesses: ['output-limit'],
        bestFor: ['general-purpose', 'vision-tasks', 'moderate-complexity'],
        tpmLimit: 300000,
        rpmLimit: 60,
        latencyMs: 1000
    },
    'gpt-4-turbo': {
        contextWindow: 128000,
        maxOutputTokens: 4096,
        performance: 'moderate',
        costTier: 'medium',
        strengths: ['accuracy', 'reasoning', 'consistency'],
        weaknesses: ['speed', 'cost'],
        bestFor: ['high-accuracy', 'complex-reasoning', 'technical-content'],
        tpmLimit: 150000,
        rpmLimit: 30,
        latencyMs: 2000
    },
    'o1-preview': {
        contextWindow: 200000,
        maxOutputTokens: 100000,
        performance: 'slow',
        costTier: 'high',
        strengths: ['deep-reasoning', 'math', 'coding', 'science'],
        weaknesses: ['speed', 'cost', 'no-streaming'],
        bestFor: ['complex-problems', 'mathematical-proofs', 'algorithm-design'],
        tpmLimit: 100000,
        rpmLimit: 10,
        latencyMs: 5000,
        isReasoningModel: true
    },
    'o1-mini': {
        contextWindow: 200000,
        maxOutputTokens: 65536,
        performance: 'moderate',
        costTier: 'medium-high',
        strengths: ['reasoning', 'cost-vs-o1', 'efficiency'],
        weaknesses: ['speed', 'no-streaming'],
        bestFor: ['moderate-reasoning', 'code-review', 'logic-problems'],
        tpmLimit: 150000,
        rpmLimit: 20,
        latencyMs: 3000,
        isReasoningModel: true
    }
};

/**
 * Task type definitions for model selection
 */
const TASK_TYPES = {
    'simple-query': {
        priority: ['speed', 'cost'],
        requiredCapabilities: [],
        preferredModels: ['gpt-4o-mini', 'gpt-5-nano', 'gpt-5-mini']
    },
    'data-analysis': {
        priority: ['large-context', 'accuracy'],
        requiredCapabilities: ['reasoning'],
        preferredModels: ['gpt-5', 'gpt-5-mini', 'gpt-4o']
    },
    'code-generation': {
        priority: ['accuracy', 'reasoning'],
        requiredCapabilities: ['coding'],
        preferredModels: ['gpt-5', 'o1-preview', 'gpt-4-turbo']
    },
    'summarization': {
        priority: ['speed', 'large-context'],
        requiredCapabilities: [],
        preferredModels: ['gpt-5-nano', 'gpt-5-mini', 'gpt-4o-mini']
    },
    'complex-reasoning': {
        priority: ['reasoning', 'accuracy'],
        requiredCapabilities: ['deep-reasoning'],
        preferredModels: ['o1-preview', 'o1-mini', 'gpt-5']
    },
    'vision-analysis': {
        priority: ['multimodal'],
        requiredCapabilities: ['vision'],
        preferredModels: ['gpt-4o', 'gpt-5', 'gpt-4-turbo']
    },
    'bulk-processing': {
        priority: ['speed', 'cost', 'large-context'],
        requiredCapabilities: [],
        preferredModels: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4o-mini']
    }
};

/**
 * Model selection strategy based on Microsoft best practices
 */
class ModelSelector {
    constructor(availableModels = []) {
        this.availableModels = availableModels;
        this.modelProfiles = MODEL_PROFILES;
        this.taskTypes = TASK_TYPES;
    }
    
    /**
     * Select optimal model based on task requirements
     * Implements Microsoft's recommendation: use the fastest model that meets requirements
     */
    selectModel(options = {}) {
        const {
            taskType = 'simple-query',
            dataSize = 0,
            requiredTokens = 0,
            maxLatencyMs = 5000,
            maxCostPer1K = 0.01,
            requiresStreaming = false,
            requiresVision = false,
            complexity = 'low' // low, medium, high
        } = options;
        
        // Get task profile
        const taskProfile = this.taskTypes[taskType] || this.taskTypes['simple-query'];
        
        // Filter available models
        let candidates = this.filterAvailableModels(this.availableModels);
        
        // Apply hard constraints
        candidates = this.applyConstraints(candidates, {
            requiredTokens,
            maxLatencyMs,
            maxCostPer1K,
            requiresStreaming,
            requiresVision
        });
        
        // Score and rank models
        const scoredModels = this.scoreModels(candidates, {
            taskProfile,
            dataSize,
            complexity
        });
        
        // Sort by score (higher is better)
        scoredModels.sort((a, b) => b.score - a.score);
        
        // Return top model with fallback chain
        const selected = scoredModels[0];
        const fallbacks = scoredModels.slice(1, 4); // Top 3 alternatives
        
        return {
            primary: selected ? selected.model : 'gpt-4o-mini',
            fallbacks: fallbacks.map(f => f.model),
            reasoning: selected ? selected.reasoning : 'Default model selected',
            scores: scoredModels
        };
    }
    
    /**
     * Filter to only available models
     */
    filterAvailableModels(availableList) {
        if (!availableList || availableList.length === 0) {
            // Return all models if no filter provided
            return Object.keys(this.modelProfiles);
        }
        
        // Match available models to profiles
        return Object.keys(this.modelProfiles).filter(model => {
            return availableList.some(available => 
                available.toLowerCase().includes(model.replace('-', ''))
            );
        });
    }
    
    /**
     * Apply hard constraints to filter models
     */
    applyConstraints(models, constraints) {
        return models.filter(model => {
            const profile = this.modelProfiles[model];
            if (!profile) return false;
            
            // Check token requirements
            if (constraints.requiredTokens > 0) {
                const availableTokens = profile.contextWindow - profile.maxOutputTokens;
                if (availableTokens < constraints.requiredTokens) {
                    return false;
                }
            }
            
            // Check latency requirements
            if (constraints.maxLatencyMs > 0 && profile.latencyMs > constraints.maxLatencyMs) {
                return false;
            }
            
            // Check cost requirements
            if (constraints.maxCostPer1K > 0) {
                const costTierValues = {
                    'very-low': 0.001,
                    'low': 0.005,
                    'medium': 0.01,
                    'medium-high': 0.02,
                    'high': 0.05
                };
                if (costTierValues[profile.costTier] > constraints.maxCostPer1K) {
                    return false;
                }
            }
            
            // Check streaming requirement
            if (constraints.requiresStreaming && profile.isReasoningModel) {
                return false; // Reasoning models don't support streaming
            }
            
            // Check vision requirement
            if (constraints.requiresVision && !profile.strengths.includes('multimodal')) {
                return false;
            }
            
            return true;
        });
    }
    
    /**
     * Score models based on task requirements and Microsoft best practices
     */
    scoreModels(models, criteria) {
        const { taskProfile, dataSize, complexity } = criteria;
        
        return models.map(model => {
            const profile = this.modelProfiles[model];
            let score = 0;
            let reasoning = [];
            
            // Base score from task match
            if (taskProfile.preferredModels.includes(model)) {
                score += 50;
                reasoning.push(`Preferred for ${taskProfile.preferredModels.indexOf(model) === 0 ? 'primary' : 'secondary'} task`);
            }
            
            // Speed bonus (Microsoft: prefer faster models)
            const speedScores = {
                'ultra-fast': 30,
                'very-fast': 25,
                'fast': 20,
                'moderate': 10,
                'slow': 0
            };
            score += speedScores[profile.performance] || 0;
            if (speedScores[profile.performance] >= 20) {
                reasoning.push(`Fast performance (${profile.performance})`);
            }
            
            // Cost efficiency bonus
            const costScores = {
                'very-low': 25,
                'low': 20,
                'medium': 10,
                'medium-high': 5,
                'high': 0
            };
            score += costScores[profile.costTier] || 0;
            if (costScores[profile.costTier] >= 20) {
                reasoning.push(`Cost-effective (${profile.costTier} tier)`);
            }
            
            // Context window fit
            if (dataSize > 0) {
                const contextUtilization = dataSize / profile.contextWindow;
                if (contextUtilization < 0.5) {
                    score += 15; // Good fit
                    reasoning.push('Ample context window');
                } else if (contextUtilization < 0.8) {
                    score += 10; // Adequate fit
                } else if (contextUtilization < 1.0) {
                    score += 5; // Tight fit
                } else {
                    score -= 20; // Doesn't fit
                    reasoning.push('Insufficient context window');
                }
            }
            
            // Complexity match
            const complexityBonus = {
                'low': { 'gpt-4o-mini': 20, 'gpt-5-nano': 20, 'gpt-5-mini': 15 },
                'medium': { 'gpt-4o': 20, 'gpt-5-mini': 20, 'gpt-5': 15 },
                'high': { 'gpt-5': 20, 'o1-preview': 25, 'o1-mini': 20, 'gpt-4-turbo': 15 }
            };
            const bonus = complexityBonus[complexity]?.[model] || 0;
            score += bonus;
            if (bonus >= 15) {
                reasoning.push(`Well-suited for ${complexity} complexity`);
            }
            
            // Strength match with task priorities
            if (taskProfile.priority) {
                taskProfile.priority.forEach(priority => {
                    if (profile.strengths.includes(priority)) {
                        score += 10;
                        reasoning.push(`Strong in ${priority}`);
                    }
                });
            }
            
            // Penalty for overkill (using expensive model for simple task)
            if (complexity === 'low' && ['o1-preview', 'o1-mini', 'gpt-5'].includes(model)) {
                score -= 15;
                reasoning.push('Overkill for simple task');
            }
            
            return {
                model,
                score,
                reasoning: reasoning.join(', '),
                profile
            };
        });
    }
    
    /**
     * Get model fallback chain based on similarity
     */
    getModelFallbackChain(primaryModel) {
        const chains = {
            'gpt-5': ['gpt-5-mini', 'gpt-4o', 'gpt-4-turbo'],
            'gpt-5-mini': ['gpt-5-nano', 'gpt-4o-mini', 'gpt-4o'],
            'gpt-5-nano': ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4o'],
            'gpt-4o': ['gpt-4o-mini', 'gpt-5-mini', 'gpt-4-turbo'],
            'gpt-4o-mini': ['gpt-5-nano', 'gpt-4o', 'gpt-5-mini'],
            'gpt-4-turbo': ['gpt-4o', 'gpt-5', 'gpt-4o-mini'],
            'o1-preview': ['o1-mini', 'gpt-5', 'gpt-4-turbo'],
            'o1-mini': ['gpt-5', 'gpt-4-turbo', 'gpt-4o']
        };
        
        return chains[primaryModel] || ['gpt-4o-mini', 'gpt-4o', 'gpt-5-mini'];
    }
    
    /**
     * Detect task type from prompt
     */
    detectTaskType(prompt) {
        const promptLower = prompt.toLowerCase();
        
        // Check for specific patterns
        if (/\b(code|function|class|implement|program)\b/.test(promptLower)) {
            return 'code-generation';
        }
        if (/\b(analyze|insight|pattern|trend|data)\b/.test(promptLower)) {
            return 'data-analysis';
        }
        if (/\b(summarize|summary|brief|overview)\b/.test(promptLower)) {
            return 'summarization';
        }
        if (/\b(reason|explain|why|how|prove|logic)\b/.test(promptLower)) {
            return 'complex-reasoning';
        }
        if (/\b(image|picture|photo|visual|see|look)\b/.test(promptLower)) {
            return 'vision-analysis';
        }
        if (/\b(bulk|batch|process|many|all)\b/.test(promptLower)) {
            return 'bulk-processing';
        }
        
        return 'simple-query';
    }
    
    /**
     * Estimate task complexity from data
     */
    estimateComplexity(data, prompt) {
        const factors = {
            dataSize: countTokens(data || ''),
            promptComplexity: this.analyzePromptComplexity(prompt),
            structuralComplexity: this.analyzeDataStructure(data)
        };
        
        // Calculate weighted complexity score
        let score = 0;
        
        // Data size factor
        if (factors.dataSize > 50000) score += 0.4;
        else if (factors.dataSize > 10000) score += 0.2;
        else if (factors.dataSize > 1000) score += 0.1;
        
        // Prompt complexity factor
        score += factors.promptComplexity * 0.3;
        
        // Structural complexity factor
        score += factors.structuralComplexity * 0.3;
        
        // Map to complexity level
        if (score >= 0.7) return 'high';
        if (score >= 0.4) return 'medium';
        return 'low';
    }
    
    /**
     * Analyze prompt complexity
     */
    analyzePromptComplexity(prompt) {
        if (!prompt) return 0;
        
        let complexity = 0;
        
        // Check for multi-step instructions
        if (/\b(then|after|next|finally|step)\b/i.test(prompt)) complexity += 0.3;
        
        // Check for conditional logic
        if (/\b(if|when|unless|otherwise|except)\b/i.test(prompt)) complexity += 0.2;
        
        // Check for comparison/analysis
        if (/\b(compare|contrast|analyze|evaluate)\b/i.test(prompt)) complexity += 0.3;
        
        // Check for creation/generation
        if (/\b(create|generate|design|build)\b/i.test(prompt)) complexity += 0.2;
        
        return Math.min(1.0, complexity);
    }
    
    /**
     * Analyze data structure complexity
     */
    analyzeDataStructure(data) {
        if (!data) return 0;
        
        let complexity = 0;
        
        // Check for nested structures
        if (/{[\s\S]*{[\s\S]*}[\s\S]*}/.test(data)) complexity += 0.3;
        
        // Check for multiple data types
        if (/\d+/.test(data) && /[a-zA-Z]+/.test(data)) complexity += 0.1;
        
        // Check for special formats
        if (/\b\d{4}-\d{2}-\d{2}\b/.test(data)) complexity += 0.1; // Dates
        if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(data)) complexity += 0.1; // Emails
        if (/https?:\/\/[^\s]+/.test(data)) complexity += 0.1; // URLs
        
        // Check for large arrays/lists
        if (/\[[\s\S]{1000,}\]/.test(data)) complexity += 0.2;
        
        // Check for code patterns
        if (/function\s+\w+\s*\(|class\s+\w+|def\s+\w+/.test(data)) complexity += 0.2;
        
        return Math.min(1.0, complexity);
    }
    
    /**
     * Get model recommendation with explanation
     */
    recommend(context) {
        const taskType = context.taskType || this.detectTaskType(context.prompt || '');
        const complexity = context.complexity || this.estimateComplexity(context.data, context.prompt);
        const dataSize = context.dataSize || countTokens(context.data || '');
        
        const selection = this.selectModel({
            taskType,
            dataSize,
            requiredTokens: dataSize,
            maxLatencyMs: context.maxLatencyMs,
            maxCostPer1K: context.maxCostPer1K,
            requiresStreaming: context.requiresStreaming,
            requiresVision: context.requiresVision,
            complexity
        });
        
        return {
            ...selection,
            taskType,
            complexity,
            dataSize,
            explanation: this.generateExplanation(selection, taskType, complexity)
        };
    }
    
    /**
     * Generate human-readable explanation for model selection
     */
    generateExplanation(selection, taskType, complexity) {
        const primary = this.modelProfiles[selection.primary];
        
        let explanation = `Selected ${selection.primary} for ${taskType} task with ${complexity} complexity. `;
        explanation += `This model offers ${primary.performance} performance at ${primary.costTier} cost. `;
        
        if (selection.reasoning) {
            explanation += `Key factors: ${selection.reasoning}. `;
        }
        
        if (selection.fallbacks.length > 0) {
            explanation += `Fallback models available: ${selection.fallbacks.join(', ')}.`;
        }
        
        return explanation;
    }
}

/**
 * Singleton instance with default configuration
 */
const defaultSelector = new ModelSelector();

module.exports = {
    ModelSelector,
    defaultSelector,
    MODEL_PROFILES,
    TASK_TYPES
};