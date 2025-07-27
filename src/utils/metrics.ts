import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();

export const metrics = {
  rpcRequests: new Counter({
    name: 'mcp_rpc_requests_total',
    help: 'Total number of RPC requests',
    labelNames: ['method', 'status'],
    registers: [registry],
  }),

  rpcLatency: new Histogram({
    name: 'mcp_rpc_latency_ms',
    help: 'RPC request latency in milliseconds',
    labelNames: ['method'],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [registry],
  }),

  linearRateLimited: new Counter({
    name: 'linear_rate_limited_total',
    help: 'Total number of rate limit hits from Linear API',
    registers: [registry],
  }),

  linearApiLatency: new Histogram({
    name: 'linear_api_latency_ms',
    help: 'Linear API request latency in milliseconds',
    labelNames: ['operation'],
    buckets: [50, 100, 250, 500, 1000, 2500, 5000],
    registers: [registry],
  }),

  activeSSEConnections: new Gauge({
    name: 'mcp_sse_connections_active',
    help: 'Number of active SSE connections',
    registers: [registry],
  }),

  webhookEvents: new Counter({
    name: 'mcp_webhook_events_total',
    help: 'Total number of webhook events received',
    labelNames: ['entity_type', 'action'],
    registers: [registry],
  }),
};