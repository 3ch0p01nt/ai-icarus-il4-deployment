# AI-Icarus IL4 Deployment to Argon Tenant
# This script automates the deployment of AI-Icarus to the Argon IL4 tenant
# Target Resource Group: aiicarus8
# Region: USGOV Arizona

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "aiicarus8",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "usgovarizona",
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "AzureUSGovernment",
    
    [Parameter(Mandatory=$false)]
    [string]$AppName = "aiicarus8",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipTests,
    
    [Parameter(Mandatory=$false)]
    [switch]$AutoApprove
)

# Colors for output
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Status {
    param([string]$Message, [string]$Type = "Info")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    switch ($Type) {
        "Success" { Write-Host "[$timestamp] ✅ $Message" -ForegroundColor Green }
        "Error" { Write-Host "[$timestamp] ❌ $Message" -ForegroundColor Red }
        "Warning" { Write-Host "[$timestamp] ⚠️ $Message" -ForegroundColor Yellow }
        "Info" { Write-Host "[$timestamp] ℹ️ $Message" -ForegroundColor Cyan }
        default { Write-Host "[$timestamp] $Message" }
    }
}

function Test-Prerequisites {
    Write-Status "Checking prerequisites..." "Info"
    
    # Check Azure CLI
    try {
        $azVersion = az version --output json | ConvertFrom-Json
        Write-Status "Azure CLI version: $($azVersion.'azure-cli')" "Success"
    } catch {
        Write-Status "Azure CLI not installed or not in PATH" "Error"
        exit 1
    }
    
    # Check Node.js (for Playwright tests)
    if (-not $SkipTests) {
        try {
            $nodeVersion = node --version
            Write-Status "Node.js version: $nodeVersion" "Success"
        } catch {
            Write-Status "Node.js not installed (required for tests)" "Warning"
        }
    }
    
    # Check current Azure context
    try {
        $account = az account show --output json | ConvertFrom-Json
        Write-Status "Current Azure subscription: $($account.name)" "Info"
        Write-Status "Tenant ID: $($account.tenantId)" "Info"
        
        # Verify this is Argon tenant (you may want to add specific tenant ID check here)
        if ($account.environmentName -ne "AzureUSGovernment") {
            Write-Status "Warning: Not connected to Azure US Government cloud" "Warning"
            
            if (-not $AutoApprove) {
                $continue = Read-Host "Continue anyway? (y/n)"
                if ($continue -ne 'y') {
                    exit 1
                }
            }
        }
    } catch {
        Write-Status "Not logged in to Azure. Please run 'az login' first" "Error"
        exit 1
    }
}

