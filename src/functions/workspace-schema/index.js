const { DefaultAzureCredential } = require("@azure/identity");
const { MonitorQueryClient } = require("@azure/monitor-query");

module.exports = async function (context, req) {
    try {
        // Get environment details
        const environment = process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment';
        const workspaceId = req.query.workspaceId || req.body?.workspaceId;
        const tableFilter = req.query.table || req.body?.table || '';
        
        if (!workspaceId) {
            context.res = {
                status: 400,
                body: { error: "Workspace ID is required" }
            };
            return;
        }

        // Set up endpoints based on environment
        const logAnalyticsEndpoint = environment === 'AzureUSGovernment' || environment === 'AzureDoD' 
            ? 'https://api.loganalytics.us'
            : 'https://api.loganalytics.io';

        // Create credential for authentication
        const credential = new DefaultAzureCredential({
            additionallyAllowedTenants: ['*']
        });

        // Create Monitor Query client
        const client = new MonitorQueryClient(credential, {
            endpoint: logAnalyticsEndpoint
        });

        // Build schema discovery query
        let schemaQuery = '';
        
        if (tableFilter) {
            // Get schema for specific table
            schemaQuery = `
                ${tableFilter}
                | getschema
                | project ColumnName, ColumnType = DataType, ColumnDescription = ""
                | order by ColumnName asc
            `;
        } else {
            // Get all tables and their schemas
            // This query gets basic table information
            schemaQuery = `
                union withsource=TableName *
                | where TimeGenerated >= ago(1h)
                | distinct TableName
                | order by TableName asc
                | take 100
            `;
        }

        context.log('Executing workspace schema query...');
        
        try {
            const result = await client.queryWorkspace(workspaceId, schemaQuery, {
                duration: 'PT1H' // 1 hour time span
            });

            // Format the response based on query type
            let response = {};
            
            if (tableFilter) {
                // Single table schema response
                response = {
                    table: tableFilter,
                    columns: [],
                    sampleQuery: generateSampleQuery(tableFilter)
                };

                if (result.tables && result.tables.length > 0) {
                    const table = result.tables[0];
                    
                    table.rows.forEach(row => {
                        const column = {
                            name: row[0],
                            type: row[1],
                            description: row[2] || getColumnDescription(tableFilter, row[0])
                        };
                        response.columns.push(column);
                    });
                }
            } else {
                // All tables response
                response = {
                    tables: [],
                    commonTables: getCommonTables(environment)
                };

                if (result.tables && result.tables.length > 0) {
                    const table = result.tables[0];
                    
                    // Get unique table names
                    const tableNames = new Set();
                    table.rows.forEach(row => {
                        tableNames.add(row[0]);
                    });

                    // Add table information
                    Array.from(tableNames).forEach(tableName => {
                        response.tables.push({
                            name: tableName,
                            description: getTableDescription(tableName),
                            category: getTableCategory(tableName)
                        });
                    });

                    // Sort tables by category and name
                    response.tables.sort((a, b) => {
                        if (a.category !== b.category) {
                            return a.category.localeCompare(b.category);
                        }
                        return a.name.localeCompare(b.name);
                    });
                }
            }

            context.res = {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: response
            };

        } catch (queryError) {
            context.log.error('Schema query failed:', queryError);
            
            // Return predefined schema for common tables
            const fallbackResponse = {
                tables: getCommonTables(environment),
                note: "Live schema discovery unavailable. Showing common table definitions."
            };

            context.res = {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: fallbackResponse
            };
        }

    } catch (error) {
        context.log.error('Error in workspace-schema function:', error);
        context.res = {
            status: 500,
            body: { 
                error: "Failed to retrieve workspace schema",
                details: error.message 
            }
        };
    }
};

// Helper function to get table descriptions
function getTableDescription(tableName) {
    const descriptions = {
        'SecurityEvent': 'Windows security events collected from domain controllers and member servers',
        'SecurityAlert': 'Security alerts from Microsoft Defender and other security solutions',
        'SecurityIncident': 'Security incidents from Microsoft Sentinel and M365 Defender',
        'Syslog': 'Linux/Unix syslog events',
        'CommonSecurityLog': 'Common Event Format (CEF) logs from security appliances',
        'AzureActivity': 'Azure control plane operations and activities',
        'AzureDiagnostics': 'Diagnostic logs from Azure resources',
        'Heartbeat': 'Agent heartbeat data for monitoring connectivity',
        'Perf': 'Performance counter data from Windows and Linux systems',
        'Event': 'Windows event logs',
        'OfficeActivity': 'Office 365 activity logs',
        'SigninLogs': 'Azure AD sign-in logs',
        'AuditLogs': 'Azure AD audit logs',
        'ThreatIntelligenceIndicator': 'Threat intelligence indicators',
        'DeviceEvents': 'Device events from Microsoft Defender for Endpoint'
    };
    
    return descriptions[tableName] || 'Log Analytics table';
}

