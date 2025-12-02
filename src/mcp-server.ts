#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { LinearService } from "./services/linear-service.js";
import { SSEManager } from "./services/sse-manager.js";
import { getAccessToken, getActiveWorkspaceKey } from "./auth/credentials.js";
import dotenv from "dotenv";
import * as path from "path";

// Load .env from the project root (where the dist folder is), not from cwd
// __dirname in CommonJS will be the dist directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const server = new Server(
  {
    name: "linear-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Wrap initialization in try-catch to catch startup errors
let sseManager: SSEManager;
let linearService: LinearService;

async function initializeServices(): Promise<void> {
  // Get access token (checks env var first, then OAuth credentials)
  const accessToken = await getAccessToken();

  if (!accessToken) {
    const workspaceKey = getActiveWorkspaceKey();
    if (workspaceKey) {
      console.error(`No valid credentials found for workspace: ${workspaceKey}`);
      console.error("Run `linear-mcp auth login` to re-authenticate.");
    } else {
      console.error("No Linear credentials found.");
      console.error("Please either:");
      console.error("  1. Run `linear-mcp auth login` to authenticate via OAuth");
      console.error("  2. Set the LINEAR_API_KEY environment variable");
    }
    process.exit(1);
  }

  sseManager = new SSEManager(15000); // Default heartbeat interval
  linearService = new LinearService(accessToken, sseManager);
}

// Services will be initialized in runServer() before connecting

const tools: Tool[] = [
  {
    name: "mcp__linear__list_issues",
    description: "List issues in the user's Linear workspace",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "The team key (e.g., 'OPS', 'SOFT')" },
        projectId: { type: "string", description: "The project identifier" },
        cycleId: { type: "string", description: "The cycle identifier" },
        assigneeId: { type: "string", description: "The assignee username or email" },
        stateId: { type: "string", description: "The state name (e.g., 'Todo', 'In Progress', 'Done')" },
        limit: { type: "number", default: 50, description: "The number of issues to return" },
        query: { type: "string", description: "An optional search query" },
        createdAt: { type: "string", description: "Return only issues created on or after this ISO-8601 date-time" },
        updatedAt: { type: "string", description: "Return only issues updated on or after this ISO-8601 date-time" },
        includeArchived: { type: "boolean", default: true, description: "Whether to include archived issues" },
        parentId: { type: "string", description: "The parent issue identifier (e.g., 'OPS-123')" }
      },
    },
  },
  {
    name: "mcp__linear__create_issue",
    description: "Create a new Linear issue",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The issue title" },
        teamId: { type: "string", description: "The team key (e.g., 'OPS', 'SOFT')" },
        description: { type: "string", description: "The issue description as Markdown" },
        assigneeId: { type: "string", description: "The assignee username or email" },
        stateId: { type: "string", description: "The state name (e.g., 'Todo', 'In Progress', 'Done')" },
        priority: { type: "number", description: "The issue priority. 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low." },
        labelIds: { type: "array", items: { type: "string" }, description: "Array of label names (e.g., ['Bug', 'Feature', 'Blocked'])" },
        projectId: { type: "string", description: "The project identifier" },
        cycleId: { type: "string", description: "The cycle identifier" },
        parentId: { type: "string", description: "The parent issue identifier (e.g., 'OPS-123')" },
        dueDate: { type: "string", description: "The due date for the issue in ISO format" },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", format: "uri" },
              title: { type: "string", minLength: 1 }
            },
            required: ["url", "title"]
          },
          description: "Array of link objects to attach to the issue"
        }
      },
      required: ["title", "teamId"],
    },
  },
  {
    name: "mcp__linear__create_subissue",
    description: "Create a sub-issue under a parent issue",
    inputSchema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "The parent issue identifier (e.g., 'OPS-123')" },
        title: { type: "string", description: "The sub-issue title" },
        description: { type: "string", description: "The sub-issue description (optional)" },
        stateId: { type: "string", description: "The state name (optional, e.g., 'Todo')" },
        labelIds: { type: "array", items: { type: "string" }, description: "Label names (optional)" }
      },
      required: ["parentId", "title"]
    },
  },
  {
    name: "mcp__linear__update_issue",
    description: "Update an existing Linear issue",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The issue identifier (e.g., 'OPS-123')" },
        title: { type: "string", description: "The issue title" },
        description: { type: "string", description: "The issue description as Markdown" },
        assigneeId: { type: "string", description: "The assignee username or email" },
        stateId: { type: "string", description: "The state name (e.g., 'Todo', 'In Progress', 'Done')" },
        priority: { type: "number", description: "The issue priority. 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low." },
        labelIds: { type: "array", items: { type: "string" }, description: "Array of label names (e.g., ['Bug', 'Feature', 'Blocked'])" },
        projectId: { type: "string", description: "The project identifier" },
        cycleId: { type: "string", description: "The cycle identifier" },
        parentId: { type: "string", description: "The parent issue identifier (e.g., 'OPS-123')" },
        dueDate: { type: "string", description: "The due date for the issue in ISO format" },
        estimate: { type: "number", description: "The numerical issue estimate value" },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", format: "uri" },
              title: { type: "string", minLength: 1 }
            },
            required: ["url", "title"]
          },
          description: "Array of link objects to attach to the issue"
        }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__get_issue",
    description: "Get issue details formatted as markdown with full description, comments, and metadata",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The issue identifier (e.g., 'OPS-123')" }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__list_teams",
    description: "List teams in the user's Linear workspace",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "An optional search query" },
        includeArchived: { type: "boolean", default: false, description: "Whether to include archived teams" },
        limit: { type: "number", default: 50, description: "The number of items to return" },
        orderBy: { type: "string", enum: ["createdAt", "updatedAt"], default: "updatedAt" },
        createdAt: { type: "string", description: "Return only teams created on or after this ISO-8601 date-time" },
        updatedAt: { type: "string", description: "Return only teams updated on or after this ISO-8601 date-time" },
        after: { type: "string", description: "A cursor to start from (for pagination)" },
        before: { type: "string", description: "A cursor to end at (for pagination)" }
      },
    },
  },
  {
    name: "mcp__linear__list_states",
    description: "List all workflow states for a team",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "The team key (e.g., 'OPS', 'SOFT')" }
      },
      required: ["teamId"],
    },
  },
  {
    name: "mcp__linear__list_labels",
    description: "List all labels for a team",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "The team key (e.g., 'OPS', 'SOFT')" }
      },
      required: ["teamId"],
    },
  },
  {
    name: "mcp__linear__search_issues",
    description: "Search for issues using full text search with filters",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query for full text search across issue titles and descriptions" },
        teamId: { type: "string", description: "Filter by team key (e.g., 'OPS', 'SOFT')" },
        stateId: { type: "string", description: "Filter by state name (e.g., 'Todo', 'In Progress', 'Done')" },
        labelIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by label names (e.g., ['Bug', 'Feature'])"
        },
        createdAfter: { type: "string", description: "Filter issues created on or after this ISO-8601 date-time" },
        updatedAfter: { type: "string", description: "Filter issues updated on or after this ISO-8601 date-time" },
        includeArchived: { type: "boolean", default: false, description: "Whether to include archived issues in search results" },
        limit: { type: "number", default: 50, description: "The maximum number of results to return" }
      },
      required: ["query"],
    },
  },
  {
    name: "mcp__linear__file_history",
    description: "Get Linear issues that modified a specific file in the git repository",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file (relative or absolute)" },
        limit: { type: "number", default: 20, description: "Maximum number of issues to return" }
      },
      required: ["file_path"],
    },
  },
  {
    name: "mcp__linear__add_comment",
    description: "Add a comment to a Linear issue",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The issue identifier (e.g., 'MCP-1')" },
        comment: { type: "string", description: "The comment text (supports markdown)" }
      },
      required: ["id", "comment"],
    },
  },
  {
    name: "mcp__linear__delete_issue",
    description: "Archive/delete a Linear issue",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The issue identifier (e.g., 'MCP-1')" }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__list_comments",
    description: "List comments on a Linear issue",
    inputSchema: {
      type: "object",
      properties: {
        issueId: { type: "string", description: "The issue identifier (e.g., 'MCP-1')" }
      },
      required: ["issueId"],
    },
  },
  {
    name: "mcp__linear__list_projects",
    description: "List projects in the user's Linear workspace",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 50, description: "The number of projects to return" }
      },
    },
  },
  {
    name: "mcp__linear__get_project",
    description: "Get details for a specific project",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The project identifier or name" }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__create_project",
    description: "Create a new project",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The project name" },
        description: { type: "string", description: "The project description" },
        teamIds: { 
          type: "array", 
          items: { type: "string" }, 
          description: "Array of team keys (e.g., ['OPS', 'SOFT'])" 
        },
        startDate: { type: "string", description: "The project start date in ISO format" },
        targetDate: { type: "string", description: "The project target date in ISO format" }
      },
      required: ["name", "teamIds"],
    },
  },
  {
    name: "mcp__linear__update_project",
    description: "Update an existing project",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The project identifier" },
        name: { type: "string", description: "The project name" },
        description: { type: "string", description: "The project description" },
        startDate: { type: "string", description: "The project start date in ISO format" },
        targetDate: { type: "string", description: "The project target date in ISO format" }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__get_team",
    description: "Get details for a specific team",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The team key (e.g., 'OPS') or ID" }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__list_users",
    description: "List users in the Linear workspace",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 50, description: "The number of users to return" }
      },
    },
  },
  {
    name: "mcp__linear__get_user",
    description: "Get details for a specific user",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The user email or ID" }
      },
      required: ["id"],
    },
  },
  {
    name: "mcp__linear__get_current_user",
    description: "Get details for the currently authenticated user",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mcp__linear__get_capabilities",
    description: "Get the capabilities and features of the Linear MCP server",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "mcp__linear__list_issues":
        const result = await linearService.listIssues(args || {});
        return {
          content: [
            {
              type: "text",
              text: result.table || "No issues found",
            },
          ],
        };

      case "mcp__linear__get_issue":
        const issueData = await linearService.getIssueMarkdown(args || {});
        return {
          content: [
            {
              type: "text",
              text: issueData.markdown,
            },
          ],
        };

      case "mcp__linear__create_issue":
        const newIssue = await linearService.createIssue(args || {});
        return {
          content: [
            {
              type: "text",
              text: `✅ Created issue **${newIssue.identifier}**: ${newIssue.title}`,
            },
          ],
        };

      case "mcp__linear__create_subissue": {
        // First, get the parent issue to retrieve its teamId
        const parentIssueData = await linearService.getIssueMarkdown({ id: args?.parentId });
        
        // Extract team info from the markdown using regex
        const teamMatch = parentIssueData.markdown.match(/\*\*Team:\*\* .+ \((\w+)\)/);
        if (!teamMatch || !teamMatch[1]) {
          throw new Error(`Could not determine team for parent issue ${String(args?.parentId)}`);
        }
        const teamId = teamMatch[1];
        
        // Extract the parent issue UUID from the markdown
        const idMatch = parentIssueData.markdown.match(/\*\*ID:\*\* `([a-f0-9-]+)`/);
        if (!idMatch || !idMatch[1]) {
          throw new Error(`Could not extract UUID for parent issue ${String(args?.parentId)}`);
        }
        const parentUuid = idMatch[1];
        
        // Create the sub-issue with the parent's teamId and resolved UUID
        const subissueArgs = {
          title: args?.title,
          description: args?.description,
          teamId: teamId,
          parentId: parentUuid,
          stateId: args?.stateId,
          labelIds: args?.labelIds
        };
        
        const newSubissue = await linearService.createIssue(subissueArgs);
        return {
          content: [
            {
              type: "text",
              text: `✅ Created sub-issue **${newSubissue.identifier}** under **${String(args?.parentId)}**: ${newSubissue.title}`,
            },
          ],
        };
      }

      case "mcp__linear__update_issue":
        const updatedIssue = await linearService.updateIssue(args || {});
        return {
          content: [
            {
              type: "text",
              text: `✅ Updated issue **${updatedIssue.identifier}**: ${updatedIssue.title}`,
            },
          ],
        };

      case "mcp__linear__list_teams":
        const teams = await linearService.listTeams(args || {});
        const teamsTable = teams.nodes.map((team: any) => `| ${team.key} | ${team.name} | ${team.description || '-'} |`).join('\n');
        return {
          content: [
            {
              type: "text",
              text: `| Key | Name | Description |\n|---|---|---|\n${teamsTable}`,
            },
          ],
        };

      case "mcp__linear__list_states":
        const statesResult = await linearService.listStates(args || {});
        const statesByType = statesResult.states.reduce((acc: any, state: any) => {
          if (!acc[state.type]) acc[state.type] = [];
          acc[state.type].push(state.name);
          return acc;
        }, {});

        const statesList = Object.entries(statesByType)
          .map(([type, states]: [string, any]) => `${type}:\n${states.map((s: string) => `  - ${s}`).join('\n')}`)
          .join('\n\n');

        return {
          content: [
            {
              type: "text",
              text: statesList,
            },
          ],
        };

      case "mcp__linear__list_labels":
        const labelsResult = await linearService.listLabels(args || {});
        const labelsList = labelsResult.labels.map((label: any) => `- ${label.name}`).join('\n');
        return {
          content: [
            {
              type: "text",
              text: labelsList,
            },
          ],
        };

      case "mcp__linear__search_issues":
        const searchResult = await linearService.searchIssues(args || {});
        return {
          content: [
            {
              type: "text",
              text: searchResult.table || "No issues found",
            },
          ],
        };

      case "mcp__linear__file_history":
        const fileHistoryResult = await linearService.getFileHistory(args || {});
        return {
          content: [
            {
              type: "text",
              text: fileHistoryResult.formatted || fileHistoryResult.message || "No issues found",
            },
          ],
        };

      case "mcp__linear__add_comment":
        const commentArgs = {
          issueId: args?.id,
          body: args?.comment
        };
        const commentResult = await linearService.createComment(commentArgs);
        let responseText: string;
        if (commentResult.chunked) {
          responseText = `✅ Added comment to issue (split into ${commentResult.totalParts} parts due to length)`;
        } else {
          responseText = `✅ Added comment to issue`;
        }
        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };

      case "mcp__linear__delete_issue":
        const deleteResult = await linearService.deleteIssue(args || {});
        return {
          content: [
            {
              type: "text",
              text: deleteResult.success ? "✅ Issue archived successfully" : "❌ Failed to archive issue",
            },
          ],
        };

      case "mcp__linear__list_comments":
        const comments = await linearService.listComments(args || {});
        if (comments.nodes.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "*No comments found*",
              },
            ],
          };
        }
        const commentsText = comments.nodes.map((comment: any) => 
          `**#${comment.position} - ${comment.user?.name || 'Unknown'}** (${new Date(comment.createdAt).toLocaleString()})\n${comment.body}`
        ).join('\n\n---\n\n');
        return {
          content: [
            {
              type: "text",
              text: commentsText,
            },
          ],
        };

      case "mcp__linear__list_projects":
        const projects = await linearService.listProjects(args || {});
        if (projects.nodes.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "*No projects found*",
              },
            ],
          };
        }
        const projectsTable = projects.nodes.map((project: any) => {
          const teams = project.teams.map((t: any) => t.key).join(', ');
          return `| ${project.name} | ${teams} | ${project.description || '-'} |`;
        }).join('\n');
        return {
          content: [
            {
              type: "text",
              text: `| Name | Teams | Description |\n|---|---|---|\n${projectsTable}`,
            },
          ],
        };

      case "mcp__linear__get_project":
        const project = await linearService.getProject(args || {});
        const projectTeams = project.teams.map((t: any) => `${t.name} (${t.key})`).join(', ');
        const projectIssues = project.issues.length > 0 
          ? project.issues.map((i: any) => `- ${i.identifier}: ${i.title}`).join('\n')
          : '*No issues*';
        return {
          content: [
            {
              type: "text",
              text: `# ${project.name}\n\n**Teams:** ${projectTeams}\n**Description:** ${project.description || 'No description'}\n**Start Date:** ${project.startDate || 'Not set'}\n**Target Date:** ${project.targetDate || 'Not set'}\n\n## Issues\n${projectIssues}`,
            },
          ],
        };

      case "mcp__linear__create_project":
        const newProject = await linearService.createProject(args || {});
        return {
          content: [
            {
              type: "text",
              text: `✅ Created project **${newProject.name}**\n${newProject.url}`,
            },
          ],
        };

      case "mcp__linear__update_project":
        const updatedProject = await linearService.updateProject(args || {});
        return {
          content: [
            {
              type: "text",
              text: `✅ Updated project **${updatedProject.name}**`,
            },
          ],
        };

      case "mcp__linear__get_team":
        const team = await linearService.getTeam(args || {});
        return {
          content: [
            {
              type: "text",
              text: `# ${team.name} (${team.key})\n\n${team.description || 'No description'}\n\n**Created:** ${new Date(team.createdAt).toLocaleDateString()}`,
            },
          ],
        };

      case "mcp__linear__list_users":
        const users = await linearService.listUsers(args || {});
        const usersTable = users.nodes.map((user: any) => 
          `| ${user.name} | ${user.email} | ${user.active ? 'Active' : 'Inactive'} |`
        ).join('\n');
        return {
          content: [
            {
              type: "text",
              text: `| Name | Email | Status |\n|---|---|---|\n${usersTable}`,
            },
          ],
        };

      case "mcp__linear__get_user":
        const user = await linearService.getUser(args || {});
        return {
          content: [
            {
              type: "text",
              text: `# ${user.name}\n\n**Email:** ${user.email}\n**Status:** ${user.active ? 'Active' : 'Inactive'}\n**Member Since:** ${new Date(user.createdAt).toLocaleDateString()}`,
            },
          ],
        };

      case "mcp__linear__get_current_user":
        const currentUser = await linearService.getCurrentUser(args || {});
        return {
          content: [
            {
              type: "text",
              text: `# ${currentUser.name} (You)\n\n**Email:** ${currentUser.email}\n**Status:** ${currentUser.active ? 'Active' : 'Inactive'}\n**Member Since:** ${new Date(currentUser.createdAt).toLocaleDateString()}`,
            },
          ],
        };

      case "mcp__linear__get_capabilities":
        const capabilities = await linearService.getCapabilities(args || {});
        const methodsList = capabilities.methods.join('\n- ');
        const featuresText = JSON.stringify(capabilities.features, null, 2);
        return {
          content: [
            {
              type: "text",
              text: `# Linear MCP Server Capabilities\n\n**Version:** ${capabilities.version}\n\n## Available Methods\n- ${methodsList}\n\n## Features\n\`\`\`json\n${featuresText}\n\`\`\``,
            },
          ],
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  try {
    // Initialize services first (get credentials, create LinearService)
    await initializeServices();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Linear MCP server running on stdio");
  } catch (error) {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
}

// Add uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

runServer().catch((error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});