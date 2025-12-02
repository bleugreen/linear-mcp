#!/usr/bin/env node

import { performOAuthFlow } from './auth/oauth.js';
import {
  storeWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  listWorkspaces,
  getAuthStatus,
} from './auth/credentials.js';

const HELP_TEXT = `
linear-mcp - Linear MCP Server with OAuth Authentication

USAGE:
  linear-mcp <command> [options]

COMMANDS:
  auth login       Authenticate with Linear via OAuth
  auth logout      Remove a workspace's credentials
  auth list        List all connected workspaces
  auth switch      Switch active workspace
  auth status      Show current authentication status
  serve            Start the MCP server (default)
  help             Show this help message

EXAMPLES:
  linear-mcp auth login              # Add a new workspace
  linear-mcp auth logout my-company  # Remove specific workspace
  linear-mcp auth switch             # Interactively switch workspace
  linear-mcp auth status             # Check auth status

ENVIRONMENT:
  LINEAR_API_KEY      Use API key instead of OAuth (takes precedence)
  LINEAR_WORKSPACE    Override active workspace for this session
  LINEAR_CLIENT_ID    Use custom OAuth app client ID
  LINEAR_CLIENT_SECRET Use custom OAuth app client secret
`;

async function authLogin(): Promise<void> {
  console.log('🔐 Starting Linear OAuth flow...\n');
  console.log('A browser window will open for you to authorize access.\n');

  try {
    const result = await performOAuthFlow({
      clientId: process.env.LINEAR_CLIENT_ID,
      clientSecret: process.env.LINEAR_CLIENT_SECRET,
      scopes: ['read', 'write'],
    });

    storeWorkspace(result.workspace, result.tokens);

    console.log(`\n✅ Successfully authenticated with ${result.workspace.name}!`);
    console.log(`   Workspace: ${result.workspace.name} (${result.workspace.urlKey})`);
    console.log(`   Scopes: ${result.tokens.scope}`);

    if (result.tokens.refreshToken) {
      console.log(`   Token expires: ${new Date(result.tokens.expiresAt).toLocaleString()}`);
      console.log('   (Token will be automatically refreshed)');
    }
  } catch (error) {
    console.error(`\n❌ Authentication failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

async function authLogout(workspaceKey?: string): Promise<void> {
  const workspaces = listWorkspaces();

  if (workspaces.length === 0) {
    console.log('No workspaces are currently authenticated.');
    return;
  }

  // If no workspace specified, show list to choose from
  if (!workspaceKey) {
    console.log('Available workspaces:');
    workspaces.forEach((ws, i) => {
      console.log(`  ${i + 1}. ${ws.name} (${ws.urlKey})`);
    });
    console.log('\nUsage: linear-mcp auth logout <workspace-key>');
    console.log('Example: linear-mcp auth logout my-company');
    return;
  }

  const removed = await removeWorkspace(workspaceKey);

  if (removed) {
    console.log(`✅ Logged out from workspace: ${workspaceKey}`);
  } else {
    console.log(`❌ Workspace not found: ${workspaceKey}`);
    console.log('\nAvailable workspaces:');
    workspaces.forEach((ws) => {
      console.log(`  - ${ws.urlKey}`);
    });
  }
}

function authList(): void {
  const workspaces = listWorkspaces();
  const status = getAuthStatus();

  if (process.env.LINEAR_API_KEY) {
    console.log('🔑 Using LINEAR_API_KEY environment variable');
    console.log('   OAuth workspaces are ignored when API key is set.\n');
  }

  if (workspaces.length === 0) {
    console.log('No workspaces authenticated.');
    console.log('\nRun `linear-mcp auth login` to authenticate.');
    return;
  }

  console.log('Connected workspaces:\n');

  workspaces.forEach((ws) => {
    const isActive = ws.urlKey === status.activeWorkspace;
    const marker = isActive ? '→' : ' ';
    const activeLabel = isActive ? ' (active)' : '';
    const expiresStr = ws.expiresAt
      ? `expires ${new Date(ws.expiresAt).toLocaleString()}`
      : 'no expiry';

    console.log(`${marker} ${ws.name}${activeLabel}`);
    console.log(`    Key: ${ws.urlKey}`);
    console.log(`    Token: ${expiresStr}`);
    console.log('');
  });
}

function authSwitch(workspaceKey?: string): void {
  const workspaces = listWorkspaces();

  if (workspaces.length === 0) {
    console.log('No workspaces authenticated.');
    console.log('\nRun `linear-mcp auth login` to authenticate.');
    return;
  }

  if (workspaces.length === 1) {
    console.log(`Only one workspace available: ${workspaces[0].name} (${workspaces[0].urlKey})`);
    return;
  }

  if (!workspaceKey) {
    console.log('Available workspaces:');
    workspaces.forEach((ws, i) => {
      console.log(`  ${i + 1}. ${ws.name} (${ws.urlKey})`);
    });
    console.log('\nUsage: linear-mcp auth switch <workspace-key>');
    console.log('Example: linear-mcp auth switch my-company');
    return;
  }

  const success = setActiveWorkspace(workspaceKey);

  if (success) {
    console.log(`✅ Switched to workspace: ${workspaceKey}`);
  } else {
    console.log(`❌ Workspace not found: ${workspaceKey}`);
    console.log('\nAvailable workspaces:');
    workspaces.forEach((ws) => {
      console.log(`  - ${ws.urlKey}`);
    });
  }
}

function authStatus(): void {
  const status = getAuthStatus();

  console.log('Linear MCP Authentication Status\n');

  if (status.method === 'env') {
    console.log('🔑 Method: Environment Variable (LINEAR_API_KEY)');
    console.log('   Status: Authenticated');
    console.log('\n   Note: OAuth workspaces are ignored when API key is set.');
    return;
  }

  if (status.method === 'none') {
    console.log('❌ Status: Not authenticated');
    console.log('\nTo authenticate, either:');
    console.log('  1. Run `linear-mcp auth login` for OAuth flow');
    console.log('  2. Set LINEAR_API_KEY environment variable');
    return;
  }

  console.log('🔐 Method: OAuth');
  console.log(`   Status: Authenticated`);
  console.log(`   Active Workspace: ${status.activeWorkspace || 'none'}`);
  console.log(`   Total Workspaces: ${status.workspaces.length}`);

  if (status.workspaces.length > 0) {
    console.log('\nWorkspaces:');
    status.workspaces.forEach((ws) => {
      const activeMarker = ws.isActive ? ' (active)' : '';
      const refreshNote = ws.needsRefresh ? ' [needs refresh]' : '';
      const expiry = ws.expiresAt ? ws.expiresAt.toLocaleString() : 'never';

      console.log(`  - ${ws.name}${activeMarker}${refreshNote}`);
      console.log(`    Key: ${ws.urlKey}`);
      console.log(`    Expires: ${expiry}`);
    });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  switch (command) {
    case 'auth':
      switch (subcommand) {
        case 'login':
          await authLogin();
          break;
        case 'logout':
          await authLogout(args[2]);
          break;
        case 'list':
          authList();
          break;
        case 'switch':
          authSwitch(args[2]);
          break;
        case 'status':
          authStatus();
          break;
        default:
          console.log('Unknown auth command. Available: login, logout, list, switch, status');
          process.exit(1);
      }
      break;

    case 'serve':
      // Import and run the MCP server
      await import('./mcp-server.js');
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP_TEXT);
      break;

    case undefined:
      // Default: run as MCP server (for backwards compatibility with Claude Code config)
      await import('./mcp-server.js');
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run `linear-mcp help` for usage information.');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
