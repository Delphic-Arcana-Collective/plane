import type { Env } from "../env.js";

export type LinearWorkflowStateType = "backlog" | "unstarted" | "started" | "completed" | "cancelled";

export interface LinearOrganization {
  id: string;
  name: string;
  urlKey: string;
}

export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  description?: string | null;
}

export interface LinearProject {
  id: string;
  name: string;
  description?: string | null;
  slugId: string;
  teamIds: string[];
  primaryTeamId: string;
  primaryTeamKey: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  color: string;
  position: number;
  type: LinearWorkflowStateType;
  teamId: string;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
  teamId: string;
}

export interface LinearComment {
  id: string;
  issueId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  parentId: string | null;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  dueDate?: string | null;
  estimate?: number | null;
  teamId: string;
  projectId: string | null;
  stateId: string;
  assigneeId?: string | null;
  labelIds: string[];
  parentId?: string | null;
  subIssuesCount: number;
  createdById: string;
}

export interface LinearSyncSnapshot {
  organization: LinearOrganization;
  teams: LinearTeam[];
  projects: LinearProject[];
  states: LinearWorkflowState[];
  labels: LinearLabel[];
  issues: LinearIssue[];
  comments: LinearComment[];
  users: LinearUser[];
}

export const LINEAR_TEAM_FALLBACK_PROJECT_PREFIX = "linear-team:";

const TEAM_SYNC_QUERY = `
  query BffTeamSync($teamId: String!, $after: String) {
    team(id: $teamId) {
      id
      key
      name
      description
      states {
        nodes {
          id
          name
          color
          position
          type
        }
      }
      labels {
        nodes {
          id
          name
          color
        }
      }
      issues(first: 50, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          identifier
          title
          description
          priority
          sortOrder
          createdAt
          updatedAt
          dueDate
          estimate
          project {
            id
            name
          }
          state {
            id
          }
          assignee {
            id
            name
            displayName
            email
            avatarUrl
          }
          creator {
            id
            name
            displayName
            email
            avatarUrl
          }
          labels {
            nodes {
              id
            }
          }
          parent {
            id
          }
          children {
            nodes {
              id
            }
          }
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              updatedAt
              parent {
                id
              }
              user {
                id
                name
                displayName
                email
                avatarUrl
              }
            }
          }
        }
      }
    }
  }
`;

const ORG_QUERY = `
  query BffOrg {
    organization {
      id
      name
      urlKey
    }
    teams {
      nodes {
        id
        key
        name
        description
      }
    }
    projects(first: 100) {
      nodes {
        id
        name
        description
        slugId
        teams {
          nodes {
            id
            key
            name
          }
        }
      }
    }
  }
`;

async function linearGraphql<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  return json.data as T;
}

function parseTeamPage(teamNode: Record<string, unknown>, teamId: string) {
  const states = ((teamNode.states as { nodes: Record<string, unknown>[] })?.nodes ?? []).map((state) => ({
    id: state.id as string,
    name: state.name as string,
    color: state.color as string,
    position: state.position as number,
    type: state.type as LinearWorkflowStateType,
    teamId,
  }));

  const labels = ((teamNode.labels as { nodes: Record<string, unknown>[] })?.nodes ?? []).map((label) => ({
    id: label.id as string,
    name: label.name as string,
    color: label.color as string,
    teamId,
  }));

  const issuesConnection = teamNode.issues as {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Record<string, unknown>[];
  };

  const usersMap = new Map<string, LinearUser>();
  const addUser = (user: Record<string, unknown> | null | undefined) => {
    if (!user?.id) return;
    usersMap.set(user.id as string, {
      id: user.id as string,
      name: user.name as string,
      displayName: user.displayName as string,
      email: user.email as string,
      avatarUrl: (user.avatarUrl as string | null) ?? null,
    });
  };

  const issues: LinearIssue[] = [];
  const comments: LinearComment[] = [];

  for (const issueNode of issuesConnection?.nodes ?? []) {
    addUser(issueNode.assignee as Record<string, unknown>);
    addUser(issueNode.creator as Record<string, unknown>);

    const labelIds = ((issueNode.labels as { nodes: { id: string }[] })?.nodes ?? []).map((l) => l.id);
    const children = (issueNode.children as { nodes: { id: string }[] })?.nodes ?? [];
    const project = issueNode.project as { id: string; name?: string } | null | undefined;
    const issueId = issueNode.id as string;

    for (const commentNode of (issueNode.comments as { nodes: Record<string, unknown>[] } | undefined)?.nodes ?? []) {
      const user = commentNode.user as Record<string, unknown> | undefined;
      addUser(user);
      comments.push({
        id: commentNode.id as string,
        issueId,
        body: (commentNode.body as string) ?? "",
        createdAt: commentNode.createdAt as string,
        updatedAt: commentNode.updatedAt as string,
        userId: (user?.id as string) ?? "",
        parentId: (commentNode.parent as { id: string } | null)?.id ?? null,
      });
    }

    issues.push({
      id: issueId,
      identifier: issueNode.identifier as string,
      title: issueNode.title as string,
      description: (issueNode.description as string | null) ?? null,
      priority: issueNode.priority as number,
      sortOrder: issueNode.sortOrder as number,
      createdAt: issueNode.createdAt as string,
      updatedAt: issueNode.updatedAt as string,
      dueDate: (issueNode.dueDate as string | null) ?? null,
      estimate: (issueNode.estimate as number | null) ?? null,
      teamId,
      projectId: project?.id ?? null,
      stateId: (issueNode.state as { id: string }).id,
      assigneeId: (issueNode.assignee as { id: string } | null)?.id ?? null,
      labelIds,
      parentId: (issueNode.parent as { id: string } | null)?.id ?? null,
      subIssuesCount: children.length,
      createdById: (issueNode.creator as { id: string }).id,
    } satisfies LinearIssue);
  }

  return {
    states,
    labels,
    issues,
    comments,
    users: [...usersMap.values()],
    hasMore: issuesConnection?.pageInfo?.hasNextPage ?? false,
    endCursor: issuesConnection?.pageInfo?.endCursor ?? null,
  };
}

