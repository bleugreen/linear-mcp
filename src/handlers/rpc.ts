import { Request, Response, NextFunction } from 'express';
import { JsonRpcRequest, JsonRpcResponse, JsonRpcErrorCodes } from '../types/json-rpc';
import { LinearService } from '../services/linear-service';
import { ApiError } from '../middleware/error-handler';
import { metrics } from '../utils/metrics';
import { logger } from '../utils/logger';

export function createRpcHandler(linearService: LinearService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    let method = 'unknown';

    try {
      const request = req.body as JsonRpcRequest;
      
      if (!request.jsonrpc || request.jsonrpc !== '2.0') {
        throw new ApiError(400, 'Invalid JSON-RPC version', JsonRpcErrorCodes.INVALID_REQUEST);
      }

      if (!request.method || typeof request.method !== 'string') {
        throw new ApiError(400, 'Method is required', JsonRpcErrorCodes.INVALID_REQUEST);
      }

      method = request.method;

      const handler = linearService.getMethodHandler(method);
      if (!handler) {
        throw new ApiError(404, `Method '${method}' not found`, JsonRpcErrorCodes.METHOD_NOT_FOUND);
      }

      const result = await handler(request.params);

      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        result,
        id: request.id,
      };

      metrics.rpcRequests.inc({ method, status: 'success' });
      res.json(response);

    } catch (error) {
      metrics.rpcRequests.inc({ method, status: 'error' });
      next(error);
    } finally {
      const duration = Date.now() - startTime;
      metrics.rpcLatency.observe({ method }, duration);
      logger.info({ method, duration }, 'RPC request processed');
    }
  };
}