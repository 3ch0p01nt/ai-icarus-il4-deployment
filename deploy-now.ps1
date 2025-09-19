# Quick deployment script for AI-Icarus to Argon IL4
Write-Host "🚀 AI-Icarus Deployment to Argon IL4 Tenant" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Set to Azure US Government cloud
Write-Host "Setting Azure cloud to US Government..." -ForegroundColor Yellow
az cloud set --name AzureUSGovernment

# Check if logged in
$account = az account show 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Not logged in to Azure" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please login to your Argon tenant:" -ForegroundColor Yellow
    Write-Host "1. Run: az login" -ForegroundColor Cyan
    Write-Host "2. Complete authentication in browser" -ForegroundColor Cyan
    Write-Host "3. Run this script again" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ Logged in to Azure" -ForegroundColor Green

# Parse account info
$accountInfo = $account | ConvertFrom-Json
Write-Host "Subscription: $($accountInfo.name)" -ForegroundColor Cyan
Write-Host "Tenant ID: $($accountInfo.tenantId)" -ForegroundColor Cyan
Write-Host ""

# Confirm deployment
Write-Host "This will deploy to:" -ForegroundColor Yellow
Write-Host "  Resource Group: aiicarus8" -ForegroundColor White
Write-Host "  Location: usgovarizona" -ForegroundColor White
Write-Host "  App Name: aiicarus8" -ForegroundColor White
Write-Host ""

$confirm = Read-Host "Continue with deployment? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "Deployment cancelled" -ForegroundColor Yellow
    exit 0
}

# Create resource group
Write-Host ""
Write-Host "Creating resource group 'aiicarus8'..." -ForegroundColor Yellow
az group create --name aiicarus8 --location usgovarizona --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Resource group ready" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to create resource group" -ForegroundColor Red
    exit 1
}

# Deploy template
Write-Host ""
Write-Host "Starting deployment (this will take 10-15 minutes)..." -ForegroundColor Yellow

$deploymentName = "aiicarus8-$(Get-Date -Format 'yyyyMMddHHmmss')"
$templateFile = Join-Path $PSScriptRoot "deployment" "azuredeploy.json"

Write-Host "Deployment name: $deploymentName" -ForegroundColor Cyan
Write-Host "Template: $templateFile" -ForegroundColor Cyan

$deployment = az deployment group create `
    --resource-group aiicarus8 `
    --name $deploymentName `
    --template-file $templateFile `
    --parameters `
        appName=aiicarus8 `
        environment=AzureUSGovernment `
        location=usgovarizona `
        webAppSku=S1 `
        functionAppSku=EP1 `
        storageAccountType=Standard_LRS `
        enableNetworkIsolation=true `
        logRetentionInDays=365 `
        enableManagedIdentity=true `
    --output json

if ($LASTEXITCODE -eq 0) {
    $deploymentInfo = $deployment | ConvertFrom-Json
    Write-Host ""
    Write-Host "✅ DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Application URLs:" -ForegroundColor Yellow
    Write-Host "  Web App: $($deploymentInfo.properties.outputs.webAppUrl.value)" -ForegroundColor Cyan
    Write-Host "  Function App: $($deploymentInfo.properties.outputs.functionAppUrl.value)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Resource Names:" -ForegroundColor Yellow
    Write-Host "  Web App: $($deploymentInfo.properties.outputs.webAppName.value)" -ForegroundColor Cyan
    Write-Host "  Function App: $($deploymentInfo.properties.outputs.functionAppName.value)" -ForegroundColor Cyan
    
    # Save deployment info
    $deploymentInfo | ConvertTo-Json -Depth 10 | Out-File "deployment-output.json"
    Write-Host ""
    Write-Host "Deployment details saved to: deployment-output.json" -ForegroundColor Green
    
    # Wait for app to be ready
    Write-Host ""
    Write-Host "Waiting for application to be ready..." -ForegroundColor Yellow
    Start-Sleep -Seconds 60
    
    # Open in browser
    Write-Host ""
    Write-Host "Opening application in browser..." -ForegroundColor Cyan
    Start-Process $deploymentInfo.properties.outputs.webAppUrl.value
    
} else {
    Write-Host ""
    Write-Host "❌ DEPLOYMENT FAILED" -ForegroundColor Red
    Write-Host "Check the Azure Portal for error details" -ForegroundColor Yellow
    
    # Try to get error details
    az deployment operation group list `
        --resource-group aiicarus8 `
        --name $deploymentName `
        --query "[?properties.provisioningState=='Failed']"
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Deployment process completed" -ForegroundColor Cyan