import { LinearClient } from '@linear/sdk';
import { IdentifierResolver } from './identifier-resolver';
import { ApiError } from '../middleware/error-handler';

// Mock the LinearClient
jest.mock('@linear/sdk');

describe('IdentifierResolver', () => {
  let resolver: IdentifierResolver;
  let mockLinearClient: jest.Mocked<LinearClient>;
  let mockRawRequest: jest.Mock;

  beforeEach(() => {
    mockRawRequest = jest.fn();
    mockLinearClient = {
      client: {
        rawRequest: mockRawRequest,
      },
    } as any;

    resolver = new IdentifierResolver(mockLinearClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Cache TTL Behavior', () => {
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should cache team ID resolution for 5 minutes', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          teams: {
            nodes: [{ id: 'team-uuid', key: 'ENG' }],
          },
        },
      });

      // First call - should hit API
      const result1 = await resolver.resolveTeamId('ENG');
      expect(result1).toBe('team-uuid');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Second call within 5 minutes - should use cache
      const result2 = await resolver.resolveTeamId('ENG');
      expect(result2).toBe('team-uuid');
      expect(mockRawRequest).toHaveBeenCalledTimes(1); // No additional call

      // Advance time by 4 minutes - still within cache
      jest.advanceTimersByTime(4 * 60 * 1000);
      const result3 = await resolver.resolveTeamId('ENG');
      expect(result3).toBe('team-uuid');
      expect(mockRawRequest).toHaveBeenCalledTimes(1); // No additional call

      // Advance time past 5 minutes - cache expired
      jest.advanceTimersByTime(2 * 60 * 1000); // Total: 6 minutes
      const result4 = await resolver.resolveTeamId('ENG');
      expect(result4).toBe('team-uuid');
      expect(mockRawRequest).toHaveBeenCalledTimes(2); // New API call
    });

    it('should cache project ID resolution with team context', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          projects: {
            nodes: [{ id: 'project-uuid', name: 'Q1 Migration' }],
          },
        },
      });

      // First call
      await resolver.resolveProjectId('Q1 Migration', 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Second call within cache window
      await resolver.resolveProjectId('Q1 Migration', 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // After cache expiry
      jest.advanceTimersByTime(FIVE_MINUTES_MS + 1000);
      await resolver.resolveProjectId('Q1 Migration', 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(2);
    });

    it('should cache state IDs per team', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            states: {
              nodes: [
                { id: 'state-1', name: 'Todo' },
                { id: 'state-2', name: 'In Progress' },
              ],
            },
          },
        },
      });

      // Resolve state
      await resolver.resolveStateId('Todo', 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Same state, same team - should use cache
      await resolver.resolveStateId('Todo', 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Different state, same team - should use cached team data
      await resolver.resolveStateId('In Progress', 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);
    });

    it('should cache label IDs per team', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            labels: {
              nodes: [
                { id: 'label-1', name: 'Bug' },
                { id: 'label-2', name: 'Feature' },
              ],
            },
          },
        },
      });

      // Resolve multiple labels
      await resolver.resolveLabelIds(['Bug', 'Feature'], 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Same labels - should use cache
      await resolver.resolveLabelIds(['Bug', 'Feature'], 'team-123');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);
    });

    it('should cache user ID resolution', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          users: {
            nodes: [{ id: 'user-uuid', email: 'user@example.com' }],
          },
        },
      });

      await resolver.resolveUserId('user@example.com');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Within cache window
      await resolver.resolveUserId('user@example.com');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);
    });

    it('should clear all caches when clearCache is called', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          teams: {
            nodes: [{ id: 'team-uuid', key: 'ENG' }],
          },
        },
      });

      // Populate cache
      await resolver.resolveTeamId('ENG');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Verify cache is used
      await resolver.resolveTeamId('ENG');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Clear cache
      resolver.clearCache();

      // Should hit API again
      await resolver.resolveTeamId('ENG');
      expect(mockRawRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('UUID Detection', () => {
    it('should return UUID directly for team without API call', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const result = await resolver.resolveTeamId(uuid);
      
      expect(result).toBe(uuid);
      expect(mockRawRequest).not.toHaveBeenCalled();
    });

    it('should return UUID directly for project without API call', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const result = await resolver.resolveProjectId(uuid);
      
      expect(result).toBe(uuid);
      expect(mockRawRequest).not.toHaveBeenCalled();
    });

    it('should return UUID directly for state without API call', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const result = await resolver.resolveStateId(uuid, 'team-123');
      
      expect(result).toBe(uuid);
      expect(mockRawRequest).not.toHaveBeenCalled();
    });

    it('should return UUID directly for user without API call', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const result = await resolver.resolveUserId(uuid);
      
      expect(result).toBe(uuid);
      expect(mockRawRequest).not.toHaveBeenCalled();
    });

    it('should handle UUID in label array without API call', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            labels: {
              nodes: [{ id: 'label-1', name: 'Bug' }],
            },
          },
        },
      });

      const result = await resolver.resolveLabelIds([uuid, 'Bug'], 'team-123');
      
      expect(result).toContain(uuid);
      expect(result).toContain('label-1');
      expect(mockRawRequest).toHaveBeenCalledTimes(1); // Only for 'Bug'
    });
  });

  describe('Error Handling', () => {
    it('should throw ApiError when team not found', async () => {
      mockRawRequest.mockResolvedValue({
        data: { teams: { nodes: [] } },
      });

      await expect(resolver.resolveTeamId('NONEXISTENT')).rejects.toThrow(ApiError);
      await expect(resolver.resolveTeamId('NONEXISTENT')).rejects.toThrow('Team with key "NONEXISTENT" not found');
    });

    it('should throw ApiError when project not found', async () => {
      mockRawRequest.mockResolvedValue({
        data: { projects: { nodes: [] } },
      });

      await expect(resolver.resolveProjectId('Nonexistent Project')).rejects.toThrow(ApiError);
    });

    it('should throw ApiError when state not found', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            states: {
              nodes: [{ id: 'state-1', name: 'Todo' }],
            },
          },
        },
      });

      await expect(resolver.resolveStateId('Nonexistent', 'team-123')).rejects.toThrow(ApiError);
    });

    it('should throw ApiError when label not found', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            labels: {
              nodes: [{ id: 'label-1', name: 'Bug' }],
            },
          },
        },
      });

      await expect(resolver.resolveLabelIds(['Nonexistent'], 'team-123')).rejects.toThrow(ApiError);
    });

    it('should throw ApiError when user not found', async () => {
      mockRawRequest.mockResolvedValue({
        data: { users: { nodes: [] } },
      });

      await expect(resolver.resolveUserId('nonexistent@example.com')).rejects.toThrow(ApiError);
    });

    it('should require team ID for state resolution', async () => {
      await expect(resolver.resolveStateId('Todo', '')).rejects.toThrow('Team ID is required');
    });

    it('should require team ID for label resolution', async () => {
      await expect(resolver.resolveLabelIds(['Bug'], '')).rejects.toThrow('Team ID is required');
    });
  });

  describe('Issue ID Resolution', () => {
    it('should resolve issue identifier format (TEAM-123)', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          teams: {
            nodes: [{
              issues: {
                nodes: [{ id: 'issue-uuid' }],
              },
            }],
          },
        },
      });

      const result = await resolver.resolveIssueId('ENG-42');
      expect(result).toBe('issue-uuid');
      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.any(String),
        { teamKey: 'ENG', number: 42 }
      );
    });

    it('should return UUID directly for issue', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';
      const result = await resolver.resolveIssueId(uuid);
      
      expect(result).toBe(uuid);
      expect(mockRawRequest).not.toHaveBeenCalled();
    });

    it('should throw error for invalid issue identifier format', async () => {
      await expect(resolver.resolveIssueId('INVALID-FORMAT-XYZ')).rejects.toThrow('Invalid issue identifier format');
    });

    it('should throw error when issue not found', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          teams: {
            nodes: [{
              issues: {
                nodes: [],
              },
            }],
          },
        },
      });

      await expect(resolver.resolveIssueId('ENG-999')).rejects.toThrow('Issue ENG-999 not found');
    });
  });

  describe('Case Insensitivity', () => {
    it('should match state names case-insensitively', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            states: {
              nodes: [{ id: 'state-1', name: 'In Progress' }],
            },
          },
        },
      });

      const result = await resolver.resolveStateId('in progress', 'team-123');
      expect(result).toBe('state-1');
    });

    it('should match label names case-insensitively', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          team: {
            labels: {
              nodes: [{ id: 'label-1', name: 'Bug' }],
            },
          },
        },
      });

      const result = await resolver.resolveLabelIds(['bug', 'BUG'], 'team-123');
      expect(result).toEqual(['label-1', 'label-1']);
    });
  });

  describe('Project Resolution with Team Context', () => {
    it('should use team filter when team ID provided', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          projects: {
            nodes: [{ id: 'project-uuid', name: 'Project' }],
          },
        },
      });

      await resolver.resolveProjectId('Project', 'team-123');
      
      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.stringContaining('$teamId'),
        { name: 'Project', teamId: 'team-123' }
      );
    });

    it('should search all projects when no team ID provided', async () => {
      mockRawRequest.mockResolvedValue({
        data: {
          projects: {
            nodes: [{ id: 'project-uuid', name: 'Project' }],
          },
        },
      });

      await resolver.resolveProjectId('Project');
      
      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.not.stringContaining('$teamId'),
        { name: 'Project' }
      );
    });

    it('should cache projects separately by team context', async () => {
      jest.useFakeTimers();

      mockRawRequest.mockResolvedValue({
        data: {
          projects: {
            nodes: [{ id: 'project-uuid', name: 'API' }],
          },
        },
      });

      // Resolve for team-1
      await resolver.resolveProjectId('API', 'team-1');
      expect(mockRawRequest).toHaveBeenCalledTimes(1);

      // Resolve for team-2 - different cache key
      await resolver.resolveProjectId('API', 'team-2');
      expect(mockRawRequest).toHaveBeenCalledTimes(2);

      // Resolve for team-1 again - uses cache
      await resolver.resolveProjectId('API', 'team-1');
      expect(mockRawRequest).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
