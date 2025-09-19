import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { LogsQueryClient, QueryTimeInterval } from "@azure/monitor-query";

interface KQLQueryRequest {
  workspaceId: string;
  query: string;
  timeRange?: {
    startTime: string;
    endTime: string;
  };
  maxRows?: number;
}

interface KQLQueryResult {
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
    }>;
    rows: any[][];
  }>;
  statistics?: any;
  visualization?: any;
}

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  context.log("ExecuteKQLQuery function processing request");

  try {
    // Validate authorization
    const authToken = req.headers.authorization;
    if (!authToken || !authToken.startsWith("Bearer ")) {
      context.res = {
        status: 401,
        body: { error: "Authorization header with Bearer token required" }
      };
      return;
    }

    // Parse request body
    const request: KQLQueryRequest = req.body;
    
    if (!request?.workspaceId || !request?.query) {
      context.res = {
        status: 400,
        body: { error: "workspaceId and query are required" }
      };
      return;
    }

    // Validate query (basic safety checks)
    if (!isQuerySafe(request.query)) {
      context.res = {
        status: 400,
        body: { error: "Query contains potentially unsafe operations" }
      };
      return;
    }

    // Initialize Azure credentials
    const credential = new DefaultAzureCredential();
    
    // Get environment configuration
    const azureEnvironment = process.env.AzureEnvironment || "AzureCloud";
    const logAnalyticsEndpoint = getLogAnalyticsEndpoint(azureEnvironment);
    
    // Initialize Log Analytics client
    const logsClient = new LogsQueryClient(credential, {
      endpoint: logAnalyticsEndpoint
    });

    // Set time range (default to last 24 hours)
    const timeInterval: QueryTimeInterval = request.timeRange ? {
      startTime: new Date(request.timeRange.startTime),
      endTime: new Date(request.timeRange.endTime)
    } : {
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endTime: new Date()
    };

    context.log(`Executing KQL query on workspace: ${request.workspaceId}`);
    
    // Execute the query
    const result = await logsClient.queryWorkspace(
      request.workspaceId,
      request.query,
      timeInterval,
      {
        serverTimeoutInSeconds: 30,
        includeStatistics: true,
        includeVisualization: true
      }
    );

    // Format the response
    const response: KQLQueryResult = {
      tables: result.tables.map(table => ({
        name: table.name,
        columns: table.columns.map(col => ({
          name: col.name,
          type: col.type
        })),
        rows: table.rows.slice(0, request.maxRows || 1000)
      })),
      statistics: result.statistics,
      visualization: result.visualization
    };

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        result: response,
        executionTime: result.statistics?.query?.executionTime || 0,
        rowCount: response.tables[0]?.rows.length || 0,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    context.log.error("Error in ExecuteKQLQuery function:", error);
    
    // Handle specific error types
    let statusCode = 500;
    let errorMessage = "Internal server error";
    
    if (error.message?.includes("unauthorized") || error.message?.includes("401")) {
      statusCode = 401;
      errorMessage = "Unauthorized to access workspace";
    } else if (error.message?.includes("not found") || error.message?.includes("404")) {
      statusCode = 404;
      errorMessage = "Workspace not found";
    } else if (error.message?.includes("syntax") || error.message?.includes("semantic")) {
      statusCode = 400;
      errorMessage = "Invalid KQL query syntax";
    }
    
    context.res = {
      status: statusCode,
      body: {
        error: errorMessage,
        message: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
};

function isQuerySafe(query: string): boolean {
  // Basic safety checks - prevent potentially destructive operations
  const unsafePatterns = [
    /\bdrop\s+table\b/i,
    /\bdelete\s+/i,
    /\btruncate\s+/i,
    /\balter\s+/i,
    /\bcreate\s+/i
  ];
  
  return !unsafePatterns.some(pattern => pattern.test(query));
}

function getLogAnalyticsEndpoint(environment: string): string {
  switch (environment) {
    case "AzureUSGovernment":
      return "https://api.loganalytics.us";
    case "AzureDoD":
      return "https://api.loganalytics.us";
    case "AzureCloud":
    default:
      return "https://api.loganalytics.io";
  }
}

export default httpTrigger;