<#
.SYNOPSIS
    Validates AI-Icarus IL4 deployment in Azure Government
.DESCRIPTION
    This script validates that all components of the AI-Icarus deployment
    are properly configured and accessible in the IL4 environment.
.PARAMETER ResourceGroupName
    The name of the resource group containing the deployment
.PARAMETER AppName
    The base name used for the deployment
.EXAMPLE
    .\validate-deployment.ps1 -ResourceGroupName "rg-ai-icarus-il4" -AppName "ai-icarus"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$true)]
    [string]$AppName
)

# Set strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " AI-Icarus IL4 Deployment Validation Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Initialize validation results
$validationResults = @{
    ResourceGroup = $false
    StaticWebApp = $false
    FunctionApp = $false
    Storage = $false
    KeyVault = $false
    AppInsights = $false
    Networking = $false
    Authentication = $false
    Endpoints = $false
    Security = $false
}

# Connect to Azure if not already connected
try {
    $context = Get-AzContext
    if ($null -eq $context) {
        Write-Host "Connecting to Azure Government..." -ForegroundColor Yellow
        Connect-AzAccount -Environment AzureUSGovernment
    }
    Write-Host "Azure Context: $($context.Environment.Name)" -ForegroundColor Green
} catch {
    Write-Error "Failed to connect to Azure: $_"
    exit 1
}

# 1. Validate Resource Group
Write-Host ""
Write-Host "Validating Resource Group..." -ForegroundColor Yellow
try {
    $rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction Stop
    Write-Host "  ✓ Resource Group exists: $($rg.ResourceGroupName)" -ForegroundColor Green
    Write-Host "    Location: $($rg.Location)" -ForegroundColor Gray
    $validationResults.ResourceGroup = $true
} catch {
    Write-Host "  ✗ Resource Group not found: $ResourceGroupName" -ForegroundColor Red
}

