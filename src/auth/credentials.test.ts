import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadCredentials,
  saveCredentials,
  storeWorkspace,
  needsRefresh,
  getActiveWorkspace,
  setActiveWorkspace,
  resolveWorkspace,
  getBindingForPath,
  parseEnvFile,
  resolveTeam,
  CredentialsStore,
  StoredWorkspace,
} from './credentials';
import { refreshAccessToken } from './oauth';

// Mock fs module
jest.mock('fs');
jest.mock('./oauth');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockRefreshAccessToken = refreshAccessToken as jest.MockedFunction<typeof refreshAccessToken>;

describe('Credentials Management', () => {
  const mockConfigDir = path.join(os.homedir(), '.linear-mcp');
  const mockCredentialsFile = path.join(mockConfigDir, 'credentials.json');
  const mockBindingsFile = path.join(mockConfigDir, 'folder-bindings.json');

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    delete process.env.LINEAR_WORKSPACE;
    delete process.env.LINEAR_TEAM;
    delete process.env.LINEAR_API_KEY;
  });

  describe('Token Refresh Logic', () => {
    const HOUR_MS = 60 * 60 * 1000;
    const DAY_MS = 24 * HOUR_MS;

    it('should indicate refresh needed when token expires within 1 hour', () => {
      const now = Date.now();
      const workspace: StoredWorkspace = {
        id: 'ws-1',
        name: 'Test Workspace',
        urlKey: 'test',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: now + 30 * 60 * 1000, // 30 minutes from now
        scope: 'read,write',
      };

      expect(needsRefresh(workspace)).toBe(true);
    });

    it('should indicate refresh not needed when token expires in more than 1 hour', () => {
      const now = Date.now();
      const workspace: StoredWorkspace = {
        id: 'ws-1',
        name: 'Test Workspace',
        urlKey: 'test',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: now + 2 * HOUR_MS, // 2 hours from now
        scope: 'read,write',
      };

      expect(needsRefresh(workspace)).toBe(false);
    });

    it('should indicate refresh not possible without refresh token', () => {
      const now = Date.now();
      const workspace: StoredWorkspace = {
        id: 'ws-1',
        name: 'Test Workspace',
        urlKey: 'test',
        accessToken: 'token',
        expiresAt: now + 30 * 60 * 1000, // 30 minutes from now
        scope: 'read,write',
      };

      expect(needsRefresh(workspace)).toBe(false);
    });

    it('should use exact 1-hour buffer threshold', () => {
      const now = Date.now();
      
      // Exactly at the buffer boundary (should refresh)
      const workspaceAtBoundary: StoredWorkspace = {
        id: 'ws-1',
        name: 'Test',
        urlKey: 'test',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: now + HOUR_MS,
        scope: 'read,write',
      };
      expect(needsRefresh(workspaceAtBoundary)).toBe(true);

      // Just past the buffer (should not refresh)
      const workspacePastBoundary: StoredWorkspace = {
        id: 'ws-2',
        name: 'Test 2',
        urlKey: 'test2',
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: now + HOUR_MS + 1000, // 1 second past buffer
        scope: 'read,write',
      };
      expect(needsRefresh(workspacePastBoundary)).toBe(false);
    });
  });

  describe('Workspace Resolution Priority', () => {
    const mockCredentials: CredentialsStore = {
      activeWorkspace: 'default-workspace',
      workspaces: {
        'workspace-1': {
          id: 'ws-1',
          name: 'Workspace 1',
          urlKey: 'workspace-1',
          accessToken: 'token1',
          expiresAt: Date.now() + 86400000,
          scope: 'read,write',
        },
        'workspace-2': {
          id: 'ws-2',
          name: 'Workspace 2',
          urlKey: 'workspace-2',
          accessToken: 'token2',
          expiresAt: Date.now() + 86400000,
          scope: 'read,write',
        },
        'default-workspace': {
          id: 'ws-default',
          name: 'Default Workspace',
          urlKey: 'default-workspace',
          accessToken: 'token-default',
          expiresAt: Date.now() + 86400000,
          scope: 'read,write',
        },
      },
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === mockCredentialsFile) {
          return JSON.stringify(mockCredentials);
        }
        if (path === mockBindingsFile) {
          return JSON.stringify({});
        }
        return '';
      });
    });

    it('should return single workspace when only one exists', () => {
      const singleWorkspace = {
        activeWorkspace: 'only',
        workspaces: {
          only: mockCredentials.workspaces['workspace-1'],
        },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(singleWorkspace));

      const result = resolveWorkspace();
      expect(result).toEqual({ urlKey: 'workspace-1', source: 'single' });
    });

    it('should prioritize LINEAR_WORKSPACE env var over all else', () => {
      process.env.LINEAR_WORKSPACE = 'workspace-2';

      const result = resolveWorkspace();
      expect(result).toEqual({ urlKey: 'workspace-2', source: 'env' });
    });

    it('should use .env file when no env var is set', () => {
      const cwd = '/test/project';
      const envPath = path.join(cwd, '.env');
      
      jest.spyOn(process, 'cwd').mockReturnValue(cwd);
      mockFs.existsSync.mockImplementation((path: any) => {
        if (path === envPath) return true;
        if (path === mockCredentialsFile) return true;
        if (path === mockBindingsFile) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === envPath) {
          return 'LINEAR_WORKSPACE=workspace-1\nOTHER_VAR=value';
        }
        if (path === mockCredentialsFile) {
          return JSON.stringify(mockCredentials);
        }
        if (path === mockBindingsFile) {
          return JSON.stringify({});
        }
        return '';
      });

      const result = resolveWorkspace();
      expect(result).toEqual({ urlKey: 'workspace-1', source: 'dotenv' });
    });

    it('should use folder binding when no env var or .env file', () => {
      const cwd = '/projects/acme-frontend';
      const bindings = {
        '/projects/acme-frontend': { workspace: 'workspace-2' },
      };

      jest.spyOn(process, 'cwd').mockReturnValue(cwd);
      mockFs.existsSync.mockImplementation((path: any) => {
        if (path === mockCredentialsFile) return true;
        if (path === mockBindingsFile) return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === mockCredentialsFile) {
          return JSON.stringify(mockCredentials);
        }
        if (path === mockBindingsFile) {
          return JSON.stringify(bindings);
        }
        return '';
      });

      const result = resolveWorkspace();
      expect(result).toEqual({ urlKey: 'workspace-2', source: 'binding' });
    });

    it('should fall back to active workspace when nothing else matches', () => {
      jest.spyOn(process, 'cwd').mockReturnValue('/random/path');

      const result = resolveWorkspace();
      expect(result).toEqual({ urlKey: 'default-workspace', source: 'active' });
    });

    it('should return null when no workspaces exist', () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        activeWorkspace: null,
        workspaces: {},
      }));

      const result = resolveWorkspace();
      expect(result).toBeNull();
    });
  });

  describe('Folder Binding Path Matching', () => {
    it('should match exact path', () => {
      const bindings = {
        '/projects/app': { workspace: 'app-workspace' },
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(bindings));

      const result = getBindingForPath('/projects/app');
      expect(result).toEqual({ workspace: 'app-workspace' });
    });

    it('should match subdirectory with longest prefix', () => {
      const bindings = {
        '/projects': { workspace: 'general' },
        '/projects/app': { workspace: 'app-workspace' },
        '/projects/app/frontend': { workspace: 'frontend-workspace' },
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(bindings));

      // Should match longest prefix
      const result = getBindingForPath('/projects/app/frontend/src/components');
      expect(result).toEqual({ workspace: 'frontend-workspace' });
    });

    it('should not match partial directory names', () => {
      const bindings = {
        '/projects/app': { workspace: 'app-workspace' },
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(bindings));

      // Should NOT match '/projects/application' - not a subdirectory
      const result = getBindingForPath('/projects/application');
      expect(result).toBeNull();
    });

    it('should return null when no bindings match', () => {
      const bindings = {
        '/projects/app': { workspace: 'app-workspace' },
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(bindings));

      const result = getBindingForPath('/other/path');
      expect(result).toBeNull();
    });

    it('should handle bindings with team information', () => {
      const bindings = {
        '/projects/app': { workspace: 'app-workspace', team: 'FRONTEND' },
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(bindings));

      const result = getBindingForPath('/projects/app/src');
      expect(result).toEqual({ workspace: 'app-workspace', team: 'FRONTEND' });
    });

    it('should migrate old format (string) to new format (object)', () => {
      const oldBindings = {
        '/projects/app': 'app-workspace', // Old format
      };
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(oldBindings));

      const result = getBindingForPath('/projects/app');
      expect(result).toEqual({ workspace: 'app-workspace' });
    });
  });

  describe('Team Resolution Priority', () => {
    it('should prioritize LINEAR_TEAM env var', () => {
      process.env.LINEAR_TEAM = 'ENV_TEAM';
      
      const result = resolveTeam();
      expect(result).toBe('ENV_TEAM');
    });

    it('should use .env file team when no env var', () => {
      const cwd = '/test/project';
      const envPath = path.join(cwd, '.env');
      
      jest.spyOn(process, 'cwd').mockReturnValue(cwd);
      mockFs.existsSync.mockImplementation((path: any) => path === envPath);
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === envPath) {
          return 'LINEAR_TEAM=DOTENV_TEAM\n';
        }
        return '';
      });

      const result = resolveTeam();
      expect(result).toBe('DOTENV_TEAM');
    });

    it('should use folder binding team when no env var or .env file', () => {
      const cwd = '/projects/app';
      const bindings = {
        '/projects/app': { workspace: 'test', team: 'BINDING_TEAM' },
      };

      jest.spyOn(process, 'cwd').mockReturnValue(cwd);
      mockFs.existsSync.mockImplementation((path: any) => path === mockBindingsFile);
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === mockBindingsFile) {
          return JSON.stringify(bindings);
        }
        return '';
      });

      const result = resolveTeam();
      expect(result).toBe('BINDING_TEAM');
    });

    it('should return null when no team is configured', () => {
      jest.spyOn(process, 'cwd').mockReturnValue('/random/path');
      mockFs.existsSync.mockReturnValue(false);

      const result = resolveTeam();
      expect(result).toBeNull();
    });
  });

  describe('.env File Parsing', () => {
    it('should parse LINEAR_WORKSPACE from .env file', () => {
      const cwd = '/test';
      const envPath = path.join(cwd, '.env');
      
      mockFs.existsSync.mockImplementation((path: any) => path === envPath);
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === envPath) {
          return 'LINEAR_WORKSPACE=my-workspace\nOTHER=value';
        }
        return '';
      });

      const result = parseEnvFile(cwd);
      expect(result.workspace).toBe('my-workspace');
    });

    it('should parse LINEAR_TEAM from .env file', () => {
      const cwd = '/test';
      const envPath = path.join(cwd, '.env');
      
      mockFs.existsSync.mockImplementation((path: any) => path === envPath);
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === envPath) {
          return 'LINEAR_TEAM=ENG\nOTHER=value';
        }
        return '';
      });

      const result = parseEnvFile(cwd);
      expect(result.team).toBe('ENG');
    });

    it('should handle quoted values', () => {
      const cwd = '/test';
      const envPath = path.join(cwd, '.env');
      
      mockFs.existsSync.mockImplementation((path: any) => path === envPath);
      mockFs.readFileSync.mockImplementation((path: any) => {
        if (path === envPath) {
          return 'LINEAR_WORKSPACE="quoted-workspace"\nLINEAR_TEAM=\'single-quoted\'';
        }
        return '';
      });

      const result = parseEnvFile(cwd);
      expect(result.workspace).toBe('quoted-workspace');
      expect(result.team).toBe('single-quoted');
    });

    it('should return empty object when .env does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = parseEnvFile('/test');
      expect(result).toEqual({});
    });

    it('should handle malformed .env file gracefully', () => {
      const cwd = '/test';
      const envPath = path.join(cwd, '.env');
      
      mockFs.existsSync.mockImplementation((path: any) => path === envPath);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const result = parseEnvFile(cwd);
      expect(result).toEqual({});
    });
  });

  describe('Active Workspace Management', () => {
    it('should set active workspace correctly', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        activeWorkspace: 'old',
        workspaces: {
          old: { id: '1', name: 'Old', urlKey: 'old', accessToken: 'token', expiresAt: 0, scope: '' },
          new: { id: '2', name: 'New', urlKey: 'new', accessToken: 'token2', expiresAt: 0, scope: '' },
        },
      }));

      const result = setActiveWorkspace('new');
      expect(result).toBe(true);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false when setting non-existent workspace', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        activeWorkspace: 'existing',
        workspaces: {
          existing: { id: '1', name: 'Existing', urlKey: 'existing', accessToken: 'token', expiresAt: 0, scope: '' },
        },
      }));

      const result = setActiveWorkspace('nonexistent');
      expect(result).toBe(false);
    });

    it('should get active workspace correctly', () => {
      const activeWs = {
        id: 'active-id',
        name: 'Active',
        urlKey: 'active',
        accessToken: 'token',
        expiresAt: Date.now() + 86400000,
        scope: 'read,write',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        activeWorkspace: 'active',
        workspaces: { active: activeWs },
      }));

      const result = getActiveWorkspace();
      expect(result).toEqual(activeWs);
    });

    it('should return null when no active workspace', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        activeWorkspace: null,
        workspaces: {},
      }));

      const result = getActiveWorkspace();
      expect(result).toBeNull();
    });
  });
});
