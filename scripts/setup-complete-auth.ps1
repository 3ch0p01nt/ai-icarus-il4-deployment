# Complete Authentication Setup Script
param(
    [string]$ResourceGroup = "aiicarus8",
    [string]$AppId = "7830b2fd-796f-4330-9d34-25b9c1e2fd1f"
)

Write-Host "🔐 Setting up Complete Authentication Configuration" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

# Get the web app and function app names
$webApp = az webapp list --resource-group $ResourceGroup --query "[?contains(name, 'web-')].name" -o tsv
$funcApp = az functionapp list --resource-group $ResourceGroup --query "[?contains(name, 'func-')].name" -o tsv

Write-Host "Web App: $webApp" -ForegroundColor Yellow
Write-Host "Function App: $funcApp" -ForegroundColor Yellow
Write-Host "App ID: $AppId" -ForegroundColor Yellow
Write-Host ""

# Update Web App settings
Write-Host "Updating Web App configuration..." -ForegroundColor Cyan
az webapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $webApp `
    --settings `
        AZURE_CLIENT_ID=$AppId `
        AZURE_TENANT_ID="cfff68a4-5e50-4cf7-8eaf-f67385f0e821" `
        AZURE_ENVIRONMENT="AzureUSGovernment" `
        USE_MANAGED_IDENTITY="true" `
    --output none

# Update Function App settings
Write-Host "Updating Function App configuration..." -ForegroundColor Cyan
az functionapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $funcApp `
    --settings `
        AZURE_CLIENT_ID=$AppId `
        AZURE_TENANT_ID="cfff68a4-5e50-4cf7-8eaf-f67385f0e821" `
        AZURE_ENVIRONMENT="AzureUSGovernment" `
        USE_MANAGED_IDENTITY="true" `
    --output none

# Enable CORS for the function app
Write-Host "Configuring CORS..." -ForegroundColor Cyan
az functionapp cors add `
    --resource-group $ResourceGroup `
    --name $funcApp `
    --allowed-origins "https://$webApp.azurewebsites.us" `
    --output none

# Restart both apps
Write-Host "Restarting applications..." -ForegroundColor Cyan
az webapp restart --resource-group $ResourceGroup --name $webApp --output none
az functionapp restart --resource-group $ResourceGroup --name $funcApp --output none

Write-Host ""
Write-Host "✅ Authentication configuration complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Please wait 30 seconds for the apps to restart, then:" -ForegroundColor Yellow
Write-Host "1. Refresh your browser (F5)" -ForegroundColor Cyan
Write-Host "2. Click 'Sign in with Microsoft'" -ForegroundColor Cyan
Write-Host "3. Use your Argon credentials" -ForegroundColor Cyan
Write-Host ""
Write-Host "The authentication should now work properly!" -ForegroundColor Green