import { LinearClient } from '@linear/sdk';
import { ApiError } from '../middleware/error-handler';
import { JsonRpcErrorCodes } from '../types/json-rpc';
import { logger } from '../utils/logger';

interface ResolverCache {
  teams: Map<string, string>;
  projects: Map<string, string>;
  states: Map<string, Map<string, string>>;
  labels: Map<string, Map<string, string>>;
  users: Map<string, string>;
}

export class IdentifierResolver {
  private client: LinearClient;
  private cache: ResolverCache = {
    teams: new Map(),
    projects: new Map(),
    states: new Map(),
    labels: new Map(),
    users: new Map(),
  };
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private lastCacheRefresh = 0;

  constructor(client: LinearClient) {
    this.client = client;
  }

  private shouldRefreshCache(): boolean {
    return Date.now() - this.lastCacheRefresh > this.cacheTimeout;
  }

  async resolveTeamId(teamKeyOrId: string): Promise<string> {
    // If it looks like a UUID, return as-is
    if (teamKeyOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return teamKeyOrId;
    }

    // Check cache
    if (!this.shouldRefreshCache() && this.cache.teams.has(teamKeyOrId)) {
      return this.cache.teams.get(teamKeyOrId)!;
    }

    // Fetch from API using raw GraphQL to avoid membership field
    const query = `
      query TeamByKey($key: String!) {
        teams(filter: { key: { eq: $key } }, first: 1) {
          nodes {
            id
            key
          }
        }
      }
    `;

    const response = await (this.client as any).client.rawRequest(query, { key: teamKeyOrId });
    const teams = response.data.teams.nodes;

    if (teams.length === 0) {
      throw new ApiError(404, `Team with key "${teamKeyOrId}" not found`, JsonRpcErrorCodes.INVALID_PARAMS);
    }

    const teamId = teams[0].id;
    this.cache.teams.set(teamKeyOrId, teamId);
    return teamId;
  }

  async resolveProjectId(projectNameOrId: string, teamId?: string): Promise<string> {
    // If it looks like a UUID, return as-is
    if (projectNameOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return projectNameOrId;
    }

    const cacheKey = teamId ? `${teamId}:${projectNameOrId}` : projectNameOrId;
    
    // Check cache
    if (!this.shouldRefreshCache() && this.cache.projects.has(cacheKey)) {
      return this.cache.projects.get(cacheKey)!;
    }

    // Fetch from API using raw GraphQL
    let query: string;
    let variables: any;

    if (teamId) {
      query = `
        query ProjectsByNameAndTeam($name: String!, $teamId: String!) {
          projects(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }, first: 1) {
            nodes {
              id
              name
            }
          }
        }
      `;
      variables = { name: projectNameOrId, teamId };
    } else {
      query = `
        query ProjectsByName($name: String!) {
          projects(filter: { name: { eq: $name } }, first: 1) {
            nodes {
              id
              name
            }
          }
        }
      `;
      variables = { name: projectNameOrId };
    }

    const response = await (this.client as any).client.rawRequest(query, variables);
    const projects = response.data.projects.nodes;

    if (projects.length === 0) {
      const context = teamId ? ` in team ${teamId}` : '';
      throw new ApiError(404, `Project "${projectNameOrId}"${context} not found`, JsonRpcErrorCodes.INVALID_PARAMS);
    }

    const projectId = projects[0].id;
    this.cache.projects.set(cacheKey, projectId);
    return projectId;
  }

  async resolveStateId(stateNameOrId: string, teamId: string): Promise<string> {
    // If it looks like a UUID, return as-is
    if (stateNameOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return stateNameOrId;
    }

    if (!teamId) {
      throw new ApiError(400, 'Team ID is required to resolve state names', JsonRpcErrorCodes.INVALID_PARAMS);
    }

    // Check cache
    const teamStates = this.cache.states.get(teamId);
    if (!this.shouldRefreshCache() && teamStates?.has(stateNameOrId)) {
      return teamStates.get(stateNameOrId)!;
    }

    // Fetch from API using raw GraphQL to avoid membership field
    const query = `
      query TeamStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes {
              id
              name
            }
          }
        }
      }
    `;

    const response = await (this.client as any).client.rawRequest(query, { teamId });
    const states = response.data.team?.states?.nodes || [];

    const state = states.find((s: any) => s.name.toLowerCase() === stateNameOrId.toLowerCase());
    if (!state) {
      throw new ApiError(404, `State "${stateNameOrId}" not found in team`, JsonRpcErrorCodes.INVALID_PARAMS);
    }

    // Update cache
    if (!this.cache.states.has(teamId)) {
      this.cache.states.set(teamId, new Map());
    }
    this.cache.states.get(teamId)!.set(stateNameOrId, state.id);
    
    return state.id;
  }

