import * as crypto from 'crypto';
import * as http from 'http';
import { URL } from 'url';

// Linear OAuth endpoints
const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

// Default client ID - users can override via LINEAR_CLIENT_ID env var
const DEFAULT_CLIENT_ID = process.env.LINEAR_CLIENT_ID || '8cc0fffee847f5b25565a5b623b6cc5b';

// Fixed callback port for OAuth flow
const CALLBACK_PORT = 8484;

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  urlKey: string;
}

export interface OAuthResult {
  tokens: TokenResponse;
  workspace: WorkspaceInfo;
}

/**
 * Generate a cryptographically random string for PKCE code verifier
 * Must be 43-128 characters, using unreserved URI characters
 */
export function generateCodeVerifier(): string {
  // Generate 32 random bytes, base64url encode to get ~43 chars
  return crypto.randomBytes(32)
    .toString('base64url')
    .slice(0, 43);
}

/**
 * Generate code challenge from verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export interface AuthorizationParams {
  clientId?: string;
  redirectUri: string;
  scopes?: string[];
  state: string;
  codeChallenge: string;
  promptConsent?: boolean;
}

/**
 * Build the Linear OAuth authorization URL
 */
export function buildAuthorizationUrl(params: AuthorizationParams): string {
  const url = new URL(LINEAR_AUTHORIZE_URL);

  url.searchParams.set('client_id', params.clientId || DEFAULT_CLIENT_ID);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (params.scopes || ['read', 'write']).join(','));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  // Always prompt for consent to allow switching workspaces
  if (params.promptConsent !== false) {
    url.searchParams.set('prompt', 'consent');
  }

  return url.toString();
}

export interface TokenExchangeParams {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(params: TokenExchangeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId || DEFAULT_CLIENT_ID,
    code_verifier: params.codeVerifier,
  });

  // Only include client_secret if provided (not required for PKCE)
  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    expiresAt: Date.now() + (data.expires_in * 1000),
    scope: data.scope,
    tokenType: data.token_type || 'Bearer',
  };
}

export interface RefreshTokenParams {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(params: RefreshTokenParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId || DEFAULT_CLIENT_ID,
  });

  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    expiresAt: Date.now() + (data.expires_in * 1000),
    scope: data.scope,
    tokenType: data.token_type || 'Bearer',
  };
}

/**
 * Revoke an access or refresh token
 */
export async function revokeToken(token: string, tokenType: 'access_token' | 'refresh_token' = 'access_token'): Promise<boolean> {
  const body = new URLSearchParams();
  body.set(tokenType, token);

  const response = await fetch(LINEAR_REVOKE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': tokenType === 'access_token' ? `Bearer ${token}` : '',
    },
    body: body.toString(),
  });

  return response.status === 200;
}

/**
 * Fetch workspace info using the access token
 */
export async function fetchWorkspaceInfo(accessToken: string): Promise<WorkspaceInfo> {
  const query = `
    query {
      viewer {
        organization {
          id
          name
          urlKey
        }
      }
    }
  `;

  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch workspace info: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
  }

  const org = data.data.viewer.organization;
  return {
    id: org.id,
    name: org.name,
    urlKey: org.urlKey,
  };
}

export interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 * Returns the authorization code and state from the callback
 */
export function startCallbackServer(port: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><meta charset="UTF-8"><title>Authorization Failed</title></head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Authorization Failed</h1>
                <p>${errorDescription || error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error(errorDescription || error));
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><meta charset="UTF-8"><title>Invalid Callback</title></head>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Invalid Callback</h1>
                <p>Missing authorization code or state parameter.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error('Invalid callback: missing code or state'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><meta charset="UTF-8"><title>Authorization Successful</title></head>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>✅ Authorization Successful</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);

        server.close();
        resolve({ code, state });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('error', (err) => {
      reject(err);
    });

    // Set a timeout for the callback
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out. Please try again.'));
    }, 5 * 60 * 1000); // 5 minutes

    server.on('close', () => {
      clearTimeout(timeout);
    });

    server.listen(port, 'localhost');
  });
}

/**
 * Find an available port for the callback server
 */
export function findAvailablePort(startPort: number = 9876): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });

    server.listen(startPort, 'localhost', () => {
      server.close(() => {
        resolve(startPort);
      });
    });
  });
}

/**
 * Full OAuth flow: opens browser, handles callback, exchanges tokens
 */
export async function performOAuthFlow(options?: {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  openBrowser?: (url: string) => Promise<void>;
}): Promise<OAuthResult> {
  // Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Use fixed callback port
  const port = CALLBACK_PORT;
  const redirectUri = `http://localhost:${port}/callback`;

  // Build authorization URL
  const authUrl = buildAuthorizationUrl({
    clientId: options?.clientId,
    redirectUri,
    scopes: options?.scopes,
    state,
    codeChallenge,
  });

  // Start callback server before opening browser
  const callbackPromise = startCallbackServer(port);

  // Open browser (default implementation)
  const openBrowser = options?.openBrowser || (async (url: string) => {
    const { exec } = await import('child_process');
    const platform = process.platform;

    let command: string;
    if (platform === 'darwin') {
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    exec(command);
  });

  await openBrowser(authUrl);

  // Wait for callback
  const callback = await callbackPromise;

  // Verify state
  if (callback.state !== state) {
    throw new Error('State mismatch - possible CSRF attack');
  }

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens({
    code: callback.code,
    redirectUri,
    codeVerifier,
    clientId: options?.clientId,
    clientSecret: options?.clientSecret,
  });

  // Fetch workspace info
  const workspace = await fetchWorkspaceInfo(tokens.accessToken);

  return { tokens, workspace };
}
