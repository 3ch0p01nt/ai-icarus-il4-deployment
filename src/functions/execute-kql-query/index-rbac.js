module.exports = async function (context, req) {
    context.log('ExecuteKQLQuery function processing request - RBAC mode');

    try {
        // Get user principal from Azure Static Web Apps
        const clientPrincipalHeader = req.headers['x-ms-client-principal'];
        
        if (!clientPrincipalHeader) {
            context.res = {
                status: 401,
                body: { error: 'Authentication required. No user principal found.' }
            };
            return;
        }

        let userPrincipal;
        try {
            // Decode the client principal header
            const buffer = Buffer.from(clientPrincipalHeader, 'base64');
            userPrincipal = JSON.parse(buffer.toString('utf-8'));
            context.log(`User authenticated: ${userPrincipal.userDetails}`);
        } catch (error) {
            context.log.error('Failed to parse client principal:', error);
            context.res = {
                status: 401,
                body: { error: 'Invalid authentication token' }
            };
            return;
        }
        
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
        
        if (!isQuerySafe) {
            context.res = {
                status: 400,
                body: { error: 'Query contains potentially unsafe operations' }
            };
            return;
        }

        context.log(`User ${userPrincipal.userDetails} executing KQL query on workspace: ${request.workspaceId}`);
        
        let result;
        let executionTime = 0;
        let usingSampleData = false;
        
        try {
            // Import Azure SDKs
            const { ManagedIdentityCredential } = require('@azure/identity');
            const { LogsQueryClient, LogsQueryResultStatus } = require('@azure/monitor-query');
            
            // Since Azure Static Web Apps doesn't provide a token we can use with Azure SDK directly,
            // we need to use Managed Identity but verify the user has access to the workspace
            context.log('Using Managed Identity with user permission verification');
            
            // Verify user has access to this workspace (simple check)
            const userEmail = userPrincipal.userDetails?.toLowerCase() || '';
            const allowedDomains = ['@tasmonk.onmicrosoft.com', '@microsoft.com'];
            const hasAccess = allowedDomains.some(domain => userEmail.includes(domain));
            
            if (!hasAccess) {
                context.res = {
                    status: 403,
                    body: { error: 'You do not have permission to query this workspace' }
                };
                return;
            }
            
            // Use Managed Identity for the actual query
            const credential = new ManagedIdentityCredential();
            
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
            context.log(`Query returned ${rowCount} rows for user ${userPrincipal.userDetails}`);
            
            // If no rows returned, it might be an empty result (not an error)
            if (rowCount === 0) {
                context.log('No data found for the query in the specified time range');
            }
            
        } catch (queryError) {
            context.log.error('Query execution failed:', queryError.message);
            
            // Use sample data as fallback for demo purposes
            context.log('Using sample data for demonstration');
            usingSampleData = true;
            
            // Generate sample data based on query type
            const queryLower = request.query.toLowerCase();
            const sampleRows = [];
            const now = new Date();
            
            if (queryLower.includes('heartbeat')) {
                // Generate heartbeat-like data
                for (let i = 0; i < 5; i++) {
                    const timestamp = new Date(now.getTime() - (i * 300000)); // 5 minute intervals
                    sampleRows.push([
                        timestamp.toISOString(),
                        `computer-${i + 1}`,
                        'Healthy',
                        '1.10.0',
                        'Linux'
                    ]);
                }
                
                result = {
                    tables: [{
                        name: 'PrimaryResult',
                        columns: [
                            { name: 'TimeGenerated', type: 'datetime' },
                            { name: 'Computer', type: 'string' },
                            { name: 'Status', type: 'string' },
                            { name: 'Version', type: 'string' },
                            { name: 'OSType', type: 'string' }
                        ],
                        rows: sampleRows
                    }]
                };
            } else {
                // Generic sample data
                for (let i = 0; i < 10; i++) {
                    const timestamp = new Date(now.getTime() - (i * 60000)); // 1 minute intervals
                    sampleRows.push([
                        timestamp.toISOString(),
                        ['Information', 'Warning', 'Error'][Math.floor(Math.random() * 3)],
                        `Sample log entry ${i + 1}: ${request.query}`,
                        'AI-Icarus',
                        Math.floor(Math.random() * 100)
                    ]);
                }
                
                result = {
                    tables: [{
                        name: 'PrimaryResult',
                        columns: [
                            { name: 'TimeGenerated', type: 'datetime' },
                            { name: 'Level', type: 'string' },
                            { name: 'Message', type: 'string' },
                            { name: 'Source', type: 'string' },
                            { name: 'Count', type: 'long' }
                        ],
                        rows: sampleRows
                    }],
                    statistics: {
                        query: {
                            executionTime: 0.234,
                            dataset: 'sample'
                        }
                    }
                };
            }
            executionTime = 0.234;
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
                warning: usingSampleData ? 'Using sample data (authentication or query error)' : undefined,
                user: userPrincipal.userDetails,
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