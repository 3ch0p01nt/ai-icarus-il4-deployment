# Authentication Setup for AI-Icarus IL4 Deployment

## Quick Start

After deploying the application, you need to set up Azure AD authentication:

### Option 1: During Deployment (Recommended)

When you click "Deploy to Azure", you'll see two authentication parameters:
- **Azure AD Client ID**: Enter your app registration client ID
- **Azure AD Tenant ID**: Enter your tenant ID (optional, uses subscription tenant by default)

If you don't have these yet, leave them empty and follow Option 2 after deployment.

### Option 2: After Deployment

1. **Create an Azure AD App Registration**:
   ```powershell
   # Connect to Azure Government
   Connect-AzAccount -Environment AzureUSGovernment
   
   # Create app registration
   $app = New-AzADApplication -DisplayName "YourAppName-auth" `
     -IdentifierUris "api://YourAppName" `
     -ReplyUrls @("https://your-web-app-url.azurewebsites.us")
   
   # Get the Client ID
   Write-Host "Client ID: $($app.AppId)"
   ```

2. **Configure the App Registration**:
   - Go to Azure Portal (portal.azure.us)
   - Navigate to Azure Active Directory > App registrations
   - Find your app and click on it
   - Go to "Authentication" > "Add a platform" > "Single-page application"
   - Add redirect URIs:
     - `https://your-web-app-url.azurewebsites.us`
     - `https://your-web-app-url.azurewebsites.us/`
     - `http://localhost:3000` (for local testing)

3. **Update Application Settings**:
   
   **For Web App**:
   ```bash
   az webapp config appsettings set \
     --resource-group YOUR_RG \
     --name web-YOUR_APP_NAME \
     --settings AZURE_CLIENT_ID="YOUR_CLIENT_ID" \
                AZURE_TENANT_ID="YOUR_TENANT_ID"
   ```
   
   **For Function App**:
   ```bash
   az functionapp config appsettings set \
     --resource-group YOUR_RG \
     --name func-YOUR_APP_NAME \
     --settings AZURE_CLIENT_ID="YOUR_CLIENT_ID" \
                AZURE_TENANT_ID="YOUR_TENANT_ID"
   ```

4. **Restart both apps**:
   ```bash
   az webapp restart --resource-group YOUR_RG --name web-YOUR_APP_NAME
   az functionapp restart --resource-group YOUR_RG --name func-YOUR_APP_NAME
   ```

## PowerShell Script (Automated)

Run the provided setup script:

```powershell
./scripts/setup-auth-il4.ps1 `
  -AppName "YOUR_APP_NAME" `
  -ResourceGroupName "YOUR_RESOURCE_GROUP"
```

This script will:
- Create the Azure AD app registration
- Configure it for SPA authentication
- Update both Web App and Function App settings
- Set up all necessary redirect URIs

## Required Permissions

The app registration needs these API permissions:
- Microsoft Graph:
  - User.Read (Delegated)
  - profile (Delegated)
  - openid (Delegated)
  - offline_access (Delegated)

## Troubleshooting

### "Client ID not configured" error
- Ensure AZURE_CLIENT_ID is set in both Web App and Function App
- Restart both applications after setting the values

### "Invalid redirect URI" error
- Check that the redirect URI in Azure AD matches your web app URL exactly
- Include both with and without trailing slash

### "Tenant not found" error
- Verify you're using the correct tenant ID for your Azure Government subscription
- Ensure you're connecting to the right Azure environment

### Authentication popup blocked
- Allow popups from your web app domain
- Try using an incognito/private browser window

## Environment-Specific Endpoints

The application automatically detects and uses the correct endpoints:

### Azure Government (IL4/IL5)
- Login: `https://login.microsoftonline.us`
- Graph: `https://dod-graph.microsoft.us`
- Management: `https://management.usgovcloudapi.net`

### Azure Commercial (for testing)
- Login: `https://login.microsoftonline.com`
- Graph: `https://graph.microsoft.com`
- Management: `https://management.azure.com`

## Security Best Practices

1. **Use Managed Identity** where possible for backend services
2. **Enable MFA** for all users accessing the application
3. **Restrict redirect URIs** to only necessary domains
4. **Regular audit** of app permissions and user access
5. **Use Key Vault** for any additional secrets

## Next Steps

After authentication is configured:
1. Navigate to your web app URL
2. Click "Sign in with Microsoft"
3. Authenticate with your Azure Government credentials
4. Start using AI-Icarus features

For additional help, see the main [README](README.md) or create an issue on GitHub.