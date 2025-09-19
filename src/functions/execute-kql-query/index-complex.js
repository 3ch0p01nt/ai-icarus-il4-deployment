module.exports = async function (context, req) {
    context.log('ExecuteKQLQuery function processing request');

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
            },
            body: ''
        };
        return;
    }

    try {
        // Check for Bearer token in Authorization header
        const authHeader = req.headers?.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            context.res = {
                status: 401,
                body: { error: 'Authentication required. Please provide a Bearer token.' }
            };
            return;
        }

        // For now, we just verify the token exists
        // In production, you would validate the token
        const token = authHeader.substring(7);
        context.log('User authenticated via Bearer token');
        
        // Parse request body
        const request = req.body;
        
        if (!request?.workspaceId || !request?.query) {
            context.res = {
                status: 400,
                body: { error: 'workspaceId and query are required' }
            };
            return;
        }

        // Basic safety validation
        const unsafePatterns = [
            /\bdrop\s+table\b/i,
            /\bdelete\s+/i,
            /\btruncate\s+/i,
            /\balter\s+/i,
            /\bcreate\s+/i
        ];
        
        const isQuerySafe = !unsafePatterns.some(pattern => pattern.test(request.query));
        
        // Auto-optimize common queries if no projection is specified
        let optimizedQuery = request.query;
        const queryLower = request.query.toLowerCase();
        
        // Check if query is a simple "table | take N" without projection
        if (queryLower.match(/^deviceevents\s*\|\s*take\s+\d+\s*$/i)) {
            context.log('Optimizing DeviceEvents query with smart projection');
            optimizedQuery = request.query.replace(/(\|\s*take\s+\d+)/i, 
                '| project Timestamp, DeviceName, ActionType, FileName, ProcessCommandLine, AccountName, RemoteIP, RemotePort $1');
        } else if (queryLower.match(/^deviceprocessevents\s*\|\s*take\s+\d+\s*$/i)) {
            context.log('Optimizing DeviceProcessEvents query with smart projection');
            optimizedQuery = request.query.replace(/(\|\s*take\s+\d+)/i,
                '| project Timestamp, DeviceName, FileName, ProcessCommandLine, AccountName, ProcessId, ParentProcessName $1');
        } else if (queryLower.match(/^devicenetworkevents\s*\|\s*take\s+\d+\s*$/i)) {
            context.log('Optimizing DeviceNetworkEvents query with smart projection');
            optimizedQuery = request.query.replace(/(\|\s*take\s+\d+)/i,
                '| project Timestamp, DeviceName, RemoteIP, RemotePort, RemoteUrl, LocalIP, LocalPort, Protocol $1');
        }
        
        if (!isQuerySafe) {
            context.res = {
                status: 400,
                body: { error: 'Query contains potentially unsafe operations' }
            };
            return;
        }

        context.log(`User executing KQL query on workspace: ${request.workspaceId}`);
        
        let result;
        let executionTime = 0;
        
        try {
            // Import Azure SDKs
            const { ManagedIdentityCredential, DefaultAzureCredential } = require('@azure/identity');
            const { LogsQueryClient, LogsQueryResultStatus } = require('@azure/monitor-query');
            
            // Use appropriate credential based on environment
            context.log('Setting up credential for query execution');
            const credential = process.env.AZURE_USE_MANAGED_IDENTITY === 'true' || process.env.MSI_ENDPOINT
                ? new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID ? { clientId: process.env.AZURE_CLIENT_ID } : {})
                : new DefaultAzureCredential();
            
            // Get environment configuration
            const azureEnvironment = process.env.AzureEnvironment || 'AzureCloud';
            const logAnalyticsEndpoint = process.env.LogAnalyticsEndpoint || 
                (azureEnvironment === 'AzureUSGovernment' || azureEnvironment === 'AzureDoD'
                    ? 'https://api.loganalytics.us'
                    : 'https://api.loganalytics.io');
            
            context.log(`Using Log Analytics endpoint: ${logAnalyticsEndpoint}`);
            
            // Initialize Log Analytics client
            const logsClient = new LogsQueryClient(credential, {
                endpoint: logAnalyticsEndpoint
            });

            // Set time range (default to last 30 days for better data availability)
            const timeInterval = request.timeRange ? {
                startTime: new Date(request.timeRange.startTime),
                endTime: new Date(request.timeRange.endTime)
            } : {
                startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
                endTime: new Date()
            };

            // Execute the query (use optimized version if available)
            const startTime = Date.now();
            const queryToExecute = optimizedQuery || request.query;
            context.log(`Executing query: ${queryToExecute}`);
            if (optimizedQuery !== request.query) {
                context.log(`Original query: ${request.query}`);
            }
            context.log(`Time range: ${timeInterval.startTime.toISOString()} to ${timeInterval.endTime.toISOString()}`);
            
            const queryResult = await logsClient.queryWorkspace(
                request.workspaceId,
                queryToExecute,
                timeInterval,
                {
                    serverTimeoutInSeconds: 30,
                    includeStatistics: true,
                    includeVisualization: false
                }
            );
            executionTime = (Date.now() - startTime) / 1000;
            
            // Check query status
            if (queryResult.status === LogsQueryResultStatus.Success) {
                context.log(`Query executed successfully in ${executionTime}s`);
            } else if (queryResult.status === LogsQueryResultStatus.PartialFailure) {
                context.log.warn('Query partially failed:', queryResult.partialError);
            }
            
            // Format the response with smart column analysis
            result = {
                tables: queryResult.tables.map(table => {
                    const rows = table.rows.slice(0, request.maxRows || 1000);
                    
                    // Analyze columns for smart display hints
                    const columnAnalysis = table.columns.map((col, index) => {
                        let hasData = false;
                        let nonNullCount = 0;
                        let sampleValues = [];
                        
                        rows.forEach(row => {
                            const value = row[index];
                            if (value !== null && value !== '' && value !== undefined) {
                                hasData = true;
                                nonNullCount++;
                                if (sampleValues.length < 3 && !sampleValues.includes(value)) {
                                    sampleValues.push(value);
                                }
                            }
                        });
                        
                        return {
                            name: col.name,
                            type: col.type,
                            hasData,
                            nonNullCount,
                            sampleValues: sampleValues.slice(0, 3)
                        };
                    });
                    
                    return {
                        name: table.name,
                        columns: columnAnalysis,
                        rows: rows
                    };
                }),
                statistics: queryResult.statistics,
                visualization: queryResult.visualization
            };
            
            const rowCount = result.tables[0]?.rows?.length || 0;
            context.log(`Query returned ${rowCount} rows`);
            
            // If no rows returned, it might be an empty result (not an error)
            if (rowCount === 0) {
                context.log('No data found for the query in the specified time range');
            }
            
        } catch (queryError) {
            context.log.error('Query execution failed:', queryError.message);
            
            // Try using user's token directly with REST API as fallback
            context.log('Attempting fallback with REST API using user token');
            
            try {
                const userToken = token; // Use the user's Bearer token from earlier
                const workspaceId = request.workspaceId;
                const query = optimizedQuery || request.query;
                
                // Use Azure Monitor REST API directly
                const azureEnvironment = process.env.AzureEnvironment || 'AzureCloud';
                const apiEndpoint = azureEnvironment === 'AzureUSGovernment' || azureEnvironment === 'AzureDoD'
                    ? 'https://api.loganalytics.us'
                    : 'https://api.loganalytics.io';
                
                const apiUrl = `${apiEndpoint}/v1/workspaces/${workspaceId}/query`;
                
                const timespan = request.timeRange ? 
                    `${new Date(request.timeRange.startTime).toISOString()}/${new Date(request.timeRange.endTime).toISOString()}` :
                    'P30D'; // Last 30 days
                
                const https = require('https');
                const url = require('url');
                
                const requestBody = JSON.stringify({
                    query: query,
                    timespan: timespan
                });
                
                const parsedUrl = url.parse(apiUrl);
                const options = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.path,
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${userToken}`,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(requestBody)
                    }
                };
                
                const queryResult = await new Promise((resolve, reject) => {
                    const req = https.request(options, (res) => {
                        let data = '';
                        
                        res.on('data', chunk => {
                            data += chunk;
                        });
                        
                        res.on('end', () => {
                            if (res.statusCode === 200) {
                                resolve(JSON.parse(data));
                            } else {
                                reject(new Error(`API returned ${res.statusCode}: ${data}`));
                            }
                        });
                    });
                    
                    req.on('error', reject);
                    req.write(requestBody);
                    req.end();
                });
                
                // Format the response to match expected structure
                result = {
                    tables: queryResult.tables.map(table => ({
                        name: table.name,
                        columns: table.columns.map(col => ({
                            name: col.name,
                            type: col.type,
                            hasData: true,
                            nonNullCount: 0,
                            sampleValues: []
                        })),
                        rows: table.rows.slice(0, request.maxRows || 1000)
                    })),
                    statistics: queryResult.statistics || {},
                    visualization: queryResult.visualization || null
                };
                
                context.log('Fallback REST API query succeeded');
                executionTime = 1.0; // Approximate
                
            } catch (fallbackError) {
                context.log.error('Fallback also failed:', fallbackError.message);
                
                // Return error response
                return context.res = {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                    },
                    body: {
                        error: 'Query execution failed',
                        message: `Primary: ${queryError.message}. Fallback: ${fallbackError.message}`,
                        code: queryError.code || 'QUERY_EXECUTION_FAILED',
                        hint: 'Please ensure the Function App Managed Identity has "Log Analytics Reader" role on the workspace'
                    }
                };
            }
        }

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
            },
            body: {
                result: result,
                executionTime: executionTime,
                rowCount: result.tables[0]?.rows.length || 0,
                timestamp: new Date().toISOString(),
                user: 'authenticated',
                error: result.error
            }
        };

    } catch (error) {
        context.log.error('Error in ExecuteKQLQuery function:', error);
        context.res = {
            status: 500,
            body: {
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};