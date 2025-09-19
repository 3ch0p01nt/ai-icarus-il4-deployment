const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 500 
    });
    
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    
    const page = await context.newPage();
    
    console.log('🔍 Checking authentication configuration issues...\n');
    
    // Enable console logging
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
        }
    });
    
    // Monitor network failures
    page.on('requestfailed', request => {
        console.log(`❌ Request failed: ${request.url()}`);
        console.log(`   Failure: ${request.failure().errorText}`);
    });
    
    // Monitor responses
    page.on('response', response => {
        if (response.status() >= 400) {
            console.log(`⚠️ HTTP ${response.status()}: ${response.url()}`);
        }
    });
    
    try {
        console.log('1️⃣ Navigating to IL4 deployment...');
        await page.goto('https://web-aiicarus5-ky5q5rqns6r4e.azurewebsites.us/', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // Check for MSAL configuration errors
        console.log('\n2️⃣ Checking MSAL configuration...');
        
        // Try to get MSAL config from page
        const msalConfig = await page.evaluate(() => {
            // Check if msalConfig is defined
            if (typeof msalConfig !== 'undefined') {
                return {
                    clientId: msalConfig.auth.clientId,
                    authority: msalConfig.auth.authority,
                    redirectUri: msalConfig.auth.redirectUri
                };
            }
            return null;
        });
        
        if (msalConfig) {
            console.log('MSAL Configuration found:');
            console.log(`   Client ID: ${msalConfig.clientId || '❌ MISSING'}`);
            console.log(`   Authority: ${msalConfig.authority || '❌ MISSING'}`);
            console.log(`   Redirect URI: ${msalConfig.redirectUri}`);
            
            // Check if client ID is the default placeholder
            if (msalConfig.clientId === '00000000-0000-0000-0000-000000000000' || 
                msalConfig.clientId === '') {
                console.log('\n❌ PROBLEM: Client ID is not configured!');
                console.log('   The app needs a valid Azure AD app registration');
            }
        }
        
        // Check if config endpoint is accessible
        console.log('\n3️⃣ Testing /api/config endpoint...');
        const configUrl = 'https://func-aiicarus5-ky5q5rqns6r4e.azurewebsites.us/api/config';
        
        const configResponse = await page.evaluate(async (url) => {
            try {
                const response = await fetch(url);
                return {
                    status: response.status,
                    ok: response.ok,
                    data: await response.text()
                };
            } catch (error) {
                return { error: error.message };
            }
        }, configUrl);
        
        if (configResponse.error) {
            console.log(`   ❌ Config endpoint error: ${configResponse.error}`);
        } else {
            console.log(`   Status: ${configResponse.status}`);
            if (configResponse.ok) {
                try {
                    const configData = JSON.parse(configResponse.data);
                    console.log(`   Environment: ${configData.environment || 'Not set'}`);
                    console.log(`   Client ID in config: ${configData.clientId || '❌ NOT SET'}`);
                    console.log(`   Tenant ID in config: ${configData.tenantId || '❌ NOT SET'}`);
                } catch (e) {
                    console.log(`   Response: ${configResponse.data}`);
                }
            }
        }
        
        // Try to click login button to see what happens
        console.log('\n4️⃣ Attempting to trigger login...');
        const loginButton = await page.locator('button:has-text("Sign in with Microsoft")');
        
        if (await loginButton.count() > 0) {
            console.log('   Login button found, attempting click...');
            
            // Set up promise to wait for popup
            const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
            
            await loginButton.click();
            
            const popup = await popupPromise;
            if (popup) {
                console.log('   ✅ Login popup opened');
                console.log(`   Popup URL: ${popup.url()}`);
                
                // Check if it's the error page
                if (popup.url().includes('error')) {
                    console.log('   ❌ Login redirected to error page');
                }
                
                await popup.close();
            } else {
                console.log('   ❌ No popup opened - likely MSAL initialization failed');
            }
        }
        
        // Check browser console for specific errors
        await page.waitForTimeout(2000);
        
        console.log('\n5️⃣ Diagnosis Summary:');
        console.log('=' .repeat(50));
        console.log('AUTHENTICATION ISSUES DETECTED:\n');
        console.log('1. Client ID is not configured (using placeholder value)');
        console.log('2. The app needs an Azure AD app registration');
        console.log('3. The Function App needs AZURE_CLIENT_ID environment variable set');
        console.log('\nTO FIX:');
        console.log('1. Create an Azure AD app registration');
        console.log('2. Set the AZURE_CLIENT_ID in the Function App configuration');
        console.log('3. Add redirect URI: https://web-aiicarus5-ky5q5rqns6r4e.azurewebsites.us');
        console.log('4. Grant API permissions if needed');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
    
    console.log('\n⏳ Keeping browser open for inspection...');
    await page.waitForTimeout(300000);
})();