// Helper function to categorize tables
function getTableCategory(tableName) {
    const categories = {
        'Security': ['SecurityEvent', 'SecurityAlert', 'SecurityIncident', 'CommonSecurityLog', 'ThreatIntelligenceIndicator'],
        'Identity': ['SigninLogs', 'AuditLogs', 'AADNonInteractiveUserSignInLogs', 'AADServicePrincipalSignInLogs'],
        'Azure': ['AzureActivity', 'AzureDiagnostics', 'AzureMetrics'],
        'Office365': ['OfficeActivity', 'Office365'],
        'Endpoint': ['DeviceEvents', 'DeviceInfo', 'DeviceProcessEvents', 'DeviceNetworkEvents'],
        'System': ['Heartbeat', 'Perf', 'Event', 'Syslog'],
        'Custom': ['Custom']
    };
    
    for (const [category, tables] of Object.entries(categories)) {
        if (tables.some(t => tableName.startsWith(t))) {
            return category;
        }
    }
    
    return 'Other';
}

// Helper function to get column descriptions
function getColumnDescription(tableName, columnName) {
    const commonColumns = {
        'TimeGenerated': 'Timestamp when the event was generated',
        'Computer': 'Name of the computer/device that generated the event',
        'Account': 'User account associated with the event',
        'EventID': 'Windows event ID',
        'Level': 'Event severity level',
        'SourceSystem': 'System that collected the event',
        '_ResourceId': 'Azure resource ID',
        'Type': 'Table name/type',
        'TenantId': 'Azure AD tenant ID'
    };
    
    return commonColumns[columnName] || '';
}

// Helper function to generate sample queries
function generateSampleQuery(tableName) {
    const samples = {
        'SecurityEvent': `${tableName}\n| where TimeGenerated >= ago(24h)\n| where EventID == 4625\n| summarize FailedLogons = count() by Account, Computer\n| where FailedLogons > 5`,
        'SecurityAlert': `${tableName}\n| where TimeGenerated >= ago(7d)\n| summarize AlertCount = count() by AlertName, AlertSeverity\n| order by AlertCount desc`,
        'SigninLogs': `${tableName}\n| where TimeGenerated >= ago(24h)\n| where ResultType != 0\n| summarize FailedSignins = count() by UserPrincipalName, IPAddress`,
        'AzureActivity': `${tableName}\n| where TimeGenerated >= ago(24h)\n| where CategoryValue == "Administrative"\n| project TimeGenerated, OperationName, Caller, ResourceGroup`,
        'Perf': `${tableName}\n| where TimeGenerated >= ago(1h)\n| where ObjectName == "Processor" and CounterName == "% Processor Time"\n| summarize AvgCPU = avg(CounterValue) by Computer, bin(TimeGenerated, 5m)`
    };
    
    return samples[tableName] || `${tableName}\n| where TimeGenerated >= ago(24h)\n| take 100`;
}

// Helper function to get common tables for environment
function getCommonTables(environment) {
    const tables = [
        { name: 'SecurityEvent', description: 'Windows security events', category: 'Security' },
        { name: 'SecurityAlert', description: 'Security alerts from Microsoft Defender', category: 'Security' },
        { name: 'SecurityIncident', description: 'Security incidents from Sentinel', category: 'Security' },
        { name: 'SigninLogs', description: 'Azure AD sign-in logs', category: 'Identity' },
        { name: 'AuditLogs', description: 'Azure AD audit logs', category: 'Identity' },
        { name: 'AzureActivity', description: 'Azure control plane operations', category: 'Azure' },
        { name: 'AzureDiagnostics', description: 'Azure resource diagnostic logs', category: 'Azure' },
        { name: 'Heartbeat', description: 'Agent heartbeat data', category: 'System' },
        { name: 'Perf', description: 'Performance counter data', category: 'System' },
        { name: 'Event', description: 'Windows event logs', category: 'System' }
    ];
    
    if (environment === 'AzureDoD' || environment === 'AzureUSGovernment') {
        tables.push(
            { name: 'CommonSecurityLog', description: 'CEF logs from security appliances', category: 'Security' },
            { name: 'Syslog', description: 'Linux/Unix syslog events', category: 'System' }
        );
    }
    
    return tables;
}