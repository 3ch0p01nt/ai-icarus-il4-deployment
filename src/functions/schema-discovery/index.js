const { ManagedIdentityCredential } = require('@azure/identity');
const { LogsQueryClient } = require('@azure/monitor-query');

// Cache for workspace schemas (5-minute TTL)
const schemaCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

module.exports = async function (context, req) {
    context.log('Schema Discovery function processing request');
    
    // Handle CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: ''
        };
        return;
    }

    const workspaceId = req.params.workspaceId;
    const forceRefresh = req.query.refresh === 'true';

    if (!workspaceId) {
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { error: 'Workspace ID is required' }
        };
        return;
    }

    try {
        // Check cache first
        const cacheKey = `schema_${workspaceId}`;
        const cached = schemaCache.get(cacheKey);
        
        if (cached && !forceRefresh && (Date.now() - cached.timestamp < CACHE_TTL)) {
            context.log('Returning cached schema');
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=300'
                },
                body: cached.data
            };
            return;
        }

        // Initialize Log Analytics client with Managed Identity
        const credential = new ManagedIdentityCredential();
        const logsClient = new LogsQueryClient(credential, {
            endpoint: process.env.LogAnalyticsEndpoint || 'https://api.loganalytics.io'
        });

        // Query to get all tables in the workspace
        const tablesQuery = `
            // Get all tables with row counts and schema info
            union withsource=TableName *
            | take 0
            | getschema
            | distinct TableName
            | order by TableName asc
        `;

        // Alternative query that works better for schema discovery
        const schemaQuery = `
            // Get table list with basic info
            .show tables
            | project TableName = Name, Description = Documentation
            | order by TableName asc
        `;

        // Try the union query first
        let tables = [];
        try {
            const timeInterval = {
                startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                endTime: new Date()
            };

            const queryResult = await logsClient.queryWorkspace(
                workspaceId,
                tablesQuery,
                timeInterval,
                {
                    serverTimeoutInSeconds: 30
                }
            );

            if (queryResult.tables && queryResult.tables.length > 0) {
                const table = queryResult.tables[0];
                const tableNameIndex = table.columns.findIndex(col => col.name === 'TableName');
                
                if (tableNameIndex >= 0) {
                    tables = table.rows.map(row => row[tableNameIndex]).filter(name => name);
                }
            }
        } catch (error) {
            context.log.warn('Union query failed, falling back to common tables:', error.message);
            
            // Fallback to common Log Analytics tables
            tables = [
                'Heartbeat',
                'AzureActivity',
                'SecurityEvent',
                'Syslog',
                'Event',
                'Perf',
                'Alert',
                'SecurityIncident',
                'SecurityAlert',
                'DeviceEvents',
                'DeviceProcessEvents',
                'DeviceNetworkEvents',
                'DeviceFileEvents',
                'DeviceRegistryEvents',
                'DeviceLogonEvents',
                'IdentityLogonEvents',
                'IdentityQueryEvents',
                'CloudAppEvents',
                'EmailEvents',
                'Update',
                'UpdateSummary',
                'ContainerInventory',
                'ContainerLog',
                'KubeEvents',
                'KubePodInventory',
                'W3CIISLog',
                'AppRequests',
                'AppDependencies',
                'AppExceptions',
                'AppTraces',
                'AppMetrics'
            ];
        }

        // Get schema for each table
        const schema = {
            workspaceId: workspaceId,
            tables: [],
            timestamp: new Date().toISOString(),
            cached: false
        };

        // Batch process tables to avoid timeouts
        const batchSize = 5;
        for (let i = 0; i < tables.length; i += batchSize) {
            const batch = tables.slice(i, i + batchSize);
            const tableSchemas = await Promise.all(
                batch.map(async (tableName) => {
                    try {
                        return await getTableSchema(logsClient, workspaceId, tableName, context);
                    } catch (error) {
                        context.log.warn(`Failed to get schema for table ${tableName}:`, error.message);
                        return {
                            name: tableName,
                            columns: [],
                            error: error.message
                        };
                    }
                })
            );
            
            schema.tables.push(...tableSchemas.filter(t => t && t.columns && t.columns.length > 0));
        }

        // Sort tables alphabetically
        schema.tables.sort((a, b) => a.name.localeCompare(b.name));

        // Cache the result
        schemaCache.set(cacheKey, {
            timestamp: Date.now(),
            data: schema
        });

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: schema
        };

    } catch (error) {
        context.log.error('Schema discovery error:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Schema discovery failed',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};

// Helper function to get schema for a specific table
async function getTableSchema(logsClient, workspaceId, tableName, context) {
    try {
        // Query to get column information for the table
        const columnQuery = `
            ${tableName}
            | take 1
            | getschema
            | project ColumnName, DataType
            | order by ColumnName asc
        `;

        const timeInterval = {
            startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
            endTime: new Date()
        };

        const queryResult = await logsClient.queryWorkspace(
            workspaceId,
            columnQuery,
            timeInterval,
            {
                serverTimeoutInSeconds: 10
            }
        );

        const columns = [];
        
        if (queryResult.tables && queryResult.tables.length > 0) {
            const table = queryResult.tables[0];
            const nameIndex = table.columns.findIndex(col => col.name === 'ColumnName');
            const typeIndex = table.columns.findIndex(col => col.name === 'DataType');
            
            if (nameIndex >= 0 && typeIndex >= 0) {
                for (const row of table.rows) {
                    columns.push({
                        name: row[nameIndex],
                        type: row[typeIndex],
                        description: getColumnDescription(tableName, row[nameIndex])
                    });
                }
            }
        }

        // Get sample data for the table
        let sampleData = [];
        try {
            const sampleQuery = `${tableName} | take 3`;
            const sampleResult = await logsClient.queryWorkspace(
                workspaceId,
                sampleQuery,
                timeInterval,
                {
                    serverTimeoutInSeconds: 5
                }
            );

            if (sampleResult.tables && sampleResult.tables.length > 0) {
                const sampleTable = sampleResult.tables[0];
                sampleData = sampleTable.rows.slice(0, 3);
            }
        } catch (error) {
            context.log.warn(`Failed to get sample data for ${tableName}:`, error.message);
        }

        return {
            name: tableName,
            description: getTableDescription(tableName),
            columns: columns,
            sampleData: sampleData,
            rowCount: sampleData.length
        };

    } catch (error) {
        throw error;
    }
}

// Helper function to provide table descriptions
function getTableDescription(tableName) {
    const descriptions = {
        'Heartbeat': 'Agent heartbeat data for monitoring agent connectivity',
        'AzureActivity': 'Azure control plane operations and administrative activities',
        'SecurityEvent': 'Windows security events from Security Event Log',
        'SecurityIncident': 'Azure Sentinel security incidents',
        'SecurityAlert': 'Security alerts from various sources',
        'Syslog': 'Linux syslog messages',
        'Event': 'Windows event logs',
        'Perf': 'Performance counter data',
        'DeviceEvents': 'Microsoft Defender for Endpoint device events',
        'DeviceProcessEvents': 'Process creation and related events',
        'DeviceNetworkEvents': 'Network connection events',
        'DeviceFileEvents': 'File creation, modification, and deletion events',
        'IdentityLogonEvents': 'Authentication and logon events',
        'CloudAppEvents': 'Events from cloud applications',
        'EmailEvents': 'Email-related security events',
        'Update': 'Windows update assessment data',
        'ContainerLog': 'Container stdout and stderr logs',
        'KubeEvents': 'Kubernetes cluster events',
        'AppRequests': 'Application Insights request telemetry',
        'AppExceptions': 'Application Insights exception telemetry'
    };
    
    return descriptions[tableName] || `Data from ${tableName} table`;
}

// Helper function to provide column descriptions
function getColumnDescription(tableName, columnName) {
    const commonColumns = {
        'TimeGenerated': 'Timestamp when the record was generated',
        'Computer': 'Name of the computer/device',
        'SourceSystem': 'System that generated the record',
        'Type': 'Table name/record type',
        '_ResourceId': 'Azure resource identifier',
        'TenantId': 'Azure AD tenant identifier',
        'SubscriptionId': 'Azure subscription identifier',
        'ResourceGroup': 'Azure resource group name',
        'ResourceProvider': 'Azure resource provider',
        'Resource': 'Azure resource name',
        'ResourceType': 'Type of Azure resource',
        'OperationName': 'Name of the operation',
        'Level': 'Severity or level of the event',
        'Category': 'Event category',
        'EventID': 'Event identifier',
        'UserName': 'User account name',
        'AccountName': 'Account name',
        'ProcessName': 'Process name',
        'ProcessId': 'Process identifier',
        'ParentProcessId': 'Parent process identifier'
    };
    
    return commonColumns[columnName] || '';
}