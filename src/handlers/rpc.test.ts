import { Request, Response, NextFunction } from 'express';
import { createRpcHandler } from './rpc';
import { LinearService } from '../services/linear-service';
import { ApiError } from '../middleware/error-handler';
import { JsonRpcErrorCodes } from '../types/json-rpc';
import { metrics } from '../utils/metrics';

// Mock dependencies
jest.mock('../services/linear-service');
jest.mock('../utils/metrics');
jest.mock('../utils/logger');

describe('RPC Handler', () => {
  let mockLinearService: jest.Mocked<LinearService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let rpcHandler: ReturnType<typeof createRpcHandler>;

  beforeEach(() => {
    mockLinearService = {
      getMethodHandler: jest.fn(),
    } as any;

    mockResponse = {
      json: jest.fn(),
    };

    mockNext = jest.fn();

    rpcHandler = createRpcHandler(mockLinearService);

    jest.clearAllMocks();
  });

  describe('JSON-RPC Request Validation', () => {
    it('should reject request without jsonrpc field', async () => {
      mockRequest = {
        body: {
          method: 'linear.issues.list',
          params: {},
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: JsonRpcErrorCodes.INVALID_REQUEST,
          message: expect.stringContaining('Invalid JSON-RPC version'),
        })
      );
    });

    it('should reject request with invalid jsonrpc version', async () => {
      mockRequest = {
        body: {
          jsonrpc: '1.0',
          method: 'linear.issues.list',
          params: {},
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: JsonRpcErrorCodes.INVALID_REQUEST,
        })
      );
    });

    it('should require method field', async () => {
      mockRequest = {
        body: {
          jsonrpc: '2.0',
          params: {},
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: JsonRpcErrorCodes.INVALID_REQUEST,
          message: expect.stringContaining('Method is required'),
        })
      );
    });

    it('should require method to be a string', async () => {
      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 123, // Invalid: not a string
          params: {},
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          code: JsonRpcErrorCodes.INVALID_REQUEST,
        })
      );
    });

    it('should accept valid JSON-RPC 2.0 request', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ result: 'success' });
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: { limit: 10 },
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: { result: 'success' },
        id: 1,
      });
    });
  });

  describe('Method Handling', () => {
    it('should return error for unknown method', async () => {
      mockLinearService.getMethodHandler.mockReturnValue(undefined);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.unknown.method',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          code: JsonRpcErrorCodes.METHOD_NOT_FOUND,
          message: expect.stringContaining("Method 'linear.unknown.method' not found"),
        })
      );
    });

    it('should execute handler for valid method', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ data: 'test' });
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: { teamId: 'ENG' },
          id: 42,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockHandler).toHaveBeenCalledWith({ teamId: 'ENG' });
      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: { data: 'test' },
        id: 42,
      });
    });

    it('should pass params to handler', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      const params = {
        teamId: 'ENG',
        limit: 50,
        query: 'test',
      };

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.search',
          params,
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockHandler).toHaveBeenCalledWith(params);
    });
  });

  describe('Response Formatting', () => {
    it('should format successful response with JSON-RPC 2.0 structure', async () => {
      const result = { issues: [{ id: '1', title: 'Test' }] };
      const mockHandler = jest.fn().mockResolvedValue(result);
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: {},
          id: 123,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result,
        id: 123,
      });
    });

    it('should include request id in response', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.capabilities',
          params: {},
          id: 'custom-id-string',
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'custom-id-string',
        })
      );
    });

    it('should handle null result', async () => {
      const mockHandler = jest.fn().mockResolvedValue(null);
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.delete',
          params: { id: 'issue-123' },
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: null,
        id: 1,
      });
    });
  });

  describe('Error Handling', () => {
    it('should pass errors to next middleware', async () => {
      const error = new Error('Handler error');
      const mockHandler = jest.fn().mockRejectedValue(error);
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should preserve ApiError properties', async () => {
      const apiError = new ApiError(
        404,
        'Resource not found',
        JsonRpcErrorCodes.INVALID_PARAMS
      );
      const mockHandler = jest.fn().mockRejectedValue(apiError);
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.get',
          params: { id: 'nonexistent' },
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Resource not found',
          code: JsonRpcErrorCodes.INVALID_PARAMS,
        })
      );
    });
  });

  describe('Metrics Tracking', () => {
    it('should increment success metrics on successful request', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(metrics.rpcRequests.inc).toHaveBeenCalledWith({
        method: 'linear.issues.list',
        status: 'success',
      });
    });

    it('should increment error metrics on failed request', async () => {
      const mockHandler = jest.fn().mockRejectedValue(new Error('Failed'));
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(metrics.rpcRequests.inc).toHaveBeenCalledWith({
        method: 'linear.issues.list',
        status: 'error',
      });
    });

    it('should track request latency', async () => {
      const mockHandler = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return {};
      });
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(metrics.rpcLatency.observe).toHaveBeenCalledWith(
        { method: 'linear.issues.list' },
        expect.any(Number)
      );
    });

    it('should track latency even on error', async () => {
      const mockHandler = jest.fn().mockRejectedValue(new Error('Failed'));
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.issues.list',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(metrics.rpcLatency.observe).toHaveBeenCalledWith(
        { method: 'linear.issues.list' },
        expect.any(Number)
      );
    });

    it('should use "unknown" method for invalid requests', async () => {
      mockRequest = {
        body: {
          jsonrpc: '2.0',
          // Missing method field
          params: {},
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(metrics.rpcLatency.observe).toHaveBeenCalledWith(
        { method: 'unknown' },
        expect.any(Number)
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle request without params field', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.capabilities',
          // No params field
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockHandler).toHaveBeenCalledWith(undefined);
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should handle request without id field', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ data: 'test' });
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.capabilities',
          params: {},
          // No id field (notification request)
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        result: { data: 'test' },
        id: undefined,
      });
    });

    it('should handle empty params object', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.capabilities',
          params: {},
          id: 1,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockHandler).toHaveBeenCalledWith({});
    });

    it('should handle numeric id', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.capabilities',
          params: {},
          id: 12345,
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ id: 12345 })
      );
    });

    it('should handle string id', async () => {
      const mockHandler = jest.fn().mockResolvedValue({});
      mockLinearService.getMethodHandler.mockReturnValue(mockHandler);

      mockRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'linear.capabilities',
          params: {},
          id: 'request-uuid-123',
        },
      };

      await rpcHandler(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'request-uuid-123' })
      );
    });
  });
});
