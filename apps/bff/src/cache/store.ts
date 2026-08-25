import type { IState, IIssueLabel, TIssue, TPartialProject, IWorkspace, IUserLite, TIssueComment } from "@plane/types";
import type { LinearSyncSnapshot, LinearComment } from "../linear/client.js";
import {
  filterIssues,
  mapComment,
  mapIssue,
  mapLabel,
  mapLinearProject,
  mapLinearUserToPlane,
  mapState,
  mapWorkspace,
  orderCommentsForDisplay,
  resolveIssueProjectId,
  teamFallbackProjectId,
} from "../mapper/index.js";
import type { Env } from "../env.js";
import { resetProjectUserProperties } from "./user-properties.js";

export interface SyncStats {
  teams: number;
  projects: number;
  issues: number;
  states: number;
  labels: number;
  users: number;
  comments: number;
}

export interface PlaneCache {
  ready: boolean;
  lastFetchedAt: string | null;
  error: string | null;
  stats: SyncStats;
  workspace: IWorkspace | null;
  projects: TPartialProject[];
  statesByProject: Map<string, IState[]>;
  labelsByProject: Map<string, IIssueLabel[]>;
  issuesByProject: Map<string, TIssue[]>;
  commentsByIssue: Map<string, TIssueComment[]>;
  users: Map<string, IUserLite>;
  stateGroupById: Map<string, string>;
}

class CacheStore {
  cache: PlaneCache = {
    ready: false,
    lastFetchedAt: null,
    error: null,
    stats: { teams: 0, projects: 0, issues: 0, states: 0, labels: 0, users: 0, comments: 0 },
    workspace: null,
    projects: [],
    statesByProject: new Map(),
    labelsByProject: new Map(),
    issuesByProject: new Map(),
    commentsByIssue: new Map(),
    users: new Map(),
    stateGroupById: new Map(),
  };

  applySnapshot(snapshot: LinearSyncSnapshot, env: Env) {
    const workspace = mapWorkspace(snapshot, env);
    const stateGroupById = new Map<string, string>();
    const statesByTeam = new Map<string, ReturnType<typeof mapState>[]>();
    const labelsByTeam = new Map<string, ReturnType<typeof mapLabel>[]>();
    const issuesByProject = new Map<string, TIssue[]>();
    const users = new Map<string, IUserLite>();

    for (const user of snapshot.users) {
      users.set(user.id, mapLinearUserToPlane(user));
    }

    for (const state of snapshot.states) {
      stateGroupById.set(state.id, state.type);
      const list = statesByTeam.get(state.teamId) ?? [];
      list.push(mapState(state, workspace.id, state.teamId));
      statesByTeam.set(state.teamId, list);
    }

    for (const label of snapshot.labels) {
      const list = labelsByTeam.get(label.teamId) ?? [];
      list.push(mapLabel(label, workspace.id, label.teamId));
      labelsByTeam.set(label.teamId, list);
    }

    for (const issue of snapshot.issues) {
      const planeProjectId = snapshot.projects.length > 0 ? resolveIssueProjectId(issue) : issue.teamId;
      const group = stateGroupById.get(issue.stateId);
      const mapped = mapIssue(issue, group);
      const list = issuesByProject.get(planeProjectId) ?? [];
      list.push(mapped);
      issuesByProject.set(planeProjectId, list);
    }

    const teamById = new Map(snapshot.teams.map((team) => [team.id, team]));
    const projects: TPartialProject[] = [];
    const statesByProject = new Map<string, IState[]>();
    const labelsByProject = new Map<string, IIssueLabel[]>();

    const assignTeamMetadata = (planeProjectId: string, teamId: string) => {
      const teamStates = statesByTeam.get(teamId) ?? [];
      statesByProject.set(
        planeProjectId,
        teamStates.map((state) => Object.assign({}, state, { project_id: planeProjectId }))
      );
      const teamLabels = labelsByTeam.get(teamId) ?? [];
      labelsByProject.set(
        planeProjectId,
        teamLabels.map((label) => Object.assign({}, label, { project_id: planeProjectId }))
      );
    };

    if (snapshot.projects.length > 0) {
      const projectsPerTeam = new Map<string, number>();
      for (const linearProject of snapshot.projects) {
        const teamId = linearProject.primaryTeamId;
        const team = teamById.get(teamId);
        const teamKey = linearProject.primaryTeamKey || team?.key || "PRJ";
        const teamIndex = projectsPerTeam.get(teamId) ?? 0;
        projectsPerTeam.set(teamId, teamIndex + 1);
        const identifier = teamIndex === 0 ? teamKey : `${teamKey}${teamIndex + 1}`;

        projects.push(
          mapLinearProject(linearProject, identifier, workspace.id, issuesByProject.get(linearProject.id)?.length ?? 0)
        );
        assignTeamMetadata(linearProject.id, teamId);
      }

      for (const team of snapshot.teams) {
        const fallbackId = teamFallbackProjectId(team.id);
        const unassignedCount = issuesByProject.get(fallbackId)?.length ?? 0;
        if (unassignedCount === 0) continue;
        projects.push(
          mapLinearProject(
            { id: fallbackId, name: `${team.name} (No Project)`, description: team.description },
            team.key,
            workspace.id,
            unassignedCount
          )
        );
        assignTeamMetadata(fallbackId, team.id);
      }
    } else {
      for (const team of snapshot.teams) {
        const projectId = team.id;
        projects.push(mapLinearProject(team, team.key, workspace.id, issuesByProject.get(projectId)?.length ?? 0));
        assignTeamMetadata(projectId, team.id);
        const fallbackIssues = issuesByProject.get(teamFallbackProjectId(team.id));
        if (fallbackIssues?.length) {
          issuesByProject.set(projectId, [...(issuesByProject.get(projectId) ?? []), ...fallbackIssues]);
          issuesByProject.delete(teamFallbackProjectId(team.id));
        }
      }
    }

    const commentsByIssueRaw = new Map<string, LinearComment[]>();
    for (const comment of snapshot.comments) {
      const list = commentsByIssueRaw.get(comment.issueId) ?? [];
      list.push(comment);
      commentsByIssueRaw.set(comment.issueId, list);
    }

    const commentsByIssue = new Map<string, TIssueComment[]>();
    const issueLookup = new Map<string, { issue: TIssue; projectId: string }>();
    for (const [projectId, issues] of issuesByProject) {
      for (const issue of issues) {
        issueLookup.set(issue.id, { issue, projectId });
      }
    }
    const projectById = new Map(projects.map((project) => [project.id, project]));

    for (const [issueId, issueComments] of commentsByIssueRaw) {
      const ref = issueLookup.get(issueId);
      if (!ref) continue;
      const project = projectById.get(ref.projectId);
      if (!project) continue;

      const mappedComments: TIssueComment[] = [];
      for (const comment of orderCommentsForDisplay(issueComments)) {
        if (!comment.userId) continue;
        const actor = users.get(comment.userId);
        if (!actor) continue;
        mappedComments.push(mapComment(comment, { workspace, project, issue: ref.issue, actor }));
      }
      if (mappedComments.length > 0) commentsByIssue.set(issueId, mappedComments);
    }

    this.cache = {
      ready: true,
      lastFetchedAt: new Date().toISOString(),
      error: null,
      stats: {
        teams: snapshot.teams.length,
        projects: projects.length,
        issues: snapshot.issues.length,
        states: snapshot.states.length,
        labels: snapshot.labels.length,
        users: snapshot.users.length,
        comments: snapshot.comments.length,
      },
      workspace,
      projects,
      statesByProject,
      labelsByProject,
      issuesByProject,
      commentsByIssue,
      users,
      stateGroupById,
    };
  }

