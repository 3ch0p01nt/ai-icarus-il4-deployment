const { DefaultAzureCredential } = require("@azure/identity");
const { MonitorQueryClient } = require("@azure/monitor-query");

module.exports = async function (context, req) {
    try {
        // Get environment details
        const environment = process.env.AZURE_ENVIRONMENT || 'AzureUSGovernment';
        const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || req.query.subscriptionId || req.body?.subscriptionId;
        const workspaceId = req.query.workspaceId || req.body?.workspaceId;
        const timeRange = req.query.timeRange || req.body?.timeRange || '7d';
        const severityFilter = req.query.severity || req.body?.severity || '';
        
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

        // Build KQL query for M365 Defender incidents
        let kqlQuery = `
            SecurityIncident
            | where TimeGenerated >= ago(${timeRange})
            ${severityFilter ? `| where Severity == "${severityFilter}"` : ''}
            | project 
                IncidentNumber,
                Title,
                Description,
                Severity,
                Status,
                Owner,
                Classification,
                ClassificationComment,
                ProviderName,
                FirstActivityTime,
                LastActivityTime,
                CreatedTime,
                ClosedTime,
                Comments,
                Labels,
                AlertIds,
                RelatedAnalyticRuleIds
            | order by CreatedTime desc
            | take 100
        `;

        // Alternative query if SecurityIncident table is not available
        const alternativeQuery = `
            SecurityAlert
            | where TimeGenerated >= ago(${timeRange})
            ${severityFilter ? `| where AlertSeverity == "${severityFilter}"` : ''}
            | summarize 
                FirstAlert = min(TimeGenerated),
                LastAlert = max(TimeGenerated),
                AlertCount = count(),
                Systems = make_set(CompromisedEntity),
                Tactics = make_set(Tactics),
                Techniques = make_set(Techniques)
                by AlertName, AlertSeverity, ProviderName, VendorName
            | project
                IncidentTitle = AlertName,
                Severity = AlertSeverity,
                Provider = ProviderName,
                Vendor = VendorName,
                FirstAlert,
                LastAlert,
                AlertCount,
                Systems,
                Tactics,
                Techniques
            | order by AlertCount desc
            | take 100
        `;

        try {
            // Try primary query first
            context.log('Executing M365 Defender incidents query...');
            const result = await client.queryWorkspace(workspaceId, kqlQuery, {
                duration: 'PT30M' // 30 minute time span
            });

            // Format the response
            const response = {
                incidents: [],
                summary: {
                    total: 0,
                    bySeverity: {},
                    byStatus: {},
                    byProvider: {}
                }
            };

            if (result.tables && result.tables.length > 0) {
                const table = result.tables[0];
                
                // Process each incident
                table.rows.forEach(row => {
                    const incident = {};
                    table.columns.forEach((col, index) => {
                        incident[col.name] = row[index];
                    });
                    response.incidents.push(incident);

                    // Update summary statistics
                    response.summary.total++;
                    
                    // Count by severity
                    const severity = incident.Severity || 'Unknown';
                    response.summary.bySeverity[severity] = (response.summary.bySeverity[severity] || 0) + 1;
                    
                    // Count by status
                    const status = incident.Status || 'Unknown';
                    response.summary.byStatus[status] = (response.summary.byStatus[status] || 0) + 1;
                    
                    // Count by provider
                    const provider = incident.ProviderName || 'Unknown';
                    response.summary.byProvider[provider] = (response.summary.byProvider[provider] || 0) + 1;
                });
            }

            context.res = {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: response
            };

        } catch (primaryError) {
            context.log('Primary query failed, trying alternative query...');
            
            // Try alternative query if SecurityIncident table doesn't exist
            try {
                const altResult = await client.queryWorkspace(workspaceId, alternativeQuery, {
                    duration: 'PT30M'
                });

                const response = {
                    incidents: [],
                    summary: {
                        total: 0,
                        bySeverity: {},
                        byProvider: {},
                        note: "Using SecurityAlert data as SecurityIncident table is not available"
                    }
                };

                if (altResult.tables && altResult.tables.length > 0) {
                    const table = altResult.tables[0];
                    
                    table.rows.forEach(row => {
                        const alert = {};
                        table.columns.forEach((col, index) => {
                            alert[col.name] = row[index];
                        });
                        response.incidents.push(alert);

                        // Update summary
                        response.summary.total++;
                        
                        const severity = alert.Severity || 'Unknown';
                        response.summary.bySeverity[severity] = (response.summary.bySeverity[severity] || 0) + 1;
                        
                        const provider = alert.Provider || 'Unknown';
                        response.summary.byProvider[provider] = (response.summary.byProvider[provider] || 0) + 1;
                    });
                }

                context.res = {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: response
                };

            } catch (altError) {
                context.log.error('Both queries failed:', altError);
                
                // Return empty results with helpful message
                context.res = {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: {
                        incidents: [],
                        summary: {
                            total: 0,
                            note: "No security incident data available. Ensure Microsoft Defender is configured and sending data to this workspace."
                        },
                        error: "Could not retrieve incident data. This may be because Microsoft Defender is not configured for this workspace."
                    }
                };
            }
        }

    } catch (error) {
        context.log.error('Error in defender-incidents function:', error);
        context.res = {
            status: 500,
            body: { 
                error: "Failed to retrieve M365 Defender incidents",
                details: error.message 
            }
        };
    }
};