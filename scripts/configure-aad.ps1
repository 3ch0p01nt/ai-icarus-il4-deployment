<#
.SYNOPSIS
    Configures Azure AD App Registration for AI-Icarus IL4 deployment
.DESCRIPTION
    This script creates and configures an Azure AD application registration
    for the AI-Icarus application in Azure Government IL4 environments.
.PARAMETER AppName
    The name of the application (default: ai-icarus)
.PARAMETER StaticWebAppUrl
    The URL of the deployed Static Web App
.PARAMETER FunctionAppUrl
    The URL of the deployed Function App
.PARAMETER Environment
    The Azure environment (AzureUSGovernment or AzureDoD)
.EXAMPLE
    .\configure-aad.ps1 -AppName "ai-icarus" -StaticWebAppUrl "https://swa-ai-icarus.azurestaticapps.net"
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$AppName = "ai-icarus",
    
    [Parameter(Mandatory=$true)]
    [string]$StaticWebAppUrl,
    
    [Parameter(Mandatory=$false)]
    [string]$FunctionAppUrl,
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("AzureUSGovernment", "AzureDoD")]
    [string]$Environment = "AzureDoD"
)

# Set strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " AI-Icarus IL4 AAD Configuration Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Az module is installed
if (-not (Get-Module -ListAvailable -Name Az)) {
    Write-Host "Az PowerShell module not found. Installing..." -ForegroundColor Yellow
    Install-Module -Name Az -Scope CurrentUser -Force -AllowClobber
}

# Import Az module
Import-Module Az -ErrorAction Stop

# Connect to Azure Government
Write-Host "Connecting to Azure Government..." -ForegroundColor Yellow
try {
    $context = Get-AzContext
    if ($null -eq $context -or $context.Environment.Name -notmatch "AzureUSGovernment|AzureUSDoD") {
        Connect-AzAccount -Environment $Environment
    }
    Write-Host "Connected to Azure Government" -ForegroundColor Green
}
catch {
    Write-Error "Failed to connect to Azure Government: $_"
    exit 1
}

# Get tenant information
$tenantId = (Get-AzContext).Tenant.Id
Write-Host "Tenant ID: $tenantId" -ForegroundColor Cyan

# Check if app already exists
Write-Host "Checking for existing app registration..." -ForegroundColor Yellow
$existingApp = Get-AzADApplication -DisplayName "$AppName-spa" -ErrorAction SilentlyContinue

if ($existingApp) {
    Write-Host "App registration already exists. Updating configuration..." -ForegroundColor Yellow
    $app = $existingApp
} else {
    Write-Host "Creating new app registration..." -ForegroundColor Yellow
    
    # Create the application
    $app = New-AzADApplication -DisplayName "$AppName-spa" `
        -AvailableToOtherTenants $false `
        -SignInAudience "AzureADMyOrg"
    
    Write-Host "App registration created successfully" -ForegroundColor Green
}

$clientId = $app.AppId
Write-Host "Client ID: $clientId" -ForegroundColor Cyan

# Configure redirect URIs for SPA
Write-Host "Configuring SPA redirect URIs..." -ForegroundColor Yellow
$redirectUris = @(
    $StaticWebAppUrl,
    "$StaticWebAppUrl/",
    "$StaticWebAppUrl/auth-callback",
    "http://localhost:3000",
    "http://localhost:3000/auth-callback"
)

# Update application with SPA configuration
$appUpdate = @{
    ObjectId = $app.Id
    Web = @{
        RedirectUris = @()
        ImplicitGrantSettings = @{
            EnableIdTokenIssuance = $false
            EnableAccessTokenIssuance = $false
        }
    }
    Spa = @{
        RedirectUris = $redirectUris
    }
}

Update-AzADApplication @appUpdate
Write-Host "SPA configuration updated" -ForegroundColor Green

# Configure API permissions
Write-Host "Configuring API permissions..." -ForegroundColor Yellow

# Microsoft Graph permissions
$graphAppId = "00000003-0000-0000-c000-000000000000"
$graphPermissions = @(
    @{
        Id = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"  # User.Read
        Type = "Scope"
    },
    @{
        Id = "37f7f235-527c-4136-accd-4a02d197296e"  # openid
        Type = "Scope"
    },
    @{
        Id = "14dad69e-099b-42c9-810b-d002981feec1"  # profile
        Type = "Scope"
    },
    @{
        Id = "7427e0e9-2fba-42fe-b0c0-848c9e6a8182"  # offline_access
        Type = "Scope"
    }
)

