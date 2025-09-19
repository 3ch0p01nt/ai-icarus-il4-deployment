const { chromium } = require('playwright');

(async () => {
    console.log('🔐 Testing Login with Debug Info\n');
    console.log('=' .repeat(60));
    
    const browser = await chromium.launch({ 
        headless: true 
    });
    const page = await browser.newPage();
    
    const logs = [];
    page.on('console', msg => {
        const text = msg.text();
        logs.push(`[${msg.type()}] ${text}`);
        if (text.includes('MSAL') || text.includes('Login') || text.includes('Client ID') || msg.type() === 'error') {
            console.log(`${msg.type().toUpperCase()}: ${text}`);
        }
    });
    
    console.log('Loading page...');
    await page.goto('https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us');
    await page.waitForTimeout(5000); // Give time for MSAL to initialize
    
    // Check what's in the console
    console.log('\n📋 Key initialization logs:');
    logs.filter(log => 
        log.includes('MSAL') || 
        log.includes('Client ID') || 
        log.includes('initialized') ||
        log.includes('error')
    ).forEach(log => console.log('  ' + log));
    
    // Check if login button exists and try to click
    const loginBtn = await page.locator('button:has-text("Sign in with Microsoft")').count();
    if (loginBtn > 0) {
        console.log('\n✅ Login button found');
        
        // Click and capture any errors
        console.log('📝 Clicking login button...');
        await page.click('button:has-text("Sign in with Microsoft")');
        await page.waitForTimeout(2000);
        
        // Check for new logs after click
        const newLogs = logs.slice(-5);
        console.log('\n📋 Logs after clicking:');
        newLogs.forEach(log => console.log('  ' + log));
    }
    
    await browser.close();
    console.log('\n' + '=' .repeat(60));
})();
