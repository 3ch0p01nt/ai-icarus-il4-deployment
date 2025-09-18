const { DefaultAzureCredential } = require("@azure/identity");
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");

module.exports = async function (context, req) {
    context.log('OpenAI analyze endpoint called');

    // Set CORS headers for Government cloud
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: headers,
            body: ''
        };
        return;
    }

    try {
        // Validate request body
        const { 
            endpoint, 
            deploymentName, 
            data, 
            analysisType, 
            systemPrompt,
            temperature = 0.7,
            maxTokens = 1000
        } = req.body;
        
        if (!endpoint || !deploymentName || !data) {
            context.res = {
                status: 400,
                headers: headers,
                body: JSON.stringify({
                    error: 'Missing required parameters',
                    message: 'endpoint, deploymentName, and data are required'
                })
            };
            return;
        }

        // Use managed identity for authentication
        const credential = new DefaultAzureCredential();
        
        // Create OpenAI client for Government cloud
        const client = new OpenAIClient(endpoint, credential);
        
        // Prepare the analysis prompt based on type
        let analysisPrompt = systemPrompt || "You are an AI assistant specialized in analyzing security and operational data.";
        
        switch (analysisType) {
            case 'security':
                analysisPrompt += "\nAnalyze the following data for security threats, anomalies, and provide recommendations.";
                break;
            case 'performance':
                analysisPrompt += "\nAnalyze the following data for performance issues, bottlenecks, and optimization opportunities.";
                break;
            case 'compliance':
                analysisPrompt += "\nAnalyze the following data for compliance issues and regulatory concerns.";
                break;
            case 'summary':
                analysisPrompt += "\nProvide a concise summary of the following data, highlighting key insights.";
                break;
            default:
                analysisPrompt += "\nAnalyze the following data and provide insights.";
        }
        
        // Prepare the data for analysis
        let dataString = "";
        if (typeof data === 'object') {
            // If data is from KQL query results, format it nicely
            if (data.tables && Array.isArray(data.tables)) {
                dataString = formatKQLResults(data);
            } else {
                dataString = JSON.stringify(data, null, 2);
            }
        } else {
            dataString = String(data);
        }
        
        // Truncate data if too long (leave room for response)
        const maxDataLength = 3000;
        if (dataString.length > maxDataLength) {
            dataString = dataString.substring(0, maxDataLength) + "\n...[truncated]";
            context.log('Data truncated for analysis');
        }
        
        const messages = [
            { role: "system", content: analysisPrompt },
            { role: "user", content: `Please analyze this data:\n\n${dataString}` }
        ];
        
        context.log(`Sending data to OpenAI for ${analysisType || 'general'} analysis`);
        
        try {
            // Call OpenAI for analysis
            const completion = await client.getChatCompletions(
                deploymentName,
                messages,
                {
                    temperature: temperature,
                    maxTokens: maxTokens,
                    topP: 0.95,
                    frequencyPenalty: 0,
                    presencePenalty: 0
                }
            );
            
            const analysis = completion.choices[0]?.message?.content || "No analysis generated";
            
            // Structure the response
            const response = {
                analysis: analysis,
                metadata: {
                    analysisType: analysisType || 'general',
                    model: deploymentName,
                    timestamp: new Date().toISOString(),
                    dataLength: dataString.length,
                    truncated: dataString.length > maxDataLength,
                    tokensUsed: completion.usage?.totalTokens || 0
                },
                insights: extractInsights(analysis, analysisType)
            };
            
            context.log('Analysis completed successfully');
            
            context.res = {
                status: 200,
                headers: headers,
                body: JSON.stringify(response)
            };
            
        } catch (openAIError) {
            context.log.error('OpenAI API error:', openAIError);
            
            if (openAIError.statusCode === 401) {
                context.res = {
                    status: 401,
                    headers: headers,
                    body: JSON.stringify({
                        error: 'Authentication failed',
                        message: 'Failed to authenticate with OpenAI. Check managed identity permissions.',
                        details: openAIError.message
                    })
                };
            } else if (openAIError.statusCode === 429) {
                context.res = {
                    status: 429,
                    headers: headers,
                    body: JSON.stringify({
                        error: 'Rate limit exceeded',
                        message: 'OpenAI API rate limit exceeded. Please try again later.',
                        details: openAIError.message
                    })
                };
            } else {
                throw openAIError;
            }
        }
        
    } catch (error) {
        context.log.error('Error in OpenAI analyze:', error);
        
        context.res = {
            status: 500,
            headers: headers,
            body: JSON.stringify({
                error: 'Failed to analyze data',
                message: error.message,
                environment: process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment'
            })
        };
    }
};

// Helper function to format KQL results for analysis
function formatKQLResults(data) {
    let formatted = "";
    
    if (data.tables && data.tables.length > 0) {
        const table = data.tables[0];
        
        // Add column headers
        formatted += "Columns: " + table.columns.map(c => c.name).join(", ") + "\n\n";
        
        // Add first 20 rows
        formatted += "Data (first 20 rows):\n";
        const rowsToShow = Math.min(20, table.rows.length);
        
        for (let i = 0; i < rowsToShow; i++) {
            const row = table.rows[i];
            formatted += table.columns.map((col, idx) => `${col.name}: ${row[idx]}`).join(", ") + "\n";
        }
        
        if (table.rows.length > 20) {
            formatted += `\n... and ${table.rows.length - 20} more rows`;
        }
    }
    
    return formatted;
}

// Helper function to extract key insights from analysis
function extractInsights(analysis, analysisType) {
    const insights = {
        keyFindings: [],
        recommendations: [],
        risks: []
    };
    
    // Simple extraction based on common patterns
    const lines = analysis.split('\n');
    
    lines.forEach(line => {
        const lowerLine = line.toLowerCase();
        
        // Extract findings
        if (lowerLine.includes('found') || lowerLine.includes('detected') || lowerLine.includes('identified')) {
            insights.keyFindings.push(line.trim());
        }
        
        // Extract recommendations
        if (lowerLine.includes('recommend') || lowerLine.includes('should') || lowerLine.includes('suggest')) {
            insights.recommendations.push(line.trim());
        }
        
        // Extract risks
        if (lowerLine.includes('risk') || lowerLine.includes('threat') || lowerLine.includes('vulnerable')) {
            insights.risks.push(line.trim());
        }
    });
    
    // Limit to top 3 of each
    insights.keyFindings = insights.keyFindings.slice(0, 3);
    insights.recommendations = insights.recommendations.slice(0, 3);
    insights.risks = insights.risks.slice(0, 3);
    
    return insights;
}