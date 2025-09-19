const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
    deploymentUrl: 'https://web-aiicarus8-[uniqueid].azurewebsites.us/',
    mangoUrl: 'https://mango-smoke-044c8f00f.1.azurestaticapps.net/',
    resourceGroup: 'aiicarus8',
    environment: 'AzureUSGovernment',
    location: 'usgovarizona',
    expectedTabs: ['Dashboard', 'Workspaces', 'KQL Query', 'OpenAI'],
    timeout: 60000,
    retryCount: 3
};

// Test results storage
const testResults = {
    timestamp: new Date().toISOString(),
    deployment: TEST_CONFIG.deploymentUrl,
    tests: [],
    screenshots: [],
    passed: 0,
    failed: 0,
    warnings: 0
};

// Helper function to add test result
function addTestResult(name, status, details = '', screenshot = null) {
    const result = {
        name,
        status,
        details,
        timestamp: new Date().toISOString()
    };
    
    if (screenshot) {
        result.screenshot = screenshot;
        testResults.screenshots.push(screenshot);
    }
    
    testResults.tests.push(result);
    
    if (status === 'PASS') {
        testResults.passed++;
        console.log(`✅ ${name}`);
    } else if (status === 'FAIL') {
        testResults.failed++;
        console.log(`❌ ${name}: ${details}`);
    } else if (status === 'WARN') {
        testResults.warnings++;
        console.log(`⚠️ ${name}: ${details}`);
    }
    
    return result;
}

