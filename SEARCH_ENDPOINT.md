# Linear MCP Search Endpoint Documentation

## Overview

The Linear MCP server now includes a powerful search endpoint that enables full-text search across issue titles and descriptions with support for multiple filters.

## Endpoint Details

### Name
`mcp__linear__search_issues` (or `linear.issues.search` when using the LinearService directly)

### Description
Search for issues using full text search with filters for team, state, labels, and date ranges.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | The search query for full text search across issue titles and descriptions |
| `teamId` | string | No | Filter by team key (e.g., 'OPS', 'SOFT') |
| `stateId` | string | No | Filter by state name (e.g., 'Todo', 'In Progress', 'Done') |
| `labelIds` | string[] | No | Filter by label names (e.g., ['Bug', 'Feature']) |
| `createdAfter` | string | No | Filter issues created on or after this ISO-8601 date-time |
| `updatedAfter` | string | No | Filter issues updated on or after this ISO-8601 date-time |
| `includeArchived` | boolean | No | Whether to include archived issues in search results (default: false) |
| `limit` | number | No | The maximum number of results to return (default: 50) |

### Response Format

The endpoint returns a structured response containing:

```javascript
{
  nodes: [
    {
      identifier: string,      // e.g., "OPS-123"
      title: string,
      description: string,     // Truncated to 200 chars
      url: string,
      lastUpdate: string,      // Formatted date
      priority: number,
      estimate: number,
      status: string,
      stateType: string,
      assignee: string,
      team: string,           // e.g., "Operations (OPS)"
      labels: string[],
      project: string | null
    }
  ],
  pageInfo: {
    hasNextPage: boolean,
    hasPreviousPage: boolean,
    startCursor: string,
    endCursor: string
  },
  table: string,              // Formatted markdown table
  query: string,              // The search query used
  filters: {                  // Applied filters
    team: string | null,
    state: string | null,
    labels: string[] | null,
    createdAfter: string | null,
    updatedAfter: string | null
  }
}
```

## Usage Examples

### Basic Search
```javascript
// Search for all issues containing "bug"
{
  "query": "bug"
}
```

### Search with Team Filter
```javascript
// Search for "feature" in the Engineering team
{
  "query": "feature",
  "teamId": "ENG"
}
```

### Search with Multiple Filters
```javascript
// Search for "api" issues in progress with specific labels
{
  "query": "api",
  "teamId": "ENG",
  "stateId": "In Progress",
  "labelIds": ["Bug", "Backend"]
}
```

### Search with Date Filters
```javascript
// Search for recently updated issues
{
  "query": "performance",
  "updatedAfter": "2024-01-01T00:00:00Z",
  "limit": 20
}
```

### Search Including Archived Issues
```javascript
// Search all issues including archived ones
{
  "query": "legacy",
  "includeArchived": true
}
```

## Implementation Details

### GraphQL Integration
The search endpoint uses Linear's GraphQL `searchIssues` query which provides:
- Full-text search across issue titles and descriptions
- Support for complex filters
- Efficient pagination
- Rich issue data in responses

### Identifier Resolution
The endpoint automatically resolves human-readable identifiers to UUIDs:
- Team keys (e.g., 'OPS') → Team UUIDs
- State names (e.g., 'In Progress') → State UUIDs
- Label names (e.g., 'Bug') → Label UUIDs

### Error Handling
- Returns 400 error if query parameter is missing
- Returns 404 error if specified team, state, or labels are not found
- Includes detailed error messages for troubleshooting

### Performance Considerations
- Results are limited to 50 by default (configurable)
- Search queries are executed with retry logic for reliability
- Caching is used for identifier resolution to minimize API calls

## Integration with MCP

When using through the MCP protocol, the endpoint is available as `mcp__linear__search_issues` and returns formatted markdown tables for easy reading in MCP clients.

## Testing

A test script is provided at `test-search.js` that demonstrates various search scenarios:
```bash
node test-search.js
```

This will run through basic searches, filtered searches, and date-based searches to verify functionality.