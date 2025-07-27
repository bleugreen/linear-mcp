import 'dotenv/config';
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { registry } from './utils/metrics';
import { errorHandler } from './middleware/error-handler';
import { createRpcHandler } from './handlers/rpc';
import { createStreamHandler } from './handlers/stream';
import { createWebhookHandler } from './handlers/webhook';
import { SSEManager } from './services/sse-manager';
import { LinearService } from './services/linear-service';

const app = express();
const PORT = process.env.PORT || 3000;

const sseManager = new SSEManager(
  parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000')
);

const linearService = new LinearService(
  process.env.LINEAR_API_KEY || '',
  sseManager
);

app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp({ logger }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (error) {
    res.status(500).end();
  }
});

app.post('/rpc', createRpcHandler(linearService));
app.get('/stream', createStreamHandler(sseManager));
app.post('/webhook', createWebhookHandler(sseManager, linearService));

app.use(errorHandler);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'MCP server started');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');

  server.close(() => {
    sseManager.shutdown();
    logger.info('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});