# Azure Service Management permissions
$azureServiceManagementAppId = "797f4846-ba00-4fd7-ba43-dac1f8f63013"
$azureServiceManagementPermissions = @(
    @{
        Id = "41094075-9dad-400e-a0bd-54e686782033"  # user_impersonation
        Type = "Scope"
    }
)

# Create resource access objects
$resourceAccess = @()

# Add Graph permissions
$graphResourceAccess = @{
    ResourceAppId = $graphAppId
    ResourceAccess = $graphPermissions
}
$resourceAccess += $graphResourceAccess

# Add Azure Service Management permissions
$asmResourceAccess = @{
    ResourceAppId = $azureServiceManagementAppId
    ResourceAccess = $azureServiceManagementPermissions
}
$resourceAccess += $asmResourceAccess

# Update application with permissions
Update-AzADApplication -ObjectId $app.Id -RequiredResourceAccess $resourceAccess
Write-Host "API permissions configured" -ForegroundColor Green

# Create service principal if it doesn't exist
Write-Host "Checking service principal..." -ForegroundColor Yellow
$sp = Get-AzADServicePrincipal -ApplicationId $clientId -ErrorAction SilentlyContinue
if (-not $sp) {
    $sp = New-AzADServicePrincipal -ApplicationId $clientId
    Write-Host "Service principal created" -ForegroundColor Green
} else {
    Write-Host "Service principal already exists" -ForegroundColor Green
}

# Output configuration
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Configuration Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Azure AD Configuration:" -ForegroundColor Cyan
Write-Host "  Client ID:     $clientId" -ForegroundColor White
Write-Host "  Tenant ID:     $tenantId" -ForegroundColor White
Write-Host "  Object ID:     $($app.Id)" -ForegroundColor White
Write-Host "  Display Name:  $($app.DisplayName)" -ForegroundColor White
Write-Host ""
Write-Host "Redirect URIs:" -ForegroundColor Cyan
foreach ($uri in $redirectUris) {
    Write-Host "  - $uri" -ForegroundColor White
}
Write-Host ""
Write-Host "Environment Configuration:" -ForegroundColor Cyan
Write-Host "  Environment:   $Environment" -ForegroundColor White
Write-Host "  Authority:     https://login.microsoftonline.us/$tenantId" -ForegroundColor White

# Write configuration to file
$configFile = Join-Path (Split-Path -Parent $PSScriptRoot) "config" "aad-config.json"
$config = @{
    clientId = $clientId
    tenantId = $tenantId
    authority = "https://login.microsoftonline.us/$tenantId"
    environment = $Environment
    redirectUris = $redirectUris
    staticWebAppUrl = $StaticWebAppUrl
    functionAppUrl = $FunctionAppUrl
    createdAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

# Create config directory if it doesn't exist
$configDir = Split-Path -Parent $configFile
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

$config | ConvertTo-Json -Depth 10 | Out-File -FilePath $configFile -Encoding UTF8
Write-Host ""
Write-Host "Configuration saved to: $configFile" -ForegroundColor Green

# Instructions for next steps
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Update your application code with the Client ID and Tenant ID above" -ForegroundColor White
Write-Host "2. Deploy your application code to the Static Web App and Function App" -ForegroundColor White
Write-Host "3. Test authentication at: $StaticWebAppUrl" -ForegroundColor White
Write-Host ""
Write-Host "Note: No admin consent is required for the configured permissions." -ForegroundColor Cyan
Write-Host "Users will consent to permissions on first sign-in." -ForegroundColor Cyan

# Export for pipeline use
if ($env:GITHUB_OUTPUT) {
    Write-Host ""
    Write-Host "Setting GitHub Actions outputs..." -ForegroundColor Yellow
    Add-Content -Path $env:GITHUB_OUTPUT -Value "clientId=$clientId"
    Add-Content -Path $env:GITHUB_OUTPUT -Value "tenantId=$tenantId"
    Add-Content -Path $env:GITHUB_OUTPUT -Value "authority=https://login.microsoftonline.us/$tenantId"
}

Write-Host ""
Write-Host "Script completed successfully!" -ForegroundColor Green