const { ConfidentialClientApplication } = require('@azure/msal-node');

module.exports = async function (context, req) {
    try {
        context.log('Token exchange function processing request');
        
        // Handle OPTIONS request for CORS
        if (req.method === 'OPTIONS') {
            context.res = {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MS-CLIENT-PRINCIPAL'
                },
                body: ''
            };
            return;
        }

        // Get client principal from header
        const clientPrincipalHeader = req.headers['x-ms-client-principal'];
        
        if (!clientPrincipalHeader) {
            context.res = {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: { 
                    error: 'Authentication required',
                    message: 'No client principal provided'
                }
            };
            return;
        }

        // Decode client principal
        let userPrincipal;
        try {
            const buffer = Buffer.from(clientPrincipalHeader, 'base64');
            userPrincipal = JSON.parse(buffer.toString('utf-8'));
            context.log(`User authenticated: ${userPrincipal.userDetails}`);
        } catch (error) {
            context.log.error('Failed to parse client principal:', error);
            context.res = {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: { 
                    error: 'Invalid authentication',
                    message: 'Failed to parse client principal'
                }
            };
            return;
        }

        // For now, we'll use the client principal as-is
        // In production, you would implement On-Behalf-Of flow here
        // to exchange the principal for an Azure AD token
        
        // Note: Static Web Apps doesn't provide the actual access token
        // that can be used with Azure APIs. To use user permissions,
        // the frontend needs to obtain the token directly via MSAL.js
        
        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                success: true,
                message: 'Token exchange requires frontend MSAL.js implementation',
                userPrincipal: userPrincipal,
                note: 'Frontend should use MSAL.js to get Azure AD tokens directly',
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('Token exchange error:', error);
        
        context.res = {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: {
                error: 'Internal Server Error',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};