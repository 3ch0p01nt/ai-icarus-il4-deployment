const https = require('https');

module.exports = async function (context, req) {
    context.log('M365 Defender Hunting Query function triggered');
    
    // Handle CORS
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: corsHeaders,
            body: ''
        };
        return;
    }

    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        context.res = {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: { error: 'No authorization token provided' }
        };
        return;
    }

    const { query, timespan } = req.body || {};
    
    if (!query) {
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: { error: 'Query is required' }
        };
        return;
    }

    try {
        context.log(`Executing hunting query: ${query.substring(0, 100)}...`);
        
        // Note: Microsoft Graph runHuntingQuery requires specific licensing
        // We'll attempt to use it, but fallback to alert-based queries if needed
        const result = await runHuntingQuery(query, timespan, token, context);
        
        // Process and format the results
        const processedResult = processHuntingResults(result, query, context);
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: processedResult
        };

    } catch (error) {
        context.log.error(`Error in hunting query: ${error.message}`);
        
        // If it's a licensing error, provide fallback
        if (error.message?.includes('403') || error.message?.includes('Forbidden')) {
            context.log('Hunting API requires E5 license, falling back to alert-based query');
            const fallbackResult = await getFallbackAlertData(query, token, context);
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: fallbackResult
            };
        } else {
            context.res = {
                status: error.statusCode || 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: {
                    error: 'Failed to execute hunting query',
                    message: error.message,
                    timestamp: new Date().toISOString(),
                    note: 'Advanced hunting requires Microsoft 365 E5 or Microsoft 365 E5 Security license.'
                }
            };
        }
    }
};

// Execute hunting query via Microsoft Graph API
async function runHuntingQuery(query, timespan, token, context) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            query: query,
            timespan: timespan // Optional timespan like 'PT12H' for 12 hours
        });
        
        const options = {
            hostname: 'graph.microsoft.com',
            path: '/v1.0/security/runHuntingQuery',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': body.length
            }
        };
        
        context.log(`Calling Graph API: ${options.path}`);
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const result = JSON.parse(data);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`Failed to parse Graph API response: ${e.message}`));
                    }
                } else {
                    const error = new Error(`Graph API returned ${res.statusCode}: ${data}`);
                    error.statusCode = res.statusCode;
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.write(body);
        req.end();
    });
}

// Process hunting query results
function processHuntingResults(result, originalQuery, context) {
    // Graph API returns results in a specific format
    const results = result.results || [];
    const schema = result.schema || [];
    
    context.log(`Hunting query returned ${results.length} results`);
    
    return {
        query: originalQuery,
        timestamp: new Date().toISOString(),
        source: 'Microsoft Graph Hunting API',
        rowCount: results.length,
        schema: schema,
        results: results,
        insights: generateInsights(results, schema, originalQuery)
    };
}

// Generate insights based on results
function generateInsights(results, schema, query) {
    const insights = {
        summary: `Query returned ${results.length} results`,
        recommendations: []
    };
    
    if (results.length > 100) {
        insights.recommendations.push('Consider adding filters to narrow down results');
    }
    
    if (query.toLowerCase().includes('process')) {
        insights.recommendations.push('Check parent processes for suspicious activity');
    }
    
    return insights;
}

// Fallback to alert-based data when hunting API is not available
async function getFallbackAlertData(query, token, context) {
    context.log('Using fallback alert-based query');
    
    // Parse the query to determine what kind of data is requested
    const queryLower = query.toLowerCase();
    let filter = '';
    
    if (queryLower.includes('malware')) {
        filter = "category eq 'Malware'";
    } else if (queryLower.includes('suspicious')) {
        filter = "category eq 'SuspiciousActivity'";
    } else if (queryLower.includes('phishing')) {
        filter = "determination eq 'phishing'";
    }
    
    return new Promise((resolve) => {
        const path = filter 
            ? `/v1.0/security/alerts_v2?$filter=${encodeURIComponent(filter)}&$top=100`
            : '/v1.0/security/alerts_v2?$top=100';
        
        const options = {
            hostname: 'graph.microsoft.com',
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    const alerts = result.value || [];
                    
                    // Transform alerts to hunting-like format
                    resolve({
                        query: query,
                        timestamp: new Date().toISOString(),
                        source: 'Microsoft Graph Alerts API (Fallback)',
                        rowCount: alerts.length,
                        schema: [
                            { name: 'Title', type: 'string' },
                            { name: 'Severity', type: 'string' },
                            { name: 'Category', type: 'string' },
                            { name: 'CreatedDateTime', type: 'datetime' },
                            { name: 'MitreTechniques', type: 'array' }
                        ],
                        results: alerts.map(a => [a.title, a.severity, a.category, a.createdDateTime, a.mitreTechniques]),
                        note: 'Using alerts API as fallback. Full hunting queries require Microsoft 365 E5 license.',
                        insights: {
                            summary: `Found ${alerts.length} security alerts matching criteria`,
                            recommendations: [
                                'Upgrade to Microsoft 365 E5 for full hunting capabilities',
                                'Use Microsoft Sentinel for advanced KQL queries'
                            ]
                        }
                    });
                } catch (e) {
                    resolve({
                        query: query,
                        timestamp: new Date().toISOString(),
                        source: 'Fallback',
                        rowCount: 0,
                        schema: [],
                        results: [],
                        error: 'Failed to fetch fallback data',
                        note: 'Hunting API and fallback both unavailable'
                    });
                }
            });
        });
        
        req.on('error', () => {
            resolve({
                query: query,
                timestamp: new Date().toISOString(),
                source: 'Fallback',
                rowCount: 0,
                schema: [],
                results: [],
                error: 'Network error',
                note: 'Unable to connect to Microsoft Graph API'
            });
        });
        
        req.end();
    });
};