async function syncTeam(apiKey: string, team: LinearTeam) {
  const states: LinearWorkflowState[] = [];
  const labels: LinearLabel[] = [];
  const issues: LinearIssue[] = [];
  const comments: LinearComment[] = [];
  const users = new Map<string, LinearUser>();

  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- paginated GraphQL cursor
    const data = await linearGraphql<{ team: Record<string, unknown> }>(apiKey, TEAM_SYNC_QUERY, {
      teamId: team.id,
      after: cursor,
    });

    const page = parseTeamPage(data.team, team.id);
    states.push(...page.states);
    labels.push(...page.labels);
    issues.push(...page.issues);
    comments.push(...page.comments);
    for (const user of page.users) {
      users.set(user.id, user);
    }

    hasMore = page.hasMore;
    cursor = page.endCursor;
  }

  return { states, labels, issues, comments, users: [...users.values()] };
}

function parseLinearProjects(
  nodes: Array<{
    id: string;
    name: string;
    description?: string | null;
    slugId: string;
    teams: { nodes: Array<{ id: string; key: string; name: string }> };
  }>
): LinearProject[] {
  return nodes.map((project) => {
    const teams = project.teams?.nodes ?? [];
    const primaryTeam = teams[0];
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      slugId: project.slugId,
      teamIds: teams.map((team) => team.id),
      primaryTeamId: primaryTeam?.id ?? "",
      primaryTeamKey: primaryTeam?.key ?? "PRJ",
    };
  });
}

export async function fetchLinearSnapshot(env: Env): Promise<LinearSyncSnapshot> {
  const apiKey = env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY is required for sync");
  }

  const orgData = await linearGraphql<{
    organization: LinearOrganization;
    teams: { nodes: LinearTeam[] };
    projects: {
      nodes: Array<{
        id: string;
        name: string;
        description?: string | null;
        slugId: string;
        teams: { nodes: Array<{ id: string; key: string; name: string }> };
      }>;
    };
  }>(apiKey, ORG_QUERY);

  const organization = orgData.organization;
  if (env.LINEAR_WORKSPACE_ID && organization.id !== env.LINEAR_WORKSPACE_ID) {
    throw new Error(`Organization mismatch: expected ${env.LINEAR_WORKSPACE_ID}, got ${organization.id}`);
  }

  const teams = orgData.teams.nodes;
  const projects = parseLinearProjects(orgData.projects?.nodes ?? []);
  const allStates: LinearWorkflowState[] = [];
  const allLabels: LinearLabel[] = [];
  const allIssues: LinearIssue[] = [];
  const allComments: LinearComment[] = [];
  const allUsers = new Map<string, LinearUser>();

  for (const team of teams) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sync teams sequentially to respect rate limits
    const result = await syncTeam(apiKey, team);
    allStates.push(...result.states);
    allLabels.push(...result.labels);
    allIssues.push(...result.issues);
    allComments.push(...result.comments);
    for (const user of result.users) {
      allUsers.set(user.id, user);
    }
  }

  return {
    organization,
    teams,
    projects,
    states: allStates,
    labels: allLabels,
    issues: allIssues,
    comments: allComments,
    users: [...allUsers.values()],
  };
}
