const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100,
        devtools: true
    });
    
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    
    console.log('🔍 Investigating Authentication Issues\n');
    console.log('=' .repeat(60));
    
    // Capture console messages
    const consoleLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push({ type: msg.type(), text });
        if (msg.type() === 'error') {
            console.log(`❌ Console Error: ${text}`);
        } else if (msg.type() === 'warning') {
            console.log(`⚠️ Console Warning: ${text}`);
        }
    });
    
    // Monitor network requests
    const apiCalls = [];
    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/') || url.includes('login.microsoftonline')) {
            apiCalls.push({
                method: request.method(),
                url: url,
                headers: request.headers()
            });
        }
    });
    
    // Monitor network responses
    page.on('response', response => {
        const url = response.url();
        if (url.includes('/api/config')) {
            console.log(`\n📡 Config API Response: ${response.status()}`);
        }
        if (response.status() >= 400) {
            console.log(`❌ HTTP ${response.status()}: ${url}`);
        }
    });
    
    // Monitor failed requests
    page.on('requestfailed', request => {
        console.log(`\n💥 Request Failed: ${request.url()}`);
        console.log(`   Reason: ${request.failure().errorText}`);
    });
    
    try {
        // Test the latest deployment
        const urls = [
            'https://web-aiicarus6-z33zhqltk3a5o.azurewebsites.us',
            'https://web-aiicarus5-ky5q5rqns6r4e.azurewebsites.us'
        ];
        
        for (const webUrl of urls) {
            console.log(`\n📌 Testing: ${webUrl}`);
            console.log('-'.repeat(60));
            
            try {
                await page.goto(webUrl, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });
                
                // Wait a bit for initialization
                await page.waitForTimeout(2000);
                
                // Check if React app loaded
                const hasRoot = await page.locator('#root').count() > 0;
                console.log(`✅ React App: ${hasRoot ? 'Loaded' : 'Not Found'}`);
                
                // Check for MSAL initialization
                const msalCheck = await page.evaluate(() => {
                    return {
                        hasMsalConfig: typeof msalConfig !== 'undefined',
                        hasMsalInstance: typeof msalInstance !== 'undefined',
                        msalConfig: typeof msalConfig !== 'undefined' ? {
                            clientId: msalConfig?.auth?.clientId,
                            authority: msalConfig?.auth?.authority
                        } : null
                    };
                });
                
                console.log(`\n🔐 MSAL Status:`);
                console.log(`   Config exists: ${msalCheck.hasMsalConfig}`);
                console.log(`   Instance exists: ${msalCheck.hasMsalInstance}`);
                if (msalCheck.msalConfig) {
                    console.log(`   Client ID: ${msalCheck.msalConfig.clientId || '❌ EMPTY'}`);
                    console.log(`   Authority: ${msalCheck.msalConfig.authority || '❌ EMPTY'}`);
                }
                
                // Try to get config from API
                const funcUrl = webUrl.replace('web-', 'func-');
                console.log(`\n🔧 Testing Config API: ${funcUrl}/api/config`);
                
                const configResponse = await page.evaluate(async (url) => {
                    try {
                        const response = await fetch(url);
                        const data = await response.json();
                        return { status: response.status, data };
                    } catch (error) {
                        return { error: error.message };
                    }
                }, `${funcUrl}/api/config`);
                
                if (configResponse.error) {
                    console.log(`   ❌ Config API Error: ${configResponse.error}`);
                } else {
                    console.log(`   Status: ${configResponse.status}`);
                    console.log(`   Environment: ${configResponse.data.environment}`);
                    console.log(`   Client ID: ${configResponse.data.auth?.clientId || '❌ NOT SET'}`);
                    console.log(`   Tenant ID: ${configResponse.data.auth?.tenantId || '❌ NOT SET'}`);
                    console.log(`   Authority: ${configResponse.data.auth?.authority || '❌ NOT SET'}`);
                }
                
                // Check for login button
                const loginButton = await page.locator('button:has-text("Sign in with Microsoft")');
                const hasLoginButton = await loginButton.count() > 0;
                
                if (hasLoginButton) {
                    console.log(`\n🔘 Login Button: Found`);
                    
                    // Get button click handler info
                    const buttonInfo = await loginButton.evaluate(el => {
                        return {
                            disabled: el.disabled,
                            onclick: el.onclick ? 'Has onclick' : 'No onclick',
                            listeners: el._reactInternalFiber ? 'Has React handlers' : 'No React handlers'
                        };
                    });
                    console.log(`   Button state:`, buttonInfo);
                    
                    // Try clicking to see what happens
                    console.log(`\n👆 Attempting to click login button...`);
                    
                    const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
                    
                    try {
                        await loginButton.click();
                        const popup = await popupPromise;
                        
                        if (popup) {
                            const popupUrl = popup.url();
                            console.log(`   ✅ Popup opened: ${popupUrl}`);
                            
                            if (popupUrl.includes('error')) {
                                console.log(`   ❌ Authentication error in popup`);
                                
                                // Try to get error details
                                await popup.waitForLoadState('domcontentloaded');
                                const errorText = await popup.textContent('body').catch(() => 'Could not read error');
                                console.log(`   Error details: ${errorText.substring(0, 200)}`);
                            }
                            
                            await popup.close();
                        } else {
                            console.log(`   ❌ No popup opened - MSAL likely not initialized`);
                        }
                    } catch (clickError) {
                        console.log(`   ❌ Click failed: ${clickError.message}`);
                    }
                } else {
                    console.log(`\n❌ No login button found`);
                }
                
                // Check console errors
                const errors = consoleLogs.filter(log => log.type === 'error');
                if (errors.length > 0) {
                    console.log(`\n📋 Console Errors Found:`);
                    errors.forEach(err => console.log(`   - ${err.text}`));
                }
                
                // Check environment settings
                console.log(`\n🌍 Environment Check:`);
                const envCheck = await page.evaluate(() => {
                    const hostname = window.location.hostname;
                    return {
                        hostname,
                        isGovCloud: hostname.includes('.us'),
                        apiBaseUrl: typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'Not defined',
                        endpoints: typeof endpoints !== 'undefined' ? endpoints : 'Not defined'
                    };
                });
                
                console.log(`   Hostname: ${envCheck.hostname}`);
                console.log(`   Gov Cloud: ${envCheck.isGovCloud ? '✅ Yes' : '❌ No'}`);
                console.log(`   API Base: ${envCheck.apiBaseUrl}`);
                
                // Check if initialization happened
                const initCheck = await page.evaluate(() => {
                    return {
                        hasInitializeApp: typeof initializeApp !== 'undefined',
                        hasUser: typeof user !== 'undefined',
                        reactMounted: document.querySelector('#root')?.children?.length > 0
                    };
                });
                
                console.log(`\n🚀 Initialization Check:`);
                console.log(`   initializeApp function: ${initCheck.hasInitializeApp}`);
                console.log(`   React mounted: ${initCheck.reactMounted}`);
                
            } catch (error) {
                console.log(`\n❌ Error testing ${webUrl}: ${error.message}`);
            }
        }
        
        // Diagnosis
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📊 DIAGNOSIS SUMMARY\n`);
        
        const issues = [];
        
        // Check common issues
        if (consoleLogs.some(log => log.text.includes('msalConfig'))) {
            issues.push('MSAL configuration errors detected');
        }
        if (consoleLogs.some(log => log.text.includes('clientId'))) {
            issues.push('Client ID configuration issue');
        }
        if (consoleLogs.some(log => log.text.includes('authority'))) {
            issues.push('Authority URL configuration issue');
        }
        
        if (issues.length > 0) {
            console.log(`❌ Issues Found:`);
            issues.forEach(issue => console.log(`   - ${issue}`));
        }
        
        console.log(`\n🔧 RECOMMENDED FIXES:\n`);
        console.log(`1. Create Azure AD App Registration:`);
        console.log(`   - Go to portal.azure.us`);
        console.log(`   - Azure Active Directory > App registrations > New`);
        console.log(`   - Set redirect URI to: https://web-aiicarus6-z33zhqltk3a5o.azurewebsites.us`);
        console.log(`\n2. Update Function App Configuration:`);
        console.log(`   az functionapp config appsettings set \\`);
        console.log(`     --resource-group YOUR_RG \\`);
        console.log(`     --name func-aiicarus6-z33zhqltk3a5o \\`);
        console.log(`     --settings AZURE_CLIENT_ID="YOUR_CLIENT_ID"`);
        console.log(`\n3. Update Web App Configuration:`);
        console.log(`   az webapp config appsettings set \\`);
        console.log(`     --resource-group YOUR_RG \\`);
        console.log(`     --name web-aiicarus6-z33zhqltk3a5o \\`);
        console.log(`     --settings AZURE_CLIENT_ID="YOUR_CLIENT_ID"`);
        
    } catch (error) {
        console.error(`\n💥 Investigation failed: ${error.message}`);
    }
    
    console.log(`\n⏸️ Keeping browser open for manual inspection...`);
    await page.waitForTimeout(300000);
})();