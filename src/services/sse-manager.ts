import { Response } from 'express';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { McpNotification } from '../types/mcp';

export class SSEManager {
  private connections: Map<string, Response> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs: number;

  constructor(heartbeatIntervalMs: number = 15000) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.startHeartbeat();
  }

  addConnection(clientId: string, res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(':ok\n\n');

    this.connections.set(clientId, res);
    metrics.activeSSEConnections.set(this.connections.size);

    logger.info({ clientId, totalConnections: this.connections.size }, 'SSE connection added');

    res.on('close', () => {
      this.removeConnection(clientId);
    });
  }

  removeConnection(clientId: string) {
    this.connections.delete(clientId);
    metrics.activeSSEConnections.set(this.connections.size);
    logger.info({ clientId, totalConnections: this.connections.size }, 'SSE connection removed');
  }

  broadcast(notification: McpNotification) {
    const message = `event: ${notification.type}\ndata: ${JSON.stringify(notification)}\n\n`;
    
    this.connections.forEach((res, clientId) => {
      try {
        res.write(message);
      } catch (error) {
        logger.error({ error, clientId }, 'Failed to send SSE message');
        this.removeConnection(clientId);
      }
    });
  }

  sendToClient(clientId: string, notification: McpNotification) {
    const res = this.connections.get(clientId);
    if (!res) {
      logger.warn({ clientId }, 'Attempted to send to non-existent SSE connection');
      return;
    }

    const message = `event: ${notification.type}\ndata: ${JSON.stringify(notification)}\n\n`;
    
    try {
      res.write(message);
    } catch (error) {
      logger.error({ error, clientId }, 'Failed to send SSE message');
      this.removeConnection(clientId);
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const heartbeat = ':heartbeat\n\n';
      
      this.connections.forEach((res, clientId) => {
        try {
          res.write(heartbeat);
        } catch (error) {
          logger.error({ error, clientId }, 'Failed to send heartbeat');
          this.removeConnection(clientId);
        }
      });
    }, this.heartbeatIntervalMs);
  }

  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.connections.forEach((res) => {
      try {
        res.end();
      } catch (error) {
        logger.error({ error }, 'Error closing SSE connection');
      }
    });
    
    this.connections.clear();
  }
}