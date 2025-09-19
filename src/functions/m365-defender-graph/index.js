const https = require('https');
const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');

module.exports = async function (context, req) {
    context.log('M365 Defender Graph API function triggered');
    
    // Handle CORS
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    // Check for action in both params (URL) and body (POST)
    const action = req.params.action || req.body?.action || 'incidents';
    context.log(`Action requested: ${action}`);
    context.log(`Request body:`, JSON.stringify(req.body));
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        context.res = {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: { error: 'No authorization token provided' }
        };
        return;
    }

    try {
        if (action === 'incidents') {
            // Fetch incidents with expanded alerts using Microsoft Graph API
            // Note: Microsoft Graph limits $top to 50 when expanding alerts
            const { top = 50, filter, orderby = 'createdDateTime desc' } = req.query || {};
            
            // Build query parameters
            const queryParams = new URLSearchParams();
            queryParams.append('$expand', 'alerts');
            queryParams.append('$top', Math.min(top, 50)); // Enforce max 50 limit
            queryParams.append('$orderby', orderby);
            
            if (filter) {
                queryParams.append('$filter', filter);
            }
            
            context.log(`Fetching incidents from Microsoft Graph with params: ${queryParams.toString()}`);
            
            const incidents = await fetchFromGraph(
                `/security/incidents?${queryParams.toString()}`,
                token,
                context
            );
            
            // Transform Graph API response to match our frontend expectations
            const transformedIncidents = transformIncidents(incidents.value || [], context);
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: {
                    incidents: transformedIncidents,
                    totalCount: transformedIncidents.length,
                    timestamp: new Date().toISOString(),
                    source: 'Microsoft Graph API',
                    dataSource: 'graph'
                }
            };
            
        } else if (action === 'incident-details') {
            // Get detailed incident with all evidence
            const { incidentId } = req.body || {};
            
            if (!incidentId) {
                context.res = {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders
                    },
                    body: { error: 'incidentId is required' }
                };
                return;
            }
            
            context.log(`Fetching incident details for: ${incidentId}`);
            
            // Remove all demo handling - always fetch real data from Graph API
            
            // Fetch incident with expanded alerts
            const incident = await fetchFromGraph(
                `/security/incidents/${incidentId}?$expand=alerts`,
                token,
                context
            );
            
            // Process and extract detailed evidence from alerts
            const analysis = processIncidentWithEvidence(incident, context);
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: analysis
            };
            
        } else if (action === 'alerts') {
            // Get alerts with evidence
            const { top = 50, filter } = req.query || {};
            
            const queryParams = new URLSearchParams();
            queryParams.append('$top', Math.min(top, 100)); // Alerts endpoint allows up to 100
            
            if (filter) {
                queryParams.append('$filter', filter);
            }
            
            const alerts = await fetchFromGraph(
                `/security/alerts_v2?${queryParams.toString()}`,
                token,
                context
            );
            
            context.res = {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                },
                body: {
                    alerts: alerts.value || [],
                    totalCount: alerts.value?.length || 0,
                    timestamp: new Date().toISOString()
                }
            };
            
        } else if (action === 'ai-analysis') {
            // Generate AI analysis for an incident
            const { incidentId, resourceName, deploymentName, incidentData } = req.body || {};
            
            if (!incidentId) {
                context.res = {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders
                    },
                    body: { error: 'Incident ID is required for AI analysis' }
                };
                return;
            }
            
            context.log(`Generating AI analysis for incident ${incidentId} with model ${deploymentName || 'default'}`);
            
            let processedData;
            
            // Use provided incident data if available (already fetched from frontend)
            if (incidentData) {
                processedData = incidentData;
            } else {
                // Fetch the incident details with expanded alerts
                const incident = await fetchFromGraph(
                    `/security/incidents/${incidentId}?$expand=alerts`,
                    token,
                    context
                );
                
                // Process incident to extract all evidence
                processedData = processIncidentWithEvidence(incident, context);
            }
            
            // If OpenAI parameters are provided, use real AI analysis
            if (resourceName && deploymentName) {
                try {
                    // Call Azure OpenAI for real AI analysis
                    const aiAnalysis = await generateRealAIAnalysis(
                        processedData, 
                        resourceName, 
                        deploymentName, 
                        token,
                        context
                    );
                    
                    context.res = {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            ...corsHeaders
                        },
                        body: aiAnalysis
                    };
                } catch (error) {
                    context.log.error('Error generating real AI analysis:', error);
                    // Fall back to mock analysis if real AI fails
                    const fallbackAnalysis = generateAIAnalysis(processedData, context);
                    context.res = {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            ...corsHeaders
                        },
                        body: {
                            ...fallbackAnalysis,
                            note: 'Using fallback analysis due to AI service error'
                        }
                    };
                }
            } else {
                // Use mock analysis if no OpenAI parameters provided
                const analysis = generateAIAnalysis(processedData, context);
                
                context.res = {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders
                    },
                    body: analysis
                };
            }
            
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
        context.log.error(`Error in M365 Defender Graph function: ${error.message}`);
        
        // Provide more detailed error information
        let errorResponse = {
            error: 'Failed to fetch from Microsoft Graph',
            message: error.message,
            timestamp: new Date().toISOString()
        };
        
        // Check for specific error types
        if (error.message?.includes('401')) {
            errorResponse.details = 'Authentication failed. The token may not have the required permissions.';
            errorResponse.requiredScopes = 'SecurityEvents.Read.All or SecurityEvents.ReadWrite.All';
        } else if (error.message?.includes('403')) {
            errorResponse.details = 'Access forbidden. This may require Microsoft 365 E5 or Microsoft Defender for Endpoint P2 license.';
            errorResponse.suggestion = 'Try switching to Azure Sentinel data source if available.';
        } else if (error.message?.includes('400')) {
            errorResponse.details = 'Bad request. The query parameters may be invalid.';
        }
        
        context.res = {
            status: error.statusCode || 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: errorResponse
        };
    }
};

