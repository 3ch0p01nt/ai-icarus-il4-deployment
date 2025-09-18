/**
 * MSAL Authentication Configuration for AI-Icarus
 * Enables proper Azure AD authentication with Log Analytics permissions
 */

// MSAL Configuration
const msalConfig = {
    auth: {
        clientId: "ecba9fbd-dc5b-472d-bcec-c2a0b6a67304", // Your existing App ID
        authority: "https://login.microsoftonline.com/a30b4895-7840-4802-8694-7ad40d5d2551",
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin
    },
    cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false
    },
    system: {
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) return;
                switch (level) {
                    case msal.LogLevel.Error:
                        console.error(message);
                        return;
                    case msal.LogLevel.Info:
                        console.info(message);
                        return;
                    case msal.LogLevel.Verbose:
                        console.debug(message);
                        return;
                    case msal.LogLevel.Warning:
                        console.warn(message);
                        return;
                }
            }
        }
    }
};

// Scopes for different services
const loginRequest = {
    scopes: [
        "openid",
        "profile",
        "User.Read",
        "https://api.loganalytics.io/Data.Read", // Log Analytics read permission
        "https://management.azure.com/user_impersonation" // Azure Management API
    ]
};

// Government cloud configurations
const govCloudConfig = {
    auth: {
        clientId: "ecba9fbd-dc5b-472d-bcec-c2a0b6a67304",
        authority: "https://login.microsoftonline.us/a30b4895-7840-4802-8694-7ad40d5d2551",
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin
    },
    cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false
    }
};

const govLoginRequest = {
    scopes: [
        "openid",
        "profile",
        "User.Read",
        "https://api.loganalytics.us/Data.Read", // Gov cloud Log Analytics
        "https://management.usgovcloudapi.net/user_impersonation" // Gov cloud Management
    ]
};

// Helper class for MSAL authentication
class MSALAuthProvider {
    constructor() {
        this.msalInstance = null;
        this.account = null;
        this.environment = 'AzureCloud';
    }

    async initialize(environment = 'AzureCloud') {
        this.environment = environment;
        
        // Load MSAL library if not already loaded
        if (!window.msal) {
            await this.loadMSAL();
        }

        // Select config based on environment
        const config = environment === 'AzureUSGovernment' || environment === 'AzureDoD' 
            ? govCloudConfig 
            : msalConfig;
        
        this.msalInstance = new msal.PublicClientApplication(config);
        await this.msalInstance.initialize();
        
        // Handle redirect response
        const response = await this.msalInstance.handleRedirectPromise();
        if (response && response.account) {
            this.account = response.account;
            this.msalInstance.setActiveAccount(response.account);
        }
        
        // Check if already logged in
        const accounts = this.msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            this.account = accounts[0];
            this.msalInstance.setActiveAccount(accounts[0]);
        }
        
        return this.account;
    }

    async loadMSAL() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://alcdn.msauth.net/browser/2.38.0/js/msal-browser.min.js';
            script.onload = () => {
                console.log('MSAL library loaded');
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async login() {
        try {
            const request = this.environment === 'AzureUSGovernment' || this.environment === 'AzureDoD'
                ? govLoginRequest
                : loginRequest;
            
            // Try popup first, fallback to redirect
            try {
                const response = await this.msalInstance.loginPopup(request);
                this.account = response.account;
                this.msalInstance.setActiveAccount(response.account);
                return response;
            } catch (popupError) {
                console.warn('Popup blocked, using redirect:', popupError);
                await this.msalInstance.loginRedirect(request);
            }
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async logout() {
        const logoutRequest = {
            account: this.msalInstance.getActiveAccount(),
            postLogoutRedirectUri: window.location.origin
        };
        await this.msalInstance.logoutRedirect(logoutRequest);
    }

    async getToken(scopes) {
        if (!this.account) {
            throw new Error('No active account. Please login first.');
        }

        const request = {
            scopes: scopes || loginRequest.scopes,
            account: this.account
        };

        try {
            // Try silent token acquisition first
            const response = await this.msalInstance.acquireTokenSilent(request);
            return response.accessToken;
        } catch (error) {
            // If silent fails, use popup
            console.warn('Silent token acquisition failed, using popup');
            const response = await this.msalInstance.acquireTokenPopup(request);
            return response.accessToken;
        }
    }

    async getLogAnalyticsToken() {
        const scopes = this.environment === 'AzureUSGovernment' || this.environment === 'AzureDoD'
            ? ['https://api.loganalytics.us/Data.Read']
            : ['https://api.loganalytics.io/Data.Read'];
        
        return this.getToken(scopes);
    }

    async getManagementToken() {
        const scopes = this.environment === 'AzureUSGovernment' || this.environment === 'AzureDoD'
            ? ['https://management.usgovcloudapi.net/user_impersonation']
            : ['https://management.azure.com/user_impersonation'];
        
        return this.getToken(scopes);
    }

    getAccount() {
        return this.account;
    }

    isAuthenticated() {
        return !!this.account;
    }
}

// Export for use in main application
window.MSALAuthProvider = MSALAuthProvider;