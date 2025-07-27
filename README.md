# Legible Linear MCP

A high-performance HTTP service that bridges Claude Code (or any MCP client) with Linear's GraphQL API. 

Built to make accessing Linear more comfortable for LLMs 

## 📋 Prerequisites

- Node.js 18+ 
- Linear API key ([Get one here](https://linear.app/settings/account/security))
- Optional: Linear webhook secret for webhook validation

## 🛠️ Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/bleugreen.git
cd linear-mcp
```

2. Install dependencies:
```bash
npm install
npm run build
```

3. Add to ~/.claude.json
```json
{
...,
"mcpServers": {
    "linear-mcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/PATH/TO/linear-mcp/dist/mcp-server.js"
      ],
      "env": {
        "LINEAR_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Linear API keys can be created by going to Workspace Settings > Security & Access > "New API key"

---

### Core Capabilities
- **JSON-RPC 2.0 API**: Full CRUD operations on Linear entities (issues, comments, projects, cycles, teams, users)
- **Smart Content Chunking**: Automatically splits large content across multiple comments - never truncates data
- **Human-Readable Identifiers**: Use team keys (TEAM), issue identifiers (TEAM-123), project names, and user emails instead of UUIDs
- **UUID-Free Responses**: All responses use human-readable identifiers, no UUIDs exposed
- **Comment Positioning**: Comments include position numbers instead of UUIDs
- **Markdown Export**: Get full issue content with all comments in clean markdown format
- **Server-Sent Events (SSE)**: Real-time push updates with automatic heartbeat (15s)
- **Webhook Integration**: Receive and broadcast Linear webhook events as MCP notifications

### Reliability & Performance
- **Rate Limiting**: Automatic exponential backoff respecting Linear's 1,500 req/hr limit
- **Query Complexity Management**: Automatically handles Linear's 10,000 complexity limit by splitting queries
- **Error Recovery**: Comprehensive error handling with detailed JSON-RPC error responses
- **Observability**: Prometheus metrics and structured JSON logging with Pino

### Developer Experience
- **Type Safety**: Full TypeScript with Linear's official SDK
- **Human-Friendly Input**: Use team keys (SOFT), issue identifiers (SOFT-123), project names, state names, label names, and user emails
- **No UUIDs Required**: All methods accept human-readable identifiers, UUIDs still supported for backwards compatibility
- **No Data Loss**: Smart chunking ensures all content is preserved, even if it exceeds Linear's limits

---

 
### Available RPC Methods

#### Issues
- `linear.issues.list` - List issues with pagination (accepts team key: "TEAM")
- `linear.issues.get` - Get issue by identifier (e.g., "TEAM-123")
- `linear.issues.create` - Create issue (accepts team key, state name, label names)
- `linear.issues.update` - Update issue (accepts issue identifier)
- `linear.issues.delete` - Archive an issue (accepts issue identifier)
- `linear.issues.markdown` - **Get full issue as markdown** (includes all comments)

#### Comments
- `linear.comments.list` - List comments with positions (accepts issue identifier)
- `linear.comments.create` - Create comment with position tracking (accepts issue identifier)

#### Projects
- `linear.projects.list` - List all projects (no UUIDs in response)
- `linear.projects.get` - Get project details (accepts project name)
- `linear.projects.create` - Create new project (accepts team keys)
- `linear.projects.update` - Update project (accepts project name)

#### Teams, Cycles, Users
- `linear.teams.list` - List all teams (returns team keys, no UUIDs)
- `linear.teams.get` - Get team details (accepts team key)
- `linear.cycles.list` - List cycles for a team (accepts team key)
- `linear.users.get` - Get user details (accepts email address)
- `linear.users.list` - List workspace users
- `linear.users.me` - Get authenticated user
- `linear.capabilities` - Get server capabilities and features

## 💡 Usage Examples

### Get Issue as Markdown
```bash
# Using identifier
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "linear.issues.markdown",
    "params": {"id": "TEAM-123"},
    "id": 1
  }'

# Response includes formatted markdown with issue details and all comments
```

### Create Issue with Human-Readable Identifiers
```bash
# Use team keys, state names, label names, and user emails
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "linear.issues.create",
    "params": {
      "title": "RFC: New Architecture",
      "description": "... 100KB of content ...",
      "teamId": "TEAM",
      "stateId": "In Progress",
      "assigneeId": "user@example.com",
      "labelIds": ["bug", "high-priority"]
    },
    "id": 2
  }'

# Response (no UUIDs):
# {"identifier": "TEAM-123", "title": "...", "url": "...", "chunked": true, "chunks": 2}
```

### Subscribe to Real-time Updates
```bash
# Connect to SSE stream
curl -N http://localhost:3000/stream \
  -H "X-Client-Id: my-client-123"

# Configure Linear webhook to POST to:
# https://your-domain.com/webhook
```

### List Issues with Human-Readable Filters
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "linear.issues.list",
    "params": {
      "teamId": "TEAM",
      "projectId": "Mobile App",
      "assigneeId": "john@example.com",
      "stateId": "Done",
      "limit": 10
    },
    "id": 3
  }'
```

### List Comments with Positions
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "linear.comments.list",
    "params": {"issueId": "TEAM-123"},
    "id": 4
  }'

# Response includes position numbers:
# {"nodes": [{"position": 1, "body": "...", "createdAt": "..."}, ...]}
```

## 🔧 Smart Content Chunking

The server implements intelligent content chunking to work around Linear's 65KB field limits:

### How It Works
1. **Paragraph-first splitting**: Tries to break on paragraph boundaries
2. **Sentence fallback**: If paragraphs are too long, splits on sentences
3. **Word-level splitting**: Last resort for extremely long content without breaks
4. **Clear indicators**: Each chunk is labeled `[Part X/Y]` with continuation notes

### Chunking Applies To
- Issue descriptions (create/update)
- Comments
- All content is preserved - nothing is ever truncated

### Example Output
```
[Part 1/3]

Your original content here...

[Continued in next comment...]

---

[Part 2/3]

Continuation of content...

[Continued in next comment...]

---

[Part 3/3]

Final part of content...
```

## 🔍 Handling Linear's Complexity Limits

Linear's GraphQL API has a complexity limit of 10,000 points per query. The server automatically:

1. Detects when queries would exceed the limit
2. Splits complex queries into multiple simpler ones
3. Assembles the results transparently
4. Falls back to raw GraphQL queries when SDK methods hit limits

## 📊 Metrics & Monitoring

Prometheus metrics available at `/metrics`:

- `mcp_rpc_requests_total` - Total RPC requests by method and status
- `mcp_rpc_latency_ms` - RPC request latency histogram
- `linear_rate_limited_total` - Rate limit hits from Linear API
- `linear_api_latency_ms` - Linear API request latency
- `mcp_sse_connections_active` - Active SSE connections
- `mcp_webhook_events_total` - Webhook events by type

## 🛡️ Security Considerations

1. **API Key**: Store in environment variables, never commit
2. **Webhook Validation**: Use `WEBHOOK_SECRET` to validate Linear webhooks
3. **Rate Limiting**: Built-in protection against Linear's API limits
4. **Input Validation**: All inputs are validated before processing

## 🚧 Limitations & Workarounds

| Limitation | Workaround |
|------------|------------|
| Linear's 65KB field limit | Automatic smart chunking into multiple comments |
| 10,000 complexity limit | Queries split automatically |
| Project descriptions can't have comments | Returns error suggesting Linear documents |
| Title length limited to 255 chars | Returns clear error message |

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 🔗 Related Links

- [Linear API Documentation](https://developers.linear.app)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io)
- [Linear TypeScript SDK](https://github.com/linear/linear)

## 🐛 Troubleshooting

### "Field membership argument userId required"
The server handles this automatically by using raw GraphQL queries for affected endpoints.

### "Query too complex"
The server automatically splits complex queries. If you still see this error, please file an issue.

### SSE Connection Drops
The server sends heartbeats every 15 seconds. Check your proxy/firewall timeout settings.

### Rate Limiting
The server implements exponential backoff. If you're hitting limits frequently, consider reducing request frequency or batch operations.
