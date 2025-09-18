# AI-Icarus IL4 Deployment Script for Azure Government
# This script deploys from the local private repo clone

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-ai-icarus-il4",
    
    [Parameter(Mandatory=$false)]
    [string]$AppName = "aiicarus",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "USGov Virginia",
    
    [Parameter(Mandatory=$false)]
    [string]$Environment = "AzureDoD",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipLogin
)

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host " AI-Icarus IL4 Deployment Script" -ForegroundColor Cyan
Write-Host " Deploying from Private Repository" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Check if running from correct directory
if (-not (Test-Path "deployment/azuredeploy.json")) {
    Write-Error "Please run this script from the ai-icarus-il4-deployment directory"
    exit 1
}

# Step 1: Connect to Azure Government
if (-not $SkipLogin) {
    Write-Host "Step 1: Connecting to Azure Government..." -ForegroundColor Yellow
    try {
        Connect-AzAccount -Environment AzureUSGovernment
        Write-Host "✓ Connected to Azure Government" -ForegroundColor Green
    } catch {
        Write-Error "Failed to connect to Azure Government: $_"
        exit 1
    }
} else {
    Write-Host "Step 1: Skipping login (already connected)" -ForegroundColor Gray
}

# Step 2: Create or verify resource group
Write-Host ""
Write-Host "Step 2: Setting up Resource Group..." -ForegroundColor Yellow
$rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction SilentlyContinue
if ($null -eq $rg) {
    Write-Host "Creating new resource group: $ResourceGroupName" -ForegroundColor Gray
    $rg = New-AzResourceGroup -Name $ResourceGroupName -Location $Location
    Write-Host "✓ Resource group created" -ForegroundColor Green
} else {
    Write-Host "✓ Using existing resource group: $ResourceGroupName" -ForegroundColor Green
}

# Step 3: Validate template
Write-Host ""
Write-Host "Step 3: Validating ARM template..." -ForegroundColor Yellow
$validation = Test-AzResourceGroupDeployment `
    -ResourceGroupName $ResourceGroupName `
    -TemplateFile "deployment/azuredeploy.json" `
    -appName $AppName `
    -environment $Environment `
    -location $Location.Replace(" ", "").ToLower() `
    -ErrorAction SilentlyContinue

if ($validation) {
    Write-Warning "Template validation warnings/errors:"
    $validation | Format-List
    $response = Read-Host "Continue with deployment? (Y/N)"
    if ($response -ne "Y") {
        Write-Host "Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "✓ Template validation passed" -ForegroundColor Green
}

# Step 4: Deploy template
Write-Host ""
Write-Host "Step 4: Deploying resources (this will take 10-15 minutes)..." -ForegroundColor Yellow
Write-Host "Deployment Parameters:" -ForegroundColor Gray
Write-Host "  App Name: $AppName" -ForegroundColor Gray
Write-Host "  Environment: $Environment" -ForegroundColor Gray
Write-Host "  Location: $Location" -ForegroundColor Gray
Write-Host "  Resource Group: $ResourceGroupName" -ForegroundColor Gray
Write-Host ""

$deploymentName = "ai-icarus-deployment-$(Get-Date -Format 'yyyyMMddHHmmss')"

try {
    $deployment = New-AzResourceGroupDeployment `
        -Name $deploymentName `
        -ResourceGroupName $ResourceGroupName `
        -TemplateFile "deployment/azuredeploy.json" `
        -appName $AppName `
        -environment $Environment `
        -location $Location.Replace(" ", "").ToLower() `
        -Verbose
    
    Write-Host "✓ Deployment completed successfully!" -ForegroundColor Green
    
    # Display outputs
    Write-Host ""
    Write-Host "Deployment Outputs:" -ForegroundColor Cyan
    Write-Host "  Static Web App URL: $($deployment.Outputs.staticWebAppUrl.Value)" -ForegroundColor Green
    Write-Host "  Function App URL: $($deployment.Outputs.functionAppUrl.Value)" -ForegroundColor Green
    Write-Host "  Key Vault Name: $($deployment.Outputs.keyVaultName.Value)" -ForegroundColor Green
    
} catch {
    Write-Error "Deployment failed: $_"
    Write-Host "Check the Azure portal for detailed error information" -ForegroundColor Yellow
    exit 1
}

# Step 5: Post-deployment configuration
Write-Host ""
Write-Host "Step 5: Post-Deployment Steps Required:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Run AAD Configuration:" -ForegroundColor Cyan
Write-Host "   ./scripts/configure-aad.ps1 -ResourceGroupName `"$ResourceGroupName`" -AppName `"$AppName`"" -ForegroundColor White
Write-Host ""
Write-Host "2. Validate Deployment:" -ForegroundColor Cyan
Write-Host "   ./scripts/validate-deployment.ps1 -ResourceGroupName `"$ResourceGroupName`" -AppName `"$AppName`"" -ForegroundColor White
Write-Host ""
Write-Host "3. Access your application at:" -ForegroundColor Cyan
Write-Host "   $($deployment.Outputs.staticWebAppUrl.Value)" -ForegroundColor White
Write-Host ""

# Save deployment info
$deploymentInfo = @{
    Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    ResourceGroup = $ResourceGroupName
    AppName = $AppName
    Environment = $Environment
    Location = $Location
    StaticWebAppUrl = $deployment.Outputs.staticWebAppUrl.Value
    FunctionAppUrl = $deployment.Outputs.functionAppUrl.Value
    KeyVaultName = $deployment.Outputs.keyVaultName.Value
    DeploymentName = $deploymentName
}

$deploymentInfo | ConvertTo-Json | Out-File "deployment-info.json"
Write-Host "Deployment information saved to: deployment-info.json" -ForegroundColor Gray

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host " Deployment Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green