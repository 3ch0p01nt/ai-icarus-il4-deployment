# Configure Azure AD App Permissions for AI-Icarus
param(
    [string]$AppId = "7830b2fd-796f-4330-9d34-25b9c1e2fd1f"
)

Write-Host "Configuring Azure AD App Permissions..." -ForegroundColor Cyan

# Microsoft Graph permissions needed
$graphPermissions = @{
    "User.Read" = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"
    "User.ReadBasic.All" = "b340eb25-3456-403f-be2f-af7a0d370277" 
    "offline_access" = "7427e0e9-2fba-42fe-b0c0-848c9e6a8182"
    "openid" = "37f7f235-527c-4136-accd-4a02d197296e"
    "profile" = "14dad69e-099b-42c9-810b-d002981feec1"
}

# Azure Service Management permissions for Government Cloud
$managementPermissions = @{
    "user_impersonation" = "41094075-9dad-400e-a0bd-54e686782033"
}

# Create the required resource access JSON
$requiredResourceAccess = @"
[
    {
        "resourceAppId": "00000003-0000-0000-c000-000000000000",
        "resourceAccess": [
            {
                "id": "e1fe6dd8-ba31-4d61-89e7-88639da4683d",
                "type": "Scope"
            },
            {
                "id": "37f7f235-527c-4136-accd-4a02d197296e",
                "type": "Scope"
            },
            {
                "id": "14dad69e-099b-42c9-810b-d002981feec1",
                "type": "Scope"
            }
        ]
    },
    {
        "resourceAppId": "797f4846-ba00-4fd7-ba43-dac1f8f63013",
        "resourceAccess": [
            {
                "id": "41094075-9dad-400e-a0bd-54e686782033",
                "type": "Scope"
            }
        ]
    }
]
"@

# Save to temp file
$tempFile = New-TemporaryFile
$requiredResourceAccess | Out-File -FilePath $tempFile.FullName -Encoding UTF8

# Update the app
Write-Host "Adding API permissions..." -ForegroundColor Yellow
az ad app update --id $AppId --required-resource-accesses "@$($tempFile.FullName)"

# Enable implicit grant for ID tokens (needed for SPA)
Write-Host "Enabling implicit grant for ID tokens..." -ForegroundColor Yellow
az ad app update --id $AppId --enable-id-token-issuance true

# Update redirect URIs to support SPA
Write-Host "Configuring SPA redirect URIs..." -ForegroundColor Yellow
$redirectUris = @(
    "https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us",
    "https://web-aiicarus8-aa32zvcy5cvgo.azurewebsites.us/"
)

$spaRedirectUris = $redirectUris | ConvertTo-Json -Compress

az ad app update --id $AppId --spa-redirect-uris $spaRedirectUris.Replace('"', '\"')

# Grant admin consent (if you have permissions)
Write-Host "Attempting to grant admin consent..." -ForegroundColor Yellow
try {
    az ad app permission admin-consent --id $AppId
    Write-Host "✅ Admin consent granted" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Could not grant admin consent automatically. Please grant manually in Azure Portal." -ForegroundColor Yellow
}

# Clean up
Remove-Item $tempFile.FullName -Force

Write-Host ""
Write-Host "✅ App permissions configured!" -ForegroundColor Green
Write-Host ""
Write-Host "App ID: $AppId" -ForegroundColor Cyan
Write-Host ""
Write-Host "Permissions added:" -ForegroundColor Yellow
Write-Host "  - User.Read (Sign in and read user profile)" -ForegroundColor White
Write-Host "  - openid (Sign users in)" -ForegroundColor White
Write-Host "  - profile (View users' basic profile)" -ForegroundColor White
Write-Host "  - user_impersonation (Access Azure Service Management)" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. If admin consent wasn't granted, go to Azure Portal and grant it" -ForegroundColor Cyan
Write-Host "2. Refresh the web application" -ForegroundColor Cyan
Write-Host "3. Try signing in again" -ForegroundColor Cyan