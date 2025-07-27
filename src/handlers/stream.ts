import { Request, Response } from 'express';
import { SSEManager } from '../services/sse-manager';
import { v4 as uuidv4 } from 'uuid';

export function createStreamHandler(sseManager: SSEManager) {
  return (req: Request, res: Response) => {
    const clientId = req.headers['x-client-id'] as string || uuidv4();
    
    req.on('close', () => {
      sseManager.removeConnection(clientId);
    });

    sseManager.addConnection(clientId, res);
  };
}