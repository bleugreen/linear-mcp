export interface McpCapabilities {
  methods: string[];
  notifications: string[];
  version: string;
}

export interface McpNotification {
  type: 'mcp.notification';
  method: string;
  params: {
    entityType: 'issue' | 'comment' | 'project' | 'cycle';
    entityId: string;
    action: 'created' | 'updated' | 'deleted';
    data: any;
    timestamp: string;
  };
}