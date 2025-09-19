const { chromium } = require('playwright');

(async () => {
    console.log('🔐 Testing Login in Visible Browser\n');
    console.log('=' .repeat(60));
    
    const browser = await chromium.launch({ 
        headless: false,
        args: ['--disable-blink-features=AutomationControlled']
    });
    
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();
    
    // Monitor console and popups
    page.on('console', msg => {
        if (msg.text().includes('Login') || msg.text().includes('MSAL') || msg.type() === 'error') {
            console.log(`[${msg.type()}] ${msg.text()}`);
        }
    });
    
    page.on('popup', popup => {
        console.log('🔓 POPUP DETECTED!');
        console.log('  URL:', popup.url());
    });
    
    console.log('📡 Navigating to app...');
    await page.goto('https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us');
    
    console.log('⏳ Waiting for initialization...');
    await page.waitForTimeout(5000);
    
    // Try clicking login
    const loginBtn = await page.locator('button:has-text("Sign in with Microsoft")');
    if (await loginBtn.count() > 0) {
        console.log('✅ Login button found');
        console.log('🔑 Clicking login button...');
        
        // Listen for popup before clicking
        const [popup] = await Promise.all([
            page.waitForEvent('popup', { timeout: 10000 }).catch(() => null),
            loginBtn.click()
        ]);
        
        if (popup) {
            console.log('✅ LOGIN POPUP OPENED!');
            console.log('  Popup URL:', popup.url().substring(0, 80) + '...');
            console.log('\n⚠️  You can now enter credentials in the popup window');
        } else {
            console.log('❌ No popup opened - checking for errors...');
            
            // Check for any visible error messages
            const errorMsg = await page.locator('.notification-error').count();
            if (errorMsg > 0) {
                const error = await page.locator('.notification-message').textContent();
                console.log('  Error message:', error);
            }
        }
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('Browser will stay open. Press Ctrl+C to close.\n');
    
    // Keep open
    await new Promise(() => {});
})();
