import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TokenResponse, WorkspaceInfo, refreshAccessToken, revokeToken } from './oauth.js';

const CONFIG_DIR = path.join(os.homedir(), '.linear-mcp');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');
const FOLDER_BINDINGS_FILE = path.join(CONFIG_DIR, 'folder-bindings.json');

// Refresh tokens 1 hour before expiry
const REFRESH_BUFFER_MS = 60 * 60 * 1000;

export interface StoredWorkspace {
  id: string;
  name: string;
  urlKey: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
}

export interface CredentialsStore {
  activeWorkspace: string | null;
  workspaces: Record<string, StoredWorkspace>;
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load credentials from disk
 */
export function loadCredentials(): CredentialsStore {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load credentials:', error);
  }

  return {
    activeWorkspace: null,
    workspaces: {},
  };
}

/**
 * Save credentials to disk
 */
export function saveCredentials(credentials: CredentialsStore): void {
  ensureConfigDir();

  // Write with restricted permissions (owner read/write only)
  fs.writeFileSync(
    CREDENTIALS_FILE,
    JSON.stringify(credentials, null, 2),
    { mode: 0o600 }
  );
}

/**
 * Store a workspace's credentials
 */
export function storeWorkspace(
  workspace: WorkspaceInfo,
  tokens: TokenResponse
): void {
  const credentials = loadCredentials();

  credentials.workspaces[workspace.urlKey] = {
    id: workspace.id,
    name: workspace.name,
    urlKey: workspace.urlKey,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  };

  // If this is the first workspace, make it active
  if (!credentials.activeWorkspace) {
    credentials.activeWorkspace = workspace.urlKey;
  }

  saveCredentials(credentials);
}

/**
 * Remove a workspace's credentials
 */
export async function removeWorkspace(urlKey: string): Promise<boolean> {
  const credentials = loadCredentials();

  const workspace = credentials.workspaces[urlKey];
  if (!workspace) {
    return false;
  }

  // Try to revoke the token
  try {
    if (workspace.refreshToken) {
      await revokeToken(workspace.refreshToken, 'refresh_token');
    } else {
      await revokeToken(workspace.accessToken, 'access_token');
    }
  } catch (error) {
    // Continue even if revocation fails
    console.error('Failed to revoke token:', error);
  }

  delete credentials.workspaces[urlKey];

  // If this was the active workspace, pick a new one
  if (credentials.activeWorkspace === urlKey) {
    const remainingKeys = Object.keys(credentials.workspaces);
    credentials.activeWorkspace = remainingKeys.length > 0 ? remainingKeys[0] : null;
  }

  saveCredentials(credentials);
  return true;
}

/**
 * Set the active workspace
 */
export function setActiveWorkspace(urlKey: string): boolean {
  const credentials = loadCredentials();

  if (!credentials.workspaces[urlKey]) {
    return false;
  }

  credentials.activeWorkspace = urlKey;
  saveCredentials(credentials);
  return true;
}

/**
 * Get the active workspace
 */
export function getActiveWorkspace(): StoredWorkspace | null {
  const credentials = loadCredentials();

  if (!credentials.activeWorkspace) {
    return null;
  }

  return credentials.workspaces[credentials.activeWorkspace] || null;
}

/**
 * List all stored workspaces
 */
export function listWorkspaces(): StoredWorkspace[] {
  const credentials = loadCredentials();
  return Object.values(credentials.workspaces);
}

/**
 * Get workspace by urlKey
 */
export function getWorkspace(urlKey: string): StoredWorkspace | null {
  const credentials = loadCredentials();
  return credentials.workspaces[urlKey] || null;
}

/**
 * Check if a token needs refreshing
 */
export function needsRefresh(workspace: StoredWorkspace): boolean {
  if (!workspace.refreshToken) {
    return false; // Can't refresh without a refresh token
  }

  return Date.now() >= workspace.expiresAt - REFRESH_BUFFER_MS;
}

/**
 * Refresh a workspace's access token
 */
export async function refreshWorkspaceToken(urlKey: string): Promise<StoredWorkspace | null> {
  const credentials = loadCredentials();
  const workspace = credentials.workspaces[urlKey];

  if (!workspace || !workspace.refreshToken) {
    return null;
  }

  try {
    const newTokens = await refreshAccessToken({
      refreshToken: workspace.refreshToken,
    });

    workspace.accessToken = newTokens.accessToken;
    workspace.refreshToken = newTokens.refreshToken || workspace.refreshToken;
    workspace.expiresAt = newTokens.expiresAt;
    workspace.scope = newTokens.scope;

    saveCredentials(credentials);
    return workspace;
  } catch (error) {
    console.error(`Failed to refresh token for ${urlKey}:`, error);
    return null;
  }
}

/**
 * Get a valid access token for the active workspace
 * Automatically refreshes if needed
 *
 * Priority:
 * 1. Explicit workspaceUrlKey parameter
 * 2. Resolved workspace (env var, .env file, folder binding, active workspace)
 * 3. LINEAR_API_KEY env var (fallback)
 */
export async function getAccessToken(workspaceUrlKey?: string): Promise<string | null> {
  const credentials = loadCredentials();

  // Use explicit parameter, or resolve workspace using full resolution logic
  const targetKey = workspaceUrlKey || resolveWorkspace()?.urlKey;

  // Try OAuth credentials first
  if (targetKey) {
    let workspace = credentials.workspaces[targetKey];
    if (workspace) {
      // Check if token needs refreshing
      if (needsRefresh(workspace)) {
        const refreshed = await refreshWorkspaceToken(targetKey);
        if (refreshed) {
          workspace = refreshed;
        } else {
          // Refresh failed, token might still be valid for a bit
          console.error('Token refresh failed, using existing token');
        }
      }
      return workspace.accessToken;
    }
  }

  // Fall back to env var if no OAuth credentials
  if (process.env.LINEAR_API_KEY) {
    return process.env.LINEAR_API_KEY;
  }

  return null;
}

export type WorkspaceResolutionSource =
  | 'single'      // Only one workspace, no resolution needed
  | 'env'         // LINEAR_WORKSPACE environment variable
  | 'dotenv'      // .env file in cwd
  | 'binding'     // Folder binding from folder-bindings.json
  | 'active';     // Default active workspace

export interface ResolvedWorkspace {
  urlKey: string;
  source: WorkspaceResolutionSource;
}

/**
 * Get the currently active workspace key with resolution source
 */
export function resolveWorkspace(): ResolvedWorkspace | null {
  const workspaces = listWorkspaces();

  // No workspaces: nothing to resolve
  if (workspaces.length === 0) {
    return null;
  }

  // Single workspace: skip all resolution logic
  if (workspaces.length === 1) {
    return { urlKey: workspaces[0].urlKey, source: 'single' };
  }

  // Multi-workspace resolution order
  const cwd = process.cwd();

  // 1. Shell env var
  if (process.env.LINEAR_WORKSPACE) {
    return { urlKey: process.env.LINEAR_WORKSPACE, source: 'env' };
  }

  // 2. .env file in cwd
  const envFile = parseEnvFile(cwd);
  if (envFile.workspace) {
    return { urlKey: envFile.workspace, source: 'dotenv' };
  }

  // 3. Folder binding (longest prefix match)
  const boundWorkspace = resolveBindingForPath(cwd);
  if (boundWorkspace) {
    return { urlKey: boundWorkspace, source: 'binding' };
  }

  // 4. Stored active workspace
  const credentials = loadCredentials();
  if (credentials.activeWorkspace) {
    return { urlKey: credentials.activeWorkspace, source: 'active' };
  }

  return null;
}

/**
 * Get the currently active workspace key
 */
export function getActiveWorkspaceKey(): string | null {
  const resolved = resolveWorkspace();
  return resolved ? resolved.urlKey : null;
}

/**
 * Check authentication status
 */
export interface AuthStatus {
  authenticated: boolean;
  method: 'env' | 'oauth' | 'none';
  activeWorkspace: string | null;
  workspaces: Array<{
    urlKey: string;
    name: string;
    isActive: boolean;
    expiresAt: Date | null;
    needsRefresh: boolean;
  }>;
}

export function getAuthStatus(): AuthStatus {
  const credentials = loadCredentials();

  const workspaces = Object.values(credentials.workspaces).map((ws) => ({
    urlKey: ws.urlKey,
    name: ws.name,
    isActive: ws.urlKey === credentials.activeWorkspace,
    expiresAt: ws.expiresAt ? new Date(ws.expiresAt) : null,
    needsRefresh: needsRefresh(ws),
  }));

  // OAuth takes priority over env var
  if (workspaces.length > 0) {
    return {
      authenticated: true,
      method: 'oauth',
      activeWorkspace: credentials.activeWorkspace,
      workspaces,
    };
  }

  // Fall back to env var
  if (process.env.LINEAR_API_KEY) {
    return {
      authenticated: true,
      method: 'env',
      activeWorkspace: null,
      workspaces: [],
    };
  }

  return {
    authenticated: false,
    method: 'none',
    activeWorkspace: null,
    workspaces: [],
  };
}

