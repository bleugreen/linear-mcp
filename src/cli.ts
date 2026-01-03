#!/usr/bin/env node

import { performOAuthFlow } from './auth/oauth.js';
import {
  storeWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  listWorkspaces,
  getAuthStatus,
  setFolderBinding,
  removeFolderBinding,
  loadFolderBindings,
  resolveWorkspace,
  getWorkspace,
  getBindingForPath,
  resolveTeam,
  getAccessToken,
} from './auth/credentials.js';
import { LinearService } from './services/linear-service.js';

const HELP_TEXT = `
linear-mcp - Linear MCP Server with OAuth Authentication

USAGE:
  lmcp <command> [options]

COMMANDS:
  login              Authenticate with Linear via OAuth
  logout [workspace] Remove a workspace's credentials
  list               List all connected workspaces
  switch [workspace] Switch active workspace
  status             Show current authentication status
  teams              List teams in current workspace
  bind <workspace> [team]  Bind current directory to workspace and optional team
  unbind             Remove binding for current directory
  bindings           List all folder bindings
  serve              Start the MCP server (default)
  help               Show this help message

EXAMPLES:
  lmcp login                    # Add a new workspace
  lmcp logout my-company        # Remove specific workspace
  lmcp switch other-workspace   # Switch active workspace
  lmcp status                   # Check auth status
  lmcp bind my-company          # Bind cwd to workspace
  lmcp bind my-company ENG      # Bind cwd to workspace + team
  lmcp unbind                   # Remove binding for cwd

WORKSPACE RESOLUTION (multi-workspace only):
  1. LINEAR_WORKSPACE env var
  2. LINEAR_WORKSPACE in .env file (cwd only)
  3. Folder binding (longest prefix match)
  4. Default active workspace

TEAM AUTO-INJECTION:
  When a folder is bound to a team, that team is automatically used
  for issue operations unless you explicitly specify a different team.

ENVIRONMENT:
  LINEAR_API_KEY       Use API key instead of OAuth
  LINEAR_WORKSPACE     Override active workspace
  LINEAR_TEAM          Override active team
  LINEAR_CLIENT_ID     Use custom OAuth app client ID
  LINEAR_CLIENT_SECRET Use custom OAuth app client secret
`;

