# Script to open Azure Portal with pre-filled deployment template
Write-Host "🚀 Opening Azure Portal for AI-Icarus Deployment" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Construct the deployment URL
$templateUri = [System.Uri]::EscapeDataString("https://raw.githubusercontent.com/3ch0p01nt/ai-icarus-il4-deployment/main/deployment/azuredeploy.json")
$portalUrl = "https://portal.azure.us/#create/Microsoft.Template/uri/$templateUri"

Write-Host "This will open the Azure US Government Portal with:" -ForegroundColor Yellow
Write-Host "  Pre-filled template: AI-Icarus IL4" -ForegroundColor White
Write-Host "  Default Resource Group: aiicarus8" -ForegroundColor White
Write-Host "  Default Location: usgovarizona" -ForegroundColor White
Write-Host "  Default App Name: aiicarus8" -ForegroundColor White
Write-Host ""

Write-Host "Instructions:" -ForegroundColor Yellow
Write-Host "1. Portal will open in your browser" -ForegroundColor Cyan
Write-Host "2. Sign in to your Argon tenant if prompted" -ForegroundColor Cyan
Write-Host "3. Verify/Create resource group 'aiicarus8'" -ForegroundColor Cyan
Write-Host "4. Review the parameters (defaults are correct)" -ForegroundColor Cyan
Write-Host "5. Click 'Review + Create'" -ForegroundColor Cyan
Write-Host "6. Click 'Create' to start deployment" -ForegroundColor Cyan
Write-Host ""

Write-Host "Opening browser..." -ForegroundColor Green
Start-Process $portalUrl

Write-Host ""
Write-Host "Portal URL:" -ForegroundColor Yellow
Write-Host $portalUrl -ForegroundColor Cyan
Write-Host ""
Write-Host "If browser didn't open, copy the URL above and paste in your browser" -ForegroundColor Yellow
Write-Host ""

# Also generate a direct az command as backup
Write-Host "Alternative: Deploy via Azure CLI" -ForegroundColor Yellow
Write-Host "=================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Run these commands:" -ForegroundColor Cyan
Write-Host ""
Write-Host "# Login to Azure US Government" -ForegroundColor Gray
Write-Host "az cloud set --name AzureUSGovernment" -ForegroundColor White
Write-Host "az login" -ForegroundColor White
Write-Host ""
Write-Host "# Create resource group" -ForegroundColor Gray
Write-Host "az group create --name aiicarus8 --location usgovarizona" -ForegroundColor White
Write-Host ""
Write-Host "# Deploy template" -ForegroundColor Gray
Write-Host @"
az deployment group create \
  --resource-group aiicarus8 \
  --template-uri https://raw.githubusercontent.com/3ch0p01nt/ai-icarus-il4-deployment/main/deployment/azuredeploy.json \
  --parameters \
    appName=aiicarus8 \
    environment=AzureUSGovernment \
    location=usgovarizona \
    webAppSku=S1 \
    functionAppSku=EP1 \
    storageAccountType=Standard_LRS \
    enableNetworkIsolation=true \
    logRetentionInDays=365 \
    enableManagedIdentity=true
"@ -ForegroundColor White

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan