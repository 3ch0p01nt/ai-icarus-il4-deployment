const { chromium } = require('playwright');

(async () => {
    console.log('🔐 Testing User-Based Authentication\n');
    console.log('=' .repeat(60));
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Monitor console
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('token') || text.includes('workspace') || text.includes('error')) {
            console.log(`[${msg.type()}] ${text}`);
        }
    });
    
    console.log('Loading application...');
    await page.goto('https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us');
    await page.waitForTimeout(3000);
    
    // Check if the function now expects user token
    console.log('\nTesting workspace discovery without token:');
    const response = await fetch('https://func-aiicarus8-aa32zvcy5cvgo.azurewebsites.us/api/workspaces/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: 'af16aa5c-8bae-4e4d-8996-56d2e65f75f4' })
    });
    
    const data = await response.json();
    console.log('Response status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.status === 401 || data.error?.includes('authentication')) {
        console.log('\n✅ CORRECT: Function now requires user authentication token');
        console.log('   The function is no longer using managed identity');
    } else if (data.workspaces && data.workspaces.length === 0) {
        console.log('\n⚠️  Function returned empty list - might still be using managed identity');
    }
    
    await browser.close();
    console.log('\n' + '=' .repeat(60));
})();
