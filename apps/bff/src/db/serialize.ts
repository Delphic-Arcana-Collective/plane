import type { IState, IIssueLabel, TIssue, TPartialProject, IWorkspace, IUserLite, TIssueComment } from "@plane/types";
import type { PlaneCache } from "../cache/backend.js";
import type { DataSource, SystemTag } from "./constants.js";
import { DATA_SOURCE_LINEAR, DATA_SOURCE_PLANE, TAG_PLANE, rowId, tagForSource } from "./constants.js";
import type { LinearSyncSnapshot } from "../linear/client.js";
import type { Env } from "../env.js";
import { buildPlaneCacheFromSnapshot } from "../cache/snapshot.js";

export interface PersistedRow {
  id: string;
  workspace_id: string;
  source: DataSource;
  external_id: string;
  tag: string;
  payload: string;
  updated_at: string;
}

export interface ProjectRow extends PersistedRow {
  name: string;
}

export interface IssueRow extends PersistedRow {
  project_id: string;
  project_name: string;
}

export interface CommentRow extends PersistedRow {
  issue_id: string;
}

export interface StateRow extends PersistedRow {
  project_id: string;
}

export interface LabelRow extends PersistedRow {
  project_id: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

/** Embed source/system_tag on entity payloads for UI distinction after D1 round-trip. */
export function attachSourceMetadata<T extends object>(
  entity: T,
  source: DataSource
): T & { source: DataSource; system_tag: SystemTag; tag: SystemTag } {
  const tag = tagForSource(source);
  return { ...entity, source, system_tag: tag, tag };
}

function serializePayload(entity: object, source: DataSource): string {
  return JSON.stringify(attachSourceMetadata(entity, source));
}

/**
 * Team workflow states/labels are copied onto every Linear project that uses the team
 * (see assignTeamMetadata). D1 UNIQUE(workspace_id, source, external_id) would otherwise
 * keep only one project's copy — scope the storage key by project.
 */
export function projectScopedExternalId(projectExternalId: string, entityId: string): string {
  return `${projectExternalId}:${entityId}`;
}

export function planeCacheToRows(
  cache: PlaneCache,
  workspaceId: string,
  source: DataSource
): {
  workspace: { id: string; slug: string; name: string; payload: string; updated_at: string } | null;
  projects: ProjectRow[];
  states: StateRow[];
  labels: LabelRow[];
  users: PersistedRow[];
  issues: IssueRow[];
  comments: CommentRow[];
} {
  const tag = tagForSource(source);
  const updatedAt = nowIso();
  const workspace = cache.workspace
    ? {
        id: workspaceId,
        slug: cache.workspace.slug,
        name: cache.workspace.name,
        payload: JSON.stringify(cache.workspace),
        updated_at: updatedAt,
      }
    : null;

  const projects: ProjectRow[] = cache.projects.map((project) => ({
    id: rowId(source, project.id),
    workspace_id: workspaceId,
    name: project.name,
    source,
    external_id: project.id,
    tag,
    payload: serializePayload(project, source),
    updated_at: updatedAt,
  }));

  const projectIdMap = new Map(projects.map((p) => [parseJson<TPartialProject>(p.payload).id, p.id]));
  const projectNameMap = new Map(projects.map((p) => [parseJson<TPartialProject>(p.payload).id, p.name]));

  const states: StateRow[] = [];
  for (const [projectExternalId, stateList] of cache.statesByProject.entries()) {
    const projectId = projectIdMap.get(projectExternalId) ?? rowId(source, projectExternalId);
    for (const state of stateList) {
      const scopedId = projectScopedExternalId(projectExternalId, state.id);
      states.push({
        id: rowId(source, scopedId),
        workspace_id: workspaceId,
        project_id: projectId,
        source,
        external_id: scopedId,
        tag,
        payload: serializePayload({ ...state, project_id: projectExternalId }, source),
        updated_at: updatedAt,
      });
    }
  }

  const labels: LabelRow[] = [];
  for (const [projectExternalId, labelList] of cache.labelsByProject.entries()) {
    const projectId = projectIdMap.get(projectExternalId) ?? rowId(source, projectExternalId);
    for (const label of labelList) {
      const scopedId = projectScopedExternalId(projectExternalId, label.id);
      labels.push({
        id: rowId(source, scopedId),
        workspace_id: workspaceId,
        project_id: projectId,
        source,
        external_id: scopedId,
        tag,
        payload: serializePayload({ ...label, project_id: projectExternalId }, source),
        updated_at: updatedAt,
      });
    }
  }

  const users: PersistedRow[] = [...cache.users.values()].map((user) => ({
    id: rowId(source, user.id),
    workspace_id: workspaceId,
    source,
    external_id: user.id,
    tag,
    payload: serializePayload(user, source),
    updated_at: updatedAt,
  }));

  const issues: IssueRow[] = [];
  for (const [projectExternalId, issueList] of cache.issuesByProject.entries()) {
    const projectId = projectIdMap.get(projectExternalId) ?? rowId(source, projectExternalId);
    const projectName = projectNameMap.get(projectExternalId) ?? projectExternalId;
    for (const issue of issueList) {
      issues.push({
        id: rowId(source, issue.id),
        workspace_id: workspaceId,
        project_id: projectId,
        project_name: projectName,
        source,
        external_id: issue.id,
        tag,
        payload: serializePayload(issue, source),
        updated_at: updatedAt,
      });
    }
  }

  const comments: CommentRow[] = [];
  for (const [issueExternalId, commentList] of cache.commentsByIssue.entries()) {
    for (const comment of commentList) {
      comments.push({
        id: rowId(source, comment.id),
        workspace_id: workspaceId,
        issue_id: rowId(source, issueExternalId),
        source,
        external_id: comment.id,
        tag,
        payload: serializePayload(comment, source),
        updated_at: updatedAt,
      });
    }
  }

  return { workspace, projects, states, labels, users, issues, comments };
}

export function rowsToPlaneCache(
  workspaceRow: { payload: string } | null,
  projectRows: ProjectRow[],
  stateRows: StateRow[],
  labelRows: LabelRow[],
  userRows: PersistedRow[],
  issueRows: IssueRow[],
  commentRows: CommentRow[]
): PlaneCache {
  const workspace = workspaceRow ? parseJson<IWorkspace>(workspaceRow.payload) : null;

  const projectsByName = new Map<string, TPartialProject[]>();

  for (const row of projectRows) {
    const project = parseJson<TPartialProject>(row.payload);
    const list = projectsByName.get(row.name) ?? [];
    list.push(project);
    projectsByName.set(row.name, list);
  }

  const projects: TPartialProject[] = [];
  /** Prefer Linear as the sidebar canonical when names collide. */
  for (const [, group] of projectsByName) {
    const preferred =
      group.find((p) => (p as TPartialProject & { source?: string }).source === DATA_SOURCE_LINEAR) ??
      group.find((p) => (p as TPartialProject & { source?: string }).source === DATA_SOURCE_PLANE) ??
      group.find((p) => p.id && !String(p.id).startsWith("linear-team:") && !String(p.id).includes("linear")) ??
      group[0];
    if (preferred) projects.push(preferred);
  }

  // States/labels stored per project (project-scoped external_id). Merge across namesakes
  // and index under EVERY namesake id — same rule as issues.
  const statesBySourceProject = new Map<string, IState[]>();
  for (const row of stateRows) {
    const state = parseJson<IState>(row.payload);
    const projectRow = projectRows.find((p) => p.id === row.project_id);
    const project = projectRow ? parseJson<TPartialProject>(projectRow.payload) : null;
    const sourceProjectId = project?.id ?? state.project_id ?? row.project_id;
    const list = statesBySourceProject.get(sourceProjectId) ?? [];
    if (!list.some((s) => s.id === state.id)) list.push(state);
    statesBySourceProject.set(sourceProjectId, list);
  }

  const labelsBySourceProject = new Map<string, IIssueLabel[]>();
  for (const row of labelRows) {
    const label = parseJson<IIssueLabel>(row.payload);
    const projectRow = projectRows.find((p) => p.id === row.project_id);
    const project = projectRow ? parseJson<TPartialProject>(projectRow.payload) : null;
    const sourceProjectId = project?.id ?? label.project_id ?? row.project_id;
    const list = labelsBySourceProject.get(sourceProjectId) ?? [];
    if (!list.some((l) => l.id === label.id)) list.push(label);
    labelsBySourceProject.set(sourceProjectId, list);
  }

  const statesByProject = new Map<string, IState[]>();
  const labelsByProject = new Map<string, IIssueLabel[]>();
  for (const [, group] of projectsByName) {
    const mergedStates: IState[] = [];
    const mergedLabels: IIssueLabel[] = [];
    for (const p of group) {
      for (const s of statesBySourceProject.get(p.id) ?? []) {
        if (!mergedStates.some((x) => x.id === s.id)) mergedStates.push(s);
      }
      for (const l of labelsBySourceProject.get(p.id) ?? []) {
        if (!mergedLabels.some((x) => x.id === l.id)) mergedLabels.push(l);
      }
    }
    for (const p of group) {
      statesByProject.set(
        p.id,
        mergedStates.map((s) => Object.assign({}, s, { project_id: p.id }))
      );
      labelsByProject.set(
        p.id,
        mergedLabels.map((l) => Object.assign({}, l, { project_id: p.id }))
      );
    }
  }

  for (const [projectId, list] of statesBySourceProject) {
    if (statesByProject.has(projectId)) continue;
    statesByProject.set(
      projectId,
      list.map((s) => Object.assign({}, s, { project_id: projectId }))
    );
  }
  for (const [projectId, list] of labelsBySourceProject) {
    if (labelsByProject.has(projectId)) continue;
    labelsByProject.set(
      projectId,
      list.map((l) => Object.assign({}, l, { project_id: projectId }))
    );
  }

  const users = new Map<string, IUserLite>();
  for (const row of userRows) {
    const user = parseJson<IUserLite>(row.payload);
    users.set(user.id, user);
  }

  const issuesByProject = new Map<string, TIssue[]>();
  const issuesByName = new Map<string, TIssue[]>();
  for (const row of issueRows) {
    const issue = parseJson<TIssue>(row.payload);
    // Plane writes may omit timestamps; list UI historically keyed off created_at.
    if (!issue.created_at) issue.created_at = row.updated_at || "2026-01-01T00:00:00.000Z";
    if (!issue.updated_at) issue.updated_at = row.updated_at || issue.created_at;
    const list = issuesByName.get(row.project_name) ?? [];
    if (!list.some((i) => i.id === issue.id)) list.push(issue);
    issuesByName.set(row.project_name, list);
  }

  // Same project name → merge Linear + Plane issues; index under every namesake project id.
  for (const [name, group] of projectsByName) {
    const merged = issuesByName.get(name) ?? [];
    for (const p of group) {
      issuesByProject.set(p.id, merged);
    }
  }

  for (const [orphanName, list] of issuesByName) {
    if (projectsByName.has(orphanName)) continue;
    if (list.length === 0) continue;
    const syntheticId = list[0]?.project_id ?? orphanName;
    issuesByProject.set(syntheticId, list);
  }

  const commentsByIssue = new Map<string, TIssueComment[]>();
  for (const row of commentRows) {
    const comment = parseJson<TIssueComment>(row.payload);
    const issueExternalId = row.issue_id.includes(":") ? row.issue_id.split(":").slice(1).join(":") : row.issue_id;
    const list = commentsByIssue.get(issueExternalId) ?? [];
    list.push(comment);
    commentsByIssue.set(issueExternalId, list);
  }

  const stats = {
    teams: projects.length,
    projects: projects.length,
    issues: issueRows.length,
    states: stateRows.length,
    labels: labelRows.length,
    users: userRows.length,
    comments: commentRows.length,
  };

  return {
    ready: projects.length > 0 || issueRows.length > 0,
    lastFetchedAt: nowIso(),
    error: null,
    stats,
    workspace,
    projects,
    statesByProject,
    labelsByProject,
    issuesByProject,
    commentsByIssue,
    users,
    stateGroupById: new Map(),
  };
}

export function snapshotToLinearRows(snapshot: LinearSyncSnapshot, env: Env, workspaceId: string) {
  const cache = buildPlaneCacheFromSnapshot(snapshot, env);
  return planeCacheToRows(cache, workspaceId, DATA_SOURCE_LINEAR);
}

export function planeIssueToRow(issue: TIssue, workspaceId: string, projectName: string): IssueRow {
  const source = DATA_SOURCE_PLANE;
  return {
    id: rowId(source, issue.id),
    workspace_id: workspaceId,
    project_id: rowId(source, issue.project_id ?? "unknown"),
    project_name: projectName,
    source,
    external_id: issue.id,
    tag: TAG_PLANE,
    payload: serializePayload(issue, DATA_SOURCE_PLANE),
    updated_at: nowIso(),
  };
}
