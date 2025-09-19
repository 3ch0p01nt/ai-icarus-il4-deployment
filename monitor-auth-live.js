const { chromium } = require('playwright');

const APP_URL = 'https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us';

(async () => {
    console.log('🚀 Opening AI-Icarus Application on Argon IL4\n');
    console.log('=' .repeat(60));
    console.log(`URL: ${APP_URL}`);
    console.log('=' .repeat(60) + '\n');
    
    const browser = await chromium.launch({
        headless: false,
        slowMo: 100,
        devtools: false
    });
    
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true
    });
    
    const page = await context.newPage();
    
    // Monitor console messages
    page.on('console', msg => {
        const text = msg.text();
        const type = msg.type();
        
        if (type === 'error') {
            console.log(`❌ Console Error: ${text}`);
        } else if (type === 'warning') {
            console.log(`⚠️ Console Warning: ${text}`);
        } else if (text.includes('auth') || text.includes('MSAL') || text.includes('login') || text.includes('token')) {
            console.log(`🔐 Auth: ${text}`);
        }
    });
    
    // Monitor authentication requests
    page.on('request', request => {
        const url = request.url();
        if (url.includes('login.microsoftonline') || url.includes('oauth') || url.includes('token')) {
            console.log(`📡 Auth Request: ${request.method()} ${url.substring(0, 80)}...`);
        }
        if (url.includes('/api/')) {
            console.log(`📡 API Call: ${request.method()} ${url.substring(url.indexOf('/api/'))}`)
        }
    });
    
    // Monitor responses
    page.on('response', response => {
        const url = response.url();
        const status = response.status();
        
        if (url.includes('login.microsoftonline') && status !== 200) {
            console.log(`⚠️ Auth Response: ${status} from Microsoft login`);
        }
        if (url.includes('/api/config')) {
            console.log(`✅ Config API Response: ${status}`);
        }
    });
    
    // Monitor popups for auth
    page.on('popup', popup => {
        console.log('🔓 Authentication popup opened');
        popup.on('close', () => {
            console.log('🔐 Authentication popup closed');
        });
    });
    
    try {
        console.log('📌 Loading Application...\n');
        await page.goto(APP_URL, {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        console.log('✅ Application loaded successfully\n');
        
        // Wait for React to initialize
        await page.waitForTimeout(3000);
        
        // Check current state
        console.log('📌 Current Application State:\n');
        
        // Check for React app
        const hasRoot = await page.locator('#root').count() > 0;
        console.log(`  React Application: ${hasRoot ? '✅ Loaded' : '❌ Not loaded'}`);
        
        // Check for login button
        const loginButton = await page.locator('button:has-text("Sign in with Microsoft")');
        const hasLoginButton = await loginButton.count() > 0;
        
        // Check for logout button (already authenticated)
        const logoutButton = await page.locator('button:has-text("Logout")');
        const hasLogoutButton = await logoutButton.count() > 0;
        
        if (hasLoginButton) {
            console.log('  Authentication: 🔓 Not signed in (login page displayed)');
            console.log('\n✅ Ready for authentication!\n');
            
            // Check MSAL configuration
            const msalStatus = await page.evaluate(() => {
                if (typeof msalConfig !== 'undefined' && msalConfig?.auth?.clientId) {
                    return {
                        configured: true,
                        clientId: msalConfig.auth.clientId,
                        authority: msalConfig.auth.authority
                    };
                }
                return { configured: false };
            });
            
            if (msalStatus.configured) {
                console.log('🔐 MSAL Configuration:');
                console.log(`  Client ID: ${msalStatus.clientId}`);
                console.log(`  Authority: ${msalStatus.authority}`);
                console.log('\n📋 Authentication Instructions:');
                console.log('  1. Click "Sign in with Microsoft" button');
                console.log('  2. Enter your Argon credentials');
                console.log('  3. Complete MFA if required');
                console.log('  4. You\'ll be redirected back to the app\n');
            } else {
                console.log('⚠️ MSAL not fully configured yet - may need a refresh');
            }
            
            // Highlight the login button
            await loginButton.evaluate(el => {
                el.style.border = '3px solid #00ff00';
                el.style.boxShadow = '0 0 20px #00ff00';
            });
            
            console.log('✨ Login button highlighted in green\n');
            
        } else if (hasLogoutButton) {
            console.log('  Authentication: ✅ Already signed in!');
            
            // Check for user info
            const userInfo = await page.evaluate(() => {
                const userElement = document.querySelector('.user-info');
                return userElement ? userElement.textContent : null;
            });
            
            if (userInfo) {
                console.log(`  User: ${userInfo}`);
            }
            
            // Check available tabs
            console.log('\n📊 Available Features:');
            const tabs = ['Dashboard', 'Workspaces', 'KQL Query', 'OpenAI'];
            for (const tab of tabs) {
                const hasTab = await page.locator(`button:has-text("${tab}")`).count() > 0;
                console.log(`  ${tab}: ${hasTab ? '✅ Available' : '❌ Not found'}`);
            }
        } else {
            console.log('  Authentication: ⏳ Initializing...');
        }
        
        // Monitor for authentication changes
        console.log('\n👁️ Monitoring authentication status...');
        console.log('The browser will stay open for you to test authentication.\n');
        
        // Set up monitoring loop
        let lastState = hasLoginButton ? 'logged-out' : hasLogoutButton ? 'logged-in' : 'initializing';
        
        const checkInterval = setInterval(async () => {
            try {
                const currentLoginButton = await page.locator('button:has-text("Sign in with Microsoft")').count() > 0;
                const currentLogoutButton = await page.locator('button:has-text("Logout")').count() > 0;
                
                const currentState = currentLoginButton ? 'logged-out' : currentLogoutButton ? 'logged-in' : 'initializing';
                
                if (currentState !== lastState) {
                    console.log('\n🔄 Authentication state changed!');
                    
                    if (currentState === 'logged-in') {
                        console.log('✅ Successfully authenticated!');
                        
                        // Check for tabs
                        console.log('\nVerifying application features:');
                        const tabs = ['Dashboard', 'Workspaces', 'KQL Query', 'OpenAI'];
                        for (const tab of tabs) {
                            const hasTab = await page.locator(`button:has-text("${tab}")`).count() > 0;
                            console.log(`  ${tab}: ${hasTab ? '✅' : '❌'}`);
                        }
                        
                        // Take screenshot
                        await page.screenshot({
                            path: `authenticated-${Date.now()}.png`,
                            fullPage: true
                        });
                        console.log('\n📸 Screenshot saved of authenticated state');
                        
                    } else if (currentState === 'logged-out') {
                        console.log('🔓 Logged out - ready for authentication');
                    }
                    
                    lastState = currentState;
                }
            } catch (error) {
                // Page might have navigated, ignore errors
            }
        }, 2000);
        
        // Keep browser open
        console.log('=' .repeat(60));
        console.log('Browser is ready for testing. Press Ctrl+C when done.\n');
        
        // Wait indefinitely
        await new Promise(() => {});
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
    }
})();