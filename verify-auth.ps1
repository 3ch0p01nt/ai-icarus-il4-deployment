# Verify Authentication Setup
Write-Host "🔐 Verifying AI-Icarus Authentication Setup" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

# Check Azure AD App
Write-Host "📌 Azure AD App Registration:" -ForegroundColor Yellow
$appId = "7830b2fd-796f-4330-9d34-25b9c1e2fd1f"
$app = az ad app show --id $appId --output json | ConvertFrom-Json

if ($app) {
    Write-Host "✅ App Name: $($app.displayName)" -ForegroundColor Green
    Write-Host "✅ Client ID: $($app.appId)" -ForegroundColor Green
    Write-Host "✅ Redirect URI: $($app.web.redirectUris[0])" -ForegroundColor Green
} else {
    Write-Host "❌ App registration not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "📌 Web App Configuration:" -ForegroundColor Yellow
$webSettings = az webapp config appsettings list --resource-group aiicarus8 --name web-aiicarus8-aa32zvcy5cvgo --output json | ConvertFrom-Json
$clientIdSetting = $webSettings | Where-Object { $_.name -eq "AZURE_CLIENT_ID" }

if ($clientIdSetting) {
    Write-Host "✅ AZURE_CLIENT_ID is configured: $($clientIdSetting.value)" -ForegroundColor Green
} else {
    Write-Host "❌ AZURE_CLIENT_ID not configured" -ForegroundColor Red
}

Write-Host ""
Write-Host "📌 Function App Configuration:" -ForegroundColor Yellow
$funcSettings = az functionapp config appsettings list --resource-group aiicarus8 --name func-aiicarus8-aa32zvcy5cvgo --output json | ConvertFrom-Json
$funcClientId = $funcSettings | Where-Object { $_.name -eq "AZURE_CLIENT_ID" }
$funcManagedId = $funcSettings | Where-Object { $_.name -eq "USE_MANAGED_IDENTITY" }

if ($funcClientId) {
    Write-Host "✅ AZURE_CLIENT_ID is configured: $($funcClientId.value)" -ForegroundColor Green
}
if ($funcManagedId) {
    Write-Host "✅ USE_MANAGED_IDENTITY is set: $($funcManagedId.value)" -ForegroundColor Green
}

Write-Host ""
Write-Host "📌 Testing Config API:" -ForegroundColor Yellow
$configUrl = "https://func-aiicarus8-aa32zvcy5cvgo.azurewebsites.us/api/config"
try {
    $config = Invoke-RestMethod -Uri $configUrl -Method Get
    Write-Host "✅ Config API is accessible" -ForegroundColor Green
    Write-Host "  Environment: $($config.environment)" -ForegroundColor Cyan
    Write-Host "  Auth Type: $($config.auth.authType)" -ForegroundColor Cyan
    Write-Host "  Managed Identity: $($config.auth.useManagedIdentity)" -ForegroundColor Cyan
    Write-Host "  Client ID: $($config.auth.clientId)" -ForegroundColor Cyan
    Write-Host "  Tenant ID: $($config.auth.tenantId)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Config API error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "📊 AUTHENTICATION STATUS SUMMARY" -ForegroundColor White
Write-Host ""

if ($clientIdSetting.value -eq $appId) {
    Write-Host "✅ Authentication is properly configured!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Users can now:" -ForegroundColor Yellow
    Write-Host "1. Navigate to: https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us" -ForegroundColor Cyan
    Write-Host "2. Click 'Sign in with Microsoft'" -ForegroundColor Cyan
    Write-Host "3. Authenticate with their Argon credentials" -ForegroundColor Cyan
    Write-Host "4. Access all application features" -ForegroundColor Cyan
} else {
    Write-Host "⚠️ Authentication configuration in progress..." -ForegroundColor Yellow
    Write-Host "Wait a few minutes for deployment to complete" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan