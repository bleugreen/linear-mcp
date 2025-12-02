import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TokenResponse, WorkspaceInfo, refreshAccessToken, revokeToken } from './oauth.js';

const CONFIG_DIR = path.join(os.homedir(), '.linear-mcp');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

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
 * 1. OAuth credentials (if available)
 * 2. LINEAR_API_KEY env var (fallback)
 */
export async function getAccessToken(workspaceUrlKey?: string): Promise<string | null> {
  // Check for workspace override via env var
  const envWorkspace = process.env.LINEAR_WORKSPACE;

  const credentials = loadCredentials();
  const targetKey = workspaceUrlKey || envWorkspace || credentials.activeWorkspace;

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

/**
 * Get the currently active workspace key
 */
export function getActiveWorkspaceKey(): string | null {
  const envWorkspace = process.env.LINEAR_WORKSPACE;
  if (envWorkspace) {
    return envWorkspace;
  }

  const credentials = loadCredentials();
  return credentials.activeWorkspace;
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
