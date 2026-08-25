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

export interface SyncStats {
  teams: number;
  projects: number;
  issues: number;
  states: number;
  labels: number;
  users: number;
  comments: number;
}

export interface CacheMeta {
  ready: boolean;
  lastFetchedAt: string | null;
  error: string | null;
  stats: SyncStats;
}

export interface PlaneCache extends CacheMeta {
  workspace: IWorkspace | null;
  projects: TPartialProject[];
  statesByProject: Map<string, IState[]>;
  labelsByProject: Map<string, IIssueLabel[]>;
  issuesByProject: Map<string, TIssue[]>;
  commentsByIssue: Map<string, TIssueComment[]>;
  users: Map<string, IUserLite>;
  stateGroupById: Map<string, string>;
}

export const EMPTY_SYNC_STATS: SyncStats = {
  teams: 0,
  projects: 0,
  issues: 0,
  states: 0,
  labels: 0,
  users: 0,
  comments: 0,
};

export const SYNC_IN_PROGRESS_KEY = "sync:in_progress";
export const SYNC_SCHEDULED_AT_KEY = "sync:scheduled_at";
export const SYNC_LAST_COMPLETED_AT_KEY = "sync:last_completed_at";
export const WEBHOOK_DELIVERY_PREFIX = "webhook:delivery:";

export interface CacheBackend {
  readonly cache: PlaneCache;

  ensureLoaded(): Promise<void>;
  getMeta(): Promise<CacheMeta>;
  applySnapshot(snapshot: LinearSyncSnapshot, env: Env): Promise<void>;
  setError(message: string): Promise<void>;
  reset(): Promise<void>;

  tryAcquireSyncLock(): Promise<boolean>;
  releaseSyncLock(): Promise<void>;

  getWorkspace(): Promise<IWorkspace | null>;
  getProjects(): Promise<TPartialProject[]>;
  getUsers(): Promise<IUserLite[]>;
  getProjectStates(projectId: string): Promise<IState[]>;
  getAllLabels(): Promise<IIssueLabel[]>;
  getProjectLabels(projectId: string): Promise<IIssueLabel[]>;

  getWorkspaceStates(): IState[];
  getAllIssues(): TIssue[];
  getProjectIssues(projectId: string, query?: Record<string, string | undefined>): TIssue[];
  getWorkspaceIssues(query?: Record<string, string | undefined>): TIssue[];
  getUserIssues(userId: string, query?: Record<string, string | undefined>): TIssue[];
  getIssue(projectId: string, issueId: string): TIssue | undefined;
  getIssueComments(projectId: string, issueId: string, createdAfter?: string): TIssueComment[];
  findIssueByIdentifier(identifier: string): { issue: TIssue; projectId: string } | undefined;

  getProjectUserProperties(projectId: string): Promise<IProjectUserPropertiesResponse>;
  updateProjectUserProperties(
    projectId: string,
    patch: Partial<IProjectUserPropertiesResponse>
  ): Promise<IProjectUserPropertiesResponse>;
}

export interface KvCacheBackend extends CacheBackend {
  markWebhookDeliveryProcessed(deliveryId: string): Promise<boolean>;
  scheduleSyncAt(isoTimestamp: string): Promise<void>;
  getScheduledSyncAt(): Promise<string | null>;
  getLastCompletedAt(): Promise<string | null>;
  isSyncInProgress(): Promise<boolean>;
}

export function isKvCacheBackend(cache: CacheBackend): cache is KvCacheBackend {
  return (
    "markWebhookDeliveryProcessed" in cache &&
    typeof (cache as KvCacheBackend).markWebhookDeliveryProcessed === "function"
  );
}