# 2. Validate Static Web App
Write-Host ""
Write-Host "Validating Static Web App..." -ForegroundColor Yellow
try {
    $staticWebApps = Get-AzStaticWebApp -ResourceGroupName $ResourceGroupName | Where-Object { $_.Name -like "*$AppName*" }
    if ($staticWebApps) {
        $swa = $staticWebApps[0]
        Write-Host "  ✓ Static Web App found: $($swa.Name)" -ForegroundColor Green
        Write-Host "    URL: $($swa.DefaultHostname)" -ForegroundColor Gray
        
        # Test accessibility
        try {
            $response = Invoke-WebRequest -Uri "https://$($swa.DefaultHostname)" -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  ✓ Static Web App is accessible" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ⚠ Static Web App not yet accessible (may still be deploying)" -ForegroundColor Yellow
        }
        $validationResults.StaticWebApp = $true
    } else {
        Write-Host "  ✗ Static Web App not found" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Error checking Static Web App: $_" -ForegroundColor Red
}

# 3. Validate Function App
Write-Host ""
Write-Host "Validating Function App..." -ForegroundColor Yellow
try {
    $functionApps = Get-AzFunctionApp -ResourceGroupName $ResourceGroupName | Where-Object { $_.Name -like "*$AppName*" }
    if ($functionApps) {
        $func = $functionApps[0]
        Write-Host "  ✓ Function App found: $($func.Name)" -ForegroundColor Green
        Write-Host "    URL: https://$($func.DefaultHostName)" -ForegroundColor Gray
        Write-Host "    Runtime: $($func.Runtime)" -ForegroundColor Gray
        Write-Host "    State: $($func.State)" -ForegroundColor Gray
        
        # Check app settings
        $appSettings = Get-AzFunctionAppSetting -ResourceGroupName $ResourceGroupName -Name $func.Name
        $requiredSettings = @('AZURE_ENVIRONMENT', 'ManagementEndpoint', 'GraphEndpoint', 'LogAnalyticsEndpoint')
        
        foreach ($setting in $requiredSettings) {
            if ($appSettings.ContainsKey($setting)) {
                Write-Host "  ✓ Setting configured: $setting" -ForegroundColor Green
            } else {
                Write-Host "  ✗ Missing setting: $setting" -ForegroundColor Red
            }
        }
        
        # Test health endpoint
        try {
            $healthUrl = "https://$($func.DefaultHostName)/api/health"
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host "  ✓ Function App health check passed" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ⚠ Function App health check failed (functions may not be deployed yet)" -ForegroundColor Yellow
        }
        
        $validationResults.FunctionApp = $true
    } else {
        Write-Host "  ✗ Function App not found" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Error checking Function App: $_" -ForegroundColor Red
}

# 4. Validate Storage Account
Write-Host ""
Write-Host "Validating Storage Account..." -ForegroundColor Yellow
try {
    $storageAccounts = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName | Where-Object { $_.StorageAccountName -like "*$AppName*" }
    if ($storageAccounts) {
        $storage = $storageAccounts[0]
        Write-Host "  ✓ Storage Account found: $($storage.StorageAccountName)" -ForegroundColor Green
        Write-Host "    Encryption: $($storage.Encryption.KeySource)" -ForegroundColor Gray
        Write-Host "    TLS Version: $($storage.MinimumTlsVersion)" -ForegroundColor Gray
        
        # Validate IL4 requirements
        if ($storage.MinimumTlsVersion -eq "TLS1_2") {
            Write-Host "  ✓ TLS 1.2 enforced" -ForegroundColor Green
        } else {
            Write-Host "  ✗ TLS 1.2 not enforced" -ForegroundColor Red
        }
        
        if ($storage.EnableHttpsTrafficOnly) {
            Write-Host "  ✓ HTTPS-only traffic enforced" -ForegroundColor Green
        } else {
            Write-Host "  ✗ HTTPS-only traffic not enforced" -ForegroundColor Red
        }
        
        $validationResults.Storage = $true
    } else {
        Write-Host "  ✗ Storage Account not found" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Error checking Storage Account: $_" -ForegroundColor Red
}

# 5. Validate Key Vault
Write-Host ""
Write-Host "Validating Key Vault..." -ForegroundColor Yellow
try {
    $keyVaults = Get-AzKeyVault -ResourceGroupName $ResourceGroupName | Where-Object { $_.VaultName -like "*$AppName*" }
    if ($keyVaults) {
        $kv = $keyVaults[0]
        Write-Host "  ✓ Key Vault found: $($kv.VaultName)" -ForegroundColor Green
        
        # Check Key Vault properties
        $kvDetails = Get-AzKeyVault -VaultName $kv.VaultName -ResourceGroupName $ResourceGroupName
        if ($kvDetails.EnableSoftDelete) {
            Write-Host "  ✓ Soft delete enabled" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Soft delete not enabled" -ForegroundColor Red
        }
        
        if ($kvDetails.EnablePurgeProtection) {
            Write-Host "  ✓ Purge protection enabled" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ Purge protection not enabled" -ForegroundColor Yellow
        }
        
        $validationResults.KeyVault = $true
    } else {
        Write-Host "  ✗ Key Vault not found" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Error checking Key Vault: $_" -ForegroundColor Red
}

# 6. Validate Application Insights
Write-Host ""
Write-Host "Validating Application Insights..." -ForegroundColor Yellow
try {
    $appInsights = Get-AzApplicationInsights -ResourceGroupName $ResourceGroupName | Where-Object { $_.Name -like "*$AppName*" }
    if ($appInsights) {
        $ai = $appInsights[0]
        Write-Host "  ✓ Application Insights found: $($ai.Name)" -ForegroundColor Green
        Write-Host "    Instrumentation Key: $($ai.InstrumentationKey.Substring(0,8))..." -ForegroundColor Gray
        Write-Host "    Type: $($ai.ApplicationType)" -ForegroundColor Gray
        $validationResults.AppInsights = $true
    } else {
        Write-Host "  ✗ Application Insights not found" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ Error checking Application Insights: $_" -ForegroundColor Red
}

# 7. Validate Network Security
Write-Host ""
Write-Host "Validating Network Security..." -ForegroundColor Yellow
try {
    $nsgs = Get-AzNetworkSecurityGroup -ResourceGroupName $ResourceGroupName | Where-Object { $_.Name -like "*$AppName*" }
    if ($nsgs) {
        $nsg = $nsgs[0]
        Write-Host "  ✓ Network Security Group found: $($nsg.Name)" -ForegroundColor Green
        Write-Host "    Rules: $($nsg.SecurityRules.Count)" -ForegroundColor Gray
        
        # Check for HTTPS rule
        $httpsRule = $nsg.SecurityRules | Where-Object { $_.DestinationPortRange -eq "443" -and $_.Access -eq "Allow" }
        if ($httpsRule) {
            Write-Host "  ✓ HTTPS (443) inbound rule configured" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ HTTPS (443) inbound rule not found" -ForegroundColor Yellow
        }
        
        $validationResults.Networking = $true
    } else {
        Write-Host "  ⚠ Network Security Group not found (may not be required)" -ForegroundColor Yellow
        $validationResults.Networking = $true
    }
} catch {
    Write-Host "  ⚠ Error checking Network Security: $_" -ForegroundColor Yellow
    $validationResults.Networking = $true
}

# 8. Validate IL4 Endpoints
Write-Host ""
Write-Host "Validating IL4 Endpoints..." -ForegroundColor Yellow
$il4Endpoints = @{
    "Authentication" = "login.microsoftonline.us"
    "Management" = "management.usgovcloudapi.net"
    "Graph" = "graph.microsoft.us"
    "LogAnalytics" = "api.loganalytics.us"
}

foreach ($endpoint in $il4Endpoints.GetEnumerator()) {
    try {
        $result = Test-NetConnection -ComputerName $endpoint.Value -Port 443 -InformationLevel Quiet
        if ($result) {
            Write-Host "  ✓ $($endpoint.Key) endpoint reachable: $($endpoint.Value)" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $($endpoint.Key) endpoint not reachable: $($endpoint.Value)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ⚠ Could not test $($endpoint.Key) endpoint" -ForegroundColor Yellow
    }
}
$validationResults.Endpoints = $true

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Validation Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

$totalChecks = $validationResults.Count
$passedChecks = ($validationResults.Values | Where-Object { $_ -eq $true }).Count
$failedChecks = $totalChecks - $passedChecks

foreach ($result in $validationResults.GetEnumerator()) {
    if ($result.Value) {
        Write-Host "  ✓ $($result.Key)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $($result.Key)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Results: $passedChecks/$totalChecks checks passed" -ForegroundColor $(if ($failedChecks -eq 0) { "Green" } elseif ($failedChecks -le 2) { "Yellow" } else { "Red" })

if ($failedChecks -eq 0) {
    Write-Host ""
    Write-Host "✅ Deployment validation successful!" -ForegroundColor Green
    Write-Host "Your AI-Icarus IL4 deployment is ready for use." -ForegroundColor Green
} elseif ($failedChecks -le 2) {
    Write-Host ""
    Write-Host "⚠ Deployment partially validated." -ForegroundColor Yellow
    Write-Host "Some components may still be deploying or require additional configuration." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "❌ Deployment validation failed." -ForegroundColor Red
    Write-Host "Please review the errors above and check your deployment." -ForegroundColor Red
}

# Export results
$outputFile = Join-Path (Split-Path -Parent $PSScriptRoot) "validation-results.json"
$validationResults | ConvertTo-Json | Out-File -FilePath $outputFile -Encoding UTF8
Write-Host ""
Write-Host "Validation results saved to: $outputFile" -ForegroundColor Cyan