# AI-Icarus Azure Government IL4 Deployment

[![Deploy to Azure Government](https://aka.ms/deploytoazurebutton)](https://portal.azure.us/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Frsoligan_microsoft%2Fai-icarus-il4-deployment%2Fmain%2Fdeployment%2Fazuredeploy.json)

## Overview

AI-Icarus is a comprehensive web application for Azure OpenAI resource management with intelligent data chunking and analysis capabilities. This repository provides a one-click deployment solution specifically configured for Azure Government IL4 (DoD Impact Level 4) environments.

## Features

- 🔒 **IL4 Compliant**: Meets all DoD IL4 security requirements
- 🚀 **One-Click Deployment**: Deploy entire infrastructure with a single button
- 🔐 **User Delegation Model**: No API keys or service principals required
- 🌐 **Multi-Environment Support**: Works in Commercial, GCC High, and DoD regions
- 📊 **Dynamic Resource Discovery**: Automatically discovers Log Analytics and OpenAI resources
- 🤖 **Intelligent Chunking**: Optimized token management for large datasets

## Prerequisites

### Required Permissions
- Azure subscription in Azure Government (IL4/IL5 regions)
- Contributor role on the subscription or resource group
- Ability to create Azure AD app registrations
- Access to create the following resources:
  - Azure Static Web Apps
  - Azure Functions
  - Storage Accounts
  - Application Insights
  - Log Analytics Workspace

### Subscription Requirements
- Must be an Azure Government subscription
- Regions: US Gov Virginia, US Gov Arizona, US DoD Central, or US DoD East
- Sufficient quota for:
  - 1 Static Web App
  - 1 Function App (Consumption plan)
  - 1 Storage Account
  - 1 Application Insights instance

## Quick Start

### Option 1: Deploy to Azure Button (Recommended)

1. Click the "Deploy to Azure Government" button above
2. Sign in to Azure Government Portal (portal.azure.us)
3. Fill in the required parameters:
   - **Resource Group**: Select or create new
   - **App Name**: Unique name for your deployment
   - **Location**: Select US Gov Virginia or US Gov Arizona
   - **Environment**: Select "AzureDoD" for IL4
4. Click "Review + Create"
5. Wait 10-15 minutes for deployment to complete
6. Access your application at the provided URLs

### Option 2: PowerShell Deployment

```powershell
# Clone the repository
git clone https://github.com/rsoligan_microsoft/ai-icarus-il4-deployment.git
cd ai-icarus-il4-deployment

# Login to Azure Government
Connect-AzAccount -Environment AzureUSGovernment

# Run deployment script
./scripts/deploy-il4.ps1 `
  -ResourceGroupName "rg-ai-icarus-il4" `
  -AppName "ai-icarus" `
  -Location "USGov Virginia" `
  -Environment "AzureDoD"
```

### Option 3: Azure CLI Deployment

```bash
# Login to Azure Government
az cloud set --name AzureUSGovernment
az login

# Create resource group
az group create \
  --name rg-ai-icarus-il4 \
  --location usgovvirginia

# Deploy template
az deployment group create \
  --resource-group rg-ai-icarus-il4 \
  --template-file deployment/azuredeploy.json \
  --parameters appName=ai-icarus environment=AzureDoD
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Azure Government (IL4)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │ Static Web   │───▶│ Function App │───▶│ Azure OpenAI │ │
│  │     App      │    │   (Node.js)  │    │   Resources  │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│         │                    │                     │        │
│         ▼                    ▼                     ▼        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │   Azure AD   │    │   Storage    │    │     Log      │ │
│  │ (Auth - .us) │    │   Account    │    │  Analytics   │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│                                                             │
│  Security Controls:                                         │
│  • TLS 1.2+ enforced                                       │
│  • Private endpoints                                       │
│  • Customer-managed keys                                   │
│  • 365-day log retention                                   │
│  • Network isolation (NSGs)                                │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

The deployment automatically configures these environment variables:

| Variable | Description | IL4 Value |
|----------|-------------|-----------|
| AZURE_ENVIRONMENT | Azure cloud environment | AzureDoD |
| AUTH_ENDPOINT | Authentication endpoint | https://login.microsoftonline.us |
| GRAPH_ENDPOINT | Graph API endpoint | https://dod-graph.microsoft.us |
| MANAGEMENT_ENDPOINT | Management API | https://management.usgovcloudapi.net |
| LOG_ANALYTICS_ENDPOINT | Log Analytics API | https://api.loganalytics.us |
| OPENAI_DOMAIN | OpenAI domain suffix | openai.azure.us |

### Post-Deployment Configuration

After deployment completes:

1. **Access the Application**
   - Navigate to the Static Web App URL provided
   - Sign in with your Azure Government credentials

2. **Configure Resources**
   - Click "Setup" in the navigation
   - Click "Discover Resources" to find available workspaces
   - Select your Log Analytics Workspace
   - Select your Azure OpenAI resource and deployment

3. **Verify Connectivity**
   - Test KQL query execution
   - Test OpenAI model connectivity
   - Verify resource discovery works

## Security Compliance

### IL4 Security Controls

This deployment implements the following IL4 requirements:

- ✅ **AC-2**: Account Management via Azure AD
- ✅ **AC-3**: RBAC-based Access Enforcement  
- ✅ **AU-4**: 365-day Audit Log Storage
- ✅ **SC-8**: TLS 1.2+ Transmission Confidentiality
- ✅ **SC-13**: FIPS 140-2 Cryptographic Protection
- ✅ **SC-28**: Customer-Managed Encryption Keys
- ✅ **SI-2**: Automated Security Updates
- ✅ **SI-4**: Application Insights Monitoring

### Data Handling

- All data remains within Azure Government boundaries
- No data is transmitted to commercial Azure
- User delegation tokens expire after 1 hour
- No persistent storage of sensitive data
- All logs encrypted at rest and in transit

## Troubleshooting

### Common Issues

#### 1. Authentication Errors
```
Error: "AADSTS50011: The reply URL specified in the request does not match"
```
**Solution**: Run `./scripts/configure-aad.ps1` to update redirect URIs

#### 2. Resource Discovery Fails
```
Error: "No workspaces found"
```
**Solution**: Ensure you have Reader role on Log Analytics workspaces

#### 3. OpenAI Connection Issues
```
Error: "Failed to connect to OpenAI endpoint"
```
**Solution**: Verify OpenAI resource is deployed in Government region

### Validation Script

Run the validation script to check your deployment:

```powershell
./scripts/validate-deployment.ps1 `
  -ResourceGroupName "rg-ai-icarus-il4" `
  -AppName "ai-icarus"
```

## Development

### Local Development Setup

1. **Clone and Install**:
```bash
git clone https://github.com/your-username/ai-icarus-il4-deployment.git
cd ai-icarus-il4-deployment
cd src/frontend && npm install
cd ../functions && npm install
```

2. **Configure for Government Cloud**:
```bash
# Set environment variables
export AZURE_ENVIRONMENT=AzureUSGovernment
export AUTH_ENDPOINT=https://login.microsoftonline.us
export GRAPH_ENDPOINT=https://graph.microsoft.us
```

3. **Run Locally**:
```bash
# Terminal 1: Run Functions
cd src/functions
func start

# Terminal 2: Run Frontend
cd src/frontend
npm start
```

### Contributing

Please read [CONTRIBUTING.md](docs/CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Support

### Documentation
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)
- [IL4 Requirements](docs/IL4_REQUIREMENTS.md)
- [Security Controls](docs/SECURITY_CONTROLS.md)
- [API Reference](docs/API_REFERENCE.md)

### Getting Help
- Create an [Issue](https://github.com/rsoligan_microsoft/ai-icarus-il4-deployment/issues)
- Review [FAQ](docs/FAQ.md)
- Check [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Azure Government team for IL4 guidance
- DoD Cloud Computing SRG for security requirements
- Microsoft Azure OpenAI team for Government support

## Compliance Notice

This deployment is designed to meet DoD IL4 requirements but requires proper configuration and operation to maintain compliance. Users are responsible for:
- Maintaining proper access controls
- Regular security audits
- Compliance validation
- Incident response procedures

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Status**: Production Ready for IL4 Deployments