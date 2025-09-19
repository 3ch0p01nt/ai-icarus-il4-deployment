module.exports = async function (context, req) {
    context.log('M365 Defender KQL function triggered');
    
    // Handle CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: ''
        };
        return;
    }

    const action = req.params.action || 'incidents';
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        context.res = {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { error: 'No authorization token provided' }
        };
        return;
    }

    // Get workspace details from request
    const { workspaceId, timeRange = '7d', severity, status } = req.method === 'GET' ? req.query : req.body;
    
    if (!workspaceId) {
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { error: 'workspaceId is required' }
        };
        return;
    }

    try {
        const { LogsQueryClient } = require('@azure/monitor-query');
        const { ManagedIdentityCredential } = require('@azure/identity');
        
        // Use Managed Identity for authentication
        // This is more reliable than trying to pass user tokens
        const credential = new ManagedIdentityCredential();
        const logsClient = new LogsQueryClient(credential, {
            endpoint: 'https://api.loganalytics.io'
        });

        if (action === 'incidents') {
            // Build KQL query for SecurityIncident table (matching C# implementation)
            let kqlQuery = `
SecurityIncident
| where TimeGenerated >= ago(30d)
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| extend IncidentNumber = tostring(IncidentNumber)
| extend Title = iff(isempty(Title), Description, Title)
| extend Description = tostring(Description)  
| extend Severity = tostring(Severity)
| extend Status = tostring(Status)
| extend Classification = tostring(Classification)
| extend Owner = tostring(Owner)
| extend AlertIdsArray = parse_json(AlertIds)
| extend AlertCount = array_length(AlertIdsArray)
| project 
    IncidentName,
    IncidentNumber,
    Title,
    Description,
    Severity,
    Status,
    Classification,
    Owner,
    AlertIds,
    AlertIdsArray,
    AlertCount,
    FirstActivityTime,
    LastActivityTime,
    CreatedTime,
    LastModifiedTime,
    Comments,
    TimeGenerated
| order by CreatedTime desc
| take 100`;

            // Add filters based on timeRange
            if (timeRange === '24h') {
                kqlQuery = kqlQuery.replace('ago(30d)', 'ago(1d)');
            } else if (timeRange === '7d') {
                kqlQuery = kqlQuery.replace('ago(30d)', 'ago(7d)');
            }

            context.log(`Executing KQL query for incidents on workspace ${workspaceId}`);
            
            const timeInterval = {
                startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                endTime: new Date()
            };

            const queryResult = await logsClient.queryWorkspace(
                workspaceId,
                kqlQuery,
                timeInterval,
                {
                    serverTimeoutInSeconds: 30,
                    includeStatistics: true
                }
            );

            const incidents = [];
            let allAlertIds = [];
            
            if (queryResult.tables && queryResult.tables.length > 0) {
                const table = queryResult.tables[0];
                
                // Map column names to indices
                const columns = {};
                table.columns.forEach((col, index) => {
                    columns[col.name] = index;
                });
                
                // Process each row and collect alert IDs
                for (const row of table.rows) {
                    const incident = {
                        id: row[columns['IncidentName']] || '',
                        incidentNumber: row[columns['IncidentNumber']] || '',
                        title: row[columns['Title']] || 'Untitled Incident',
                        description: row[columns['Description']] || '',
                        severity: row[columns['Severity']] || 'medium',
                        status: row[columns['Status']] || 'active',
                        classification: row[columns['Classification']] || '',
                        owner: row[columns['Owner']] || '',
                        alertIds: row[columns['AlertIds']] || '[]',
                    alertIdsArray: row[columns['AlertIdsArray']] || [],
                    alertCount: row[columns['AlertCount']] || 0,
                        firstActivityTime: row[columns['FirstActivityTime']] || null,
                        lastActivityTime: row[columns['LastActivityTime']] || null,
                        createdTime: row[columns['CreatedTime']] || row[columns['TimeGenerated']],
                        lastModifiedTime: row[columns['LastModifiedTime']] || row[columns['TimeGenerated']],
                        comments: 0,
                        alerts: 0,
                        devices: 0,
                        users: 0,
                        ips: 0,
                        files: 0
                    };
                    
                    // Parse AlertIds to get alert list
                    let incidentAlertIds = [];
                    
                    // Use the pre-parsed AlertIdsArray from KQL if available
                    if (incident.alertIdsArray && Array.isArray(incident.alertIdsArray)) {
                        incidentAlertIds = incident.alertIdsArray;
                        incident.alerts = incident.alertCount || incident.alertIdsArray.length;
                        allAlertIds = allAlertIds.concat(incident.alertIdsArray);
                    } else if (incident.alertIds && incident.alertIds !== '[]') {
                        // Fallback: try to parse the raw AlertIds string
                        try {
                            const alertIdArray = JSON.parse(incident.alertIds);
                            if (Array.isArray(alertIdArray)) {
                                incidentAlertIds = alertIdArray;
                                incident.alerts = alertIdArray.length;
                                allAlertIds = allAlertIds.concat(alertIdArray);
                            }
                        } catch (e) {
                            // If JSON parsing fails, check if it's a comma-separated string
                            if (typeof incident.alertIds === 'string' && incident.alertIds.includes(',')) {
                                incidentAlertIds = incident.alertIds.split(',').map(id => id.trim());
                                incident.alerts = incidentAlertIds.length;
                                allAlertIds = allAlertIds.concat(incidentAlertIds);
                            } else {
                                context.log(`Failed to parse AlertIds for incident ${incident.incidentNumber}: ${e.message}`);
                                incident.alerts = 0;
                            }
                        }
                    } else {
                        incident.alerts = 0;
                    }
                    
                    // Store parsed alert IDs for later correlation
                    incident.parsedAlertIds = incidentAlertIds;
                    incidents.push(incident);
                }
                
                context.log(`Found ${incidents.length} incidents with ${allAlertIds.length} total alerts`);
                
                // Now query SecurityAlert table for entity details if we have alert IDs
                if (allAlertIds.length > 0) {
                    try {
                        // Remove duplicates
                        const uniqueAlertIds = [...new Set(allAlertIds)];
                        context.log(`Querying SecurityAlert table for ${uniqueAlertIds.length} unique alerts`);
                        
                        // Build query for alerts (batch in groups of 50 to avoid query length limits)
                        const batchSize = 50;
                        const alertEntityMap = {};
                        
                        for (let i = 0; i < uniqueAlertIds.length; i += batchSize) {
                            const batch = uniqueAlertIds.slice(i, i + batchSize);
                            const alertFilter = batch.map(id => `SystemAlertId == '${id}'`).join(' or ');
                            
                            const alertQuery = `
SecurityAlert
| where ${alertFilter}
| project 
    SystemAlertId,
    AlertName,
    AlertSeverity,
    Entities
| take 1000`;
                            
                            try {
                                const alertResult = await logsClient.queryWorkspace(
                                    workspaceId,
                                    alertQuery,
                                    timeInterval,
                                    {
                                        serverTimeoutInSeconds: 30
                                    }
                                );
                                
                                if (alertResult.tables && alertResult.tables.length > 0) {
                                    const alertTable = alertResult.tables[0];
                                    const alertColumns = {};
                                    alertTable.columns.forEach((col, index) => {
                                        alertColumns[col.name] = index;
                                    });
                                    
                                    // Process alert entities
                                    for (const alertRow of alertTable.rows) {
                                        const alertId = alertRow[alertColumns['SystemAlertId']];
                                        const entitiesJson = alertRow[alertColumns['Entities']];
                                        
                                        const entityCounts = {
                                            users: 0,
                                            devices: 0,
                                            ips: 0,
                                            files: 0,
                                            total: 0
                                        };
                                        
                                        if (entitiesJson) {
                                            try {
                                                const entities = JSON.parse(entitiesJson);
                                                if (Array.isArray(entities)) {
                                                    for (const entity of entities) {
                                                        const entityType = (entity.Type || '').toLowerCase();
                                                        if (entityType === 'account') {
                                                            entityCounts.users++;
                                                        } else if (entityType === 'host' || entityType === 'machine') {
                                                            entityCounts.devices++;
                                                        } else if (entityType === 'ip' || entityType === 'ipaddress') {
                                                            entityCounts.ips++;
                                                        } else if (entityType === 'file' || entityType === 'filehash') {
                                                            entityCounts.files++;
                                                        }
                                                        entityCounts.total++;
                                                    }
                                                }
                                            } catch (e) {
                                                context.log(`Failed to parse entities for alert ${alertId}: ${e.message}`);
                                            }
                                        }
                                        
                                        alertEntityMap[alertId] = entityCounts;
                                    }
                                }
                            } catch (alertError) {
                                context.log(`Error querying alerts batch ${i/batchSize + 1}: ${alertError.message}`);
                            }
                        }
                        
                        // Now correlate entity counts back to incidents
                        for (const incident of incidents) {
                            let totalUsers = 0;
                            let totalDevices = 0;
                            let totalIps = 0;
                            let totalFiles = 0;
                            
                            for (const alertId of incident.parsedAlertIds) {
                                if (alertEntityMap[alertId]) {
                                    totalUsers += alertEntityMap[alertId].users;
                                    totalDevices += alertEntityMap[alertId].devices;
                                    totalIps += alertEntityMap[alertId].ips;
                                    totalFiles += alertEntityMap[alertId].files;
                                }
                            }
                            
                            incident.users = totalUsers;
                            incident.devices = totalDevices;
                            incident.ips = totalIps;
                            incident.files = totalFiles;
                            
                            // Keep alertIdsArray for the frontend to use
                            // This contains the properly parsed alert IDs
                            incident.alertIdsArray = incident.parsedAlertIds;
                            delete incident.parsedAlertIds;
                        }
                        
                        context.log(`Successfully correlated entities for ${incidents.length} incidents`);
                    } catch (correlationError) {
                        context.log.error(`Error correlating alerts with incidents: ${correlationError.message}`);
                        // Continue with incidents but without entity counts
                    }
                }
            } else {
                context.log('No SecurityIncident data found in the workspace');
            }

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: {
                    incidents: incidents,
                    totalCount: incidents.length,
                    timestamp: new Date().toISOString(),
                    source: 'SecurityIncident table (KQL)',
                    workspaceId: workspaceId
                }
            };
            
        } else if (action === 'alerts') {
            // Query SecurityAlert table for detailed alert information
            const alertIds = req.body?.alertIds || [];
            
            if (alertIds.length === 0) {
                context.res = {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: { alerts: [], totalCount: 0 }
                };
                return;
            }
            
            // Build filter for specific alert IDs
            const alertFilter = alertIds.map(id => `SystemAlertId == '${id}'`).join(' or ');
            const kqlQuery = `
SecurityAlert
| where ${alertFilter}
| project 
    SystemAlertId,
    AlertName,
    AlertSeverity,
    TimeGenerated,
    VendorName,
    ProductName,
    AlertType,
    Entities
| take 100`;

            context.log(`Executing KQL query for alerts on workspace ${workspaceId}`);
            
            const timeInterval = {
                startTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                endTime: new Date()
            };

            const queryResult = await logsClient.queryWorkspace(
                workspaceId,
                kqlQuery,
                timeInterval,
                {
                    serverTimeoutInSeconds: 30
                }
            );

            const alerts = [];
            
            if (queryResult.tables && queryResult.tables.length > 0) {
                const table = queryResult.tables[0];
                
                // Map column names to indices
                const columns = {};
                table.columns.forEach((col, index) => {
                    columns[col.name] = index;
                });
                
                // Process each row
                for (const row of table.rows) {
                    const alert = {
                        id: row[columns['SystemAlertId']] || '',
                        name: row[columns['AlertName']] || '',
                        severity: row[columns['AlertSeverity']] || 'medium',
                        timeGenerated: row[columns['TimeGenerated']] || null,
                        vendor: row[columns['VendorName']] || '',
                        product: row[columns['ProductName']] || '',
                        type: row[columns['AlertType']] || '',
                        entities: []
                    };
                    
                    // Parse entities if available
                    const entitiesJson = row[columns['Entities']];
                    if (entitiesJson) {
                        try {
                            const entities = JSON.parse(entitiesJson);
                            if (Array.isArray(entities)) {
                                alert.entityCount = entities.length;
                                alert.users = entities.filter(e => e.Type === 'account').length;
                                alert.devices = entities.filter(e => e.Type === 'host').length;
                                alert.ips = entities.filter(e => e.Type === 'ip').length;
                            }
                        } catch (e) {
                            context.log(`Failed to parse entities for alert ${alert.id}`);
                        }
                    }
                    
                    alerts.push(alert);
                }
            }

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: {
                    alerts: alerts,
                    totalCount: alerts.length,
                    timestamp: new Date().toISOString()
                }
            };
            
        } else {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: { error: `Unknown action: ${action}` }
            };
        }

    } catch (error) {
        context.log.error(`Error in M365 Defender KQL function: ${error.message}`);
        
        // Check if it's a table not found error
        if (error.message?.includes('SecurityIncident') || error.message?.includes('not found')) {
            context.res = {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: {
                    error: 'SecurityIncident table not found',
                    message: 'This workspace does not have Azure Sentinel enabled or does not contain SecurityIncident data. Please select a Sentinel-enabled workspace.',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        } else {
            context.res = {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                body: {
                    error: 'Internal server error',
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }
};