# Deploying AI-Icarus from Private Repository

## Method 1: Manual Template Upload (Recommended - 5 minutes)

1. **Copy the template content:**
   - The template is already cloned locally at `/tmp/ai-icarus-il4-deployment/deployment/azuredeploy.json`
   
2. **Go to Azure Government Portal:**
   - Navigate to https://portal.azure.us
   - Search for "Deploy a custom template" or go to:
   - https://portal.azure.us/#create/Microsoft.Template

3. **Click "Build your own template in the editor"**

4. **Paste the template content** from `azuredeploy.json`

5. **Click Save** then fill in parameters:
   - Resource Group: Create new or select existing
   - App Name: `aiicarus` (or your preferred name)
   - Environment: `AzureDoD`
   - Location: `usgovvirginia` or `usgovarizona`
   
6. **Click "Review + Create" then "Create"**

## Method 2: Azure CLI Deployment (From Local Clone)

```bash
# Since you already have the repo cloned locally
cd /tmp/ai-icarus-il4-deployment

# Login to Azure Government
az cloud set --name AzureUSGovernment
az login

# Create resource group
az group create \
  --name rg-ai-icarus-il4 \
  --location usgovvirginia

# Deploy using local template
az deployment group create \
  --resource-group rg-ai-icarus-il4 \
  --template-file deployment/azuredeploy.json \
  --parameters @test-parameters.json
```

## Method 3: PowerShell Deployment (From Local Clone)

```powershell
# Navigate to cloned repo
cd /tmp/ai-icarus-il4-deployment

# Connect to Azure Government
Connect-AzAccount -Environment AzureUSGovernment

# Create resource group
New-AzResourceGroup `
  -Name "rg-ai-icarus-il4" `
  -Location "USGov Virginia"

# Deploy template
New-AzResourceGroupDeployment `
  -ResourceGroupName "rg-ai-icarus-il4" `
  -TemplateFile "deployment/azuredeploy.json" `
  -TemplateParameterFile "test-parameters.json"
```

## Method 4: Make Repository Temporarily Public

If you want to use the Deploy to Azure button:

1. **Temporarily make the repo public:**
   ```bash
   gh repo edit rsoligan_microsoft/ai-icarus-il4-deployment --visibility public
   ```

2. **Click the Deploy to Azure button**

3. **Make it private again after deployment:**
   ```bash
   gh repo edit rsoligan_microsoft/ai-icarus-il4-deployment --visibility private
   ```

## Method 5: GitHub Actions with Service Principal

For automated deployments from private repo:

1. **Create Service Principal:**
   ```bash
   az ad sp create-for-rbac \
     --name "ai-icarus-deployment-sp" \
     --role contributor \
     --scopes /subscriptions/{subscription-id}/resourceGroups/rg-ai-icarus-il4 \
     --sdk-auth
   ```

2. **Add as GitHub Secret:**
   - Go to repo Settings > Secrets
   - Add new secret `AZURE_CREDENTIALS` with the JSON output

3. **Use the provided GitHub Actions workflow:**
   - The repo includes `GITHUB_WORKFLOW.yml` for automated deployment

## Important Notes

### Cannot Grant GitHub Access to Azure AD Identity
- **GitHub.com (even Microsoft repos) cannot authenticate against Azure Government AD**
- GitHub uses its own authentication system (GitHub PATs, OAuth)
- Azure Government AD identities cannot be directly granted access to GitHub repos
- This is a boundary between commercial GitHub and Government cloud

### Why Private Repo Access Fails
- The Deploy to Azure button expects a publicly accessible URL
- Azure portal (even Government) cannot authenticate to private GitHub repos
- GitHub raw content URLs require authentication tokens for private repos
- CORS policies prevent passing authentication headers from Azure portal

### Recommended Approach
**Use Method 1 (Manual Template Upload)** - It's the quickest and most reliable for private repos. You already have the template locally, so just copy and paste it into the Azure portal.

## Post-Deployment Steps

After deployment completes (any method):

1. **Run AAD Configuration:**
   ```powershell
   cd /tmp/ai-icarus-il4-deployment
   ./scripts/configure-aad.ps1 `
     -ResourceGroupName "rg-ai-icarus-il4" `
     -AppName "aiicarus"
   ```

2. **Validate Deployment:**
   ```powershell
   ./scripts/validate-deployment.ps1 `
     -ResourceGroupName "rg-ai-icarus-il4" `
     -AppName "aiicarus"
   ```