// Helper function to call Microsoft Graph API
async function fetchFromGraph(endpoint, token, context) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'graph.microsoft.com',
            path: `/v1.0${endpoint}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 second timeout
        };
        
        context.log(`Calling Graph API: ${options.path}`);
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const result = JSON.parse(data);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`Failed to parse Graph API response: ${e.message}`));
                    }
                } else {
                    const error = new Error(`Graph API returned ${res.statusCode}: ${data}`);
                    error.statusCode = res.statusCode;
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            context.log(`Graph API request error: ${error.message}`);
            reject(error);
        });
        
        req.on('timeout', () => {
            context.log(`Graph API request timed out after 10 seconds`);
            req.destroy();
            reject(new Error('Graph API request timed out'));
        });
        
        req.setTimeout(10000); // Set the timeout
        req.end();
    });
}

// Transform Graph API incidents to match our format
function transformIncidents(graphIncidents, context) {
    // Filter out collapsed/redirected incidents
    const originalCount = graphIncidents.length;
    const activeIncidents = graphIncidents.filter(incident => {
        // Keep only incidents that haven't been redirected/collapsed into another incident
        if (incident.redirectIncidentId) {
            context.log(`Filtering out collapsed incident ${incident.id} (redirected to ${incident.redirectIncidentId})`);
            return false;
        }
        return true;
    });
    
    const filteredCount = originalCount - activeIncidents.length;
    if (filteredCount > 0) {
        context.log(`Filtered out ${filteredCount} collapsed incidents from ${originalCount} total`);
    }
    
    return activeIncidents.map(incident => {
        // Extract alert IDs from the expanded alerts
        const alertIds = incident.alerts?.map(alert => alert.id || alert.providerAlertId) || [];
        
        // Extract incident number from the ID (Graph API uses numeric ID as the primary identifier)
        // The ID field contains the incident number, while incidentId would be the GUID if available
        const incidentNumber = parseInt(incident.id) || incident.id;
        
        context.log(`Incident ${incident.id} (${incident.incidentId || 'no GUID'}) has ${alertIds.length} alerts`);
        
        return {
            id: incident.incidentId || incident.id, // Use GUID if available, otherwise use numeric ID
            incidentId: incident.incidentId || incident.id, // Explicit incident ID field
            incidentNumber: incidentNumber, // Numeric incident number
            title: incident.displayName || incident.title || 'Untitled Incident',
            description: incident.description || incident.summary || '',
            severity: (incident.severity || 'medium').toLowerCase(),
            status: (incident.status || 'active').toLowerCase(),
            classification: incident.classification || 'Unknown', // Proper case for classification
            determination: incident.determination || 'Unknown', // Proper case for determination
            owner: incident.assignedTo || '',
            createdTime: incident.createdDateTime,
            lastActivityTime: incident.lastUpdateDateTime || incident.lastModifiedDateTime,
            firstActivityTime: incident.firstActivityTime || incident.createdDateTime,
            
            // Store both raw and array format for compatibility
            alertIds: JSON.stringify(alertIds),
            alertIdsArray: alertIds,
            alerts: alertIds.length,
            
            // Count entities from alerts if available
            users: countEntitiesFromAlerts(incident.alerts, 'user'),
            devices: countEntitiesFromAlerts(incident.alerts, 'device'),
            ips: countEntitiesFromAlerts(incident.alerts, 'ip'),
            files: countEntitiesFromAlerts(incident.alerts, 'file'),
            
            // Additional Graph-specific fields
            incidentWebUrl: incident.incidentWebUrl,
            redirectIncidentId: incident.redirectIncidentId, // Will be null for active incidents
            tenantId: incident.tenantId,
            tags: incident.tags || [],
            systemTags: incident.systemTags || [],
            comments: incident.comments || [],
            
            // Store the full alerts array for detailed processing
            _graphAlerts: incident.alerts
        };
    });
}

// Count entities from alerts
function countEntitiesFromAlerts(alerts, entityType) {
    if (!alerts || !Array.isArray(alerts)) return 0;
    
    let count = 0;
    for (const alert of alerts) {
        if (alert.evidence && Array.isArray(alert.evidence)) {
            for (const evidence of alert.evidence) {
                const evidenceType = evidence['@odata.type'] || '';
                
                if (entityType === 'user' && evidenceType.includes('userEvidence')) count++;
                else if (entityType === 'device' && evidenceType.includes('deviceEvidence')) count++;
                else if (entityType === 'ip' && evidenceType.includes('ipEvidence')) count++;
                else if (entityType === 'file' && evidenceType.includes('fileEvidence')) count++;
            }
        }
    }
    
    return count;
}

// Process incident with detailed evidence extraction
function processIncidentWithEvidence(incident, context) {
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 5000; // 5 second max
    
    const alerts = incident.alerts || [];
    
    context.log(`Processing incident ${incident.id} with ${alerts.length} alerts`);
    
    // Extract all entities from alert evidence
    const entities = {
        users: [],
        devices: [],
        ips: [],
        files: [],
        processes: [],
        urls: [],
        mailboxes: []
    };
    
    // Build timeline from alerts with storytelling
    const timeline = [];
    
    // Add incident creation event
    if (incident.createdDateTime) {
        timeline.push({
            timestamp: incident.createdDateTime,
            type: 'incident_created',
            title: '🚨 Security Incident Detected',
            description: `A new security incident "${incident.displayName || 'Untitled'}" was created with ${incident.severity} severity.`,
            severity: incident.severity,
            icon: '🚨'
        });
    }
    
    // Process each alert with narrative context
    for (const alert of alerts) {
        // Check for timeout
        if (Date.now() - startTime > MAX_PROCESSING_TIME) {
            context.log('Processing timeout reached, returning partial results');
            break;
        }
        
        // Determine the attack stage based on alert properties
        let attackStage = 'Detection';
        let icon = '🔍';
        let narrative = '';
        
        // Check MITRE tactics to determine attack stage
        const tactics = alert.mitreTechniques || [];
        if (tactics.some(t => t.includes('InitialAccess') || t.includes('Execution'))) {
            attackStage = 'Initial Compromise';
            icon = '🎯';
            narrative = 'Attacker gained initial foothold in the environment. ';
        } else if (tactics.some(t => t.includes('Persistence') || t.includes('PrivilegeEscalation'))) {
            attackStage = 'Establishing Persistence';
            icon = '🔓';
            narrative = 'Attacker is attempting to maintain access and elevate privileges. ';
        } else if (tactics.some(t => t.includes('Discovery') || t.includes('Collection'))) {
            attackStage = 'Reconnaissance & Collection';
            icon = '🔎';
            narrative = 'Attacker is exploring the environment and gathering information. ';
        } else if (tactics.some(t => t.includes('Exfiltration') || t.includes('Impact'))) {
            attackStage = 'Data Exfiltration/Impact';
            icon = '⚠️';
            narrative = 'Critical stage - Attacker is attempting to steal data or cause damage. ';
        }
        
        // Collect entities for this alert
        const alertEntities = {
            users: [],
            hosts: [],
            ips: [],
            files: [],
            processes: [],
            urls: [],
            mailboxes: [],
            cloudApplications: []
        };
        
        // Extract evidence
        if (alert.evidence && Array.isArray(alert.evidence)) {
            for (const evidence of alert.evidence) {
                // Skip if timeout
                if (Date.now() - startTime > MAX_PROCESSING_TIME) {
                    break;
                }
                
                const evidenceType = evidence['@odata.type'] || '';
                
                if (evidenceType.includes('userEvidence')) {
                    const userEntity = {
                        accountName: evidence.userAccount?.accountName,
                        domainName: evidence.userAccount?.domainName,
                        userPrincipalName: evidence.userAccount?.userPrincipalName,
                        azureAdUserId: evidence.userAccount?.azureAdUserId,
                        roles: evidence.roles || [],
                        verdict: evidence.verdict
                    };
                    entities.users.push(userEntity);
                    alertEntities.users.push(userEntity);
                } else if (evidenceType.includes('deviceEvidence')) {
                    const deviceEntity = {
                        deviceName: evidence.deviceDnsName || evidence.hostName,
                        hostName: evidence.deviceDnsName || evidence.hostName,
                        deviceId: evidence.mdeDeviceId,
                        azureAdDeviceId: evidence.azureAdDeviceId,
                        osPlatform: evidence.osPlatform,
                        riskScore: evidence.riskScore,
                        healthStatus: evidence.healthStatus,
                        ipAddresses: evidence.ipInterfaces || [],
                        roles: evidence.roles || [],
                        verdict: evidence.verdict
                    };
                    entities.devices.push(deviceEntity);
                    alertEntities.hosts.push(deviceEntity);
                } else if (evidenceType.includes('fileEvidence')) {
                    const fileEntity = {
                        fileName: evidence.fileDetails?.fileName,
                        sha1: evidence.fileDetails?.sha1,
                        sha256: evidence.fileDetails?.sha256,
                        filePath: evidence.fileDetails?.filePath,
                        fileSize: evidence.fileDetails?.fileSize,
                        roles: evidence.roles || [],
                        verdict: evidence.verdict
                    };
                    entities.files.push(fileEntity);
                    alertEntities.files.push(fileEntity);
                } else if (evidenceType.includes('processEvidence')) {
                    const processEntity = {
                        processId: evidence.processId,
                        commandLine: evidence.processCommandLine,
                        processCommandLine: evidence.processCommandLine,
                        fileName: evidence.imageFile?.fileName,
                        filePath: evidence.imageFile?.filePath,
                        parentProcessId: evidence.parentProcessId,
                        creationTime: evidence.processCreationDateTime,
                        verdict: evidence.verdict
                    };
                    entities.processes.push(processEntity);
                    alertEntities.processes.push(processEntity);
                } else if (evidenceType.includes('ipEvidence') || evidenceType.includes('ipAddress')) {
                    // Handle different IP evidence structures from Graph API
                    const ip = evidence.ipAddress || evidence.address || evidence.ip || evidence.value;
                    if (ip && ip !== 'Unknown') {
                        const ipEntity = {
                            name: ip, // Add name field for frontend compatibility
                            ipAddress: ip,
                            address: ip, // Alternative field name
                            countryCode: evidence.countryCode || evidence.location?.countryCode,
                            roles: evidence.roles || [],
                            verdict: evidence.verdict,
                            // Add to timeline if this is a significant IP
                            timestamp: evidence.firstSeenDateTime || evidence.createdDateTime
                        };
                        entities.ips.push(ipEntity);
                        alertEntities.ips.push(ipEntity);
                        
                        // Add IP activity to timeline if it's significant
                        if (evidence.verdict === 'malicious' || evidence.roles?.includes('attacker')) {
                            timeline.push({
                                timestamp: evidence.firstSeenDateTime || alert.createdDateTime,
                                type: 'network_activity',
                                title: `🌐 Suspicious IP Activity: ${ip}`,
                                description: `Malicious IP address ${ip} ${evidence.countryCode ? `from ${evidence.countryCode}` : ''} was detected. ${evidence.verdict ? `Verdict: ${evidence.verdict}` : ''}`,
                                severity: 'medium',
                                icon: '🌐'
                            });
                        }
                    }
                } else if (evidenceType.includes('urlEvidence')) {
                    const urlEntity = {
                        url: evidence.url,
                        roles: evidence.roles || [],
                        verdict: evidence.verdict
                    };
                    entities.urls.push(urlEntity);
                    alertEntities.urls.push(urlEntity);
                } else if (evidenceType.includes('mailboxEvidence')) {
                    const mailboxEntity = {
                        mailboxPrimaryAddress: evidence.primaryAddress || evidence.mailboxAddress,
                        displayName: evidence.displayName,
                        verdict: evidence.verdict
                    };
                    entities.mailboxes.push(mailboxEntity);
                    alertEntities.mailboxes.push(mailboxEntity);
                }
            }
        }
        
        // Build rich contextual data for this alert
        const contextData = {
            // User context
            users: alertEntities.users.map(user => ({
                ...user,
                department: user.department || 'Unknown Department',
                jobTitle: user.jobTitle || 'Unknown Role',
                officeLocation: user.officeLocation || 'Unknown Location',
                manager: user.manager || 'No Manager Data',
                riskScore: user.riskScore || 'N/A',
                lastSignIn: user.lastSignIn || 'Unknown',
                mfaEnabled: user.mfaEnabled !== undefined ? user.mfaEnabled : 'Unknown'
            })),
            
            // Device context  
            devices: alertEntities.hosts.map(device => ({
                ...device,
                osVersion: device.osVersion || 'Unknown Version',
                complianceState: device.complianceState || 'Unknown',
                lastSeen: device.lastSeen || 'Unknown',
                riskScore: device.riskScore || 'Unknown',
                defenderStatus: device.healthStatus || 'Unknown',
                loggedOnUsers: device.loggedOnUsers || [],
                networkInterfaces: device.ipAddresses || []
            })),
            
            // Process context
            processes: alertEntities.processes.map(proc => ({
                ...proc,
                parentProcess: proc.parentProcessName || 'Unknown Parent',
                parentCommandLine: proc.parentCommandLine || 'N/A',
                integrityLevel: proc.integrityLevel || 'Unknown',
                userName: proc.userName || 'Unknown User',
                sessionId: proc.sessionId || 'Unknown'
            })),
            
            // Network context
            network: alertEntities.ips.map(ip => ({
                ...ip,
                geoLocation: ip.countryCode ? {
                    country: ip.countryCode,
                    city: ip.city || 'Unknown City',
                    latitude: ip.latitude || null,
                    longitude: ip.longitude || null
                } : null,
                isp: ip.isp || 'Unknown ISP',
                asn: ip.asn || 'Unknown ASN',
                reputation: ip.verdict === 'malicious' ? 'Malicious' : ip.verdict === 'suspicious' ? 'Suspicious' : 'Clean',
                firstSeen: ip.firstSeenDateTime || null,
                lastSeen: ip.lastSeenDateTime || null,
                relatedAlerts: ip.relatedAlerts || []
            })),
            
            // File context
            files: alertEntities.files.map(file => ({
                ...file,
                fileType: file.fileType || 'Unknown Type',
                signer: file.signer || 'Not Signed',
                signerHash: file.signerHash || null,
                prevalence: file.prevalence || 'Unknown',
                globalPrevalence: file.globalPrevalence || 'Unknown',
                firstSeen: file.firstSeenDateTime || null,
                threatName: file.threatName || null
            })),
            
            // URL context
            urls: alertEntities.urls.map(url => ({
                ...url,
                domain: url.domain || new URL(url.url || '').hostname,
                reputation: url.verdict === 'malicious' ? 'Malicious' : 'Unknown',
                category: url.category || 'Uncategorized',
                clickTime: url.clickDateTime || null,
                referrer: url.referrer || null
            }))
        };
        
        // Add alert to timeline with rich context
        timeline.push({
            timestamp: alert.createdDateTime,
            type: 'alert',
            title: alert.title,
            description: `${narrative}${alert.description || ''}`,
            severity: alert.severity,
            id: alert.id,
            alertId: alert.id,
            webUrl: alert.alertWebUrl,
            vendor: alert.vendorInformation?.vendor || 'Unknown',
            mitreTechniques: tactics,
            attackStage: attackStage,
            entities: alertEntities,
            context: contextData,
            category: alert.category || '',
            // Add correlation data
            correlations: {
                relatedAlerts: alert.relatedAlerts || [],
                relatedIncidents: alert.relatedIncidents || [],
                threatIntelMatches: alert.threatIntelMatches || []
            },
            // Add recommended actions
            recommendedActions: alert.recommendedActions || [],
            // Add detection details
            detection: {
                detectionSource: alert.detectionSource || 'Unknown',
                serviceSource: alert.serviceSource || 'Unknown',
                providerAlertId: alert.providerAlertId || null,
                techniques: alert.mitreTechniques || []
            }
        });
    }
    
    // Sort timeline by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Calculate statistics
    const statistics = {
        totalAlerts: alerts.length,
        criticalAlerts: alerts.filter(a => a.severity === 'high').length,
        uniqueDevices: new Set(entities.devices.map(d => d.deviceId)).size,
        uniqueUsers: new Set(entities.users.map(u => u.userPrincipalName)).size,
        uniqueIPs: new Set(entities.ips.map(ip => ip.ipAddress)).size,
        mitreTechniques: [...new Set(alerts.flatMap(a => a.mitreTechniques || []))],
        affectedAssets: {
            users: entities.users.length,
            devices: entities.devices.length,
            files: entities.files.length,
            ips: entities.ips.length
        }
    };
    
    // Build AI context
    const aiContext = {
        summary: `Incident "${incident.displayName}" with ${alerts.length} alerts affecting ${statistics.uniqueDevices} devices and ${statistics.uniqueUsers} users.`,
        severity: incident.severity,
        classification: incident.classification,
        determination: incident.determination,
        mitreTechniques: statistics.mitreTechniques,
        recommendations: alerts.map(a => a.recommendedActions).filter(r => r).join('\n\n'),
        entities: entities,
        timeline: timeline
    };
    
    return {
        incident: {
            ...incident,
            alertIdsArray: alerts.map(a => a.id)
        },
        alerts: alerts,
        entities: entities,
        timeline: timeline,
        statistics: statistics,
        aiContext: aiContext,
        source: 'Microsoft Graph API'
    };
}

// Generate AI analysis for incident
function generateAIAnalysis(processedData, context) {
    // Extract the incident and enriched data
    const incident = processedData.incident || processedData;
    const alerts = processedData.alerts || [];
    const entities = processedData.entities || {};
    const timeline = processedData.timeline || [];
    const statistics = processedData.statistics || {};
    
    context.log('Generating AI analysis for incident:', incident.id);
    context.log('Data available - Alerts:', alerts.length, 'Timeline events:', timeline.length);
    
    // Extract key data points from the enriched data
    const severity = incident.severity || 'unknown';
    const status = incident.status || 'unknown';
    const classification = incident.classification || 'unknown';
    const determination = incident.determination || 'unknown';
    const alertCount = alerts.length || statistics.totalAlerts || incident.alertsCount || 0;
    
    // Count actual entities from the processed data
    const impactedEntities = [
        ...(entities.users || []),
        ...(entities.devices || []),
        ...(entities.ips || []),
        ...(entities.files || []),
        ...(entities.processes || []),
        ...(entities.urls || [])
    ];
    
    // Build executive summary with real data
    const userCount = entities.users?.length || 0;
    const deviceCount = entities.devices?.length || 0;
    const ipCount = entities.ips?.length || 0;
    
    const executiveSummary = {
        title: 'Executive Summary',
        content: `This ${severity} severity incident "${incident.displayName || incident.title}" (ID: ${incident.id}) involves ${alertCount} security alerts. The incident is currently ${status} with a classification of ${classification}. ${userCount} users, ${deviceCount} devices, and ${ipCount} IP addresses have been identified as potentially impacted. ${timeline.length} events have been recorded in the attack timeline. The incident appears to be ${determination === 'maliciousActivity' ? 'confirmed malicious activity requiring immediate attention' : determination === 'benignPositive' ? 'a benign positive that can be safely closed' : 'under investigation for determination'}.`,
        businessImpact: generateBusinessImpact({...incident, alertCount, userCount, deviceCount}),
        riskLevel: calculateRiskLevel(severity, alertCount, impactedEntities.length, {...incident, alerts, entities})
    };
    
    // Build technical analysis with real data
    // Generate the narrative timeline with proper storytelling
    const narrativeEvents = createNarrativeTimeline(timeline, alerts);
    
    const technicalAnalysis = {
        title: 'Technical Analysis',
        attackChain: reconstructAttackChain({...incident, alerts, timeline}),
        indicators: extractIndicators({...incident, entities, alerts}),
        timeline: generateTimelineAnalysis({...incident, timeline}),
        narrativeTimeline: narrativeEvents,
        timelineStory: generateTimelineStory(narrativeEvents, incident),
        tactics: extractMitreTactics({...incident, alerts, statistics})
    };
    
    // Build threat intelligence
    const threatIntelligence = {
        title: 'Threat Intelligence',
        threatActors: identifyPotentialThreatActors(incident),
        knownPatterns: matchKnownPatterns(incident),
        relatedIncidents: `Based on the incident patterns, this may be related to ${determination === 'maliciousActivity' ? 'ongoing threat campaigns' : 'routine security monitoring'}.`,
        iocCorrelation: correlateIOCs(incident)
    };
    
    // Build recommendations
    const recommendations = {
        title: 'Recommendations',
        immediate: generateImmediateActions(incident, severity),
        shortTerm: generateShortTermActions(incident),
        longTerm: generateLongTermActions(incident),
        preventive: generatePreventiveMeasures(incident)
    };
    
    return {
        timestamp: new Date().toISOString(),
        incidentId: incident.id,
        incidentTitle: incident.displayName || 'Unnamed Incident',
        analysisType: 'Comprehensive',
        executiveSummary: executiveSummary,
        technicalAnalysis: technicalAnalysis,
        threatIntelligence: threatIntelligence,
        recommendations: recommendations,
        confidence: calculateConfidenceLevel(incident),
        metadata: {
            analyzedAt: new Date().toISOString(),
            version: '1.0',
            model: 'AI-Icarus Analysis Engine'
        }
    };
}

// Helper functions for AI analysis
function generateBusinessImpact(incident) {
    const severity = incident.severity || 'unknown';
    const userCount = incident.userCount || 0;
    const deviceCount = incident.deviceCount || 0;
    const alertCount = incident.alertCount || 0;
    
    let impactStatement = '';
    if (userCount > 0 || deviceCount > 0) {
        impactStatement = `${userCount} users and ${deviceCount} systems are potentially compromised. `;
    }
    
    if (severity === 'high' || severity === 'critical') {
        return `Critical business operations may be affected. ${impactStatement}With ${alertCount} alerts triggered, immediate action is required to prevent data loss or service disruption.`;
    } else if (severity === 'medium') {
        return `Moderate impact on business operations. ${impactStatement}Security posture may be degraded. Remediation should be prioritized within business hours.`;
    } else {
        return `Minimal impact on business operations. ${impactStatement}Standard security procedures should be followed.`;
    }
}

function calculateRiskLevel(severity, alertCount, entityCount, incident = {}) {
    let riskScore = 0;
    const breakdown = [];
    
    // Severity scoring with explanation
    let severityScore = 0;
    let severityExplanation = '';
    if (severity === 'critical') {
        severityScore = 40;
        severityExplanation = 'Critical severity incidents require immediate response';
    } else if (severity === 'high') {
        severityScore = 30;
        severityExplanation = 'High severity indicates significant security threat';
    } else if (severity === 'medium') {
        severityScore = 20;
        severityExplanation = 'Medium severity requires investigation and monitoring';
    } else {
        severityScore = 10;
        severityExplanation = 'Low severity but still requires attention';
    }
    riskScore += severityScore;
    breakdown.push({
        factor: 'Base Severity',
        value: severity.charAt(0).toUpperCase() + severity.slice(1),
        points: severityScore,
        explanation: severityExplanation
    });
    
    // Alert volume scoring with explanation
    let alertScore = 0;
    let alertExplanation = '';
    if (alertCount > 10) {
        alertScore = 30;
        alertExplanation = 'High volume of alerts indicates widespread attack';
    } else if (alertCount > 5) {
        alertScore = 20;
        alertExplanation = 'Multiple alerts suggest coordinated activity';
    } else if (alertCount > 2) {
        alertScore = 10;
        alertExplanation = 'Several alerts detected requiring correlation';
    } else {
        alertScore = 5;
        alertExplanation = 'Limited alert activity';
    }
    riskScore += alertScore;
    breakdown.push({
        factor: 'Alert Volume',
        value: `${alertCount} alerts`,
        points: alertScore,
        explanation: alertExplanation
    });
    
    // Entity impact scoring with explanation
    let entityScore = 0;
    let entityExplanation = '';
    if (entityCount > 10) {
        entityScore = 30;
        entityExplanation = 'Widespread impact across multiple entities';
    } else if (entityCount > 5) {
        entityScore = 20;
        entityExplanation = 'Several entities affected, possible lateral movement';
    } else if (entityCount > 2) {
        entityScore = 10;
        entityExplanation = 'Multiple entities involved';
    } else {
        entityScore = 5;
        entityExplanation = 'Limited entity scope';
    }
    riskScore += entityScore;
    breakdown.push({
        factor: 'Entity Impact',
        value: `${entityCount} entities`,
        points: entityScore,
        explanation: entityExplanation
    });
    
    // Additional contextual factors
    const contextualFactors = [];
    
    // Check for privileged accounts
    if (incident.entities && incident.entities.users) {
        const hasPrivilegedUser = incident.entities.users.some(u => 
            u.roles?.includes('admin') || 
            u.userPrincipalName?.includes('admin') ||
            u.accountName?.includes('admin')
        );
        if (hasPrivilegedUser) {
            contextualFactors.push({
                factor: 'Privileged Account',
                value: 'Detected',
                points: 15,
                explanation: 'Administrative or privileged account is compromised'
            });
            riskScore += 15;
        }
    }
    
    // Check for data exfiltration indicators
    if (incident.alerts) {
        const hasDataExfiltration = incident.alerts.some(a => 
            a.title?.toLowerCase().includes('exfiltration') ||
            a.description?.toLowerCase().includes('data transfer') ||
            a.category?.toLowerCase().includes('exfiltration')
        );
        if (hasDataExfiltration) {
            contextualFactors.push({
                factor: 'Data Exfiltration',
                value: 'Suspected',
                points: 20,
                explanation: 'Potential data theft or unauthorized transfer detected'
            });
            riskScore += 20;
        }
    }
    
    // Check for lateral movement
    if (incident.alerts) {
        const hasLateralMovement = incident.alerts.some(a => 
            a.title?.toLowerCase().includes('lateral') ||
            a.tactics?.includes('LateralMovement') ||
            a.category?.toLowerCase().includes('lateral')
        );
        if (hasLateralMovement) {
            contextualFactors.push({
                factor: 'Lateral Movement',
                value: 'Detected',
                points: 15,
                explanation: 'Attacker moving between systems in the network'
            });
            riskScore += 15;
        }
    }
    
    // Add contextual factors to breakdown
    breakdown.push(...contextualFactors);
    
    // Determine risk level
    let level = '';
    let levelDescription = '';
    if (riskScore >= 80) {
        level = 'Critical';
        levelDescription = 'Immediate action required. Potential major breach in progress.';
    } else if (riskScore >= 60) {
        level = 'High';
        levelDescription = 'Urgent response needed. Significant threat to organization.';
    } else if (riskScore >= 40) {
        level = 'Medium';
        levelDescription = 'Investigation required. Potential security incident developing.';
    } else {
        level = 'Low';
        levelDescription = 'Monitor situation. May be false positive or minor issue.';
    }
    
    return {
        level: level,
        score: riskScore,
        maxScore: 100,
        percentage: Math.min(100, riskScore),
        breakdown: breakdown,
        description: levelDescription,
        recommendation: getRiskRecommendation(level, riskScore)
    };
}

function getRiskRecommendation(level, score) {
    if (level === 'Critical') {
        return 'Immediately isolate affected systems, disable compromised accounts, and initiate incident response protocol. Contact security team lead.';
    } else if (level === 'High') {
        return 'Begin containment procedures, collect forensic data, and escalate to senior analyst. Monitor for further suspicious activity.';
    } else if (level === 'Medium') {
        return 'Investigate alerts, verify legitimacy, and document findings. Prepare for potential escalation if confirmed malicious.';
    } else {
        return 'Review alert details, check for false positives, and update detection rules if needed. Continue monitoring.';
    }
}

function reconstructAttackChain(incident) {
    const alerts = incident.alerts || [];
    const timeline = incident.timeline || [];
    const chain = [];
    
    // Use timeline if available (more detailed), otherwise use alerts
    if (timeline.length > 0) {
        // Timeline already sorted and enriched with attack stage information
        timeline.forEach((event, index) => {
            if (event.type === 'alert') {
                chain.push({
                    step: index + 1,
                    time: event.timestamp,
                    action: event.title || 'Unknown Action',
                    category: event.attackStage || event.severity || 'Unknown',
                    severity: event.severity || 'unknown',
                    description: event.description
                });
            }
        });
    } else if (alerts.length > 0) {
        // Fall back to alerts if no timeline
        const sortedAlerts = [...alerts].sort((a, b) => 
            new Date(a.createdDateTime) - new Date(b.createdDateTime)
        );
        
        sortedAlerts.forEach((alert, index) => {
            chain.push({
                step: index + 1,
                time: alert.createdDateTime,
                action: alert.title || 'Unknown Action',
                category: alert.category || 'Unknown',
                severity: alert.severity || 'unknown'
            });
        });
    }
    
    return chain.length > 0 ? chain : [{
        step: 1,
        action: 'Incident detected',
        category: incident.classification || 'Unknown',
        severity: incident.severity || 'unknown'
    }];
}

function extractIndicators(incident) {
    const indicators = {
        ips: [],
        domains: [],
        hashes: [],
        users: [],
        processes: []
    };
    
    // Extract from enriched entities data
    const entities = incident.entities || {};
    
    // Extract IPs
    if (entities.ips) {
        indicators.ips = entities.ips.map(ip => ip.ipAddress || ip.address || ip.name).filter(Boolean);
    }
    
    // Extract users
    if (entities.users) {
        indicators.users = entities.users.map(user => 
            user.userPrincipalName || user.accountName || user.domainName
        ).filter(Boolean);
    }
    
    // Extract file hashes
    if (entities.files) {
        entities.files.forEach(file => {
            if (file.sha256) indicators.hashes.push(file.sha256);
            else if (file.sha1) indicators.hashes.push(file.sha1);
        });
    }
    
    // Extract processes
    if (entities.processes) {
        indicators.processes = entities.processes.map(proc => 
            proc.fileName || proc.commandLine
        ).filter(Boolean);
    }
    
    // Extract URLs/domains
    if (entities.urls) {
        entities.urls.forEach(urlEntity => {
            if (urlEntity.url) {
                try {
                    const url = new URL(urlEntity.url);
                    indicators.domains.push(url.hostname);
                } catch {
                    // If not a valid URL, add as is
                    indicators.domains.push(urlEntity.url);
                }
            }
        });
    }
    
    return indicators;
}

// Generate a complete timeline story from narrative events
function generateTimelineStory(narrativeEvents = [], incident = {}) {
    if (!narrativeEvents || narrativeEvents.length === 0) {
        return "No timeline events available for this incident.";
    }
    
    // Sort events by timestamp
    const sortedEvents = [...narrativeEvents].sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
    );
    
    const story = [];
    story.push("=== INCIDENT TIMELINE NARRATIVE ===\n");
    story.push(`Incident: ${incident.displayName || incident.title || 'Security Incident'}`);
    story.push(`Severity: ${incident.severity || 'Unknown'}\n`);
    
    // Extract key entities from all events for context summary
    const allUsers = new Set();
    const allDevices = new Set();
    const allIPs = new Set();
    const allFiles = new Set();
    
    sortedEvents.forEach(event => {
        if (event.context) {
            event.context.users?.forEach(u => allUsers.add(u.userPrincipalName || u.accountName));
            event.context.devices?.forEach(d => allDevices.add(d.deviceName || d.hostName));
            event.context.network?.forEach(ip => allIPs.add(ip.ipAddress));
            event.context.files?.forEach(f => allFiles.add(f.fileName));
        } else if (event.entities) {
            event.entities.users?.forEach(u => allUsers.add(u.userPrincipalName || u.accountName));
            event.entities.hosts?.forEach(d => allDevices.add(d.deviceName || d.hostName));
            event.entities.ips?.forEach(ip => allIPs.add(ip.ipAddress || ip.name));
            event.entities.files?.forEach(f => allFiles.add(f.fileName));
        }
    });
    
    // Add context summary
    if (allUsers.size > 0 || allDevices.size > 0 || allIPs.size > 0) {
        story.push("📊 AFFECTED ENTITIES:");
        story.push("─────────────────────");
        if (allUsers.size > 0) story.push(`• Users: ${Array.from(allUsers).join(', ')}`);
        if (allDevices.size > 0) story.push(`• Devices: ${Array.from(allDevices).join(', ')}`);
        if (allIPs.size > 0) story.push(`• IPs: ${Array.from(allIPs).join(', ')}`);
        if (allFiles.size > 0) story.push(`• Files: ${Array.from(allFiles).join(', ')}`);
        story.push("");
    }
    
    // Build a chronological narrative from the actual events
    story.push("📅 ATTACK TIMELINE (Chronological):");
    story.push("════════════════════════════════════\n");
    
    // Detect PowerShell abuse pattern
    const psEvents = narrativeEvents.filter(e => 
        e.title && e.title.toLowerCase().includes('powershell')
    );
    
    if (psEvents.length > 10) {
        story.push("\n🔴 CRITICAL FINDING: Persistent PowerShell Policy Violations Detected");
        story.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        
        // Group by hour to show pattern
        const hourlyGroups = {};
        psEvents.forEach(event => {
            const hour = new Date(event.timestamp).getHours();
            const day = new Date(event.timestamp).toLocaleDateString();
            const key = `${day}_${hour}`;
            if (!hourlyGroups[key]) {
                hourlyGroups[key] = [];
            }
            hourlyGroups[key].push(event);
        });
        
        story.push("📊 PATTERN ANALYSIS:");
        story.push(`• Total PowerShell violations: ${psEvents.length} events`);
        story.push(`• Duration: ${Math.floor((new Date(psEvents[psEvents.length-1].timestamp) - new Date(psEvents[0].timestamp)) / (1000 * 60 * 60))} hours`);
        story.push(`• Frequency: Every hour (automated/scheduled execution suspected)`);
        story.push(`• User involved: ${psEvents[0].entities?.users?.[0]?.userPrincipalName || 'Unknown'}\n`);
        
        story.push("🧩 THE PUZZLE PIECES:");
        story.push("─────────────────────");
        
        // First event - initial compromise
        const firstEvent = psEvents[0];
        const firstTime = new Date(firstEvent.timestamp).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
        });
        story.push(`\n${firstTime} - 🚨 INITIAL DETECTION`);
        story.push(`   └─ PowerShell policy violation first detected`);
        story.push(`   └─ This could indicate:`);
        story.push(`      • Malicious script execution attempt`);
        story.push(`      • Bypass of execution policy`);
        story.push(`      • Living-off-the-land attack technique\n`);
        
        // Pattern detection
        if (psEvents.length > 20) {
            story.push(`${firstTime} to ${new Date(psEvents[psEvents.length-1].timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} - ⚠️ PERSISTENT EXECUTION PATTERN`);
            story.push(`   └─ Hourly execution detected (${psEvents.length} times)`);
            story.push(`   └─ This pattern suggests:`);
            story.push(`      • Scheduled task or cron job executing malicious PowerShell`);
            story.push(`      • Persistence mechanism established`);
            story.push(`      • Possible backdoor maintaining access`);
            story.push(`      • Could be cryptocurrency miner, data exfiltration script, or C2 beacon\n`);
        }
    }
    
    // Check for escalation - moved outside of if block for proper scope
    const uniqueUsers = [...new Set(narrativeEvents.map(e => e.entities?.users?.[0]?.userPrincipalName).filter(Boolean))];
    if (uniqueUsers.length > 1) {
        story.push(`⚠️ LATERAL MOVEMENT SUSPECTED`);
        story.push(`   └─ Multiple users affected: ${uniqueUsers.join(', ')}`);
        story.push(`   └─ Indicates potential privilege escalation or lateral movement\n`);
    }
    
    // Look for other attack patterns
    const emailEvents = narrativeEvents.filter(e => 
        e.title && (e.title.toLowerCase().includes('email') || e.title.toLowerCase().includes('phish'))
    );
    
    const malwareEvents = narrativeEvents.filter(e => 
        e.title && (e.title.toLowerCase().includes('malware') || e.title.toLowerCase().includes('trojan'))
    );
    
    const c2Events = narrativeEvents.filter(e => 
        e.title && (e.title.toLowerCase().includes('beacon') || e.title.toLowerCase().includes('c2'))
    );
    
    if (emailEvents.length > 0) {
        story.push("\n📧 EMAIL ATTACK VECTOR DETECTED:");
        story.push("─────────────────────────────────");
        emailEvents.forEach(event => {
            const time = new Date(event.timestamp).toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
            });
            story.push(`${time} - ${event.narrative || 'Suspicious email activity'}`);
            
            // Add rich context for email events
            if (event.context) {
                if (event.context.users?.length > 0) {
                    const user = event.context.users[0];
                    story.push(`   └─ Target User: ${user.userPrincipalName}`);
                    if (user.department !== 'Unknown Department') story.push(`      • Department: ${user.department}`);
                    if (user.jobTitle !== 'Unknown Role') story.push(`      • Role: ${user.jobTitle}`);
                    if (user.riskScore !== 'N/A') story.push(`      • Risk Score: ${user.riskScore}`);
                }
                if (event.context.urls?.length > 0) {
                    const url = event.context.urls[0];
                    story.push(`   └─ Malicious URL: ${url.url}`);
                    if (url.domain) story.push(`      • Domain: ${url.domain}`);
                    if (url.reputation) story.push(`      • Reputation: ${url.reputation}`);
                    if (url.category !== 'Uncategorized') story.push(`      • Category: ${url.category}`);
                }
            } else if (event.entities?.urls?.length > 0) {
                story.push(`   └─ Malicious URL: ${event.entities.urls[0].url}`);
            }
        });
    }
    
    if (c2Events.length > 0) {
        story.push("\n📡 COMMAND & CONTROL ACTIVITY:");
        story.push("────────────────────────────────");
        c2Events.forEach(event => {
            const time = new Date(event.timestamp).toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
            });
            story.push(`${time} - ${event.title || 'C2 Communication'}`);
            
            // Add rich context for C2 events
            if (event.context) {
                if (event.context.network?.length > 0) {
                    const ip = event.context.network[0];
                    story.push(`   └─ C2 Server: ${ip.ipAddress}`);
                    if (ip.geoLocation) {
                        story.push(`      • Location: ${ip.geoLocation.country}${ip.geoLocation.city !== 'Unknown City' ? `, ${ip.geoLocation.city}` : ''}`);
                    }
                    if (ip.isp !== 'Unknown ISP') story.push(`      • ISP: ${ip.isp}`);
                    if (ip.reputation) story.push(`      • Reputation: ${ip.reputation}`);
                }
                if (event.context.processes?.length > 0) {
                    const proc = event.context.processes[0];
                    story.push(`   └─ Process: ${proc.fileName || proc.commandLine}`);
                    if (proc.parentProcess !== 'Unknown Parent') story.push(`      • Parent: ${proc.parentProcess}`);
                    if (proc.userName !== 'Unknown User') story.push(`      • User: ${proc.userName}`);
                }
                if (event.context.devices?.length > 0) {
                    const device = event.context.devices[0];
                    story.push(`   └─ Compromised Device: ${device.deviceName}`);
                    if (device.osVersion !== 'Unknown Version') story.push(`      • OS: ${device.osVersion}`);
                    if (device.riskScore !== 'Unknown') story.push(`      • Risk Score: ${device.riskScore}`);
                }
            } else if (event.entities?.ips?.length > 0) {
                story.push(`${time} - Beacon to C2 server: ${event.entities.ips[0].address || event.entities.ips[0].ipAddress}`);
                story.push(`   └─ Attacker maintaining control of compromised system`);
            }
        });
    }
    
    // Conclusion and recommendations
    story.push("\n=== ATTACK CHAIN RECONSTRUCTION ===");
    story.push("───────────────────────────────────");
    
    if (psEvents.length > 10) {
        story.push("1. Initial PowerShell execution policy bypass detected");
        story.push("2. Persistence mechanism established (hourly execution)");
        story.push("3. Continuous malicious activity for extended period");
        story.push("4. No successful remediation observed\n");
        
        story.push("🎯 IMMEDIATE ACTIONS REQUIRED:");
        story.push("• Isolate affected system(s) immediately");
        story.push("• Kill all PowerShell processes from affected user");
        story.push("• Check scheduled tasks and startup items");
        story.push("• Review PowerShell logs for executed commands");
        story.push("• Reset user credentials");
        story.push("• Scan for persistence mechanisms");
        story.push("• Check for data exfiltration indicators");
    }
    
    // Statistics
    const duration = narrativeEvents.length > 0 ? 
        new Date(narrativeEvents[narrativeEvents.length - 1].timestamp) - new Date(narrativeEvents[0].timestamp) : 0;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    
    story.push(`\n📈 INCIDENT METRICS:`);
    story.push(`• Total Duration: ${hours} hours ${minutes} minutes`);
    story.push(`• Total Events: ${narrativeEvents.length}`);
    story.push(`• Affected Users: ${uniqueUsers.length || 1}`);
    story.push(`• Threat Level: ${psEvents.length > 20 ? 'CRITICAL' : psEvents.length > 10 ? 'HIGH' : 'MEDIUM'}`);
    
    return story.join('\n');
}

// Helper function to analyze event patterns
function analyzeEventPatterns(events) {
    const patterns = {
        repeatingEvents: {},
        timePatterns: [],
        userPatterns: {},
        ipPatterns: {}
    };
    
    events.forEach(event => {
        // Count repeating event types
        const eventType = event.title || 'unknown';
        patterns.repeatingEvents[eventType] = (patterns.repeatingEvents[eventType] || 0) + 1;
        
        // Analyze time patterns
        const hour = new Date(event.timestamp).getHours();
        patterns.timePatterns.push(hour);
        
        // Track user activity
        if (event.entities?.users) {
            event.entities.users.forEach(user => {
                const userName = user.userPrincipalName || user.accountName;
                if (!patterns.userPatterns[userName]) {
                    patterns.userPatterns[userName] = [];
                }
                patterns.userPatterns[userName].push(event);
            });
        }
    });
    
    return patterns;
}

// Helper function to detect hourly patterns in events
function detectHourlyPattern(events) {
    if (events.length < 10) return false;
    
    // Check if events occur at regular hourly intervals
    const timestamps = events.map(e => new Date(e.timestamp).getTime());
    const intervals = [];
    
    for (let i = 1; i < timestamps.length; i++) {
        intervals.push(timestamps[i] - timestamps[i-1]);
    }
    
    // Check if most intervals are around 1 hour (allow 10 minute variance)
    const hourlyIntervals = intervals.filter(interval => {
        const hours = interval / (1000 * 60 * 60);
        return hours >= 0.83 && hours <= 1.17; // Between 50-70 minutes
    });
    
    // If more than 70% of intervals are hourly, it's a pattern
    return hourlyIntervals.length / intervals.length > 0.7;
}

function createNarrativeTimeline(timeline = [], alerts = []) {
    const narrativeEvents = [];
    
    // Alert title to narrative mapping
    const alertNarratives = {
        // Email threats
        'suspiciousemailreceived': (alert, entities) => {
            const user = entities?.users?.[0]?.userPrincipalName || 'unknown user';
            const sender = entities?.mailboxes?.[0]?.mailboxPrimaryAddress || 'unknown sender';
            return `User '${user}' received suspicious email from '${sender}'`;
        },
        'phishingdetected': (alert, entities) => {
            const user = entities?.users?.[0]?.userPrincipalName || 'a user';
            const url = entities?.urls?.[0]?.url || 'malicious URL';
            return `Phishing attempt detected: User '${user}' received email with malicious link to '${url}'`;
        },
        'maliciousemailclicked': (alert, entities) => {
            const user = entities?.users?.[0]?.userPrincipalName || 'a user';
            const url = entities?.urls?.[0]?.url || 'malicious link';
            return `User '${user}' clicked on malicious link: '${url}'`;
        },
        
        // Malware detection
        'malwaredetected': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            const file = entities?.files?.[0]?.fileName || 'malicious file';
            const malware = alert.category || 'malware';
            return `Malware detected on '${device}': ${file} identified as ${malware}`;
        },
        'suspiciousprocessexecution': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            const process = entities?.processes?.[0]?.processCommandLine || entities?.processes?.[0]?.fileName || 'suspicious process';
            return `Suspicious process execution on '${device}': ${process}`;
        },
        'powershellanomaly': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            const user = entities?.users?.[0]?.userPrincipalName || 'unknown user';
            return `Anomalous PowerShell activity detected on '${device}' by user '${user}'`;
        },
        
        // Network activity
        'suspiciousnetworkactivity': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            const ip = entities?.ips?.[0]?.address || 'external IP';
            return `Suspicious network connection from '${device}' to '${ip}'`;
        },
        'c2communication': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            const ip = entities?.ips?.[0]?.address || 'C2 server';
            return `Command and control communication detected: '${device}' beaconing to '${ip}'`;
        },
        'dataexfiltration': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            const size = alert.properties?.dataSize || 'unknown amount';
            return `Potential data exfiltration from '${device}': ${size} of data transferred`;
        },
        
        // Account activity
        'suspiciouslogin': (alert, entities) => {
            const user = entities?.users?.[0]?.userPrincipalName || 'unknown user';
            const ip = entities?.ips?.[0]?.address || 'unknown location';
            return `Suspicious login attempt for '${user}' from '${ip}'`;
        },
        'impossibletravel': (alert, entities) => {
            const user = entities?.users?.[0]?.userPrincipalName || 'unknown user';
            const locations = entities?.cloudApplications?.[0]?.instanceName || 'multiple locations';
            return `Impossible travel detected for '${user}': Login attempts from ${locations}`;
        },
        'privilegeescalation': (alert, entities) => {
            const user = entities?.users?.[0]?.userPrincipalName || 'unknown user';
            return `Privilege escalation attempt by '${user}'`;
        },
        
        // Lateral movement
        'lateralmovement': (alert, entities) => {
            const source = entities?.hosts?.[0]?.hostName || 'source device';
            const target = entities?.hosts?.[1]?.hostName || 'target device';
            return `Lateral movement detected from '${source}' to '${target}'`;
        },
        
        // Defense evasion
        'defenderbypass': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            return `Attempt to bypass Microsoft Defender detected on '${device}'`;
        },
        'antivirustampering': (alert, entities) => {
            const device = entities?.hosts?.[0]?.hostName || 'affected device';
            return `Antivirus tampering detected on '${device}'`;
        }
    };
    
    // Process timeline events and convert to narrative
    timeline.forEach((event, index) => {
        let narrative = '';
        let icon = '📝';
        let phase = 'Detection';
        
        // Try to parse entities
        let entities = {};
        try {
            if (event.entities && typeof event.entities === 'string') {
                entities = JSON.parse(event.entities);
            } else if (event.entities) {
                entities = event.entities;
            }
        } catch (e) {
            console.log('Failed to parse entities:', e);
        }
        
        // Determine attack phase
        const title = (event.title || '').toLowerCase();
        const category = (event.category || '').toLowerCase();
        
        if (title.includes('email') || title.includes('phish') || category.includes('email')) {
            phase = 'Initial Access';
            icon = '📧';
        } else if (title.includes('clicked') || title.includes('opened') || title.includes('download')) {
            phase = 'User Interaction';
            icon = '⚠️';
        } else if (title.includes('process') || title.includes('execution') || title.includes('powershell')) {
            phase = 'Execution';
            icon = '💻';
        } else if (title.includes('malware') || title.includes('trojan') || title.includes('virus')) {
            phase = 'Payload Detected';
            icon = '🦠';
        } else if (title.includes('lateral') || title.includes('movement')) {
            phase = 'Lateral Movement';
            icon = '➡️';
        } else if (title.includes('exfiltration') || title.includes('transfer')) {
            phase = 'Data Exfiltration';
            icon = '📤';
        } else if (title.includes('c2') || title.includes('beacon') || title.includes('command')) {
            phase = 'Command & Control';
            icon = '📡';
        } else if (title.includes('defender') || title.includes('blocked') || title.includes('quarantine')) {
            phase = 'Response & Containment';
            icon = '🛡️';
        }
        
        // Try to match alert patterns for narrative generation
        let narrativeGenerated = false;
        const normalizedTitle = title.replace(/\s+/g, '').toLowerCase();
        
        // Check each narrative pattern
        for (const [pattern, narrativeFunc] of Object.entries(alertNarratives)) {
            if (normalizedTitle.includes(pattern) || title.includes(pattern.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())) {
                narrative = narrativeFunc(event, entities);
                narrativeGenerated = true;
                break;
            }
        }
        
        if (!narrativeGenerated) {
            // Enhanced default narrative construction
            narrative = '';
            
            // Build comprehensive narrative from entities
            const users = entities.users || [];
            const hosts = entities.hosts || [];
            const ips = entities.ips || [];
            const files = entities.files || [];
            const urls = entities.urls || [];
            const processes = entities.processes || [];
            
            // Start building the narrative based on available entities
            if (users.length > 0) {
                const user = users[0].userPrincipalName || users[0].accountName || 'unknown user';
                narrative += `User '${user}'`;
            }
            
            if (hosts.length > 0) {
                const host = hosts[0].hostName || hosts[0].deviceName || 'unknown device';
                if (narrative) narrative += ` on device '${host}'`;
                else narrative += `Device '${host}'`;
            }
            
            // Add action based on title
            if (title.includes('email') || title.includes('phish')) {
                if (urls.length > 0) {
                    narrative += ` received suspicious email with link to '${urls[0].url}'`;
                } else {
                    narrative += ` received suspicious email`;
                }
            } else if (title.includes('clicked') || title.includes('opened')) {
                if (urls.length > 0) {
                    narrative += ` clicked on malicious link '${urls[0].url}'`;
                } else {
                    narrative += ` interacted with suspicious content`;
                }
            } else if (title.includes('download')) {
                if (files.length > 0) {
                    narrative += ` downloaded file '${files[0].fileName}'`;
                } else {
                    narrative += ` downloaded suspicious file`;
                }
            } else if (title.includes('malware') || title.includes('trojan')) {
                if (files.length > 0) {
                    narrative += ` - malware detected in '${files[0].fileName}'`;
                    if (title.includes('blocked') || title.includes('quarantine')) {
                        narrative += ` - file was blocked and quarantined`;
                    }
                } else {
                    narrative += ` - malware activity detected`;
                }
            } else if (title.includes('process') || title.includes('execution')) {
                if (processes.length > 0) {
                    const proc = processes[0].fileName || processes[0].processCommandLine || 'unknown process';
                    narrative += ` executed suspicious process '${proc}'`;
                } else {
                    narrative += ` - suspicious process execution detected`;
                }
            } else if (title.includes('beacon') || title.includes('c2')) {
                if (ips.length > 0) {
                    narrative += ` beaconed out to '${ips[0].address || ips[0].ipAddress}'`;
                } else {
                    narrative += ` - command and control activity detected`;
                }
            } else if (title.includes('defender') && (title.includes('block') || title.includes('quarantine'))) {
                narrative += ` - threat was blocked by Microsoft Defender`;
            } else {
                // Generic fallback
                narrative += ` - ${event.title || 'security event detected'}`;
            }
            
            // If still no narrative, use the description
            if (!narrative) {
                narrative = event.description || event.title || 'Security event detected';
            }
        }
        
        // Add severity context
        if (event.severity === 'high' || event.severity === 'High') {
            narrative += ' [HIGH SEVERITY]';
        } else if (event.severity === 'critical' || event.severity === 'Critical') {
            narrative += ' [CRITICAL]';
        }
        
        narrativeEvents.push({
            ...event,
            narrative: narrative,
            icon: icon,
            phase: phase,
            index: index + 1,
            formattedTime: new Date(event.timestamp).toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true 
            })
        });
    });
    
    return narrativeEvents;
}

function generateTimelineAnalysis(incident) {
    const timeline = incident.timeline || [];
    const firstActivity = incident.firstActivityDateTime || incident.createdDateTime;
    const lastActivity = incident.lastActivityDateTime || incident.lastModifiedDateTime;
    
    // If we have timeline events, provide detailed analysis
    if (timeline.length > 0) {
        const firstEvent = timeline[0];
        const lastEvent = timeline[timeline.length - 1];
        const duration = new Date(lastEvent.timestamp) - new Date(firstEvent.timestamp);
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        
        // Count events by type
        const alertEvents = timeline.filter(e => e.type === 'alert').length;
        const networkEvents = timeline.filter(e => e.type === 'network_activity').length;
        
        return `Attack timeline contains ${timeline.length} events over ${hours} hours ${minutes} minutes. ` +
               `${alertEvents} security alerts and ${networkEvents} network activities detected. ` +
               `First event: ${new Date(firstEvent.timestamp).toLocaleString()}, ` +
               `Last event: ${new Date(lastEvent.timestamp).toLocaleString()}.`;
    } else if (firstActivity && lastActivity) {
        const duration = new Date(lastActivity) - new Date(firstActivity);
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        
        return `Attack duration: ${hours} hours ${minutes} minutes. First activity: ${new Date(firstActivity).toLocaleString()}, Last activity: ${new Date(lastActivity).toLocaleString()}.`;
    }
    
    return 'Timeline information not available for this incident.';
}

function extractMitreTactics(incident) {
    const tactics = new Set();
    const alerts = incident.alerts || [];
    const statistics = incident.statistics || {};
    
    // First check if we have pre-computed MITRE techniques in statistics
    if (statistics.mitreTechniques && Array.isArray(statistics.mitreTechniques)) {
        statistics.mitreTechniques.forEach(technique => {
            if (technique) tactics.add(technique);
        });
    }
    
    // Also extract from individual alerts
    alerts.forEach(alert => {
        if (alert.mitreTechniques && Array.isArray(alert.mitreTechniques)) {
            alert.mitreTechniques.forEach(technique => {
                if (technique) {
                    // Some techniques come as full strings, extract the ID
                    if (technique.startsWith('T')) {
                        tactics.add(technique);
                    } else if (technique.includes('T')) {
                        // Extract T#### pattern from strings like "InitialAccess.T1566"
                        const match = technique.match(/T\d{4}(\.\d{3})?/);
                        if (match) tactics.add(match[0]);
                    }
                }
            });
        }
    });
    
    return Array.from(tactics).length > 0 ? Array.from(tactics) : ['No MITRE tactics identified'];
}

function identifyPotentialThreatActors(incident) {
    const determination = incident.determination || '';
    const classification = incident.classification || '';
    
    if (determination === 'maliciousActivity') {
        if (classification === 'truePositive') {
            return 'Confirmed malicious actor. Pattern analysis suggests possible APT activity or organized threat group.';
        }
        return 'Suspected malicious actor. Further investigation needed to determine attribution.';
    }
    
    return 'No specific threat actor identified. May be automated scanning or benign activity.';
}

function matchKnownPatterns(incident) {
    const patterns = [];
    const alerts = incident.alerts || [];
    
    alerts.forEach(alert => {
        const category = alert.category || '';
        if (category.includes('Malware')) patterns.push('Malware deployment pattern detected');
        if (category.includes('Phishing')) patterns.push('Phishing campaign characteristics identified');
        if (category.includes('Ransomware')) patterns.push('Ransomware behavior patterns observed');
        if (category.includes('Persistence')) patterns.push('Persistence mechanism establishment detected');
    });
    
    return patterns.length > 0 ? patterns : ['No known attack patterns matched'];
}

function correlateIOCs(incident) {
    // Extract IOCs from the enriched incident data
    const entities = incident.entities || {};
    const indicators = extractIndicators(incident);
    
    // Build a comprehensive IOC list
    const iocList = [];
    
    // Add IP addresses
    if (indicators.ips && indicators.ips.length > 0) {
        iocList.push(`IP Addresses (${indicators.ips.length}): ${indicators.ips.slice(0, 5).join(', ')}${indicators.ips.length > 5 ? ', ...' : ''}`);
    }
    
    // Add user accounts
    if (indicators.users && indicators.users.length > 0) {
        iocList.push(`User Accounts (${indicators.users.length}): ${indicators.users.slice(0, 5).join(', ')}${indicators.users.length > 5 ? ', ...' : ''}`);
    }
    
    // Add domains
    if (indicators.domains && indicators.domains.length > 0) {
        iocList.push(`Domains (${indicators.domains.length}): ${indicators.domains.slice(0, 5).join(', ')}${indicators.domains.length > 5 ? ', ...' : ''}`);
    }
    
    // Add file hashes
    if (indicators.hashes && indicators.hashes.length > 0) {
        iocList.push(`File Hashes (${indicators.hashes.length}): ${indicators.hashes.slice(0, 3).map(h => h.substring(0, 16) + '...').join(', ')}${indicators.hashes.length > 3 ? ', ...' : ''}`);
    }
    
    // Add processes
    if (indicators.processes && indicators.processes.length > 0) {
        iocList.push(`Processes (${indicators.processes.length}): ${indicators.processes.slice(0, 3).join(', ')}${indicators.processes.length > 3 ? ', ...' : ''}`);
    }
    
    // Calculate total IOC count
    const totalIOCs = (indicators.ips?.length || 0) + 
                      (indicators.users?.length || 0) + 
                      (indicators.domains?.length || 0) + 
                      (indicators.hashes?.length || 0) + 
                      (indicators.processes?.length || 0);
    
    if (iocList.length > 0) {
        let correlationLevel = '';
        if (totalIOCs > 50) {
            correlationLevel = 'High correlation detected - coordinated attack likely. ';
        } else if (totalIOCs > 20) {
            correlationLevel = 'Moderate correlation - targeted activity detected. ';
        } else if (totalIOCs > 0) {
            correlationLevel = 'Limited correlation - isolated activity. ';
        }
        
        return correlationLevel + '\n\nIndicators of Compromise:\n' + iocList.join('\n');
    }
    
    return 'No IOCs identified in this incident.';
}

function generateImmediateActions(incident, severity) {
    const actions = [];
    
    if (severity === 'critical' || severity === 'high') {
        actions.push('Isolate affected systems immediately');
        actions.push('Initiate incident response protocol');
        actions.push('Preserve forensic evidence');
        actions.push('Reset credentials for affected users');
    } else if (severity === 'medium') {
        actions.push('Monitor affected systems closely');
        actions.push('Review security logs for additional indicators');
        actions.push('Update security controls');
    } else {
        actions.push('Document incident for review');
        actions.push('Update detection rules if needed');
    }
    
    return actions;
}

function generateShortTermActions(incident) {
    return [
        'Conduct thorough investigation of all affected systems',
        'Patch identified vulnerabilities',
        'Review and update security policies',
        'Communicate findings to stakeholders'
    ];
}

function generateLongTermActions(incident) {
    return [
        'Implement enhanced monitoring for similar patterns',
        'Update security awareness training',
        'Review and enhance incident response procedures',
        'Consider additional security tooling or controls'
    ];
}

function generatePreventiveMeasures(incident) {
    const measures = [];
    const classification = incident.classification || '';
    
    if (classification.includes('Malware')) {
        measures.push('Deploy advanced anti-malware solutions');
        measures.push('Implement application whitelisting');
    }
    if (classification.includes('Phishing')) {
        measures.push('Enhance email security filters');
        measures.push('Increase user security awareness training');
    }
    
    measures.push('Regular security assessments');
    measures.push('Continuous security monitoring');
    measures.push('Zero-trust architecture implementation');
    
    return measures;
}

function calculateConfidenceLevel(incident) {
    const hasAlerts = (incident.alertsCount || 0) > 0;
    const hasEntities = (incident.impactedEntities || []).length > 0;
    const hasDetermination = incident.determination && incident.determination !== 'unknown';
    const hasClassification = incident.classification && incident.classification !== 'unknown';
    
    let confidence = 0;
    if (hasAlerts) confidence += 25;
    if (hasEntities) confidence += 25;
    if (hasDetermination) confidence += 25;
    if (hasClassification) confidence += 25;
    
    if (confidence >= 75) return 'High';
    else if (confidence >= 50) return 'Medium';
    else return 'Low';
}

// Generate real AI analysis using Azure OpenAI
async function generateRealAIAnalysis(incidentData, resourceName, deploymentName, token, context) {
    context.log(`Generating real AI analysis using ${resourceName}/${deploymentName}`);
    const startTime = Date.now(); // Track performance metrics
    
    try {
        // Get Azure OpenAI endpoint and key from environment or use defaults
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT || `https://${resourceName}.openai.azure.com`;
        const apiKey = process.env.AZURE_OPENAI_KEY;
        
        if (!apiKey) {
            context.log.warn('Azure OpenAI API key not found in environment, attempting to use managed identity');
            // For now, fall back to mock if no API key
            return generateMockAIAnalysis(incidentData, context);
        }
        
        // Initialize OpenAI client
        const client = new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));
        
        // Prepare the incident summary for AI analysis
        const incidentSummary = {
            title: incidentData.title,
            severity: incidentData.severity,
            classification: incidentData.classification,
            determination: incidentData.determination,
            status: incidentData.status,
            alertCount: incidentData.alertsCount || 0,
            impactedEntities: incidentData.impactedEntities?.slice(0, 10) || [], // Limit entities for token management
            timeline: incidentData.timeline?.slice(0, 5).map(t => ({
                timestamp: t.timestamp,
                title: t.title,
                description: t.description
            })) || [],
            mitreTactics: incidentData.mitreTactics?.slice(0, 5) || [],
            topRecommendations: incidentData.recommendations?.slice(0, 3) || []
        };
        
        // Create the prompt for AI analysis
        const systemPrompt = `You are a cybersecurity expert analyzing Microsoft 365 Defender incidents. 
Provide a comprehensive security analysis with specific, actionable recommendations.
Focus on threat assessment, attack patterns, and mitigation strategies.
Be concise but thorough. Use security industry best practices and frameworks like MITRE ATT&CK.`;
        
        const userPrompt = `Analyze this security incident and provide:
1. Executive Summary (2-3 sentences)
2. Threat Assessment (severity justification and potential impact)
3. Attack Pattern Analysis (tactics used and likely next steps)
4. Immediate Actions Required (top 3-5 urgent steps)
5. Long-term Security Improvements (strategic recommendations)
6. Indicators of Compromise to monitor

Incident Data:
${JSON.stringify(incidentSummary, null, 2)}`;
        
        context.log(`Sending request to Azure OpenAI with deployment: ${deploymentName}`);
        
        // Call Azure OpenAI
        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ];
        
        const result = await client.getChatCompletions(
            deploymentName,
            messages,
            {
                maxTokens: 2000,
                temperature: 0.7,
                topP: 0.9,
                frequencyPenalty: 0.3,
                presencePenalty: 0.3
            }
        );
        
        const aiResponse = result.choices[0]?.message?.content || '';
        
        if (!aiResponse) {
            context.log.error('Empty response from Azure OpenAI');
            return generateMockAIAnalysis(incidentData, context);
        }
        
        context.log('Successfully generated AI analysis');
        
        // Parse the AI response into structured format
        const analysis = parseAIResponse(aiResponse, incidentData);
        
        return {
            analysis,
            metadata: {
                model: deploymentName,
                resource: resourceName,
                timestamp: new Date().toISOString(),
                tokensUsed: result.usage?.totalTokens || 0,
                processingTime: Date.now() - startTime
            }
        };
        
    } catch (error) {
        context.log.error(`Error generating AI analysis: ${error.message}`);
        context.log.error(`Error details: ${JSON.stringify(error)}`);
        
        // Fall back to mock analysis
        context.log('Falling back to mock analysis due to error');
        return generateMockAIAnalysis(incidentData, context);
    }
}

