# Local Validation Script for AI-Icarus IL4 Deployment
# This validates the deployment package without connecting to Azure

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " AI-Icarus IL4 Deployment Validation" -ForegroundColor Cyan
Write-Host " Local Package Validation" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$validationResults = @()
$hasErrors = $false

# 1. Check ARM Template Structure
Write-Host "1. ARM Template Validation" -ForegroundColor Yellow
Write-Host "   Checking template file..." -ForegroundColor Gray

$templatePath = "deployment/azuredeploy.json"
if (Test-Path $templatePath) {
    $template = Get-Content $templatePath -Raw | ConvertFrom-Json
    
    # Check schema
    if ($template.'$schema' -like "*deploymentTemplate.json*") {
        Write-Host "   ✓ Valid ARM template schema" -ForegroundColor Green
        $validationResults += @{Test="ARM Schema"; Result="Pass"; Details="Valid schema"}
    } else {
        Write-Host "   ✗ Invalid schema" -ForegroundColor Red
        $hasErrors = $true
        $validationResults += @{Test="ARM Schema"; Result="Fail"; Details="Invalid schema"}
    }
    
    # Check resources
    $resourceCount = $template.resources.Count
    Write-Host "   ✓ Found $resourceCount resources" -ForegroundColor Green
    $validationResults += @{Test="Resource Count"; Result="Pass"; Details="$resourceCount resources defined"}
    
    # Check for IL4-specific configurations
    $hasNetworkIsolation = $template.parameters.enableNetworkIsolation
    $hasLogRetention = $template.parameters.logRetentionInDays
    
    if ($hasNetworkIsolation -and $hasLogRetention.minValue -eq 365) {
        Write-Host "   ✓ IL4 compliance parameters present" -ForegroundColor Green
        $validationResults += @{Test="IL4 Parameters"; Result="Pass"; Details="Network isolation and 365-day retention"}
    } else {
        Write-Host "   ⚠ IL4 compliance parameters may be incomplete" -ForegroundColor Yellow
        $validationResults += @{Test="IL4 Parameters"; Result="Warning"; Details="Check IL4 parameters"}
    }
    
} else {
    Write-Host "   ✗ Template file not found" -ForegroundColor Red
    $hasErrors = $true
    $validationResults += @{Test="ARM Template"; Result="Fail"; Details="File not found"}
}

# 2. Check Government Cloud Endpoints
Write-Host "`n2. Government Cloud Configuration" -ForegroundColor Yellow
Write-Host "   Checking endpoint configuration..." -ForegroundColor Gray

$template = Get-Content $templatePath -Raw | ConvertFrom-Json
$endpoints = $template.variables.endpoints.AzureDoD

$expectedEndpoints = @{
    "authentication" = "https://login.microsoftonline.us"
    "graph" = "https://dod-graph.microsoft.us"
    "management" = "https://management.usgovcloudapi.net"
    "logAnalytics" = "https://api.loganalytics.us"
    "openAI" = "openai.azure.us"
}

$endpointValid = $true
foreach ($endpoint in $expectedEndpoints.GetEnumerator()) {
    if ($endpoints.$($endpoint.Key) -eq $endpoint.Value) {
        Write-Host "   ✓ $($endpoint.Key): $($endpoint.Value)" -ForegroundColor Green
    } else {
        Write-Host "   ✗ $($endpoint.Key): Expected $($endpoint.Value), got $($endpoints.$($endpoint.Key))" -ForegroundColor Red
        $endpointValid = $false
    }
}

if ($endpointValid) {
    $validationResults += @{Test="DoD Endpoints"; Result="Pass"; Details="All endpoints correct"}
} else {
    $validationResults += @{Test="DoD Endpoints"; Result="Fail"; Details="Incorrect endpoints"}
    $hasErrors = $true
}

# 3. Check Source Code
Write-Host "`n3. Source Code Validation" -ForegroundColor Yellow
Write-Host "   Checking application code..." -ForegroundColor Gray

$frontendPath = "src/frontend"
$functionsPath = "src/functions"

if (Test-Path $frontendPath) {
    $htmlFiles = Get-ChildItem -Path $frontendPath -Filter "*.html" -Recurse
    Write-Host "   ✓ Found $($htmlFiles.Count) frontend files" -ForegroundColor Green
    $validationResults += @{Test="Frontend Code"; Result="Pass"; Details="$($htmlFiles.Count) HTML files"}
} else {
    Write-Host "   ✗ Frontend code not found" -ForegroundColor Red
    $hasErrors = $true
    $validationResults += @{Test="Frontend Code"; Result="Fail"; Details="Directory not found"}
}

if (Test-Path $functionsPath) {
    $jsFiles = Get-ChildItem -Path $functionsPath -Filter "*.js" -Recurse
    Write-Host "   ✓ Found $($jsFiles.Count) function files" -ForegroundColor Green
    $validationResults += @{Test="Function Code"; Result="Pass"; Details="$($jsFiles.Count) JS files"}
} else {
    Write-Host "   ✗ Function code not found" -ForegroundColor Red
    $hasErrors = $true
    $validationResults += @{Test="Function Code"; Result="Fail"; Details="Directory not found"}
}

# 4. Check Security Configurations
Write-Host "`n4. Security Configuration" -ForegroundColor Yellow
Write-Host "   Checking security settings..." -ForegroundColor Gray

