import type {
  IState,
  IIssueLabel,
  TIssue,
  TPartialProject,
  IWorkspace,
  IUserLite,
  TIssueComment,
  IProjectUserPropertiesResponse,
} from "@plane/types";
import type { LinearSyncSnapshot } from "../linear/client.js";
import type { Env } from "../env.js";
import { filterIssues } from "../mapper/index.js";
import type { CacheBackend, CacheMeta, PlaneCache } from "./backend.js";
import { buildPlaneCacheFromSnapshot, createEmptyPlaneCache } from "./snapshot.js";
import {
  getProjectUserProperties,
  resetProjectUserProperties,
  updateProjectUserProperties,
} from "./user-properties.js";

export type { SyncStats, CacheMeta, PlaneCache, CacheBackend } from "./backend.js";
export class MemoryCacheBackend implements CacheBackend {
  protected inner: PlaneCache = createEmptyPlaneCache();
  private syncLock = false;

  get cache(): PlaneCache {
    return this.inner;
  }

  protected replaceCache(cache: PlaneCache): void {
    this.inner = cache;
  }

  async ensureLoaded(): Promise<void> {
    // in-process cache is always available
  }

  async getMeta(): Promise<CacheMeta> {
    const { ready, lastFetchedAt, error, stats } = this.inner;
    return { ready, lastFetchedAt, error, stats };
  }

  async applySnapshot(snapshot: LinearSyncSnapshot, env: Env): Promise<void> {
    this.inner = buildPlaneCacheFromSnapshot(snapshot, env);
  }

  async setError(message: string): Promise<void> {
    this.inner = { ...this.inner, error: message };
  }

  async reset(): Promise<void> {
    resetProjectUserProperties();
    this.inner = createEmptyPlaneCache();
  }

  async tryAcquireSyncLock(): Promise<boolean> {
    if (this.syncLock) return false;
    this.syncLock = true;
    return true;
  }

  async releaseSyncLock(): Promise<void> {
    this.syncLock = false;
  }

  async getWorkspace(): Promise<IWorkspace | null> {
    return this.inner.workspace;
  }

  async getProjects(): Promise<TPartialProject[]> {
    return this.inner.projects;
  }

  async getUsers(): Promise<IUserLite[]> {
    return [...this.inner.users.values()];
  }

  async getProjectStates(projectId: string): Promise<IState[]> {
    return this.inner.statesByProject.get(projectId) ?? [];
  }

  async getAllLabels(): Promise<IIssueLabel[]> {
    return [...this.inner.labelsByProject.values()].flat();
  }

  async getProjectLabels(projectId: string): Promise<IIssueLabel[]> {
    return this.inner.labelsByProject.get(projectId) ?? [];
  }

  getWorkspaceStates(): IState[] {
    return [...this.inner.statesByProject.values()].flat();
  }

  getAllIssues(): TIssue[] {
    return [...this.inner.issuesByProject.values()].flat();
  }

  getProjectIssues(projectId: string, query: Record<string, string | undefined> = {}): TIssue[] {
    const issues = this.inner.issuesByProject.get(projectId) ?? [];
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
    return this.inner.issuesByProject.get(projectId)?.find((issue) => issue.id === issueId);
  }

  getIssueComments(projectId: string, issueId: string, createdAfter?: string): TIssueComment[] {
    if (!this.getIssue(projectId, issueId)) return [];
    const comments = this.inner.commentsByIssue.get(issueId) ?? [];
    if (!createdAfter) return comments;
    return comments.filter((comment) => comment.created_at > createdAfter);
  }

  findIssueByIdentifier(identifier: string): { issue: TIssue; projectId: string } | undefined {
    const match = identifier.match(/^([A-Z]+)-(\d+)$/);
    if (!match) return undefined;

    const [, projectKey, sequenceRaw] = match;
    const sequence = Number(sequenceRaw);
    const project = this.inner.projects.find((entry) => entry.identifier === projectKey);
    if (!project) return undefined;

    const issue = this.inner.issuesByProject.get(project.id)?.find((entry) => entry.sequence_id === sequence);
    if (!issue) return undefined;

    return { issue, projectId: project.id };
  }

  async getProjectUserProperties(projectId: string): Promise<IProjectUserPropertiesResponse> {
    return getProjectUserProperties(projectId);
  }

  async updateProjectUserProperties(
    projectId: string,
    patch: Partial<IProjectUserPropertiesResponse>
  ): Promise<IProjectUserPropertiesResponse> {
    return updateProjectUserProperties(projectId, patch);
  }
}

/** Default in-process cache for Node dev and tests. */
export const cacheStore = new MemoryCacheBackend();
