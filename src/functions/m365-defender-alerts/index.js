const fetch = require('node-fetch');

module.exports = async function (context, req) {
    context.log('M365 Defender alerts function triggered');

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        context.res = {
            status: 401,
            body: { error: 'No authorization token provided' }
        };
        return;
    }

    try {
        // Get query parameters
        const top = req.query.top || 100;
        const incidentId = req.query.incidentId;
        const severity = req.query.severity;
        const category = req.query.category;
        
        // Build filter
        let filters = [];
        if (incidentId) {
            filters.push(`incidentId eq ${incidentId}`);
        }
        if (severity) {
            filters.push(`severity eq '${severity}'`);
        }
        if (category) {
            filters.push(`category eq '${category}'`);
        }
        
        // Construct URL with filters - Using Microsoft Graph API
        let apiUrl = `https://graph.microsoft.com/v1.0/security/alerts_v2?$top=${top}`;
        if (filters.length > 0) {
            apiUrl += `&$filter=${filters.join(' and ')}`;
        }
        
        // Call Microsoft Graph API
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            context.log(`M365 Defender API error: ${response.status} - ${errorText}`);
            
            if (response.status === 401) {
                context.res = {
                    status: 401,
                    body: { 
                        error: 'Authentication failed. Please ensure you have the correct permissions for Microsoft Graph API.',
                        details: 'Required scope: SecurityAlert.Read.All or SecurityAlert.ReadWrite.All'
                    }
                };
                return;
            }
            
            context.res = {
                status: response.status,
                body: { 
                    error: 'Failed to fetch alerts from M365 Defender',
                    details: errorText
                }
            };
            return;
        }

        let data;
        try {
            data = await response.json();
        } catch (jsonError) {
            // If we can't parse the response, return empty results
            context.log('Response was not valid JSON, returning empty results');
            context.res = {
                status: 200,
                body: {
                    alerts: [],
                    totalCount: 0,
                    timestamp: new Date().toISOString(),
                    note: 'No security alerts found in your tenant.'
                }
            };
            return;
        }
        
        // Transform the response to include key fields
        const alerts = data.value?.map(alert => ({
            id: alert.id,
            incidentId: alert.incidentId,
            title: alert.title,
            description: alert.description,
            severity: alert.severity,
            category: alert.category,
            status: alert.status,
            detectionSource: alert.detectionSource,
            serviceSource: alert.serviceSource,
            firstActivity: alert.firstActivity,
            lastActivity: alert.lastActivity,
            alertCreationTime: alert.alertCreationTime,
            resolvedTime: alert.resolvedTime,
            evidence: {
                files: alert.evidence?.filter(e => e.entityType === 'File')?.length || 0,
                processes: alert.evidence?.filter(e => e.entityType === 'Process')?.length || 0,
                users: alert.evidence?.filter(e => e.entityType === 'User')?.length || 0,
                devices: alert.evidence?.filter(e => e.entityType === 'Device')?.length || 0,
                ips: alert.evidence?.filter(e => e.entityType === 'Ip')?.length || 0,
                urls: alert.evidence?.filter(e => e.entityType === 'Url')?.length || 0
            },
            recommendedActions: alert.recommendedActions,
            rbacGroupId: alert.rbacGroupId
        })) || [];

        context.res = {
            status: 200,
            body: {
                alerts: alerts,
                totalCount: alerts.length,
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log(`Error fetching M365 Defender alerts: ${error.message}`);
        context.res = {
            status: 500,
            body: { 
                error: 'Internal server error while fetching alerts',
                details: error.message
            }
        };
    }
};