# Check TLS version
if ($template.resources | Where-Object { $_.properties.minTlsVersion -eq "1.2" }) {
    Write-Host "   ✓ TLS 1.2 enforcement configured" -ForegroundColor Green
    $validationResults += @{Test="TLS Version"; Result="Pass"; Details="TLS 1.2 minimum"}
} else {
    Write-Host "   ⚠ TLS 1.2 enforcement not found in all resources" -ForegroundColor Yellow
    $validationResults += @{Test="TLS Version"; Result="Warning"; Details="Check TLS settings"}
}

# Check HTTPS only
$httpsOnly = $template.resources | Where-Object { $_.properties.httpsOnly -eq $true }
if ($httpsOnly) {
    Write-Host "   ✓ HTTPS-only mode enabled" -ForegroundColor Green
    $validationResults += @{Test="HTTPS Only"; Result="Pass"; Details="Enabled"}
} else {
    Write-Host "   ⚠ HTTPS-only mode not configured" -ForegroundColor Yellow
    $validationResults += @{Test="HTTPS Only"; Result="Warning"; Details="Check HTTPS settings"}
}

# Check Key Vault configuration
$keyVault = $template.resources | Where-Object { $_.type -eq "Microsoft.KeyVault/vaults" }
if ($keyVault.properties.enablePurgeProtection -and $keyVault.properties.enableSoftDelete) {
    Write-Host "   ✓ Key Vault protection enabled" -ForegroundColor Green
    $validationResults += @{Test="Key Vault"; Result="Pass"; Details="Purge protection and soft delete enabled"}
} else {
    Write-Host "   ⚠ Key Vault protection incomplete" -ForegroundColor Yellow
    $validationResults += @{Test="Key Vault"; Result="Warning"; Details="Check protection settings"}
}

# 5. Check Deployment Scripts
Write-Host "`n5. Deployment Scripts" -ForegroundColor Yellow
Write-Host "   Checking helper scripts..." -ForegroundColor Gray

$scripts = @(
    "scripts/configure-aad.ps1",
    "scripts/validate-deployment.ps1"
)

foreach ($script in $scripts) {
    if (Test-Path $script) {
        Write-Host "   ✓ Found: $script" -ForegroundColor Green
        $validationResults += @{Test="Script: $(Split-Path $script -Leaf)"; Result="Pass"; Details="Present"}
    } else {
        Write-Host "   ✗ Missing: $script" -ForegroundColor Red
        $hasErrors = $true
        $validationResults += @{Test="Script: $(Split-Path $script -Leaf)"; Result="Fail"; Details="Missing"}
    }
}

# 6. Check Deploy to Azure Button URL
Write-Host "`n6. Deploy to Azure Button" -ForegroundColor Yellow
Write-Host "   Checking deployment URL..." -ForegroundColor Gray

$readme = Get-Content "README.md" -Raw
$deployButtonPattern = 'https://portal\.azure\.us/#create/Microsoft\.Template/uri/.*azuredeploy\.json'

if ($readme -match $deployButtonPattern) {
    Write-Host "   ✓ Deploy to Azure Government button configured" -ForegroundColor Green
    $validationResults += @{Test="Deploy Button"; Result="Pass"; Details="Points to Azure Government portal"}
    
    # Extract and validate the template URL
    if ($readme -match 'uri/(https.*?azuredeploy\.json)') {
        $templateUrl = [System.Web.HttpUtility]::UrlDecode($matches[1])
        Write-Host "   Template URL: $templateUrl" -ForegroundColor Gray
    }
} else {
    Write-Host "   ✗ Deploy button not properly configured" -ForegroundColor Red
    $hasErrors = $true
    $validationResults += @{Test="Deploy Button"; Result="Fail"; Details="Invalid or missing"}
}

# Generate Summary Report
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " VALIDATION SUMMARY" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$passCount = ($validationResults | Where-Object { $_.Result -eq "Pass" }).Count
$warnCount = ($validationResults | Where-Object { $_.Result -eq "Warning" }).Count
$failCount = ($validationResults | Where-Object { $_.Result -eq "Fail" }).Count

Write-Host "Results:" -ForegroundColor White
Write-Host "  ✓ Passed:  $passCount" -ForegroundColor Green
Write-Host "  ⚠ Warnings: $warnCount" -ForegroundColor Yellow
Write-Host "  ✗ Failed:   $failCount" -ForegroundColor Red

# Save results to JSON
$reportPath = "validation-report.json"
$report = @{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Summary = @{
        Passed = $passCount
        Warnings = $warnCount
        Failed = $failCount
        HasErrors = $hasErrors
    }
    Details = $validationResults
    Recommendation = if ($hasErrors) { 
        "DO NOT PROCEED - Critical issues found. Review and fix errors before deployment."
    } elseif ($warnCount -gt 0) {
        "PROCEED WITH CAUTION - Review warnings before deployment to IL4 environment."
    } else {
        "READY TO DEPLOY - All validation checks passed. Safe to proceed with deployment."
    }
}

$report | ConvertTo-Json -Depth 3 | Out-File $reportPath

Write-Host "`nValidation report saved to: $reportPath" -ForegroundColor Cyan

if ($hasErrors) {
    Write-Host "`n⚠️  DEPLOYMENT NOT RECOMMENDED" -ForegroundColor Red
    Write-Host "Critical issues detected. Please fix errors before attempting deployment." -ForegroundColor Red
    exit 1
} elseif ($warnCount -gt 0) {
    Write-Host "`n⚠️  REVIEW WARNINGS BEFORE DEPLOYMENT" -ForegroundColor Yellow
    Write-Host "Some warnings were detected. Review them before proceeding." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "`n✅ READY FOR DEPLOYMENT" -ForegroundColor Green
    Write-Host "All validation checks passed. The package is ready for IL4 deployment!" -ForegroundColor Green
    exit 0
}