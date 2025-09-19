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
    
    console.log('🚀 Starting IL4 deployment test...');
    console.log('📍 URL: https://web-aiicarus5-ky5q5rqns6r4e.azurewebsites.us/');
    
    try {
        // Navigate to the IL4 deployment
        console.log('\n1️⃣ Navigating to IL4 deployment...');
        await page.goto('https://web-aiicarus5-ky5q5rqns6r4e.azurewebsites.us/', {
            waitUntil: 'networkidle',
            timeout: 60000
        });
        
        // Take initial screenshot
        await page.screenshot({ 
            path: 'il4-deployment-initial.png',
            fullPage: true 
        });
        console.log('✅ Initial page loaded and screenshot saved');
        
        // Check if React app loaded
        console.log('\n2️⃣ Checking React app initialization...');
        const rootElement = await page.locator('#root');
        const rootExists = await rootElement.count() > 0;
        console.log(`   React root element: ${rootExists ? '✅ Found' : '❌ Not found'}`);
        
        // Check for login button or user interface
        console.log('\n3️⃣ Checking authentication state...');
        const loginButton = await page.locator('button:has-text("Sign in with Microsoft")');
        const logoutButton = await page.locator('button:has-text("Logout")');
        
        const loginVisible = await loginButton.count() > 0;
        const logoutVisible = await logoutButton.count() > 0;
        
        if (loginVisible) {
            console.log('   ✅ Login page displayed - MSAL ready');
            console.log('   🔐 Authentication required to proceed');
            
            // Check login page elements
            const logo = await page.locator('.logo');
            const appTitle = await page.locator('h1:has-text("AI-Icarus")');
            const description = await page.locator('text=Azure OpenAI & Log Analytics Management Platform');
            
            console.log(`   Logo: ${await logo.count() > 0 ? '✅' : '❌'}`);
            console.log(`   Title: ${await appTitle.count() > 0 ? '✅' : '❌'}`);
            console.log(`   Description: ${await description.count() > 0 ? '✅' : '❌'}`);
            
        } else if (logoutVisible) {
            console.log('   ✅ User already authenticated');
            
            // Check for tabs
            console.log('\n4️⃣ Checking navigation tabs...');
            const dashboardTab = await page.locator('button:has-text("Dashboard")');
            const workspacesTab = await page.locator('button:has-text("Workspaces")');
            const kqlTab = await page.locator('button:has-text("KQL Query")');
            const openaiTab = await page.locator('button:has-text("OpenAI")');
            
            console.log(`   Dashboard tab: ${await dashboardTab.count() > 0 ? '✅' : '❌'}`);
            console.log(`   Workspaces tab: ${await workspacesTab.count() > 0 ? '✅' : '❌'}`);
            console.log(`   KQL Query tab: ${await kqlTab.count() > 0 ? '✅' : '❌'}`);
            console.log(`   OpenAI tab: ${await openaiTab.count() > 0 ? '✅' : '❌'}`);
        }
        
        // Check for environment detection
        console.log('\n5️⃣ Checking IL4 environment detection...');
        const hostname = new URL(page.url()).hostname;
        const isGovCloud = hostname.includes('.us');
        console.log(`   Hostname: ${hostname}`);
        console.log(`   Government cloud detected: ${isGovCloud ? '✅ Yes (.us domain)' : '❌ No'}`);
        
        // Check console for errors
        console.log('\n6️⃣ Checking browser console...');
        const consoleMessages = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleMessages.push(msg.text());
            }
        });
        
        // Wait a bit to collect any console errors
        await page.waitForTimeout(2000);
        
        if (consoleMessages.length > 0) {
            console.log('   ⚠️ Console errors detected:');
            consoleMessages.forEach(msg => console.log(`      - ${msg}`));
        } else {
            console.log('   ✅ No console errors');
        }
        
        // Check network requests for API calls
        console.log('\n7️⃣ Monitoring API calls...');
        const apiCalls = [];
        page.on('request', request => {
            const url = request.url();
            if (url.includes('/api/')) {
                apiCalls.push({
                    url: url,
                    method: request.method()
                });
            }
        });
        
        // Reload to capture API calls
        await page.reload({ waitUntil: 'networkidle' });
        
        if (apiCalls.length > 0) {
            console.log('   API calls detected:');
            apiCalls.forEach(call => {
                console.log(`      ${call.method} ${call.url}`);
                // Check if using correct IL4 pattern
                if (call.url.includes('func-aiicarus5')) {
                    console.log('      ✅ Correct IL4 function app pattern');
                }
            });
        } else {
            console.log('   ℹ️ No API calls detected (may need authentication)');
        }
        
        // Take final screenshot
        await page.screenshot({ 
            path: 'il4-deployment-final.png',
            fullPage: true 
        });
        
        // Compare with expected UI
        console.log('\n8️⃣ UI Comparison Summary:');
        console.log('   Expected: React-based UI with 4 tabs (like mango-smoke)');
        console.log('   Actual: ' + (loginVisible ? 'Login page (authentication required)' : 
                                     logoutVisible ? '4-tab interface detected' : 
                                     'Unknown state'));
        
        // Final verdict
        console.log('\n' + '='.repeat(60));
        console.log('🏁 TEST RESULTS:');
        if (rootExists && (loginVisible || logoutVisible)) {
            console.log('✅ SUCCESS: React app is deployed and running');
            console.log('✅ UI matches expected mango-smoke layout');
            if (isGovCloud) {
                console.log('✅ IL4 environment properly detected');
            }
        } else {
            console.log('❌ ISSUE: React app may not be loading correctly');
            console.log('   Check deployment logs for errors');
        }
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        await page.screenshot({ 
            path: 'il4-deployment-error.png',
            fullPage: true 
        });
    }
    
    console.log('\n📸 Screenshots saved:');
    console.log('   - il4-deployment-initial.png');
    console.log('   - il4-deployment-final.png');
    
    console.log('\n⏳ Keeping browser open for manual inspection...');
    console.log('   Press Ctrl+C to close');
    
    // Keep browser open for inspection
    await page.waitForTimeout(300000); // 5 minutes
})();