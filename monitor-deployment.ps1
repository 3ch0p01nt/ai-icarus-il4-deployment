# AI-Icarus IL4 Deployment Monitoring Script
# Monitors deployment progress in Azure Government

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroupName = "rg-ai-icarus-il4",
    
    [Parameter(Mandatory=$false)]
    [int]$RefreshIntervalSeconds = 30,
    
    [Parameter(Mandatory=$false)]
    [switch]$Continuous
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " AI-Icarus Deployment Monitor" -ForegroundColor Cyan
Write-Host " Monitoring Azure Government Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to get deployment status
function Get-DeploymentStatus {
    param($ResourceGroupName)
    
    try {
        # Get all deployments in the resource group
        $deployments = Get-AzResourceGroupDeployment -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue | 
                       Sort-Object Timestamp -Descending | 
                       Select-Object -First 5
        
        if ($deployments) {
            Write-Host "`n📊 DEPLOYMENT STATUS" -ForegroundColor Yellow
            Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
            
            foreach ($deployment in $deployments) {
                $status = $deployment.ProvisioningState
                $statusColor = switch ($status) {
                    "Succeeded" { "Green" }
                    "Failed" { "Red" }
                    "Running" { "Yellow" }
                    "Canceled" { "DarkGray" }
                    default { "White" }
                }
                
                $statusIcon = switch ($status) {
                    "Succeeded" { "✅" }
                    "Failed" { "❌" }
                    "Running" { "🔄" }
                    "Canceled" { "⚠️" }
                    default { "⚪" }
                }
                
                Write-Host "`n$statusIcon Deployment: $($deployment.DeploymentName)" -ForegroundColor $statusColor
                Write-Host "   Status: $status" -ForegroundColor $statusColor
                Write-Host "   Started: $($deployment.Timestamp)" -ForegroundColor Gray
                if ($deployment.ProvisioningState -eq "Succeeded" -or $deployment.ProvisioningState -eq "Failed") {
                    $duration = $deployment.Timestamp - $deployment.Timestamp
                    Write-Host "   Duration: $($deployment.Duration)" -ForegroundColor Gray
                }
                
                # If deployment is running, show operations
                if ($status -eq "Running") {
                    $operations = Get-AzResourceGroupDeploymentOperation `
                        -ResourceGroupName $ResourceGroupName `
                        -DeploymentName $deployment.DeploymentName `
                        -ErrorAction SilentlyContinue
                    
                    if ($operations) {
                        Write-Host "   Operations:" -ForegroundColor Cyan
                        foreach ($op in $operations | Where-Object { $_.Properties.ProvisioningState -ne "Succeeded" }) {
                            $opStatus = $op.Properties.ProvisioningState
                            $opIcon = if ($opStatus -eq "Running") { "⏳" } else { "📦" }
                            Write-Host "     $opIcon $($op.Properties.TargetResource.ResourceType.Split('/')[-1]): $opStatus" -ForegroundColor DarkYellow
                        }
                    }
                }
                
                # Show any error messages
                if ($status -eq "Failed") {
                    $operations = Get-AzResourceGroupDeploymentOperation `
                        -ResourceGroupName $ResourceGroupName `
                        -DeploymentName $deployment.DeploymentName `
                        -ErrorAction SilentlyContinue
                    
                    $failedOps = $operations | Where-Object { $_.Properties.ProvisioningState -eq "Failed" }
                    if ($failedOps) {
                        Write-Host "   ❗ Error Details:" -ForegroundColor Red
                        foreach ($failedOp in $failedOps) {
                            $errorMsg = $failedOp.Properties.StatusMessage.error.message
                            if ($errorMsg) {
                                Write-Host "      - $errorMsg" -ForegroundColor Red
                            }
                        }
                    }
                }
            }
        } else {
            Write-Host "⚠️  No deployments found in resource group: $ResourceGroupName" -ForegroundColor Yellow
            Write-Host "   Make sure you've started the deployment or check the resource group name." -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "❌ Error checking deployment status: $_" -ForegroundColor Red
    }
}

# Function to get resource status
function Get-ResourceStatus {
    param($ResourceGroupName)
    
    try {
        $resources = Get-AzResource -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue
        
        if ($resources) {
            Write-Host "`n📦 RESOURCES STATUS" -ForegroundColor Yellow
            Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
            
            $resourceTypes = $resources | Group-Object ResourceType
            
            foreach ($type in $resourceTypes) {
                $icon = switch -Wildcard ($type.Name) {
                    "*staticSites*" { "🌐" }
                    "*sites*" { "⚡" }
                    "*Storage*" { "💾" }
                    "*KeyVault*" { "🔐" }
                    "*insights*" { "📊" }
                    "*OperationalInsights*" { "📝" }
                    "*Network*" { "🔗" }
                    default { "📦" }
                }
                
                Write-Host "`n$icon $($type.Name.Split('/')[-1]): $($type.Count) resource(s)" -ForegroundColor Cyan
                
                foreach ($resource in $type.Group) {
                    $provisioningState = (Get-AzResource -ResourceId $resource.ResourceId).Properties.provisioningState
                    $stateColor = if ($provisioningState -eq "Succeeded") { "Green" } else { "Yellow" }
                    $stateIcon = if ($provisioningState -eq "Succeeded") { "✓" } else { "⏳" }
                    
                    Write-Host "   $stateIcon $($resource.Name)" -ForegroundColor $stateColor
                    if ($provisioningState -ne "Succeeded") {
                        Write-Host "      State: $provisioningState" -ForegroundColor Yellow
                    }
                }
            }
            
            Write-Host "`n📈 Summary:" -ForegroundColor White
            Write-Host "   Total Resources: $($resources.Count)" -ForegroundColor Gray
            $succeeded = @($resources | Where-Object { 
                (Get-AzResource -ResourceId $_.ResourceId).Properties.provisioningState -eq "Succeeded" 
            }).Count
            Write-Host "   Succeeded: $succeeded/$($resources.Count)" -ForegroundColor Green
            
        } else {
            Write-Host "ℹ️  No resources found yet in resource group: $ResourceGroupName" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "❌ Error checking resources: $_" -ForegroundColor Red
    }
}

# Function to check critical endpoints
function Test-Endpoints {
    param($ResourceGroupName)
    
    Write-Host "`n🔍 ENDPOINT VALIDATION" -ForegroundColor Yellow
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    
    # Try to get the static web app
    $staticWebApp = Get-AzStaticWebApp -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue | 
                    Where-Object { $_.Name -like "*aiicarus*" } | 
                    Select-Object -First 1
    
    if ($staticWebApp) {
        $url = "https://$($staticWebApp.DefaultHostname)"
        Write-Host "   🌐 Static Web App: $url" -ForegroundColor Cyan
        
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Host "      ✅ Accessible (HTTP 200)" -ForegroundColor Green
            } else {
                Write-Host "      ⚠️  Response: $($response.StatusCode)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "      ⏳ Not yet accessible (deployment in progress)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ⏳ Static Web App not deployed yet" -ForegroundColor Gray
    }
    
    # Try to get function app
    $functionApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue | 
                   Where-Object { $_.Name -like "*aiicarus*" }
    
    if ($functionApp) {
        $funcUrl = "https://$($functionApp.DefaultHostName)"
        Write-Host "   ⚡ Function App: $funcUrl" -ForegroundColor Cyan
        Write-Host "      State: $($functionApp.State)" -ForegroundColor $(if ($functionApp.State -eq "Running") { "Green" } else { "Yellow" })
    } else {
        Write-Host "   ⏳ Function App not deployed yet" -ForegroundColor Gray
    }
}

# Main monitoring loop
try {
    # Check if connected to Azure
    $context = Get-AzContext -ErrorAction SilentlyContinue
    if ($null -eq $context) {
        Write-Host "Connecting to Azure Government..." -ForegroundColor Yellow
        Connect-AzAccount -Environment AzureUSGovernment
    } else {
        Write-Host "Connected to: $($context.Environment.Name)" -ForegroundColor Green
        Write-Host "Subscription: $($context.Subscription.Name)" -ForegroundColor Gray
    }
    
    Write-Host "Monitoring Resource Group: $ResourceGroupName" -ForegroundColor Cyan
    if ($Continuous) {
        Write-Host "Refresh Interval: $RefreshIntervalSeconds seconds" -ForegroundColor Gray
        Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Yellow
    }
    Write-Host ""
    
    do {
        $timestamp = Get-Date -Format "HH:mm:ss"
        Write-Host "`n⏰ Last Update: $timestamp" -ForegroundColor DarkGray
        Write-Host "════════════════════════════════════════" -ForegroundColor DarkGray
        
        # Get deployment status
        Get-DeploymentStatus -ResourceGroupName $ResourceGroupName
        
        # Get resource status
        Get-ResourceStatus -ResourceGroupName $ResourceGroupName
        
        # Test endpoints
        Test-Endpoints -ResourceGroupName $ResourceGroupName
        
        if ($Continuous) {
            Write-Host "`n💤 Waiting $RefreshIntervalSeconds seconds for next update..." -ForegroundColor DarkGray
            Start-Sleep -Seconds $RefreshIntervalSeconds
            Clear-Host
            Write-Host "========================================" -ForegroundColor Cyan
            Write-Host " AI-Icarus Deployment Monitor" -ForegroundColor Cyan
            Write-Host " Monitoring Azure Government Deployment" -ForegroundColor Cyan
            Write-Host "========================================" -ForegroundColor Cyan
        }
        
    } while ($Continuous)
    
    Write-Host "`n✅ Monitoring Complete" -ForegroundColor Green
    Write-Host "Run with -Continuous flag for real-time monitoring" -ForegroundColor Gray
    
} catch {
    Write-Error "Monitoring error: $_"
    exit 1
}