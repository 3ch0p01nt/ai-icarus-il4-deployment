# AI-Icarus IL4 Project Restrictions and Guidelines

## Deployment Target
- **Tenant**: Argon (IL4)
- **Resource Group**: aiicarus8 (ONLY - no resources outside this group)
- **Region**: USGOV Arizona
- **Environment**: AzureUSGovernment
- **Location**: usgovarizona

## Critical Restrictions
- **NO hardcoded API keys, secrets, or credentials**
- **NO direct tenant modifications** (deployment only)
- **NO resources created outside aiicarus8 resource group**
- **ALL changes must be made via GitHub repository**
- **MUST use managed identities for authentication**
- **Query Argon tenant for monitoring/logs ONLY**

## Required Principles
- **Zero Trust Architecture**: No standing privileges, no hardcoded secrets
- **Portability**: App must be deployable to any IL4 tenant without modification
- **Managed Identities**: All authentication via Azure Managed Identity
- **Repository-Based**: All configuration and code changes via GitHub

## Testing Requirements
- **Run Playwright tests after EVERY deployment**
- **Verify UI matches mango-smoke webapp exactly**
- **Test all 4 tabs are functional**
- **Validate authentication works without manual configuration**
- **Ensure no hardcoded credentials exist**
- **Generate test reports with screenshots**

## Feature Requirements
The deployed application MUST be an exact replica of the mango webapp with:
1. **4 Main Tabs**:
   - Dashboard (workspace metrics)
   - Workspaces (discovery and selection)
   - KQL Query (with IntelliSense)
   - OpenAI (model management)

2. **M365 Defender Integration**:
   - Incident management
   - Alert correlation
   - Advanced hunting queries
   - Entity graph visualization

3. **Export Capabilities**:
   - CSV, JSON, Excel, PDF, Text formats
   - Streaming AI responses

## Development Workflow
1. Make all code changes in GitHub repository
2. Test locally with Playwright
3. Push to main branch
4. Deploy to Argon via ARM template
5. Run Playwright tests against deployment
6. Verify all success criteria met

## Success Criteria Checklist
- [ ] One-click deployment works without manual configuration
- [ ] UI identical to mango-smoke webapp
- [ ] All 4 tabs functional
- [ ] M365 Defender features working
- [ ] Export capabilities operational
- [ ] No hardcoded credentials
- [ ] Managed identity authentication working
- [ ] Deployed to aiicarus8 resource group only
- [ ] IL4 compliance maintained
- [ ] All Playwright tests passing
- [ ] Test reports generated with screenshots

## Commands to Remember
```bash
# Run Playwright tests
node test-aiicarus8-deployment.js

# Deploy to Argon
./scripts/deploy-to-argon.ps1

# Check deployment status
az deployment group show --resource-group aiicarus8 --name aiicarus8-deployment

# View logs
az webapp log tail --resource-group aiicarus8 --name web-aiicarus8
```

## DO NOT
- Modify resources outside aiicarus8 resource group
- Hardcode any credentials or secrets
- Make direct changes to the tenant (only via ARM template)
- Skip Playwright testing after deployment
- Deploy without verifying managed identity configuration