// User settings storage using Azure Table Storage or in-memory cache
// In production, this should use Azure Table Storage or Cosmos DB

// In-memory storage for demo purposes (will reset on function restart)
// In production, replace with Azure Table Storage or Cosmos DB
const userSettings = new Map();

module.exports = async function (context, req) {
    try {
        const method = req.method.toUpperCase();
        const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId || 'default';
        
        context.log(`User settings request: ${method} for user: ${userId}`);
        
        switch (method) {
            case 'GET':
                // Retrieve user settings
                const settings = getUserSettings(userId);
                
                context.res = {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: settings
                };
                break;
                
            case 'POST':
            case 'PUT':
                // Save or update user settings
                const newSettings = req.body;
                
                if (!newSettings || typeof newSettings !== 'object') {
                    context.res = {
                        status: 400,
                        body: { error: "Invalid settings data" }
                    };
                    return;
                }
                
                // Validate settings structure
                const validatedSettings = validateSettings(newSettings);
                
                // Save settings
                saveUserSettings(userId, validatedSettings);
                
                context.res = {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: {
                        message: "Settings saved successfully",
                        settings: validatedSettings
                    }
                };
                break;
                
            default:
                context.res = {
                    status: 405,
                    body: { error: "Method not allowed" }
                };
        }
        
    } catch (error) {
        context.log.error('Error in user-settings function:', error);
        context.res = {
            status: 500,
            body: { 
                error: "Failed to process user settings",
                details: error.message 
            }
        };
    }
};

// Get user settings with defaults
function getUserSettings(userId) {
    if (userSettings.has(userId)) {
        return userSettings.get(userId);
    }
    
    // Return default settings
    return getDefaultSettings();
}

// Save user settings
function saveUserSettings(userId, settings) {
    // Merge with existing settings
    const existingSettings = getUserSettings(userId);
    const mergedSettings = {
        ...existingSettings,
        ...settings,
        lastModified: new Date().toISOString()
    };
    
    userSettings.set(userId, mergedSettings);
    
    // In production, save to persistent storage here
    // Example: Azure Table Storage
    // await tableClient.upsertEntity({
    //     partitionKey: 'settings',
    //     rowKey: userId,
    //     ...mergedSettings
    // });
    
    return mergedSettings;
}

// Validate and sanitize settings
function validateSettings(settings) {
    const validated = {};
    
    // Theme settings
    if (settings.theme) {
        validated.theme = {
            mode: ['light', 'dark', 'auto'].includes(settings.theme.mode) 
                ? settings.theme.mode 
                : 'light',
            primaryColor: settings.theme.primaryColor || '#0078D4',
            fontSize: ['small', 'medium', 'large'].includes(settings.theme.fontSize)
                ? settings.theme.fontSize
                : 'medium'
        };
    }
    
    // Query settings
    if (settings.query) {
        validated.query = {
            defaultTimeRange: settings.query.defaultTimeRange || '24h',
            maxResults: Math.min(Math.max(settings.query.maxResults || 100, 10), 10000),
            enableAutoComplete: settings.query.enableAutoComplete !== false,
            saveHistory: settings.query.saveHistory !== false,
            historyLimit: Math.min(Math.max(settings.query.historyLimit || 50, 10), 200)
        };
    }
    
    // Workspace preferences
    if (settings.workspaces) {
        validated.workspaces = {
            default: settings.workspaces.default || null,
            favorites: Array.isArray(settings.workspaces.favorites) 
                ? settings.workspaces.favorites.slice(0, 10)
                : [],
            recent: Array.isArray(settings.workspaces.recent)
                ? settings.workspaces.recent.slice(0, 5)
                : []
        };
    }
    
    // OpenAI settings
    if (settings.openai) {
        validated.openai = {
            defaultDeployment: settings.openai.defaultDeployment || null,
            temperature: Math.min(Math.max(settings.openai.temperature || 0.7, 0), 2),
            maxTokens: Math.min(Math.max(settings.openai.maxTokens || 2000, 100), 4000),
            analysisMode: ['detailed', 'summary', 'actionable'].includes(settings.openai.analysisMode)
                ? settings.openai.analysisMode
                : 'detailed'
        };
    }
    
    // Visualization preferences
    if (settings.visualization) {
        validated.visualization = {
            defaultChartType: ['line', 'bar', 'pie', 'doughnut', 'scatter'].includes(settings.visualization.defaultChartType)
                ? settings.visualization.defaultChartType
                : 'auto',
            colorScheme: settings.visualization.colorScheme || 'default',
            showLegend: settings.visualization.showLegend !== false,
            showGrid: settings.visualization.showGrid !== false,
            animateCharts: settings.visualization.animateCharts !== false
        };
    }
    
    // Export preferences
    if (settings.export) {
        validated.export = {
            defaultFormat: ['csv', 'json', 'excel'].includes(settings.export.defaultFormat)
                ? settings.export.defaultFormat
                : 'csv',
            includeHeaders: settings.export.includeHeaders !== false,
            dateFormat: settings.export.dateFormat || 'ISO',
            nullValue: settings.export.nullValue || ''
        };
    }
    
    // Notification preferences
    if (settings.notifications) {
        validated.notifications = {
            enableNotifications: settings.notifications.enableNotifications !== false,
            soundEnabled: settings.notifications.soundEnabled !== false,
            queryComplete: settings.notifications.queryComplete !== false,
            errorAlerts: settings.notifications.errorAlerts !== false
        };
    }
    
    // Security settings
    if (settings.security) {
        validated.security = {
            autoLogout: Math.min(Math.max(settings.security.autoLogout || 30, 5), 1440),
            requireMFA: settings.security.requireMFA === true,
            dataEncryption: settings.security.dataEncryption !== false
        };
    }
    
    // Saved queries
    if (settings.savedQueries) {
        validated.savedQueries = Array.isArray(settings.savedQueries)
            ? settings.savedQueries.slice(0, 100).map(q => ({
                id: q.id || generateId(),
                name: q.name || 'Unnamed Query',
                query: q.query || '',
                category: q.category || 'General',
                created: q.created || new Date().toISOString(),
                modified: new Date().toISOString()
            }))
            : [];
    }
    
    return validated;
}

// Get default settings
function getDefaultSettings() {
    return {
        theme: {
            mode: 'light',
            primaryColor: '#0078D4',
            fontSize: 'medium'
        },
        query: {
            defaultTimeRange: '24h',
            maxResults: 100,
            enableAutoComplete: true,
            saveHistory: true,
            historyLimit: 50
        },
        workspaces: {
            default: null,
            favorites: [],
            recent: []
        },
        openai: {
            defaultDeployment: null,
            temperature: 0.7,
            maxTokens: 2000,
            analysisMode: 'detailed'
        },
        visualization: {
            defaultChartType: 'auto',
            colorScheme: 'default',
            showLegend: true,
            showGrid: true,
            animateCharts: true
        },
        export: {
            defaultFormat: 'csv',
            includeHeaders: true,
            dateFormat: 'ISO',
            nullValue: ''
        },
        notifications: {
            enableNotifications: true,
            soundEnabled: false,
            queryComplete: true,
            errorAlerts: true
        },
        security: {
            autoLogout: 30,
            requireMFA: false,
            dataEncryption: true
        },
        savedQueries: [],
        lastModified: new Date().toISOString()
    };
}

// Generate unique ID for saved queries
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}