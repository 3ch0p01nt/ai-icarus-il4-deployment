const { chromium } = require('playwright');

(async () => {
    console.log('🔐 Testing AI-Icarus Login Capability\n');
    console.log('=' .repeat(60));
    
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100 
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Monitor console
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`❌ Console Error: ${msg.text()}`);
        }
    });
    
    try {
        // Navigate to the app
        console.log('📡 Navigating to: https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us');
        await page.goto('https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us');
        await page.waitForTimeout(2000);
        
        // Check for login button
        const loginButton = page.locator('button:has-text("Sign in with Microsoft")');
        const loginExists = await loginButton.count() > 0;
        
        if (loginExists) {
            console.log('✅ Login button found');
            console.log('🔑 Clicking "Sign in with Microsoft"...');
            
            // Click login button - this will open Microsoft login popup
            const [popup] = await Promise.all([
                page.waitForEvent('popup'),
                loginButton.click()
            ]);
            
            console.log('🔓 Microsoft login popup opened');
            console.log('   URL:', popup.url().substring(0, 50) + '...');
            
            // The popup will require actual user credentials
            console.log('\n⚠️  MANUAL INTERVENTION REQUIRED:');
            console.log('   Please enter your Microsoft credentials in the popup window');
            console.log('   The browser will remain open for you to complete authentication\n');
            
            // Wait for potential redirect back to app
            await page.waitForTimeout(5000);
            
            // Check if authenticated
            const authenticated = await page.locator('.user-menu').count() > 0;
            if (authenticated) {
                console.log('✅ Successfully authenticated!');
                const userName = await page.locator('.user-name').textContent();
                console.log(`   Logged in as: ${userName}`);
            } else {
                console.log('⏳ Waiting for authentication to complete...');
            }
            
        } else {
            // Already authenticated?
            const userMenu = await page.locator('.user-menu').count() > 0;
            if (userMenu) {
                console.log('✅ Already authenticated');
                const userName = await page.locator('.user-name').textContent();
                console.log(`   Logged in as: ${userName}`);
            } else {
                console.log('❓ Unknown state - no login button or user menu found');
            }
        }
        
        console.log('\n' + '=' .repeat(60));
        console.log('Browser will remain open for testing. Press Ctrl+C to close.\n');
        
        // Keep browser open
        await new Promise(() => {});
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        await browser.close();
    }
})();
