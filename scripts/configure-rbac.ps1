<#
.SYNOPSIS
    Configures RBAC permissions for AI-Icarus Managed Identities
.DESCRIPTION
    This script assigns the necessary Azure RBAC roles to the Function App's
    managed identity to enable resource discovery and data access.
.PARAMETER ResourceGroupName
    The name of the resource group containing the deployment
.PARAMETER FunctionAppName
    The name of the Function App (will be auto-detected if not provided)
.EXAMPLE
    .\configure-rbac.ps1 -ResourceGroupName "rg-aiicarus"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,
    
    [Parameter(Mandatory=$false)]
    [string]$FunctionAppName,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipConfirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " AI-Icarus RBAC Configuration Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Connect to Azure if not connected
$context = Get-AzContext
if ($null -eq $context) {
    Write-Host "Connecting to Azure Government..." -ForegroundColor Yellow
    Connect-AzAccount -Environment AzureUSGovernment
}

Write-Host "Azure Context: $($context.Environment.Name)" -ForegroundColor Green
Write-Host "Subscription: $($context.Subscription.Name)" -ForegroundColor Green
Write-Host ""

# Get the Function App
if (-not $FunctionAppName) {
    Write-Host "Auto-detecting Function App..." -ForegroundColor Yellow
    $funcApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName | Where-Object { $_.Name -like "func-*" } | Select-Object -First 1
    if ($funcApp) {
        $FunctionAppName = $funcApp.Name
        Write-Host "Found Function App: $FunctionAppName" -ForegroundColor Green
    } else {
        Write-Error "Could not find Function App in resource group $ResourceGroupName"
        exit 1
    }
} else {
    $funcApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -Name $FunctionAppName
}

# Get the managed identity principal ID
$principalId = $funcApp.Identity.PrincipalId
if (-not $principalId) {
    Write-Error "Function App does not have a managed identity enabled"
    exit 1
}

Write-Host "Managed Identity Principal ID: $principalId" -ForegroundColor Gray
Write-Host ""

# Define roles to assign
$rolesToAssign = @(
    @{
        Name = "Reader"
        Description = "Allows discovery of resources"
        Scope = "/subscriptions/$($context.Subscription.Id)"
    },
    @{
        Name = "Log Analytics Reader"
        Description = "Allows reading Log Analytics workspaces and executing queries"
        Scope = "/subscriptions/$($context.Subscription.Id)"
    },
    @{
        Name = "Cognitive Services User"
        Description = "Allows using Azure OpenAI and other Cognitive Services"
        Scope = "/subscriptions/$($context.Subscription.Id)"
    }
)

Write-Host "The following roles will be assigned:" -ForegroundColor Yellow
foreach ($role in $rolesToAssign) {
    Write-Host "  • $($role.Name): $($role.Description)" -ForegroundColor Gray
}
Write-Host ""

if (-not $SkipConfirmation) {
    $confirm = Read-Host "Do you want to proceed? (Y/N)"
    if ($confirm -ne "Y") {
        Write-Host "Operation cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "Assigning RBAC roles..." -ForegroundColor Yellow

$successCount = 0
$skipCount = 0
$errorCount = 0

foreach ($role in $rolesToAssign) {
    Write-Host "  Assigning '$($role.Name)'..." -ForegroundColor Gray -NoNewline
    
    try {
        # Check if role is already assigned
        $existingAssignment = Get-AzRoleAssignment `
            -ObjectId $principalId `
            -RoleDefinitionName $role.Name `
            -Scope $role.Scope `
            -ErrorAction SilentlyContinue
        
        if ($existingAssignment) {
            Write-Host " [SKIPPED - Already assigned]" -ForegroundColor Yellow
            $skipCount++
        } else {
            # Assign the role
            New-AzRoleAssignment `
                -ObjectId $principalId `
                -RoleDefinitionName $role.Name `
                -Scope $role.Scope `
                -ErrorAction Stop | Out-Null
            
            Write-Host " [SUCCESS]" -ForegroundColor Green
            $successCount++
        }
    } catch {
        Write-Host " [ERROR]" -ForegroundColor Red
        Write-Host "    Error: $_" -ForegroundColor Red
        $errorCount++
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " RBAC Configuration Complete" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "  ✓ Assigned: $successCount" -ForegroundColor Green
Write-Host "  ⚠ Skipped (already assigned): $skipCount" -ForegroundColor Yellow
if ($errorCount -gt 0) {
    Write-Host "  ✗ Errors: $errorCount" -ForegroundColor Red
}

Write-Host ""
Write-Host "The Function App now has the following permissions:" -ForegroundColor Green
Write-Host "  • Can discover all resources in the subscription" -ForegroundColor Gray
Write-Host "  • Can read and query Log Analytics workspaces" -ForegroundColor Gray
Write-Host "  • Can use Azure OpenAI and Cognitive Services" -ForegroundColor Gray
Write-Host ""

if ($errorCount -eq 0) {
    Write-Host "✅ RBAC configuration successful!" -ForegroundColor Green
    Write-Host "The AI-Icarus application should now be able to discover and access resources." -ForegroundColor Green
} else {
    Write-Host "⚠️ RBAC configuration completed with errors" -ForegroundColor Yellow
    Write-Host "Some roles could not be assigned. Check the errors above." -ForegroundColor Yellow
}

# Also update the Function App with subscription ID if not set
Write-Host ""
Write-Host "Checking Function App configuration..." -ForegroundColor Yellow

$appSettings = $funcApp.SiteConfig.AppSettings
$hasSubscriptionId = $appSettings | Where-Object { $_.Name -eq "AZURE_SUBSCRIPTION_ID" }

if (-not $hasSubscriptionId) {
    Write-Host "  Setting AZURE_SUBSCRIPTION_ID..." -ForegroundColor Gray
    
    $newSettings = @{}
    foreach ($setting in $appSettings) {
        $newSettings[$setting.Name] = $setting.Value
    }
    $newSettings["AZURE_SUBSCRIPTION_ID"] = $context.Subscription.Id
    
    Set-AzWebApp -ResourceGroupName $ResourceGroupName -Name $FunctionAppName -AppSettings $newSettings | Out-Null
    Write-Host "  ✓ Subscription ID configured" -ForegroundColor Green
} else {
    Write-Host "  ✓ Subscription ID already configured" -ForegroundColor Green
}

Write-Host ""
Write-Host "Configuration complete! The application is ready to use." -ForegroundColor Green