  async resolveLabelIds(labelNamesOrIds: string[], teamId: string): Promise<string[]> {
    if (!teamId) {
      throw new ApiError(400, 'Team ID is required to resolve label names', JsonRpcErrorCodes.INVALID_PARAMS);
    }

    const resolvedIds: string[] = [];
    const namesToResolve: string[] = [];

    // Separate UUIDs from names
    for (const labelNameOrId of labelNamesOrIds) {
      if (labelNameOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        resolvedIds.push(labelNameOrId);
      } else {
        namesToResolve.push(labelNameOrId);
      }
    }

    if (namesToResolve.length === 0) {
      return resolvedIds;
    }

    // Check cache
    const teamLabels = this.cache.labels.get(teamId);
    const uncachedNames: string[] = [];

    if (!this.shouldRefreshCache() && teamLabels) {
      for (const name of namesToResolve) {
        const cachedId = teamLabels.get(name);
        if (cachedId) {
          resolvedIds.push(cachedId);
        } else {
          uncachedNames.push(name);
        }
      }
    } else {
      uncachedNames.push(...namesToResolve);
    }

    if (uncachedNames.length === 0) {
      return resolvedIds;
    }

    // Fetch from API using raw GraphQL to avoid membership field
    const query = `
      query TeamLabels($teamId: String!) {
        team(id: $teamId) {
          labels {
            nodes {
              id
              name
            }
          }
        }
      }
    `;

    const response = await (this.client as any).client.rawRequest(query, { teamId });
    const labels = response.data.team?.labels?.nodes || [];

    // Update cache
    if (!this.cache.labels.has(teamId)) {
      this.cache.labels.set(teamId, new Map());
    }
    const labelCache = this.cache.labels.get(teamId)!;

    for (const name of uncachedNames) {
      const label = labels.find((l: any) => l.name.toLowerCase() === name.toLowerCase());
      if (!label) {
        throw new ApiError(404, `Label "${name}" not found in team`, JsonRpcErrorCodes.INVALID_PARAMS);
      }
      labelCache.set(name, label.id);
      resolvedIds.push(label.id);
    }

    return resolvedIds;
  }

  async resolveUserId(userEmailOrId: string): Promise<string> {
    // If it looks like a UUID, return as-is
    if (userEmailOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return userEmailOrId;
    }

    // Check cache
    if (!this.shouldRefreshCache() && this.cache.users.has(userEmailOrId)) {
      return this.cache.users.get(userEmailOrId)!;
    }

    // Fetch from API using raw GraphQL
    const query = `
      query UserByEmail($email: String!) {
        users(filter: { email: { eq: $email } }, first: 1) {
          nodes {
            id
            email
          }
        }
      }
    `;

    const response = await (this.client as any).client.rawRequest(query, { email: userEmailOrId });
    const users = response.data.users.nodes;

    if (users.length === 0) {
      throw new ApiError(404, `User with email "${userEmailOrId}" not found`, JsonRpcErrorCodes.INVALID_PARAMS);
    }

    const userId = users[0].id;
    this.cache.users.set(userEmailOrId, userId);
    return userId;
  }

  async resolveIssueId(issueIdentifierOrId: string): Promise<string> {
    // If it looks like a UUID, return as-is
    if (issueIdentifierOrId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return issueIdentifierOrId;
    }

    // If it's an identifier like TEAM-123
    if (issueIdentifierOrId.includes('-')) {
      const [teamKey, numberStr] = issueIdentifierOrId.split('-');
      const number = parseInt(numberStr);
      
      if (isNaN(number)) {
        throw new ApiError(400, `Invalid issue identifier format: ${issueIdentifierOrId}`, JsonRpcErrorCodes.INVALID_PARAMS);
      }

      const query = `
        query IssueByIdentifier($teamKey: String!, $number: Float!) {
          teams(filter: { key: { eq: $teamKey } }) {
            nodes {
              issues(filter: { number: { eq: $number } }, first: 1) {
                nodes {
                  id
                }
              }
            }
          }
        }
      `;
      
      const response = await (this.client as any).client.rawRequest(query, { teamKey, number });
      const team = response.data.teams.nodes[0];
      
      if (!team || team.issues.nodes.length === 0) {
        throw new ApiError(404, `Issue ${issueIdentifierOrId} not found`, JsonRpcErrorCodes.INVALID_PARAMS);
      }
      
      return team.issues.nodes[0].id;
    }

    throw new ApiError(400, `Invalid issue identifier format: ${issueIdentifierOrId}`, JsonRpcErrorCodes.INVALID_PARAMS);
  }

  clearCache() {
    this.cache = {
      teams: new Map(),
      projects: new Map(),
      states: new Map(),
      labels: new Map(),
      users: new Map(),
    };
    this.lastCacheRefresh = 0;
    logger.info('Identifier resolver cache cleared');
  }
}