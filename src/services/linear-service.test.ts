import { LinearService } from './linear-service';
import { SSEManager } from './sse-manager';

describe('LinearService', () => {
  let linearService: LinearService;
  let mockSSEManager: SSEManager;

  beforeEach(() => {
    mockSSEManager = new SSEManager();
    linearService = new LinearService('test-api-key', mockSSEManager);
  });

  afterEach(() => {
    mockSSEManager.shutdown();
  });

  describe('getMethodHandler', () => {
    it('should return handler for valid method', () => {
      const handler = linearService.getMethodHandler('linear.issues.list');
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should return undefined for invalid method', () => {
      const handler = linearService.getMethodHandler('invalid.method');
      expect(handler).toBeUndefined();
    });

    it('should have all expected methods registered', () => {
      const expectedMethods = [
        'linear.issues.list',
        'linear.issues.get',
        'linear.issues.create',
        'linear.issues.update',
        'linear.issues.delete',
        'linear.issues.markdown',
        'linear.issues.search',
        'linear.comments.list',
        'linear.comments.create',
        'linear.projects.list',
        'linear.projects.get',
        'linear.projects.create',
        'linear.projects.update',
        'linear.cycles.list',
        'linear.cycles.get',
        'linear.teams.list',
        'linear.teams.get',
        'linear.states.list',
        'linear.labels.list',
        'linear.users.list',
        'linear.users.get',
        'linear.users.me',
        'linear.capabilities',
      ];

      for (const method of expectedMethods) {
        const handler = linearService.getMethodHandler(method);
        expect(handler).toBeDefined();
      }
    });
  });

  describe('capabilities', () => {
    it('should return capabilities info', async () => {
      const handler = linearService.getMethodHandler('linear.capabilities');
      expect(handler).toBeDefined();
      
      if (handler) {
        const capabilities = await handler({});
        expect(capabilities).toHaveProperty('version');
        expect(capabilities).toHaveProperty('methods');
        expect(capabilities).toHaveProperty('notifications');
        expect(capabilities).toHaveProperty('features');
        expect(Array.isArray(capabilities.methods)).toBe(true);
      }
    });
  });
});