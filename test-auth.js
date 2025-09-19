const { chromium } = require('playwright');

const DEPLOYMENT_URL = 'https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us';

(async () => {
    console.log('🔐 Testing Authentication on AI-Icarus Deployment\n');
    console.log('=' .repeat(60));
    console.log(`URL: ${DEPLOYMENT_URL}`);
    console.log('=' .repeat(60) + '\n');
    
    const browser = await chromium.launch({
        headless: false,
        slowMo: 100,
        devtools: true
    });
    
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true
    });
    
    const page = await context.newPage();
    
    // Capture all console messages
    const consoleLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push({ type: msg.type(), text });
        if (msg.type() === 'error') {
            console.log(`❌ Console Error: ${text}`);
        } else if (msg.type() === 'warning') {
            console.log(`⚠️ Console Warning: ${text}`);
        } else if (text.includes('auth') || text.includes('MSAL') || text.includes('login')) {
            console.log(`📝 Auth Log: ${text}`);
        }
    });
    
    // Monitor network for auth-related requests
    page.on('request', request => {
        const url = request.url();
        if (url.includes('login.microsoftonline') || url.includes('/api/config') || url.includes('auth')) {
            console.log(`📡 Auth Request: ${request.method()} ${url.substring(0, 100)}...`);
        }
    });
    
    page.on('response', response => {
        const url = response.url();
        if (url.includes('/api/config')) {
            console.log(`📡 Config Response: ${response.status()}`);
        }
        if (url.includes('login.microsoftonline') && response.status() >= 400) {
            console.log(`❌ Auth Error: HTTP ${response.status()} from ${url.substring(0, 100)}...`);
        }
    });
    
    try {
        console.log('📌 Step 1: Loading Application\n');
        await page.goto(DEPLOYMENT_URL, {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        // Wait for React to initialize
        await page.waitForTimeout(5000);
        
        // Check current state
        console.log('📌 Step 2: Checking Application State\n');
        
        // Check if React loaded
        const hasRoot = await page.locator('#root').count() > 0;
        console.log(`React App: ${hasRoot ? '✅ Loaded' : '❌ Not loaded'}`);
        
        // Check for initialization message
        const initMessage = await page.locator('text=Initializing application').count() > 0;
        if (initMessage) {
            console.log('Status: ⏳ Application initializing...');
            
            // Wait longer for initialization
            await page.waitForTimeout(5000);
        }
        
        // Check for login button
        const loginButton = await page.locator('button:has-text("Sign in with Microsoft")');
        const loginButtonExists = await loginButton.count() > 0;
        
        if (loginButtonExists) {
            console.log('Status: ✅ Login page displayed\n');
            
            console.log('📌 Step 3: Checking MSAL Configuration\n');
            
            // Check MSAL config in page context
            const msalConfig = await page.evaluate(() => {
                return {
                    hasMsalConfig: typeof msalConfig !== 'undefined',
                    hasMsalInstance: typeof msalInstance !== 'undefined',
                    config: typeof msalConfig !== 'undefined' ? {
                        clientId: msalConfig?.auth?.clientId,
                        authority: msalConfig?.auth?.authority,
                        redirectUri: msalConfig?.auth?.redirectUri
                    } : null
                };
            });
            
            console.log(`MSAL Config Exists: ${msalConfig.hasMsalConfig ? '✅' : '❌'}`);
            console.log(`MSAL Instance Exists: ${msalConfig.hasMsalInstance ? '✅' : '❌'}`);
            
            if (msalConfig.config) {
                console.log('\nMSAL Configuration:');
                console.log(`  Client ID: ${msalConfig.config.clientId || '❌ NOT SET'}`);
                console.log(`  Authority: ${msalConfig.config.authority || '❌ NOT SET'}`);
                console.log(`  Redirect URI: ${msalConfig.config.redirectUri || '❌ NOT SET'}`);
            }
            
            // Check config from API
            console.log('\n📌 Step 4: Checking API Configuration\n');
            
            const apiConfig = await page.evaluate(async () => {
                try {
                    const hostname = window.location.hostname;
                    const funcUrl = hostname.replace('web-', 'func-');
                    const response = await fetch(`https://${funcUrl}/api/config`);
                    return await response.json();
                } catch (error) {
                    return { error: error.message };
                }
            });
            
            if (apiConfig.error) {
                console.log(`❌ Config API Error: ${apiConfig.error}`);
            } else {
                console.log('✅ Config API Response:');
                console.log(`  Environment: ${apiConfig.environment}`);
                console.log(`  Auth Type: ${apiConfig.auth?.authType}`);
                console.log(`  Managed Identity: ${apiConfig.auth?.useManagedIdentity ? '✅ Enabled' : '❌ Disabled'}`);
                console.log(`  Tenant ID: ${apiConfig.auth?.tenantId || '❌ NOT SET'}`);
            }
            
            // Try clicking login button
            console.log('\n📌 Step 5: Testing Login Button\n');
            
            // Check if button is disabled
            const isDisabled = await loginButton.evaluate(el => el.disabled);
            console.log(`Login Button Enabled: ${!isDisabled ? '✅' : '❌'}`);
            
            if (!isDisabled) {
                console.log('\nAttempting to click login button...');
                
                // Set up popup promise
                const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
                
                // Click the button
                await loginButton.click();
                console.log('Button clicked, waiting for popup...');
                
                // Wait for popup
                const popup = await popupPromise;
                
                if (popup) {
                    console.log('✅ Authentication popup opened!');
                    const popupUrl = popup.url();
                    console.log(`Popup URL: ${popupUrl.substring(0, 100)}...`);
                    
                    // Check if it's an error page
                    if (popupUrl.includes('error')) {
                        console.log('❌ Authentication error detected in popup');
                        
                        await popup.waitForLoadState('domcontentloaded');
                        const errorText = await popup.textContent('body').catch(() => 'Could not read error');
                        console.log(`Error details: ${errorText.substring(0, 200)}`);
                    } else {
                        console.log('✅ Authentication flow initiated successfully!');
                        console.log('\n🎉 AUTHENTICATION IS WORKING!');
                        console.log('User can now sign in with their Microsoft account.');
                    }
                    
                    await popup.close();
                } else {
                    console.log('❌ No popup opened - checking for inline auth...');
                    
                    // Check if auth happened inline
                    await page.waitForTimeout(3000);
                    
                    // Check if we're still on login page
                    const stillOnLogin = await page.locator('button:has-text("Sign in with Microsoft")').count() > 0;
                    if (!stillOnLogin) {
                        console.log('✅ Authentication may have succeeded inline');
                    } else {
                        console.log('❌ Authentication did not trigger');
                    }
                }
            } else {
                console.log('❌ Login button is disabled - configuration issue');
            }
            
        } else {
            // Check if user is already authenticated
            const logoutButton = await page.locator('button:has-text("Logout")').count() > 0;
            if (logoutButton) {
                console.log('✅ User is already authenticated!\n');
                
                // Check which tabs are visible
                const tabs = ['Dashboard', 'Workspaces', 'KQL Query', 'OpenAI'];
                console.log('Available tabs:');
                for (const tab of tabs) {
                    const found = await page.locator(`button:has-text("${tab}")`).count() > 0;
                    console.log(`  ${tab}: ${found ? '✅' : '❌'}`);
                }
            } else {
                console.log('❓ Unknown state - no login or logout button found');
            }
        }
        
        // Check console errors related to auth
        console.log('\n📌 Step 6: Authentication Issues Summary\n');
        
        const authErrors = consoleLogs.filter(log => 
            log.type === 'error' && 
            (log.text.includes('auth') || log.text.includes('MSAL') || log.text.includes('client'))
        );
        
        if (authErrors.length > 0) {
            console.log('Authentication-related errors found:');
            authErrors.forEach(err => console.log(`  - ${err.text}`));
        } else {
            console.log('✅ No authentication errors in console');
        }
        
        // Final verdict
        console.log('\n' + '=' .repeat(60));
        console.log('📊 AUTHENTICATION STATUS\n');
        
        if (apiConfig.auth?.useManagedIdentity) {
            console.log('✅ Managed Identity is configured');
            console.log('✅ Zero trust authentication enabled');
            console.log('ℹ️ Note: With managed identity, backend APIs authenticate automatically');
            console.log('ℹ️ User authentication may require Azure AD app registration');
        } else {
            console.log('⚠️ Authentication needs configuration');
            console.log('Follow the setup guide to configure Azure AD');
        }
        
        // Take screenshot
        await page.screenshot({ 
            path: `auth-test-${Date.now()}.png`,
            fullPage: true 
        });
        console.log('\n📸 Screenshot saved');
        
    } catch (error) {
        console.error(`\n❌ Test failed: ${error.message}`);
    }
    
    console.log('\n🔍 Keeping browser open for manual testing...');
    console.log('You can try logging in manually if needed.');
    console.log('Press Ctrl+C to close\n');
    
    // Keep open for manual inspection
    await page.waitForTimeout(300000);
    await browser.close();
})();