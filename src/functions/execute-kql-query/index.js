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
        // Get authorization header
        const authToken = req.headers?.authorization;
        
        if (!authToken || !authToken.startsWith('Bearer ')) {
            context.res = {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                },
                body: { error: 'Authentication required. Please provide a Bearer token.' }
            };
            return;
        }
        
        // Parse request body
        const request = req.body;
        
        if (!request?.workspaceId || !request?.query) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                },
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
        
        if (!isQuerySafe) {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                },
                body: { error: 'Query contains potentially unsafe operations' }
            };
            return;
        }

        context.log(`User executing KQL query on workspace: ${request.workspaceId}`);
        context.log(`Query: ${request.query}`);
        
        let result;
        let executionTime = 0;
        let usingSampleData = false;
        
        try {
            // Import Azure SDKs
            const { ManagedIdentityCredential } = require('@azure/identity');
            const { LogsQueryClient, LogsQueryResultStatus } = require('@azure/monitor-query');
            
            // Custom credential implementation for user bearer tokens
            class BearerTokenCredential {
                constructor(bearerToken) {
                    this.bearerToken = bearerToken;
                }
                
                async getToken(scopes, options) {
                    // Return the token in the format expected by Azure SDK
                    return {
                        token: this.bearerToken,
                        expiresOnTimestamp: Date.now() + 3600000 // 1 hour from now
                    };
                }
            }
            
            // Use user's delegated token for RBAC-based authentication
            const userToken = authToken.substring(7);
            context.log('Using user delegated token for authentication (RBAC-based)');
            
            const credential = new BearerTokenCredential(userToken);
            
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

            // Execute the query
            const startTime = Date.now();
            context.log(`Executing query: ${request.query}`);
            context.log(`Time range: ${timeInterval.startTime.toISOString()} to ${timeInterval.endTime.toISOString()}`);
            
            const queryResult = await logsClient.queryWorkspace(
                request.workspaceId,
                request.query,
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
            
            // Format the response
            result = {
                tables: queryResult.tables.map(table => ({
                    name: table.name,
                    columns: table.columns.map(col => ({
                        name: col.name,
                        type: col.type
                    })),
                    rows: table.rows.slice(0, request.maxRows || 1000)
                })),
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
            
            // If user token failed, try with Managed Identity as fallback
            if (queryError.message && 
                (queryError.message.includes('authentication') || 
                 queryError.message.includes('401') || 
                 queryError.message.includes('403'))) {
                
                context.log('User token authentication failed, trying Managed Identity fallback');
                
                try {
                    const { ManagedIdentityCredential } = require('@azure/identity');
                    const { LogsQueryClient, LogsQueryResultStatus } = require('@azure/monitor-query');
                    
                    const credential = new ManagedIdentityCredential();
                    const logsClient = new LogsQueryClient(credential, {
                        endpoint: process.env.LogAnalyticsEndpoint || 'https://api.loganalytics.io'
                    });
                    
                    const timeInterval = request.timeRange ? {
                        startTime: new Date(request.timeRange.startTime),
                        endTime: new Date(request.timeRange.endTime)
                    } : {
                        startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                        endTime: new Date()
                    };
                    
                    const startTime = Date.now();
                    const queryResult = await logsClient.queryWorkspace(
                        request.workspaceId,
                        request.query,
                        timeInterval,
                        {
                            serverTimeoutInSeconds: 30,
                            includeStatistics: true,
                            includeVisualization: false
                        }
                    );
                    executionTime = (Date.now() - startTime) / 1000;
                    
                    result = {
                        tables: queryResult.tables.map(table => ({
                            name: table.name,
                            columns: table.columns.map(col => ({
                                name: col.name,
                                type: col.type
                            })),
                            rows: table.rows.slice(0, request.maxRows || 1000)
                        })),
                        statistics: queryResult.statistics,
                        visualization: queryResult.visualization
                    };
                    
                    const rowCount = result.tables[0]?.rows?.length || 0;
                    context.log(`Query returned ${rowCount} rows using Managed Identity fallback`);
                    
                } catch (fallbackError) {
                    context.log.error('Managed Identity fallback also failed:', fallbackError.message);
                    
                    // Return error response instead of sample data
                    context.res = {
                        status: 403,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                        },
                        body: {
                            error: 'Failed to execute query',
                            message: 'Authentication failed. Please ensure you have Log Analytics Reader permissions on the workspace.',
                            details: fallbackError.message,
                            timestamp: new Date().toISOString()
                        }
                    };
                    return;
                }
            } else {
                // Not an auth error, return the error
                context.res = {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                    },
                    body: {
                        error: 'Query execution failed',
                        message: queryError.message,
                        timestamp: new Date().toISOString()
                    }
                };
                return;
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
                rowCount: result.tables[0]?.rows?.length || 0,
                timestamp: new Date().toISOString(),
                user: 'authenticated',
                note: result.tables[0]?.rows?.length === 0 ? 'No data found for the query in the specified time range' : undefined
            }
        };

    } catch (error) {
        context.log.error('Error in ExecuteKQLQuery function:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
            },
            body: {
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};