const { DefaultAzureCredential } = require("@azure/identity");
const { MonitorQueryClient } = require("@azure/monitor-query");

module.exports = async function (context, req) {
    context.log('KQL execute endpoint called');

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
        const { workspaceId, query, timespan } = req.body;
        
        if (!workspaceId || !query) {
            context.res = {
                status: 400,
                headers: headers,
                body: JSON.stringify({
                    error: 'Missing required parameters',
                    message: 'workspaceId and query are required'
                })
            };
            return;
        }

        // Use managed identity for authentication
        const credential = new DefaultAzureCredential();
        
        // Configure for Government cloud endpoints
        const logAnalyticsEndpoint = process.env.LogAnalyticsEndpoint || 'https://api.loganalytics.us';
        
        // Create Monitor Query Client for Government cloud
        const client = new MonitorQueryClient(credential, {
            endpoint: logAnalyticsEndpoint
        });

        // Set default timespan if not provided (last 24 hours)
        const queryTimespan = timespan || 'P1D';
        
        context.log(`Executing KQL query on workspace ${workspaceId}`);
        
        try {
            // Execute the KQL query
            const result = await client.queryWorkspace(
                workspaceId,
                query,
                {
                    duration: queryTimespan,
                    includeQueryStatistics: true,
                    includeVisualization: true
                }
            );

            // Process the results
            const tables = [];
            
            for (const table of result.tables) {
                const processedTable = {
                    name: table.name,
                    columns: table.columns.map(col => ({
                        name: col.name,
                        type: col.type
                    })),
                    rows: table.rows
                };
                tables.push(processedTable);
            }

            // Include statistics if available
            const response = {
                tables: tables,
                statistics: result.statistics || {},
                visualization: result.visualization || null,
                metadata: {
                    workspaceId: workspaceId,
                    query: query,
                    timespan: queryTimespan,
                    executedAt: new Date().toISOString(),
                    rowCount: tables[0]?.rows?.length || 0,
                    columnCount: tables[0]?.columns?.length || 0
                }
            };

            context.log(`Query executed successfully, returned ${response.metadata.rowCount} rows`);

            context.res = {
                status: 200,
                headers: headers,
                body: JSON.stringify(response)
            };
            
        } catch (queryError) {
            context.log.error('Error executing query:', queryError);
            
            // Handle specific query errors
            if (queryError.statusCode === 403) {
                context.res = {
                    status: 403,
                    headers: headers,
                    body: JSON.stringify({
                        error: 'Access denied',
                        message: 'You do not have permission to query this workspace. Ensure you have Log Analytics Reader role.',
                        details: queryError.message
                    })
                };
            } else if (queryError.code === 'BadRequest' || queryError.statusCode === 400) {
                context.res = {
                    status: 400,
                    headers: headers,
                    body: JSON.stringify({
                        error: 'Invalid query',
                        message: 'The KQL query syntax is invalid',
                        details: queryError.message
                    })
                };
            } else {
                throw queryError;
            }
        }

    } catch (error) {
        context.log.error('Error in KQL execute:', error);
        
        context.res = {
            status: 500,
            headers: headers,
            body: JSON.stringify({
                error: 'Failed to execute KQL query',
                message: error.message,
                environment: process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment'
            })
        };
    }
};