// Main test function
async function runTests() {
    const browser = await chromium.launch({
        headless: false,
        slowMo: 100,
        devtools: true
    });
    
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true // For self-signed certs in IL4
    });
    
    const page = await context.newPage();
    
    console.log('🚀 Starting AI-Icarus IL4 Deployment Tests');
    console.log('=' .repeat(60));
    console.log(`Deployment: ${TEST_CONFIG.deploymentUrl}`);
    console.log(`Reference: ${TEST_CONFIG.mangoUrl}`);
    console.log(`Resource Group: ${TEST_CONFIG.resourceGroup}`);
    console.log('=' .repeat(60) + '\n');
    
    // Monitor console for errors
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });
    
    // Monitor network for failures
    const networkFailures = [];
    page.on('requestfailed', request => {
        networkFailures.push({
            url: request.url(),
            failure: request.failure().errorText
        });
    });
    
    try {
        // Test 1: Deployment Accessibility
        console.log('\n📌 Test 1: Deployment Accessibility');
        try {
            await page.goto(TEST_CONFIG.deploymentUrl, {
                waitUntil: 'networkidle',
                timeout: TEST_CONFIG.timeout
            });
            addTestResult('Deployment Accessibility', 'PASS', 'Application is accessible');
        } catch (error) {
            addTestResult('Deployment Accessibility', 'FAIL', error.message);
            throw new Error('Cannot access deployment - stopping tests');
        }
        
        // Test 2: React App Initialization
        console.log('\n📌 Test 2: React App Initialization');
        const hasRoot = await page.locator('#root').count() > 0;
        if (hasRoot) {
            addTestResult('React App Initialization', 'PASS', 'React root element found');
        } else {
            addTestResult('React App Initialization', 'FAIL', 'React root element not found');
        }
        
        await page.waitForTimeout(3000); // Wait for app to fully load
        
        // Test 3: Managed Identity Authentication
        console.log('\n📌 Test 3: Authentication Configuration');
        const configResponse = await page.evaluate(async () => {
            try {
                const funcUrl = window.location.hostname.replace('web-', 'func-');
                const response = await fetch(`https://${funcUrl}/api/config`);
                return await response.json();
            } catch (error) {
                return { error: error.message };
            }
        });
        
        if (configResponse.error) {
            addTestResult('Authentication Configuration', 'FAIL', configResponse.error);
        } else if (configResponse.auth?.useManagedIdentity) {
            addTestResult('Authentication Configuration', 'PASS', 'Managed Identity enabled');
        } else {
            addTestResult('Authentication Configuration', 'WARN', 'Managed Identity not configured');
        }
        
        // Test 4: UI Tabs Verification
        console.log('\n📌 Test 4: UI Tabs Verification');
        let allTabsFound = true;
        for (const tabName of TEST_CONFIG.expectedTabs) {
            const tab = await page.locator(`button:has-text("${tabName}")`).count() > 0;
            if (tab) {
                addTestResult(`Tab: ${tabName}`, 'PASS', 'Tab found in UI');
            } else {
                addTestResult(`Tab: ${tabName}`, 'FAIL', 'Tab not found in UI');
                allTabsFound = false;
            }
        }
        
        // Take screenshot of current state
        const screenshotPath = path.join(__dirname, `aiicarus8-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        
        // Test 5: Visual Comparison with Mango
        console.log('\n📌 Test 5: Visual Comparison with Mango');
        const mangoPage = await context.newPage();
        
        try {
            await mangoPage.goto(TEST_CONFIG.mangoUrl, {
                waitUntil: 'networkidle',
                timeout: TEST_CONFIG.timeout
            });
            
            const mangoScreenshot = path.join(__dirname, `mango-reference-${Date.now()}.png`);
            await mangoPage.screenshot({ path: mangoScreenshot, fullPage: true });
            
            // Compare UI elements
            const mangoTabs = [];
            for (const tabName of TEST_CONFIG.expectedTabs) {
                const hasTab = await mangoPage.locator(`button:has-text("${tabName}")`).count() > 0;
                if (hasTab) mangoTabs.push(tabName);
            }
            
            if (mangoTabs.length === TEST_CONFIG.expectedTabs.length && allTabsFound) {
                addTestResult('UI Parity with Mango', 'PASS', 'All tabs match reference');
            } else {
                addTestResult('UI Parity with Mango', 'FAIL', 
                    `Expected ${TEST_CONFIG.expectedTabs.length} tabs, found ${mangoTabs.length}`);
            }
            
        } catch (error) {
            addTestResult('Visual Comparison', 'WARN', 
                `Could not access mango reference: ${error.message}`);
        }
        
        await mangoPage.close();
        
        // Test 6: API Endpoints
        console.log('\n📌 Test 6: API Endpoints');
        const apiEndpoints = [
            '/api/health',
            '/api/config',
            '/api/workspaces',
            '/api/subscriptions'
        ];
        
        for (const endpoint of apiEndpoints) {
            const response = await page.evaluate(async (ep) => {
                try {
                    const funcUrl = window.location.hostname.replace('web-', 'func-');
                    const res = await fetch(`https://${funcUrl}${ep}`);
                    return { status: res.status, ok: res.ok };
                } catch (error) {
                    return { error: error.message };
                }
            }, endpoint);
            
            if (response.error) {
                addTestResult(`API: ${endpoint}`, 'FAIL', response.error);
            } else if (response.ok) {
                addTestResult(`API: ${endpoint}`, 'PASS', `Status: ${response.status}`);
            } else {
                addTestResult(`API: ${endpoint}`, 'WARN', `Status: ${response.status}`);
            }
        }
        
        // Test 7: M365 Defender Integration
        console.log('\n📌 Test 7: M365 Defender Integration');
        const defenderEndpoints = [
            '/api/defender-incidents',
            '/api/m365-defender-alerts',
            '/api/m365-defender-hunting'
        ];
        
        for (const endpoint of defenderEndpoints) {
            const functionExists = await page.evaluate(async (ep) => {
                try {
                    const funcUrl = window.location.hostname.replace('web-', 'func-');
                    const res = await fetch(`https://${funcUrl}${ep}`, { method: 'OPTIONS' });
                    return res.status !== 404;
                } catch (error) {
                    return false;
                }
            }, endpoint);
            
            if (functionExists) {
                addTestResult(`M365 Defender: ${endpoint}`, 'PASS', 'Endpoint available');
            } else {
                addTestResult(`M365 Defender: ${endpoint}`, 'WARN', 'Endpoint not found');
            }
        }
        
        // Test 8: Export Functionality
        console.log('\n📌 Test 8: Export Functionality');
        const exportEndpoint = await page.evaluate(async () => {
            try {
                const funcUrl = window.location.hostname.replace('web-', 'func-');
                const res = await fetch(`https://${funcUrl}/api/export-service`, { method: 'OPTIONS' });
                return res.status !== 404;
            } catch (error) {
                return false;
            }
        });
        
        if (exportEndpoint) {
            addTestResult('Export Service', 'PASS', 'Export functionality available');
        } else {
            addTestResult('Export Service', 'WARN', 'Export service not found');
        }
        
        // Test 9: Security Compliance
        console.log('\n📌 Test 9: Security Compliance');
        
        // Check for hardcoded credentials
        const pageContent = await page.content();
        const hasHardcodedCreds = /api[_-]?key|client[_-]?secret|password/i.test(pageContent);
        
        if (!hasHardcodedCreds) {
            addTestResult('No Hardcoded Credentials', 'PASS', 'No credentials found in page source');
        } else {
            addTestResult('No Hardcoded Credentials', 'FAIL', 'Potential credentials found in page source');
        }
        
        // Check HTTPS
        const isHttps = page.url().startsWith('https://');
        if (isHttps) {
            addTestResult('HTTPS Enabled', 'PASS', 'Site uses HTTPS');
        } else {
            addTestResult('HTTPS Enabled', 'FAIL', 'Site not using HTTPS');
        }
        
        // Check IL4 compliance indicators
        const isGovDomain = page.url().includes('.us');
        if (isGovDomain) {
            addTestResult('IL4 Domain', 'PASS', 'Using .us government domain');
        } else {
            addTestResult('IL4 Domain', 'FAIL', 'Not using government domain');
        }
        
        // Test 10: Performance Metrics
        console.log('\n📌 Test 10: Performance Metrics');
        const performanceMetrics = await page.evaluate(() => {
            const perfData = performance.getEntriesByType('navigation')[0];
            return {
                domContentLoaded: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
                loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
                totalTime: perfData.loadEventEnd - perfData.fetchStart
            };
        });
        
        if (performanceMetrics.totalTime < 5000) {
            addTestResult('Page Load Performance', 'PASS', 
                `Total load time: ${performanceMetrics.totalTime.toFixed(2)}ms`);
        } else {
            addTestResult('Page Load Performance', 'WARN', 
                `Total load time: ${performanceMetrics.totalTime.toFixed(2)}ms (>5s)`);
        }
        
        // Check console errors
        if (consoleErrors.length > 0) {
            addTestResult('Console Errors', 'WARN', 
                `${consoleErrors.length} console errors detected`);
        } else {
            addTestResult('Console Errors', 'PASS', 'No console errors');
        }
        
        // Check network failures
        if (networkFailures.length > 0) {
            addTestResult('Network Requests', 'WARN', 
                `${networkFailures.length} failed requests`);
        } else {
            addTestResult('Network Requests', 'PASS', 'All network requests successful');
        }
        
    } catch (error) {
        addTestResult('Test Execution', 'FAIL', error.message);
    } finally {
        // Generate test report
        console.log('\n' + '=' .repeat(60));
        console.log('📊 TEST SUMMARY');
        console.log('=' .repeat(60));
        console.log(`✅ Passed: ${testResults.passed}`);
        console.log(`❌ Failed: ${testResults.failed}`);
        console.log(`⚠️ Warnings: ${testResults.warnings}`);
        console.log(`Total Tests: ${testResults.tests.length}`);
        
        // Calculate success rate
        const successRate = (testResults.passed / testResults.tests.length * 100).toFixed(1);
        console.log(`Success Rate: ${successRate}%`);
        
        // Determine overall status
        let overallStatus = 'FAIL';
        if (testResults.failed === 0 && successRate >= 80) {
            overallStatus = 'PASS';
        } else if (testResults.failed <= 2 && successRate >= 70) {
            overallStatus = 'PASS WITH WARNINGS';
        }
        
        console.log(`\nOverall Status: ${overallStatus}`);
        
        // Save test report
        const reportPath = path.join(__dirname, `test-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
        console.log(`\n📁 Test report saved to: ${reportPath}`);
        
        // Critical failures that should block deployment
        const criticalTests = [
            'Deployment Accessibility',
            'React App Initialization',
            'No Hardcoded Credentials',
            'HTTPS Enabled',
            'IL4 Domain'
        ];
        
        const criticalFailures = testResults.tests.filter(t => 
            criticalTests.includes(t.name) && t.status === 'FAIL'
        );
        
        if (criticalFailures.length > 0) {
            console.log('\n⛔ CRITICAL FAILURES DETECTED:');
            criticalFailures.forEach(f => {
                console.log(`   - ${f.name}: ${f.details}`);
            });
            console.log('\n🚫 DEPLOYMENT SHOULD BE BLOCKED');
        } else {
            console.log('\n✅ All critical tests passed');
            console.log('🚀 DEPLOYMENT CAN PROCEED');
        }
        
        await browser.close();
        
        // Exit with appropriate code
        process.exit(criticalFailures.length > 0 ? 1 : 0);
    }
}

// Run tests
(async () => {
    try {
        // Get deployment URL from command line or environment
        if (process.argv[2]) {
            TEST_CONFIG.deploymentUrl = process.argv[2];
        } else if (process.env.DEPLOYMENT_URL) {
            TEST_CONFIG.deploymentUrl = process.env.DEPLOYMENT_URL;
        }
        
        console.log('🎯 AI-Icarus IL4 Deployment Test Suite');
        console.log('Version: 1.0.0');
        console.log('Target: ' + TEST_CONFIG.deploymentUrl);
        
        await runTests();
    } catch (error) {
        console.error('💥 Test suite failed:', error.message);
        process.exit(1);
    }
})();