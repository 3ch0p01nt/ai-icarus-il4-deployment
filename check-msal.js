const { chromium } = require('playwright');

(async () => {
    console.log('🔍 Debugging MSAL Login Issue\n');
    console.log('=' .repeat(60));
    
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100 
    });
    const page = await browser.newPage();
    
    // Capture all console messages
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error') {
            console.log(`❌ ERROR: ${text}`);
        } else if (type === 'warning') {
            console.log(`⚠️  WARNING: ${text}`);
        } else if (text.includes('MSAL') || text.includes('Config') || text.includes('Client ID')) {
            console.log(`📝 ${text}`);
        }
    });
    
    console.log('\n📡 Loading application...');
    await page.goto('https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us');
    await page.waitForTimeout(3000);
    
    // Check MSAL instance
    console.log('\n🔐 Checking MSAL configuration:');
    const msalCheck = await page.evaluate(() => {
        return {
            msalInstanceExists: typeof msalInstance !== 'undefined',
            msalInstanceNull: typeof msalInstance !== 'undefined' ? msalInstance === null : 'undefined',
            msalConfigExists: typeof msalConfig !== 'undefined',
            hasLoginButton: document.querySelector('button') ? document.querySelector('button').textContent : null
        };
    });
    
    console.log('  MSAL Instance exists:', msalCheck.msalInstanceExists);
    console.log('  MSAL Instance is null:', msalCheck.msalInstanceNull);
    console.log('  MSAL Config exists:', msalCheck.msalConfigExists);
    console.log('  Login button text:', msalCheck.hasLoginButton);
    
    // Try to click login and see what happens
    console.log('\n🔑 Attempting to click login button...');
    
    try {
        await page.click('button:has-text("Sign in with Microsoft")', { timeout: 5000 });
        console.log('✅ Button clicked');
        
        // Wait to see if popup appears
        await page.waitForTimeout(2000);
        
        // Check for popups
        const pages = browser.contexts()[0].pages();
        console.log(`  Number of pages/popups: ${pages.length}`);
        
    } catch (error) {
        console.log(`❌ Could not click button: ${error.message}`);
    }
    
    // Check for any errors in initialization
    const initErrors = await page.evaluate(() => {
        const errors = [];
        if (typeof msalInstance === 'undefined') {
            errors.push('msalInstance is undefined');
        }
        if (typeof msalInstance !== 'undefined' && msalInstance === null) {
            errors.push('msalInstance is null - not initialized');
        }
        return errors;
    });
    
    if (initErrors.length > 0) {
        console.log('\n❌ Initialization Problems:');
        initErrors.forEach(err => console.log(`  - ${err}`));
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('Keeping browser open for inspection. Press Ctrl+C to close.\n');
    
    await new Promise(() => {});
})();