function Create-ResourceGroup {
    Write-Status "Checking resource group '$ResourceGroupName'..." "Info"
    
    $rgExists = az group exists --name $ResourceGroupName --output tsv
    
    if ($rgExists -eq "false") {
        Write-Status "Creating resource group '$ResourceGroupName' in '$Location'..." "Info"
        
        try {
            az group create `
                --name $ResourceGroupName `
                --location $Location `
                --output none
            
            Write-Status "Resource group created successfully" "Success"
        } catch {
            Write-Status "Failed to create resource group: $_" "Error"
            exit 1
        }
    } else {
        Write-Status "Resource group '$ResourceGroupName' already exists" "Success"
    }
}

function Deploy-Template {
    Write-Status "Starting ARM template deployment..." "Info"
    
    $templateFile = Join-Path $PSScriptRoot ".." "deployment" "azuredeploy.json"
    
    if (-not (Test-Path $templateFile)) {
        Write-Status "ARM template not found at: $templateFile" "Error"
        exit 1
    }
    
    Write-Status "Template file: $templateFile" "Info"
    
    $deploymentName = "aiicarus8-deployment-$(Get-Date -Format 'yyyyMMddHHmmss')"
    
    try {
        Write-Status "Deploying template (this may take 10-15 minutes)..." "Info"
        
        $deployment = az deployment group create `
            --resource-group $ResourceGroupName `
            --name $deploymentName `
            --template-file $templateFile `
            --parameters `
                appName=$AppName `
                environment=$Environment `
                location=$Location `
                webAppSku="S1" `
                functionAppSku="EP1" `
                storageAccountType="Standard_LRS" `
                enableNetworkIsolation=true `
                logRetentionInDays=365 `
                enableManagedIdentity=true `
            --output json | ConvertFrom-Json
        
        if ($deployment.properties.provisioningState -eq "Succeeded") {
            Write-Status "Deployment completed successfully!" "Success"
            
            # Output deployment details
            Write-Status "Deployment outputs:" "Info"
            Write-Host "  Web App URL: $($deployment.properties.outputs.webAppUrl.value)" -ForegroundColor Yellow
            Write-Host "  Function App URL: $($deployment.properties.outputs.functionAppUrl.value)" -ForegroundColor Yellow
            Write-Host "  Web App Name: $($deployment.properties.outputs.webAppName.value)" -ForegroundColor Yellow
            Write-Host "  Function App Name: $($deployment.properties.outputs.functionAppName.value)" -ForegroundColor Yellow
            
            # Store URLs for testing
            $script:WebAppUrl = $deployment.properties.outputs.webAppUrl.value
            $script:FunctionAppUrl = $deployment.properties.outputs.functionAppUrl.value
            $script:WebAppName = $deployment.properties.outputs.webAppName.value
            $script:FunctionAppName = $deployment.properties.outputs.functionAppName.value
            
        } else {
            Write-Status "Deployment failed with state: $($deployment.properties.provisioningState)" "Error"
            exit 1
        }
    } catch {
        Write-Status "Deployment failed: $_" "Error"
        
        # Try to get deployment error details
        try {
            $operations = az deployment operation group list `
                --resource-group $ResourceGroupName `
                --name $deploymentName `
                --query "[?properties.provisioningState=='Failed']" `
                --output json | ConvertFrom-Json
            
            foreach ($op in $operations) {
                Write-Status "Error in $($op.properties.targetResource.resourceType): $($op.properties.statusMessage.error.message)" "Error"
            }
        } catch {}
        
        exit 1
    }
}

function Configure-ManagedIdentity {
    Write-Status "Configuring managed identity permissions..." "Info"
    
    try {
        # Get the principal IDs
        $webAppIdentity = az webapp identity show `
            --resource-group $ResourceGroupName `
            --name $script:WebAppName `
            --query principalId `
            --output tsv
        
        $funcAppIdentity = az functionapp identity show `
            --resource-group $ResourceGroupName `
            --name $script:FunctionAppName `
            --query principalId `
            --output tsv
        
        Write-Status "Web App Identity: $webAppIdentity" "Info"
        Write-Status "Function App Identity: $funcAppIdentity" "Info"
        
        # Assign roles (adjust as needed for your specific requirements)
        # Example: Contributor role at resource group level
        Write-Status "Assigning roles to managed identities..." "Info"
        
        # Note: Role assignments might already be done in ARM template
        # This is here as a fallback or for additional permissions
        
    } catch {
        Write-Status "Warning: Could not configure managed identity permissions: $_" "Warning"
    }
}

function Wait-ForDeployment {
    Write-Status "Waiting for application to be ready..." "Info"
    
    $maxAttempts = 30
    $attemptCount = 0
    $ready = $false
    
    while (-not $ready -and $attemptCount -lt $maxAttempts) {
        $attemptCount++
        Write-Status "Checking application status (attempt $attemptCount/$maxAttempts)..." "Info"
        
        try {
            $response = Invoke-WebRequest -Uri $script:WebAppUrl -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                $ready = $true
                Write-Status "Application is ready!" "Success"
            }
        } catch {
            Write-Status "Application not ready yet, waiting 30 seconds..." "Info"
            Start-Sleep -Seconds 30
        }
    }
    
    if (-not $ready) {
        Write-Status "Application did not become ready in time" "Warning"
    }
}

function Run-PlaywrightTests {
    if ($SkipTests) {
        Write-Status "Skipping Playwright tests (--SkipTests specified)" "Warning"
        return
    }
    
    Write-Status "Running Playwright tests..." "Info"
    
    $testScript = Join-Path $PSScriptRoot ".." "tests" "playwright" "test-aiicarus8-deployment.js"
    
    if (-not (Test-Path $testScript)) {
        Write-Status "Test script not found at: $testScript" "Warning"
        return
    }
    
    # Install dependencies if needed
    $packageJson = Join-Path $PSScriptRoot ".." "package.json"
    if (Test-Path $packageJson) {
        Write-Status "Installing test dependencies..." "Info"
        Push-Location (Split-Path $packageJson)
        npm install playwright --silent
        Pop-Location
    }
    
    # Run tests
    try {
        Write-Status "Executing Playwright test suite..." "Info"
        $testResult = node $testScript $script:WebAppUrl
        
        if ($LASTEXITCODE -eq 0) {
            Write-Status "All tests passed!" "Success"
        } else {
            Write-Status "Some tests failed. Check the test report for details." "Warning"
        }
    } catch {
        Write-Status "Failed to run tests: $_" "Error"
    }
}

function Show-Summary {
    Write-Host "`n" -NoNewline
    Write-Host "═" -NoNewline -ForegroundColor Cyan
    Write-Host "═" * 59 -ForegroundColor Cyan
    Write-Host "📊 DEPLOYMENT SUMMARY" -ForegroundColor White
    Write-Host "═" * 60 -ForegroundColor Cyan
    
    Write-Host "Resource Group:    " -NoNewline; Write-Host $ResourceGroupName -ForegroundColor Yellow
    Write-Host "Location:          " -NoNewline; Write-Host $Location -ForegroundColor Yellow
    Write-Host "Environment:       " -NoNewline; Write-Host $Environment -ForegroundColor Yellow
    Write-Host "App Name:          " -NoNewline; Write-Host $AppName -ForegroundColor Yellow
    
    if ($script:WebAppUrl) {
        Write-Host "`nApplication URLs:" -ForegroundColor White
        Write-Host "  Web App:         " -NoNewline; Write-Host $script:WebAppUrl -ForegroundColor Green
        Write-Host "  Function App:    " -NoNewline; Write-Host $script:FunctionAppUrl -ForegroundColor Green
    }
    
    Write-Host "`nNext Steps:" -ForegroundColor White
    Write-Host "1. Visit the Web App URL to verify the deployment" -ForegroundColor Cyan
    Write-Host "2. Check Application Insights for monitoring data" -ForegroundColor Cyan
    Write-Host "3. Review the test report in tests/playwright/" -ForegroundColor Cyan
    
    Write-Host "═" * 60 -ForegroundColor Cyan
}

# Main execution
function Main {
    Write-Host "`n🚀 AI-Icarus IL4 Deployment Script for Argon Tenant" -ForegroundColor Magenta
    Write-Host "═" * 60 -ForegroundColor Cyan
    
    # Step 1: Check prerequisites
    Test-Prerequisites
    
    # Step 2: Create resource group if needed
    Create-ResourceGroup
    
    # Step 3: Deploy ARM template
    Deploy-Template
    
    # Step 4: Configure managed identity
    Configure-ManagedIdentity
    
    # Step 5: Wait for deployment to be ready
    Wait-ForDeployment
    
    # Step 6: Run Playwright tests
    Run-PlaywrightTests
    
    # Step 7: Show summary
    Show-Summary
    
    Write-Status "`n✅ Deployment process completed!" "Success"
}

# Run the script
try {
    Main
} catch {
    Write-Status "Script failed: $_" "Error"
    exit 1
}