// Parse AI response into structured format
function parseAIResponse(aiResponse, incidentData) {
    // Try to extract sections from the AI response
    const sections = {
        executiveSummary: '',
        threatAssessment: '',
        attackPattern: '',
        immediateActions: [],
        longTermImprovements: [],
        iocs: []
    };
    
    // Simple parsing - look for section headers
    const lines = aiResponse.split('\n');
    let currentSection = '';
    
    for (const line of lines) {
        const lowerLine = line.toLowerCase();
        
        if (lowerLine.includes('executive summary')) {
            currentSection = 'executiveSummary';
        } else if (lowerLine.includes('threat assessment')) {
            currentSection = 'threatAssessment';
        } else if (lowerLine.includes('attack pattern')) {
            currentSection = 'attackPattern';
        } else if (lowerLine.includes('immediate action')) {
            currentSection = 'immediateActions';
        } else if (lowerLine.includes('long-term') || lowerLine.includes('long term')) {
            currentSection = 'longTermImprovements';
        } else if (lowerLine.includes('indicator') && lowerLine.includes('compromise')) {
            currentSection = 'iocs';
        } else if (line.trim() && currentSection) {
            // Add content to current section
            if (currentSection === 'immediateActions' || currentSection === 'longTermImprovements' || currentSection === 'iocs') {
                // These are lists
                if (line.match(/^[\d\-\*•]/)) {
                    sections[currentSection].push(line.replace(/^[\d\-\*•]+\.?\s*/, '').trim());
                }
            } else {
                // These are text sections
                sections[currentSection] += (sections[currentSection] ? ' ' : '') + line.trim();
            }
        }
    }
    
    // If parsing didn't work well, use the full response
    if (!sections.executiveSummary) {
        sections.executiveSummary = aiResponse.split('\n')[0] || 'AI analysis completed successfully.';
    }
    
    // Build the structured response similar to mock
    return {
        summary: sections.executiveSummary || `Advanced AI analysis of ${incidentData.title} incident`,
        
        threatIntelligence: {
            assessment: sections.threatAssessment || `This ${incidentData.severity} severity incident shows characteristics of ${incidentData.classification || 'suspicious activity'}.`,
            attackVector: sections.attackPattern || 'Multiple attack vectors detected requiring immediate attention.',
            indicators: sections.iocs.length > 0 ? sections.iocs : [
                'Monitor for similar attack patterns',
                'Track associated IP addresses and domains',
                'Watch for lateral movement attempts'
            ],
            confidence: calculateConfidenceLevel(incidentData)
        },
        
        recommendations: {
            immediate: sections.immediateActions.length > 0 ? sections.immediateActions : [
                'Isolate affected systems immediately',
                'Reset credentials for compromised accounts',
                'Enable enhanced monitoring on critical assets'
            ],
            shortTerm: [
                'Conduct thorough forensic analysis',
                'Review and update security policies',
                'Implement additional detection rules'
            ],
            longTerm: sections.longTermImprovements.length > 0 ? sections.longTermImprovements : [
                'Implement zero-trust architecture',
                'Enhance security awareness training',
                'Deploy advanced threat protection solutions'
            ]
        },
        
        riskScore: calculateRiskScore(incidentData),
        
        affectedAssets: {
            users: incidentData.impactedUsers || [],
            devices: incidentData.impactedDevices || [],
            applications: incidentData.impactedApplications || []
        },
        
        mitigationSteps: generateMitigationSteps(incidentData),
        
        complianceImpact: {
            frameworks: ['NIST', 'ISO 27001', 'SOC 2'],
            potentialViolations: generateComplianceViolations(incidentData),
            requiredNotifications: incidentData.severity === 'high' ? ['Security team', 'Management', 'Legal'] : ['Security team']
        },
        
        estimatedTimeToResolve: `${Math.max(2, 8 - (incidentData.alertsCount || 0))} hours`,
        
        preventiveMeasures: sections.longTermImprovements.length > 0 ? sections.longTermImprovements : generatePreventiveMeasures(incidentData),
        
        additionalContext: aiResponse,
        
        generatedAt: new Date().toISOString(),
        
        modelUsed: 'Azure OpenAI GPT-4'
    };
}