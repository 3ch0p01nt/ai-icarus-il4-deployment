# Setup Authentication for AI-Icarus IL4 Deployment
# This script creates and configures Azure AD app registration for the IL4 deployment

param(
    [Parameter(Mandatory=$true)]
    [string]$AppName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "AzureUSGovernment"
)

Write-Host "Setting up authentication for AI-Icarus IL4 deployment..." -ForegroundColor Cyan

# Set the Azure environment
if ($Environment -eq "AzureUSGovernment" -or $Environment -eq "AzureDoD") {
    Write-Host "Connecting to Azure Government..." -ForegroundColor Yellow
    Connect-AzAccount -Environment AzureUSGovernment -ErrorAction Stop
} else {
    Write-Host "Connecting to Azure Commercial..." -ForegroundColor Yellow
    Connect-AzAccount -ErrorAction Stop
}

# Get the Web App URL
$webApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -Name "web-$AppName" -ErrorAction Stop
$webAppUrl = "https://" + $webApp.DefaultHostName

Write-Host "Web App URL: $webAppUrl" -ForegroundColor Green

# Create Azure AD App Registration
Write-Host "`nCreating Azure AD App Registration..." -ForegroundColor Cyan

$appRegistration = New-AzADApplication -DisplayName "$AppName-auth" `
    -IdentifierUris "api://$AppName" `
    -ReplyUrls @($webAppUrl, "${webAppUrl}/", "http://localhost:3000") `
    -ErrorAction Stop

$appId = $appRegistration.AppId
Write-Host "App Registration created with Client ID: $appId" -ForegroundColor Green

# Create a service principal
Write-Host "Creating Service Principal..." -ForegroundColor Cyan
$servicePrincipal = New-AzADServicePrincipal -ApplicationId $appId -ErrorAction Stop

# Update the app registration for SPA
Write-Host "Configuring for Single Page Application (SPA)..." -ForegroundColor Cyan

$body = @{
    spa = @{
        redirectUris = @(
            $webAppUrl,
            "${webAppUrl}/",
            "http://localhost:3000"
        )
    }
    web = @{
        redirectUris = @()
        implicitGrantSettings = @{
            enableAccessTokenIssuance = $false
            enableIdTokenIssuance = $false
        }
    }
} | ConvertTo-Json -Depth 10

$token = (Get-AzAccessToken -ResourceUrl "https://graph.microsoft.com").Token
$headers = @{
    'Authorization' = "Bearer $token"
    'Content-Type' = 'application/json'
}

$graphUrl = if ($Environment -eq "AzureUSGovernment" -or $Environment -eq "AzureDoD") {
    "https://graph.microsoft.us"
} else {
    "https://graph.microsoft.com"
}

$uri = "$graphUrl/v1.0/applications/$($appRegistration.Id)"

try {
    Invoke-RestMethod -Uri $uri -Method PATCH -Headers $headers -Body $body
    Write-Host "SPA configuration applied successfully" -ForegroundColor Green
} catch {
    Write-Warning "Failed to update SPA settings via Graph API. You may need to configure this manually in the Azure Portal."
}

# Configure API permissions
Write-Host "`nConfiguring API permissions..." -ForegroundColor Cyan

# Add Microsoft Graph permissions
$graphPermissions = @(
    @{
        id = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"  # User.Read
        type = "Scope"
    },
    @{
        id = "14dad69e-099b-42c9-810b-d002981feec1"  # profile
        type = "Scope"
    },
    @{
        id = "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0"  # email
        type = "Scope"
    },
    @{
        id = "7427e0e9-2fba-42fe-b0c0-848c9e6a8182"  # offline_access
        type = "Scope"
    },
    @{
        id = "37f7f235-527c-4136-accd-4a02d197296e"  # openid
        type = "Scope"
    }
)

# Update Function App configuration
Write-Host "`nUpdating Function App configuration..." -ForegroundColor Cyan

$funcApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -Name "func-$AppName" -ErrorAction Stop

# Get existing app settings
$appSettings = $funcApp.SiteConfig.AppSettings
$newAppSettings = @{}
foreach ($setting in $appSettings) {
    $newAppSettings[$setting.Name] = $setting.Value
}

# Add/Update authentication settings
$newAppSettings["AZURE_CLIENT_ID"] = $appId
$newAppSettings["AZURE_TENANT_ID"] = (Get-AzContext).Tenant.Id

# Apply the settings
Set-AzWebApp -ResourceGroupName $ResourceGroupName -Name "func-$AppName" `
    -AppSettings $newAppSettings -ErrorAction Stop

Write-Host "Function App configuration updated" -ForegroundColor Green

# Update Web App configuration
Write-Host "`nUpdating Web App configuration..." -ForegroundColor Cyan

$webAppSettings = $webApp.SiteConfig.AppSettings
$newWebAppSettings = @{}
foreach ($setting in $webAppSettings) {
    $newWebAppSettings[$setting.Name] = $setting.Value
}

# Add/Update authentication settings
$newWebAppSettings["AZURE_CLIENT_ID"] = $appId
$newWebAppSettings["AZURE_TENANT_ID"] = (Get-AzContext).Tenant.Id

# Apply the settings
Set-AzWebApp -ResourceGroupName $ResourceGroupName -Name "web-$AppName" `
    -AppSettings $newWebAppSettings -ErrorAction Stop

Write-Host "Web App configuration updated" -ForegroundColor Green

# Output summary
Write-Host "`n" -NoNewline
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Authentication Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "App Registration Details:" -ForegroundColor Yellow
Write-Host "  Display Name: $AppName-auth"
Write-Host "  Client ID: $appId" -ForegroundColor Green
Write-Host "  Tenant ID: $((Get-AzContext).Tenant.Id)" -ForegroundColor Green
Write-Host ""
Write-Host "Redirect URIs configured:" -ForegroundColor Yellow
Write-Host "  - $webAppUrl"
Write-Host "  - ${webAppUrl}/"
Write-Host "  - http://localhost:3000"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. The application should now work with authentication"
Write-Host "2. Navigate to: $webAppUrl"
Write-Host "3. Click 'Sign in with Microsoft'"
Write-Host "4. Use your Azure Government credentials"
Write-Host ""
Write-Host "If you encounter issues:" -ForegroundColor Yellow
Write-Host "1. Wait 2-3 minutes for settings to propagate"
Write-Host "2. Clear browser cache and cookies"
Write-Host "3. Try an incognito/private browser window"
Write-Host ""