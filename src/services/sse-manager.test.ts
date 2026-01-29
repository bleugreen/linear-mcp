import { Response } from 'express';
import { SSEManager } from './sse-manager';
import { metrics } from '../utils/metrics';
import { McpNotification } from '../types/mcp';

// Mock dependencies
jest.mock('../utils/logger');
jest.mock('../utils/metrics');

describe('SSEManager', () => {
  let sseManager: SSEManager;
  let mockResponse: jest.Mocked<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create a mock response object
    mockResponse = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any;
  });

  afterEach(() => {
    if (sseManager) {
      sseManager.shutdown();
    }
    jest.useRealTimers();
  });

  describe('Connection Management', () => {
    it('should add connection with correct SSE headers', () => {
      sseManager = new SSEManager(15000);
      sseManager.addConnection('client-1', mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    it('should send initial ok message on connection', () => {
      sseManager = new SSEManager(15000);
      sseManager.addConnection('client-1', mockResponse);

      expect(mockResponse.write).toHaveBeenCalledWith(':ok\n\n');
    });

    it('should update metrics when adding connection', () => {
      sseManager = new SSEManager(15000);
      
      sseManager.addConnection('client-1', mockResponse);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(1);

      const mockResponse2 = { ...mockResponse };
      sseManager.addConnection('client-2', mockResponse2 as any);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(2);
    });

    it('should setup close event handler', () => {
      sseManager = new SSEManager(15000);
      sseManager.addConnection('client-1', mockResponse);

      expect(mockResponse.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should remove connection and update metrics', () => {
      sseManager = new SSEManager(15000);
      const mockResponse2 = { ...mockResponse, on: jest.fn() } as any;

      sseManager.addConnection('client-1', mockResponse);
      sseManager.addConnection('client-2', mockResponse2);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(2);

      sseManager.removeConnection('client-1');
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(1);
    });

    it('should handle connection close event', () => {
      sseManager = new SSEManager(15000);
      let closeHandler: Function | undefined;

      mockResponse.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'close') {
          closeHandler = handler;
        }
        return mockResponse;
      });

      sseManager.addConnection('client-1', mockResponse);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(1);

      // Simulate connection close
      if (closeHandler) {
        closeHandler();
      }

      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(0);
    });

    it('should handle multiple connections independently', () => {
      sseManager = new SSEManager(15000);
      const responses = Array.from({ length: 5 }, () => ({
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      })) as jest.Mocked<Response>[];

      responses.forEach((res, i) => {
        sseManager.addConnection(`client-${i}`, res);
      });

      expect(metrics.activeSSEConnections.set).toHaveBeenLastCalledWith(5);
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast notification to all connected clients', () => {
      sseManager = new SSEManager(15000);
      const responses = [mockResponse, { ...mockResponse } as any, { ...mockResponse } as any];
      
      responses.forEach((res, i) => {
        res.write = jest.fn();
        sseManager.addConnection(`client-${i}`, res);
      });

      const notification: McpNotification = {
        type: 'issue.updated',
        data: { issueId: 'test-123' },
      };

      sseManager.broadcast(notification);

      const expectedMessage = `event: issue.updated\ndata: ${JSON.stringify(notification)}\n\n`;
      responses.forEach((res) => {
        expect(res.write).toHaveBeenCalledWith(expectedMessage);
      });
    });

    it('should format SSE message correctly', () => {
      sseManager = new SSEManager(15000);
      sseManager.addConnection('client-1', mockResponse);

      const notification: McpNotification = {
        type: 'issue.created',
        data: { issueId: 'NEW-123', title: 'New Issue' },
      };

      // Clear the initial :ok message
      mockResponse.write.mockClear();

      sseManager.broadcast(notification);

      const expectedMessage = 
        `event: issue.created\n` +
        `data: ${JSON.stringify(notification)}\n\n`;

      expect(mockResponse.write).toHaveBeenCalledWith(expectedMessage);
    });

    it('should remove connection if broadcast write fails', () => {
      sseManager = new SSEManager(15000);
      mockResponse.write.mockImplementation(() => {
        throw new Error('Write failed');
      });

      sseManager.addConnection('client-1', mockResponse);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(1);

      const notification: McpNotification = {
        type: 'test',
        data: {},
      };

      sseManager.broadcast(notification);

      // Connection should be removed after failed write
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(0);
    });

    it('should continue broadcasting to other clients if one fails', () => {
      sseManager = new SSEManager(15000);
      
      const failingResponse = { ...mockResponse } as any;
      failingResponse.write = jest.fn().mockImplementation(() => {
        throw new Error('Write failed');
      });

      const workingResponse = { ...mockResponse } as any;
      workingResponse.write = jest.fn();

      sseManager.addConnection('failing-client', failingResponse);
      sseManager.addConnection('working-client', workingResponse);

      const notification: McpNotification = {
        type: 'test',
        data: {},
      };

      sseManager.broadcast(notification);

      // Working client should still receive the message
      expect(workingResponse.write).toHaveBeenCalled();
    });
  });

  describe('Targeted Messaging', () => {
    it('should send notification to specific client', () => {
      sseManager = new SSEManager(15000);
      const response1 = { ...mockResponse } as any;
      const response2 = { ...mockResponse } as any;
      
      response1.write = jest.fn();
      response2.write = jest.fn();

      sseManager.addConnection('client-1', response1);
      sseManager.addConnection('client-2', response2);

      const notification: McpNotification = {
        type: 'private.message',
        data: { content: 'Secret' },
      };

      // Clear initial messages
      response1.write.mockClear();
      response2.write.mockClear();

      sseManager.sendToClient('client-1', notification);

      expect(response1.write).toHaveBeenCalled();
      expect(response2.write).not.toHaveBeenCalled();
    });

    it('should handle send to non-existent client gracefully', () => {
      sseManager = new SSEManager(15000);
      
      const notification: McpNotification = {
        type: 'test',
        data: {},
      };

      // Should not throw
      expect(() => {
        sseManager.sendToClient('nonexistent', notification);
      }).not.toThrow();
    });

    it('should remove connection if targeted write fails', () => {
      sseManager = new SSEManager(15000);
      mockResponse.write.mockImplementation(() => {
        throw new Error('Write failed');
      });

      sseManager.addConnection('client-1', mockResponse);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(1);

      const notification: McpNotification = {
        type: 'test',
        data: {},
      };

      sseManager.sendToClient('client-1', notification);

      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(0);
    });
  });

  describe('Heartbeat Mechanism', () => {
    it('should start heartbeat on initialization', () => {
      sseManager = new SSEManager(10000);
      
      // Heartbeat should be scheduled
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });

    it('should send heartbeat to all connections at specified interval', () => {
      const heartbeatInterval = 5000;
      sseManager = new SSEManager(heartbeatInterval);
      
      sseManager.addConnection('client-1', mockResponse);
      mockResponse.write.mockClear(); // Clear initial :ok message

      // Advance time by heartbeat interval
      jest.advanceTimersByTime(heartbeatInterval);

      expect(mockResponse.write).toHaveBeenCalledWith(':heartbeat\n\n');
    });

    it('should send heartbeats at correct intervals', () => {
      const heartbeatInterval = 15000;
      sseManager = new SSEManager(heartbeatInterval);
      
      sseManager.addConnection('client-1', mockResponse);
      mockResponse.write.mockClear();

      // First heartbeat
      jest.advanceTimersByTime(heartbeatInterval);
      expect(mockResponse.write).toHaveBeenCalledTimes(1);

      // Second heartbeat
      jest.advanceTimersByTime(heartbeatInterval);
      expect(mockResponse.write).toHaveBeenCalledTimes(2);

      // Third heartbeat
      jest.advanceTimersByTime(heartbeatInterval);
      expect(mockResponse.write).toHaveBeenCalledTimes(3);
    });

    it('should use default 15s heartbeat interval', () => {
      sseManager = new SSEManager(); // No interval specified
      
      sseManager.addConnection('client-1', mockResponse);
      mockResponse.write.mockClear();

      // Should use default 15000ms
      jest.advanceTimersByTime(14999);
      expect(mockResponse.write).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockResponse.write).toHaveBeenCalledWith(':heartbeat\n\n');
    });

    it('should remove connection if heartbeat write fails', () => {
      sseManager = new SSEManager(5000);
      
      let writeCount = 0;
      mockResponse.write.mockImplementation(() => {
        writeCount++;
        if (writeCount > 1) { // Fail after initial :ok
          throw new Error('Write failed');
        }
      });

      sseManager.addConnection('client-1', mockResponse);
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(1);

      // Trigger heartbeat
      jest.advanceTimersByTime(5000);

      // Connection should be removed after failed heartbeat
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(0);
    });

    it('should send heartbeats to multiple clients', () => {
      sseManager = new SSEManager(5000);
      const responses = Array.from({ length: 3 }, () => ({
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      })) as jest.Mocked<Response>[];

      responses.forEach((res, i) => {
        sseManager.addConnection(`client-${i}`, res);
        res.write.mockClear(); // Clear initial :ok
      });

      jest.advanceTimersByTime(5000);

      responses.forEach((res) => {
        expect(res.write).toHaveBeenCalledWith(':heartbeat\n\n');
      });
    });
  });

  describe('Shutdown', () => {
    it('should clear heartbeat interval on shutdown', () => {
      sseManager = new SSEManager(5000);
      
      sseManager.addConnection('client-1', mockResponse);
      mockResponse.write.mockClear();

      sseManager.shutdown();

      // Heartbeat should not fire after shutdown
      jest.advanceTimersByTime(10000);
      expect(mockResponse.write).not.toHaveBeenCalled();
    });

    it('should close all connections on shutdown', () => {
      sseManager = new SSEManager(15000);
      const responses = Array.from({ length: 3 }, () => ({
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      })) as jest.Mocked<Response>[];

      responses.forEach((res, i) => {
        sseManager.addConnection(`client-${i}`, res);
      });

      sseManager.shutdown();

      responses.forEach((res) => {
        expect(res.end).toHaveBeenCalled();
      });
    });

    it('should clear connections map on shutdown', () => {
      sseManager = new SSEManager(15000);
      
      sseManager.addConnection('client-1', mockResponse);
      sseManager.addConnection('client-2', { ...mockResponse, on: jest.fn() } as any);
      
      expect(metrics.activeSSEConnections.set).toHaveBeenCalledWith(2);

      sseManager.shutdown();

      // Attempting to send after shutdown should not throw
      expect(() => {
        sseManager.sendToClient('client-1', { type: 'test', data: {} });
      }).not.toThrow();
    });

    it('should handle errors when closing connections', () => {
      sseManager = new SSEManager(15000);
      
      mockResponse.end.mockImplementation(() => {
        throw new Error('Close failed');
      });

      sseManager.addConnection('client-1', mockResponse);

      // Should not throw even if closing fails
      expect(() => {
        sseManager.shutdown();
      }).not.toThrow();
    });

    it('should be safe to call shutdown multiple times', () => {
      sseManager = new SSEManager(15000);
      
      sseManager.addConnection('client-1', mockResponse);

      expect(() => {
        sseManager.shutdown();
        sseManager.shutdown();
        sseManager.shutdown();
      }).not.toThrow();
    });
  });

  describe('Message Format Validation', () => {
    it('should format SSE event with type and data', () => {
      sseManager = new SSEManager(15000);
      sseManager.addConnection('client-1', mockResponse);
      mockResponse.write.mockClear();

      const notification: McpNotification = {
        type: 'custom.event',
        data: { key: 'value', nested: { prop: 123 } },
      };

      sseManager.sendToClient('client-1', notification);

      const call = mockResponse.write.mock.calls[0][0] as string;
      expect(call).toContain('event: custom.event');
      expect(call).toContain('data: ');
      expect(call).toContain('"key":"value"');
      expect(call).toMatch(/\n\n$/); // Should end with double newline
    });

    it('should properly serialize complex data', () => {
      sseManager = new SSEManager(15000);
      sseManager.addConnection('client-1', mockResponse);
      mockResponse.write.mockClear();

      const notification: McpNotification = {
        type: 'complex.data',
        data: {
          array: [1, 2, 3],
          object: { a: 'b' },
          null: null,
          boolean: true,
        },
      };

      sseManager.sendToClient('client-1', notification);

      const message = mockResponse.write.mock.calls[0][0] as string;
      const dataMatch = message.match(/data: (.+)\n/);
      expect(dataMatch).toBeTruthy();
      
      if (dataMatch) {
        const parsedData = JSON.parse(dataMatch[1]);
        expect(parsedData.data).toEqual(notification.data);
      }
    });
  });
});