  setError(message: string) {
    this.cache.error = message;
  }

  getWorkspaceStates(): IState[] {
    return [...this.cache.statesByProject.values()].flat();
  }

  getAllIssues(): TIssue[] {
    return [...this.cache.issuesByProject.values()].flat();
  }

  getProjectIssues(projectId: string, query: Record<string, string | undefined> = {}): TIssue[] {
    const issues = this.cache.issuesByProject.get(projectId) ?? [];
    return filterIssues(issues, query);
  }

  getWorkspaceIssues(query: Record<string, string | undefined> = {}): TIssue[] {
    return filterIssues(this.getAllIssues(), query);
  }

  getUserIssues(userId: string, query: Record<string, string | undefined> = {}): TIssue[] {
    const mergedQuery = { ...query };
    if (query.assignees) {
      mergedQuery.assignees = query.assignees;
    } else if (query.created_by) {
      mergedQuery.created_by = query.created_by;
    } else if (query.subscriber) {
      mergedQuery.subscriber = query.subscriber;
    } else {
      mergedQuery.assignees = userId;
    }
    return filterIssues(this.getAllIssues(), mergedQuery);
  }

  getIssue(projectId: string, issueId: string): TIssue | undefined {
    return this.cache.issuesByProject.get(projectId)?.find((i) => i.id === issueId);
  }

  getIssueComments(projectId: string, issueId: string, createdAfter?: string): TIssueComment[] {
    if (!this.getIssue(projectId, issueId)) return [];
    const comments = this.cache.commentsByIssue.get(issueId) ?? [];
    if (!createdAfter) return comments;
    return comments.filter((comment) => comment.created_at > createdAfter);
  }

  findIssueByIdentifier(identifier: string): { issue: TIssue; projectId: string } | undefined {
    const match = identifier.match(/^([A-Z]+)-(\d+)$/);
    if (!match) return undefined;

    const [, projectKey, sequenceRaw] = match;
    const sequence = Number(sequenceRaw);
    const project = this.cache.projects.find((p) => p.identifier === projectKey);
    if (!project) return undefined;

    const issue = this.cache.issuesByProject.get(project.id)?.find((i) => i.sequence_id === sequence);
    if (!issue) return undefined;

    return { issue, projectId: project.id };
  }

  reset() {
    resetProjectUserProperties();
    this.cache = {
      ready: false,
      lastFetchedAt: null,
      error: null,
      stats: { teams: 0, projects: 0, issues: 0, states: 0, labels: 0, users: 0, comments: 0 },
      workspace: null,
      projects: [],
      statesByProject: new Map(),
      labelsByProject: new Map(),
      issuesByProject: new Map(),
      commentsByIssue: new Map(),
      users: new Map(),
      stateGroupById: new Map(),
    };
  }
}

export const cacheStore = new CacheStore();
