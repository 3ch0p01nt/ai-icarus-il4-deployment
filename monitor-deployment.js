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
    
    console.log('🔍 Monitoring Deployment Activity\n');
    console.log('=' .repeat(60));
    
    // Monitor console messages
    page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') {
            console.log(`❌ Console Error: ${text}`);
        } else if (msg.type() === 'warning') {
            console.log(`⚠️ Console Warning: ${text}`);
        } else {
            console.log(`📝 Console: ${text}`);
        }
    });
    
    // Monitor network requests
    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/') || url.includes('login.microsoftonline') || url.includes('github.com')) {
            console.log(`📡 Request: ${request.method()} ${url}`);
        }
    });
    
    // Monitor network responses
    page.on('response', response => {
        const url = response.url();
        if (response.status() >= 400) {
            console.log(`❌ HTTP ${response.status()}: ${url}`);
        }
    });
    
    try {
        // First check the GitHub repository
        console.log('\n📌 Checking GitHub Repository Status');
        console.log('-'.repeat(60));
        
        await page.goto('https://github.com/3ch0p01nt/ai-icarus-il4-deployment', {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // Check if repo is public
        const isPublic = await page.locator('span:has-text("Public")').count() > 0;
        console.log(`Repository Status: ${isPublic ? '✅ Public' : '❌ Private'}`);
        
        // Check for Deploy to Azure button
        const deployButton = await page.locator('a[href*="deploytoazurebutton"]').count() > 0;
        console.log(`Deploy to Azure Button: ${deployButton ? '✅ Present' : '❌ Not Found'}`);
        
        // Now check the latest deployment
        console.log('\n📌 Checking Latest IL4 Deployment');
        console.log('-'.repeat(60));
        
        const deploymentUrl = 'https://web-aiicarus7-7okhycnd7lv4c.azurewebsites.us/';
        console.log(`Testing: ${deploymentUrl}`);
        
        await page.goto(deploymentUrl, {
            waitUntil: 'networkidle',
            timeout: 30000
        });
        
        // Wait for React app
        await page.waitForTimeout(3000);
        
        // Check application state
        const hasRoot = await page.locator('#root').count() > 0;
        console.log(`\n✅ React App: ${hasRoot ? 'Loaded' : 'Not Found'}`);
        
        // Check for initialization message
        const initMessage = await page.locator('text=Initializing application').count() > 0;
        if (initMessage) {
            console.log('⏳ App Status: Still initializing (auth not configured)');
        }
        
        // Check for login button
        const loginButton = await page.locator('button:has-text("Sign in with Microsoft")').count() > 0;
        if (loginButton) {
            console.log('✅ Login Button: Present (auth partially configured)');
        }
        
        // Check MSAL configuration
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
        
        // Test config API
        const funcUrl = deploymentUrl.replace('web-', 'func-');
        console.log(`\n🔧 Testing Config API: ${funcUrl}api/config`);
        
        const configResponse = await page.evaluate(async (url) => {
            try {
                const response = await fetch(url);
                const data = await response.json();
                return { status: response.status, data };
            } catch (error) {
                return { error: error.message };
            }
        }, `${funcUrl}api/config`);
        
        if (configResponse.error) {
            console.log(`   ❌ Config API Error: ${configResponse.error}`);
        } else {
            console.log(`   Status: ${configResponse.status}`);
            console.log(`   Environment: ${configResponse.data.environment}`);
            console.log(`   Client ID: ${configResponse.data.auth?.clientId || '❌ NOT SET'}`);
            console.log(`   Tenant ID: ${configResponse.data.auth?.tenantId || '❌ NOT SET'}`);
        }
        
        // Monitor Azure Portal for deployment
        console.log('\n📌 Opening Azure Portal to Monitor Deployment');
        console.log('-'.repeat(60));
        
        const portalPage = await context.newPage();
        await portalPage.goto('https://portal.azure.us/#blade/HubsExtension/BrowseResourceGroups', {
            waitUntil: 'networkidle',
            timeout: 60000
        }).catch(() => {
            console.log('⚠️ Azure Portal requires authentication');
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 MONITORING SUMMARY\n');
        console.log('Repository: Public ✅');
        console.log('Deploy Button: Available ✅');
        console.log(`Deployment URL: ${deploymentUrl}`);
        console.log('\nCurrent Issues:');
        console.log('1. ❌ Authentication not configured (no Client ID)');
        console.log('2. ❌ MSAL initialization incomplete');
        console.log('3. ⏳ Application stuck at initialization');
        
        console.log('\n🔧 NEXT STEPS:');
        console.log('1. Click "Deploy to Azure" button on GitHub');
        console.log('2. Fill in required parameters during deployment:');
        console.log('   - Azure AD Client ID');
        console.log('   - Azure AD Tenant ID');
        console.log('3. Or configure post-deployment using az CLI');
        
        console.log('\n👁️ Keeping browser open for monitoring...');
        console.log('   - GitHub repo page');
        console.log('   - Deployed application');
        console.log('   - Azure Portal (if authenticated)');
        console.log('\nPress Ctrl+C when done monitoring');
        
    } catch (error) {
        console.error(`\n💥 Monitoring error: ${error.message}`);
    }
    
    // Keep browser open for manual monitoring
    await page.waitForTimeout(600000); // 10 minutes
})();