async function cmdLogin(): Promise<void> {
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

async function cmdLogout(workspaceKey?: string): Promise<void> {
  const workspaces = listWorkspaces();

  if (workspaces.length === 0) {
    console.log('No workspaces are currently authenticated.');
    return;
  }

  if (!workspaceKey) {
    console.log('Available workspaces:');
    workspaces.forEach((ws, i) => {
      console.log(`  ${i + 1}. ${ws.name} (${ws.urlKey})`);
    });
    console.log('\nUsage: lmcp logout <workspace-key>');
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

function cmdList(): void {
  const workspaces = listWorkspaces();
  const status = getAuthStatus();

  if (process.env.LINEAR_API_KEY) {
    console.log('🔑 Using LINEAR_API_KEY environment variable');
    console.log('   OAuth workspaces are ignored when API key is set.\n');
  }

  if (workspaces.length === 0) {
    console.log('No workspaces authenticated.');
    console.log('\nRun `lmcp login` to authenticate.');
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

function cmdSwitch(workspaceKey?: string): void {
  const workspaces = listWorkspaces();

  if (workspaces.length === 0) {
    console.log('No workspaces authenticated.');
    console.log('\nRun `lmcp login` to authenticate.');
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
    console.log('\nUsage: lmcp switch <workspace-key>');
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

function cmdStatus(): void {
  const status = getAuthStatus();

  console.log('Linear MCP Status\n');

  if (status.method === 'env') {
    console.log('🔑 Method: Environment Variable (LINEAR_API_KEY)');
    console.log('   Status: Authenticated');
    console.log('\n   Note: OAuth workspaces are ignored when API key is set.');
    return;
  }

  if (status.method === 'none') {
    console.log('❌ Status: Not authenticated');
    console.log('\nTo authenticate, either:');
    console.log('  1. Run `lmcp login` for OAuth flow');
    console.log('  2. Set LINEAR_API_KEY environment variable');
    return;
  }

  console.log('🔐 Method: OAuth');
  console.log(`   Status: Authenticated`);

  // Show resolved workspace with source
  const resolved = resolveWorkspace();
  if (resolved) {
    const sourceLabels: Record<string, string> = {
      single: 'only workspace',
      env: 'LINEAR_WORKSPACE env var',
      dotenv: '.env file',
      binding: 'folder binding',
      active: 'default active',
    };
    const workspace = getWorkspace(resolved.urlKey);
    const name = workspace?.name || resolved.urlKey;
    console.log(`   Active Workspace: ${name} (${resolved.urlKey})`);
    console.log(`   Resolved via: ${sourceLabels[resolved.source]}`);
  } else {
    console.log(`   Active Workspace: none`);
  }

  // Show resolved team if any
  const team = resolveTeam();
  if (team) {
    let teamSource = 'folder binding';
    if (process.env.LINEAR_TEAM) {
      teamSource = 'LINEAR_TEAM env var';
    } else {
      const cwd = process.cwd();
      const binding = getBindingForPath(cwd);
      if (!binding?.team) {
        teamSource = '.env file';
      }
    }
    console.log(`   Active Team: ${team}`);
    console.log(`   Team via: ${teamSource}`);
  }

  console.log(`   Total Workspaces: ${status.workspaces.length}`);

  if (status.workspaces.length > 0) {
    console.log('\nWorkspaces:');
    status.workspaces.forEach((ws) => {
      const isResolved = resolved?.urlKey === ws.urlKey;
      const marker = isResolved ? '→' : ' ';
      const refreshNote = ws.needsRefresh ? ' [needs refresh]' : '';
      const expiry = ws.expiresAt ? ws.expiresAt.toLocaleString() : 'never';

      console.log(`${marker} ${ws.name}${refreshNote}`);
      console.log(`    Key: ${ws.urlKey}`);
      console.log(`    Expires: ${expiry}`);
    });
  }

  // Show folder bindings if any exist
  const bindings = loadFolderBindings();
  const bindingPaths = Object.keys(bindings);
  if (bindingPaths.length > 0) {
    console.log('\nFolder Bindings:');
    bindingPaths.forEach((p) => {
      const b = bindings[p];
      const teamStr = b.team ? ` (team: ${b.team})` : '';
      console.log(`  ${p} → ${b.workspace}${teamStr}`);
    });
  }
}

async function cmdTeams(): Promise<void> {
  const accessToken = await getAccessToken();

  if (!accessToken) {
    console.log('Not authenticated. Run `lmcp login` first.');
    return;
  }

  try {
    // Use null SSEManager since we don't need it for listing teams
    const linearService = new LinearService(accessToken, null as any);
    const result = await linearService.listTeams({});

    if (result.nodes.length === 0) {
      console.log('No teams found in workspace.');
      return;
    }

    console.log('Teams:\n');
    result.nodes.forEach((team: any) => {
      console.log(`  ${team.key.padEnd(10)} ${team.name}`);
    });

    const resolvedTeam = resolveTeam();
    if (resolvedTeam) {
      console.log(`\nActive team: ${resolvedTeam}`);
    }
  } catch (error) {
    console.error(`Failed to list teams: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function cmdBind(workspaceKey?: string, teamKey?: string): void {
  const workspaces = listWorkspaces();

  if (workspaces.length === 0) {
    console.log('No workspaces authenticated.');
    console.log('\nRun `lmcp login` to authenticate.');
    return;
  }

  if (!workspaceKey) {
    console.log('Available workspaces:');
    workspaces.forEach((ws, i) => {
      console.log(`  ${i + 1}. ${ws.name} (${ws.urlKey})`);
    });
    console.log('\nUsage: lmcp bind <workspace-key> [team-key]');
    console.log('Examples:');
    console.log('  lmcp bind my-company');
    console.log('  lmcp bind my-company ENG');
    return;
  }

  // Verify workspace exists
  const workspace = workspaces.find((ws) => ws.urlKey === workspaceKey);
  if (!workspace) {
    console.log(`❌ Workspace not found: ${workspaceKey}`);
    console.log('\nAvailable workspaces:');
    workspaces.forEach((ws) => {
      console.log(`  - ${ws.urlKey}`);
    });
    return;
  }

  const cwd = process.cwd();
  setFolderBinding(cwd, workspaceKey, teamKey);
  console.log(`✅ Bound ${cwd}`);
  console.log(`   → Workspace: ${workspace.name} (${workspaceKey})`);
  if (teamKey) {
    console.log(`   → Team: ${teamKey}`);
  }
}

function cmdUnbind(): void {
  const cwd = process.cwd();
  const removed = removeFolderBinding(cwd);

  if (removed) {
    console.log(`✅ Removed binding for ${cwd}`);
  } else {
    console.log(`No binding found for ${cwd}`);
  }
}

function cmdBindings(): void {
  const bindings = loadFolderBindings();
  const paths = Object.keys(bindings);

  if (paths.length === 0) {
    console.log('No folder bindings configured.');
    console.log('\nUse `lmcp bind <workspace> [team]` to bind current directory.');
    return;
  }

  console.log('Folder Bindings:\n');
  paths.forEach((p) => {
    const binding = bindings[p];
    const workspace = getWorkspace(binding.workspace);
    const name = workspace?.name || binding.workspace;
    console.log(`  ${p}`);
    console.log(`    → Workspace: ${name} (${binding.workspace})`);
    if (binding.team) {
      console.log(`    → Team: ${binding.team}`);
    }
    console.log('');
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'login':
      await cmdLogin();
      break;

    case 'logout':
      await cmdLogout(args[1]);
      break;

    case 'list':
      cmdList();
      break;

    case 'switch':
      cmdSwitch(args[1]);
      break;

    case 'status':
      cmdStatus();
      break;

    case 'teams':
      await cmdTeams();
      break;

    case 'bind':
      cmdBind(args[1], args[2]);
      break;

    case 'unbind':
      cmdUnbind();
      break;

    case 'bindings':
      cmdBindings();
      break;

    case 'serve':
      await import('./mcp-server.js');
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP_TEXT);
      break;

    case undefined:
      // Default: run as MCP server (for backwards compatibility)
      await import('./mcp-server.js');
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run `lmcp help` for usage information.');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