/**
 * Clear all credentials
 */
export function clearAllCredentials(): void {
  saveCredentials({
    activeWorkspace: null,
    workspaces: {},
  });
}

// ============================================================================
// Folder Bindings - map directories to workspaces and optional teams
// ============================================================================

export interface FolderBinding {
  workspace: string;  // urlKey
  team?: string;      // team key (e.g., 'ENG', 'OPS')
}

export interface FolderBindings {
  [folderPath: string]: FolderBinding;
}

/**
 * Load folder bindings from disk
 * Handles migration from old format (string) to new format (object)
 */
export function loadFolderBindings(): FolderBindings {
  try {
    if (fs.existsSync(FOLDER_BINDINGS_FILE)) {
      const data = fs.readFileSync(FOLDER_BINDINGS_FILE, 'utf-8');
      const parsed = JSON.parse(data);

      // Migrate old format (string values) to new format (object values)
      const migrated: FolderBindings = {};
      for (const [folderPath, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          migrated[folderPath] = { workspace: value };
        } else {
          migrated[folderPath] = value as FolderBinding;
        }
      }
      return migrated;
    }
  } catch (error) {
    console.error('Failed to load folder bindings:', error);
  }
  return {};
}

/**
 * Save folder bindings to disk
 */
function saveFolderBindings(bindings: FolderBindings): void {
  ensureConfigDir();
  fs.writeFileSync(
    FOLDER_BINDINGS_FILE,
    JSON.stringify(bindings, null, 2),
    { mode: 0o600 }
  );
}

/**
 * Bind a folder path to a workspace and optional team
 */
export function setFolderBinding(folderPath: string, workspace: string, team?: string): void {
  const bindings = loadFolderBindings();
  bindings[folderPath] = { workspace, ...(team && { team }) };
  saveFolderBindings(bindings);
}

/**
 * Remove a folder binding
 */
export function removeFolderBinding(folderPath: string): boolean {
  const bindings = loadFolderBindings();
  if (bindings[folderPath]) {
    delete bindings[folderPath];
    saveFolderBindings(bindings);
    return true;
  }
  return false;
}

/**
 * Get the binding for a path using longest prefix match
 */
export function getBindingForPath(cwd: string): FolderBinding | null {
  const bindings = loadFolderBindings();
  const paths = Object.keys(bindings);

  if (paths.length === 0) return null;

  // Find longest matching prefix
  let bestMatch: string | null = null;
  let bestLength = 0;

  for (const boundPath of paths) {
    // Check if cwd starts with this bound path
    if (cwd === boundPath || cwd.startsWith(boundPath + path.sep)) {
      if (boundPath.length > bestLength) {
        bestMatch = boundPath;
        bestLength = boundPath.length;
      }
    }
  }

  return bestMatch ? bindings[bestMatch] : null;
}

/**
 * Resolve workspace for a path using longest prefix match
 * @deprecated Use getBindingForPath instead for full binding info
 */
export function resolveBindingForPath(cwd: string): string | null {
  const binding = getBindingForPath(cwd);
  return binding ? binding.workspace : null;
}

/**
 * Parse .env file in a directory for LINEAR_WORKSPACE and LINEAR_TEAM
 */
export function parseEnvFile(cwd: string): { workspace?: string; team?: string } {
  const envPath = path.join(cwd, '.env');
  try {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf-8');
    const workspaceMatch = content.match(/^LINEAR_WORKSPACE=(.+)$/m);
    const teamMatch = content.match(/^LINEAR_TEAM=(.+)$/m);
    return {
      workspace: workspaceMatch ? workspaceMatch[1].trim().replace(/^["']|["']$/g, '') : undefined,
      team: teamMatch ? teamMatch[1].trim().replace(/^["']|["']$/g, '') : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Resolve the current team based on env var, .env file, or folder binding
 */
export function resolveTeam(): string | null {
  // 1. Shell env var
  if (process.env.LINEAR_TEAM) {
    return process.env.LINEAR_TEAM;
  }

  const cwd = process.cwd();

  // 2. .env file in cwd
  const envFile = parseEnvFile(cwd);
  if (envFile.team) {
    return envFile.team;
  }

  // 3. Folder binding
  const binding = getBindingForPath(cwd);
  if (binding?.team) {
    return binding.team;
  }

  return null;
}
