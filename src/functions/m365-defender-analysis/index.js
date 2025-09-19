const { ManagedIdentityCredential } = require('@azure/identity');
const { LogsQueryClient } = require('@azure/monitor-query');

module.exports = async function (context, req) {
    context.log('M365 Defender Analysis function triggered');
    context.log('Action:', req.params?.action);
    context.log('Method:', req.method);
    
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

    const action = req.params?.action;
    const { workspaceId, incident, includeAlerts = true, includeEntities = true, includeTimeline = true } = req.body || {};
    
    context.log('Request body received:', { 
        workspaceId, 
        incidentNumber: incident?.incidentNumber,
        hasIncident: !!incident 
    });

    if (!workspaceId || !incident) {
        context.res = {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: { error: 'workspaceId and incident are required' }
        };
        return;
    }

    try {
        const credential = new ManagedIdentityCredential();
        const logsClient = new LogsQueryClient(credential, {
            endpoint: process.env.LogAnalyticsEndpoint || 'https://api.loganalytics.io'
        });

        if (action === 'full-analysis') {
            context.log('Starting full incident analysis');
            
            // Initialize analysis object
            const analysis = {
                incident: incident,
                alerts: [],
                entities: {
                    users: [],
                    devices: [],
                    ips: [],
                    files: [],
                    processes: [],
                    urls: []
                },
                timeline: [],
                statistics: {},
                aiContext: null
            };

            // 1. Fetch detailed alerts if we have alert IDs
            if (includeAlerts && (incident.alertIds || incident.alertIdsArray)) {
                context.log(`Fetching alerts for incident ${incident.incidentNumber}`);
                context.log('Alert data received:', {
                    alertIds: incident.alertIds ? typeof incident.alertIds : 'undefined',
                    alertIdsArray: incident.alertIdsArray ? `Array(${incident.alertIdsArray.length})` : 'undefined',
                    alertCount: incident.alerts
                });
                
                // Parse alert IDs - prioritize pre-parsed array
                let alertIdList = [];
                try {
                    // First check if we have the pre-parsed array from the KQL function
                    if (incident.alertIdsArray && Array.isArray(incident.alertIdsArray)) {
                        alertIdList = incident.alertIdsArray;
                        context.log(`Using pre-parsed alertIdsArray with ${alertIdList.length} alerts`);
                    } else if (incident.alertIds) {
                        // Fallback to parsing the raw alertIds field
                        if (typeof incident.alertIds === 'string') {
                            // Try to parse as JSON array
                            try {
                                const parsed = JSON.parse(incident.alertIds);
                                if (Array.isArray(parsed)) {
                                    alertIdList = parsed;
                                    context.log(`Parsed alertIds as JSON array with ${alertIdList.length} alerts`);
                                }
                            } catch {
                                // If not JSON, treat as comma-separated string
                                if (incident.alertIds && incident.alertIds !== '[]') {
                                    alertIdList = incident.alertIds.split(',').map(id => id.trim()).filter(id => id);
                                    context.log(`Parsed alertIds as comma-separated with ${alertIdList.length} alerts`);
                                }
                            }
                        } else if (Array.isArray(incident.alertIds)) {
                            alertIdList = incident.alertIds;
                            context.log(`alertIds is already an array with ${alertIdList.length} alerts`);
                        }
                    }
                } catch (e) {
                    context.log.warn('Failed to parse alert IDs:', e.message);
                }

                context.log(`Found ${alertIdList.length} alert IDs to query`);

                if (alertIdList.length > 0) {
                    // Query SecurityAlert table for detailed information
                    const alertFilter = alertIdList.map(id => `SystemAlertId == '${id}'`).join(' or ');
                    const alertQuery = `
SecurityAlert
| where ${alertFilter}
| project 
    SystemAlertId,
    AlertName,
    DisplayName,
    Description,
    Severity,
    AlertSeverity,
    TimeGenerated,
    StartTime,
    EndTime,
    VendorName,
    VendorOriginalId,
    ProductName,
    ProductComponentName,
    AlertType,
    Status,
    CompromisedEntity,
    Entities,
    ExtendedProperties,
    Tactics,
    Techniques,
    RemediationSteps,
    ConfidenceLevel,
    ConfidenceScore,
    Intent,
    ProviderAlertId,
    ProcessingEndTime
| order by TimeGenerated desc`;

                    try {
                        context.log('Executing alert query');
                        const alertResult = await logsClient.queryWorkspace(
                            workspaceId,
                            alertQuery,
                            {
                                startTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                                endTime: new Date()
                            },
                            {
                                serverTimeoutInSeconds: 30
                            }
                        );

                        if (alertResult.tables && alertResult.tables.length > 0) {
                            const table = alertResult.tables[0];
                            const columns = {};
                            table.columns.forEach((col, index) => {
                                columns[col.name] = index;
                            });

                            context.log(`Processing ${table.rows.length} alert rows`);

                            for (const row of table.rows) {
                                const alert = {
                                    id: row[columns['SystemAlertId']] || '',
                                    name: row[columns['AlertName']] || row[columns['DisplayName']] || '',
                                    description: row[columns['Description']] || '',
                                    severity: row[columns['Severity']] || row[columns['AlertSeverity']] || 'Medium',
                                    timeGenerated: row[columns['TimeGenerated']] || null,
                                    startTime: row[columns['StartTime']] || null,
                                    endTime: row[columns['EndTime']] || null,
                                    vendor: row[columns['VendorName']] || '',
                                    product: row[columns['ProductName']] || '',
                                    alertType: row[columns['AlertType']] || '',
                                    status: row[columns['Status']] || '',
                                    compromisedEntity: row[columns['CompromisedEntity']] || '',
                                    tactics: row[columns['Tactics']] || '',
                                    techniques: row[columns['Techniques']] || '',
                                    remediationSteps: row[columns['RemediationSteps']] || '',
                                    confidenceLevel: row[columns['ConfidenceLevel']] || '',
                                    confidenceScore: row[columns['ConfidenceScore']] || 0,
                                    entities: [],
                                    extendedProperties: {}
                                };

                                // Parse entities
                                const entitiesJson = row[columns['Entities']];
                                if (entitiesJson) {
                                    try {
                                        const entities = JSON.parse(entitiesJson);
                                        if (Array.isArray(entities)) {
                                            alert.entities = entities;
                                            
                                            // Aggregate entities by type
                                            for (const entity of entities) {
                                                const entityType = (entity.Type || entity['$type'] || '').toLowerCase();
                                                const entityData = {
                                                    name: entity.Name || entity.DisplayName || entity.Address || '',
                                                    type: entity.Type || entity['$type'],
                                                    ...entity
                                                };

                                                if (entityType.includes('account') || entityType.includes('user')) {
                                                    analysis.entities.users.push(entityData);
                                                } else if (entityType.includes('host') || entityType.includes('machine') || entityType.includes('device')) {
                                                    analysis.entities.devices.push(entityData);
                                                } else if (entityType.includes('ip') || entityType.includes('address')) {
                                                    analysis.entities.ips.push(entityData);
                                                } else if (entityType.includes('file') || entityType.includes('hash')) {
                                                    analysis.entities.files.push(entityData);
                                                } else if (entityType.includes('process')) {
                                                    analysis.entities.processes.push(entityData);
                                                } else if (entityType.includes('url') || entityType.includes('dns')) {
                                                    analysis.entities.urls.push(entityData);
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        context.log.warn(`Failed to parse entities for alert ${alert.id}:`, e.message);
                                    }
                                }

                                // Parse extended properties
                                const extPropsJson = row[columns['ExtendedProperties']];
                                if (extPropsJson) {
                                    try {
                                        alert.extendedProperties = JSON.parse(extPropsJson);
                                    } catch (e) {
                                        context.log.warn('Failed to parse extended properties:', e.message);
                                    }
                                }

                                analysis.alerts.push(alert);
                            }
                        }
                    } catch (alertError) {
                        context.log.error('Error fetching alerts:', alertError.message);
                        // Continue without alerts rather than failing completely
                    }
                }
            }

            // 2. Build timeline from alerts
            if (includeTimeline) {
                context.log('Building incident timeline');
                
                const timelineEvents = [];
                
                // Add incident creation
                timelineEvents.push({
                    timestamp: incident.createdTime || incident.firstActivityTime || new Date().toISOString(),
                    type: 'incident_created',
                    title: 'Incident Created',
                    description: `Incident #${incident.incidentNumber} created with severity ${incident.severity}`,
                    severity: incident.severity,
                    source: 'SecurityIncident'
                });

                // Add alert events
                for (const alert of analysis.alerts) {
                    if (alert.timeGenerated) {
                        timelineEvents.push({
                            timestamp: alert.timeGenerated,
                            type: 'alert_triggered',
                            title: alert.name,
                            description: alert.description || `Alert ${alert.name} triggered`,
                            severity: alert.severity,
                            source: alert.product || alert.vendor,
                            alertId: alert.id,
                            tactics: alert.tactics,
                            techniques: alert.techniques
                        });
                    }
                }

                // Add last activity if different from creation
                if (incident.lastActivityTime && incident.lastActivityTime !== incident.createdTime) {
                    timelineEvents.push({
                        timestamp: incident.lastActivityTime,
                        type: 'activity_detected',
                        title: 'Last Activity',
                        description: 'Most recent activity detected for this incident',
                        severity: 'Info',
                        source: 'SecurityIncident'
                    });
                }

                // Sort timeline by timestamp
                analysis.timeline = timelineEvents.sort((a, b) => 
                    new Date(a.timestamp) - new Date(b.timestamp)
                );
            }

            // 3. Deduplicate entities
            analysis.entities.users = deduplicateEntities(analysis.entities.users, 'name');
            analysis.entities.devices = deduplicateEntities(analysis.entities.devices, 'name');
            analysis.entities.ips = deduplicateEntities(analysis.entities.ips, 'name');
            analysis.entities.files = deduplicateEntities(analysis.entities.files, 'name');
            analysis.entities.processes = deduplicateEntities(analysis.entities.processes, 'name');
            analysis.entities.urls = deduplicateEntities(analysis.entities.urls, 'name');

            // 4. Calculate statistics
            analysis.statistics = {
                totalAlerts: analysis.alerts.length,
                severityBreakdown: {
                    critical: analysis.alerts.filter(a => (a.severity || '').toLowerCase() === 'critical').length,
                    high: analysis.alerts.filter(a => (a.severity || '').toLowerCase() === 'high').length,
                    medium: analysis.alerts.filter(a => (a.severity || '').toLowerCase() === 'medium').length,
                    low: analysis.alerts.filter(a => (a.severity || '').toLowerCase() === 'low').length,
                    informational: analysis.alerts.filter(a => (a.severity || '').toLowerCase() === 'informational').length
                },
                uniqueUsers: analysis.entities.users.length,
                uniqueDevices: analysis.entities.devices.length,
                uniqueIPs: analysis.entities.ips.length,
                uniqueFiles: analysis.entities.files.length,
                timeSpan: analysis.timeline.length > 1 ? {
                    start: analysis.timeline[0].timestamp,
                    end: analysis.timeline[analysis.timeline.length - 1].timestamp,
                    durationHours: Math.round((new Date(analysis.timeline[analysis.timeline.length - 1].timestamp) - 
                                               new Date(analysis.timeline[0].timestamp)) / (1000 * 60 * 60))
                } : null
            };

            // 5. Prepare AI context
            analysis.aiContext = {
                incident: {
                    title: incident.title,
                    number: incident.incidentNumber,
                    severity: incident.severity,
                    status: incident.status,
                    classification: incident.classification
                },
                alertCount: analysis.alerts.length,
                alertSummary: analysis.alerts.slice(0, 5).map(a => ({
                    name: a.name,
                    severity: a.severity,
                    tactics: a.tactics,
                    techniques: a.techniques
                })),
                entities: {
                    users: analysis.entities.users.length,
                    devices: analysis.entities.devices.length,
                    ips: analysis.entities.ips.length
                },
                topEntities: {
                    users: analysis.entities.users.slice(0, 5).map(u => u.name),
                    devices: analysis.entities.devices.slice(0, 5).map(d => d.name),
                    ips: analysis.entities.ips.slice(0, 5).map(ip => ip.name || ip.Address)
                },
                timelineLength: analysis.timeline.length,
                duration: analysis.statistics.timeSpan
            };

            context.log(`Analysis complete: ${analysis.alerts.length} alerts, ${analysis.timeline.length} timeline events`);

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: analysis
            };

        } else if (action === 'ai-prompt') {
            // Generate AI analysis prompt
            const { analysisType = 'executive' } = req.body;
            
            const prompts = {
                executive: {
                    system: `You are a senior security analyst providing an executive summary of security incidents. 
Focus on business impact, risk assessment, and high-level required actions. 
Keep the summary concise and suitable for non-technical leadership.
Format your response with clear sections and bullet points.`,
                    user: generateExecutivePrompt(incident)
                },
                technical: {
                    system: `You are a security expert providing deep technical analysis of security incidents.
Focus on attack vectors, techniques used, indicators of compromise, and technical details.
Map findings to MITRE ATT&CK framework where applicable.
Provide specific technical recommendations.`,
                    user: generateTechnicalPrompt(incident)
                },
                business: {
                    system: `You are a risk analyst assessing the business impact of security incidents.
Focus on potential financial impact, compliance implications, operational disruptions, and reputational risk.
Provide risk ratings and business-oriented recommendations.`,
                    user: generateBusinessPrompt(incident)
                },
                recommendations: {
                    system: `You are an incident response specialist providing actionable recommendations.
Focus on immediate containment actions, investigation steps, remediation requirements, and prevention measures.
Include specific KQL queries for further investigation where applicable.
Structure recommendations by priority and timeline.`,
                    user: generateRecommendationsPrompt(incident)
                }
            };

            const selectedPrompt = prompts[analysisType] || prompts.executive;

            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: {
                    systemPrompt: selectedPrompt.system,
                    userPrompt: selectedPrompt.user,
                    analysisType: analysisType
                }
            };

        } else {
            context.res = {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: { error: `Unknown action: ${action}` }
            };
        }

    } catch (error) {
        context.log.error('Error in M365 Defender Analysis:', error);
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: {
                error: 'Analysis failed',
                message: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        };
    }
};

// Helper function to deduplicate entities
function deduplicateEntities(entities, keyField) {
    const seen = new Set();
    return entities.filter(entity => {
        const key = entity[keyField] || JSON.stringify(entity);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// Prompt generation functions
function generateExecutivePrompt(incident) {
    return `Analyze this security incident and provide an executive summary:

INCIDENT DETAILS:
- Title: ${incident.title}
- Incident Number: ${incident.incidentNumber}
- Severity: ${incident.severity}
- Status: ${incident.status}
- Classification: ${incident.classification || 'Under Investigation'}
- Created: ${incident.createdTime}
- Alerts: ${incident.alerts || 0}
- Affected Users: ${incident.users || 0}
- Affected Devices: ${incident.devices || 0}

Provide:
1. Executive Summary (2-3 sentences)
2. Business Impact Assessment
3. Risk Level (Critical/High/Medium/Low) with justification
4. Recommended Executive Actions (3-5 bullet points)
5. Key Metrics and Timeline`;
}

function generateTechnicalPrompt(incident) {
    return `Perform technical analysis of this security incident:

INCIDENT: ${incident.title}
Severity: ${incident.severity}
Alert Count: ${incident.alerts || 0}

TECHNICAL CONTEXT:
${incident.description || 'No description available'}

Analyze and provide:
1. Attack Vector Analysis
2. MITRE ATT&CK Tactics and Techniques
3. Indicators of Compromise (IoCs)
4. Attack Timeline and Progression
5. Detection Gaps and Improvements
6. Technical Containment Actions`;
}

function generateBusinessPrompt(incident) {
    return `Assess the business impact of this security incident:

INCIDENT: ${incident.title}
Severity: ${incident.severity}
Classification: ${incident.classification || 'Under Investigation'}
Affected Systems: Users: ${incident.users || 0}, Devices: ${incident.devices || 0}

Provide assessment of:
1. Potential Financial Impact (data breach costs, downtime, recovery)
2. Compliance and Regulatory Implications
3. Operational Disruption Assessment
4. Reputational Risk Analysis
5. Customer/Partner Impact
6. Business Continuity Recommendations`;
}

function generateRecommendationsPrompt(incident) {
    return `Provide actionable recommendations for this security incident:

INCIDENT: ${incident.title} (#${incident.incidentNumber})
Severity: ${incident.severity}
Status: ${incident.status}
Alerts: ${incident.alerts || 0}

Generate comprehensive recommendations:

1. IMMEDIATE ACTIONS (within 1 hour):
   - Containment steps
   - Evidence preservation
   - Critical notifications

2. SHORT-TERM ACTIONS (within 24 hours):
   - Investigation queries (provide specific KQL)
   - System isolation requirements
   - Password reset scope

3. MEDIUM-TERM ACTIONS (within 1 week):
   - Remediation requirements
   - Security control improvements
   - Monitoring enhancements

4. LONG-TERM ACTIONS (within 1 month):
   - Process improvements
   - Training requirements
   - Policy updates

Include specific KQL queries for investigation where applicable.`;
}