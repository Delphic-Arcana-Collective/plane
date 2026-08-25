import type { IState, IIssueLabel, TIssue, TIssueComment, IProjectUserPropertiesResponse } from "@plane/types";
import type { PlaneCache } from "./backend.js";

export const KV_KEYS = {
  meta: "meta",
  workspace: "workspace",
  projects: "projects",
  states: "states",
  labels: "labels",
  issues: "issues",
  comments: "comments",
  users: "users",
} as const;

export const USER_PROPERTIES_PREFIX = "user-properties:";

type SerializedMap<T> = Record<string, T[]>;

function mapToRecord<V>(map: Map<string, V[]>): SerializedMap<V> {
  const record: SerializedMap<V> = {};
  for (const [key, value] of map) {
    record[key] = value;
  }
  return record;
}

function recordToMap<V>(record: SerializedMap<V> | null | undefined): Map<string, V[]> {
  const map = new Map<string, V[]>();
  if (!record) return map;
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value);
  }
  return map;
}

function usersToRecord(
  users: Map<string, PlaneCache["users"] extends Map<string, infer V> ? V : never>
): Record<string, PlaneCache["users"] extends Map<string, infer V> ? V : never> {
  const record: Record<string, PlaneCache["users"] extends Map<string, infer V> ? V : never> = {};
  for (const [key, value] of users) {
    record[key] = value;
  }
  return record;
}

function usersFromRecord(
  record: Record<string, PlaneCache["users"] extends Map<string, infer V> ? V : never> | null | undefined
): PlaneCache["users"] {
  const map = new Map<string, PlaneCache["users"] extends Map<string, infer V> ? V : never>();
  if (!record) return map;
  for (const [key, value] of Object.entries(record)) {
    map.set(key, value);
  }
  return map;
}

export interface SerializedCacheMeta {
  ready: boolean;
  lastFetchedAt: string | null;
  error: string | null;
  stats: PlaneCache["stats"];
}

export function serializeCacheMeta(cache: PlaneCache): string {
  const payload: SerializedCacheMeta = {
    ready: cache.ready,
    lastFetchedAt: cache.lastFetchedAt,
    error: cache.error,
    stats: cache.stats,
  };
  return JSON.stringify(payload);
}

export function deserializeCacheMeta(raw: string): SerializedCacheMeta {
  return JSON.parse(raw) as SerializedCacheMeta;
}

export function serializePlaneCacheMaps(cache: PlaneCache) {
  return {
    states: JSON.stringify(mapToRecord(cache.statesByProject)),
    labels: JSON.stringify(mapToRecord(cache.labelsByProject)),
    issues: JSON.stringify(mapToRecord(cache.issuesByProject)),
    comments: JSON.stringify(mapToRecord(cache.commentsByIssue)),
    users: JSON.stringify(usersToRecord(cache.users)),
  };
}

export function assemblePlaneCache(
  meta: SerializedCacheMeta,
  workspace: PlaneCache["workspace"],
  projects: PlaneCache["projects"],
  statesRaw: string | null,
  labelsRaw: string | null,
  issuesRaw: string | null,
  commentsRaw: string | null,
  usersRaw: string | null
): PlaneCache {
  return {
    ...meta,
    workspace: workspace ?? null,
    projects: projects ?? [],
    statesByProject: recordToMap<IState>(statesRaw ? (JSON.parse(statesRaw) as SerializedMap<IState>) : null),
    labelsByProject: recordToMap<IIssueLabel>(labelsRaw ? (JSON.parse(labelsRaw) as SerializedMap<IIssueLabel>) : null),
    issuesByProject: recordToMap<TIssue>(issuesRaw ? (JSON.parse(issuesRaw) as SerializedMap<TIssue>) : null),
    commentsByIssue: recordToMap<TIssueComment>(
      commentsRaw ? (JSON.parse(commentsRaw) as SerializedMap<TIssueComment>) : null
    ),
    users: usersFromRecord(
      usersRaw
        ? (JSON.parse(usersRaw) as Record<string, PlaneCache["users"] extends Map<string, infer V> ? V : never>)
        : null
    ),
    stateGroupById: new Map(),
  };
}

/** @deprecated Single-key blob kept for migration; prefer per-key KV_KEYS storage. */
export interface SerializedPlaneCache {
  ready: boolean;
  lastFetchedAt: string | null;
  error: string | null;
  stats: PlaneCache["stats"];
  workspace: PlaneCache["workspace"];
  projects: PlaneCache["projects"];
  statesByProject: [string, PlaneCache["statesByProject"] extends Map<string, infer V> ? V : never][];
  labelsByProject: [string, PlaneCache["labelsByProject"] extends Map<string, infer V> ? V : never][];
  issuesByProject: [string, PlaneCache["issuesByProject"] extends Map<string, infer V> ? V : never][];
  commentsByIssue: [string, PlaneCache["commentsByIssue"] extends Map<string, infer V> ? V : never][];
  users: [string, PlaneCache["users"] extends Map<string, infer V> ? V : never][];
  stateGroupById: [string, string][];
}

export function serializePlaneCache(cache: PlaneCache): string {
  const payload: SerializedPlaneCache = {
    ready: cache.ready,
    lastFetchedAt: cache.lastFetchedAt,
    error: cache.error,
    stats: cache.stats,
    workspace: cache.workspace,
    projects: cache.projects,
    statesByProject: [...cache.statesByProject.entries()],
    labelsByProject: [...cache.labelsByProject.entries()],
    issuesByProject: [...cache.issuesByProject.entries()],
    commentsByIssue: [...cache.commentsByIssue.entries()],
    users: [...cache.users.entries()],
    stateGroupById: [...cache.stateGroupById.entries()],
  };
  return JSON.stringify(payload);
}

export function deserializePlaneCache(raw: string): PlaneCache {
  const payload = JSON.parse(raw) as SerializedPlaneCache;
  return {
    ready: payload.ready,
    lastFetchedAt: payload.lastFetchedAt,
    error: payload.error,
    stats: payload.stats,
    workspace: payload.workspace,
    projects: payload.projects,
    statesByProject: new Map(payload.statesByProject),
    labelsByProject: new Map(payload.labelsByProject),
    issuesByProject: new Map(payload.issuesByProject),
    commentsByIssue: new Map(payload.commentsByIssue),
    users: new Map(payload.users),
    stateGroupById: new Map(payload.stateGroupById),
  };
}

export function getProjectUserPropertiesKey(projectId: string): string {
  return `${USER_PROPERTIES_PREFIX}${projectId}`;
}

export function mergeProjectUserProperties(
  current: IProjectUserPropertiesResponse,
  patch: Partial<IProjectUserPropertiesResponse>
): IProjectUserPropertiesResponse {
  return {
    ...current,
    ...patch,
    rich_filters: patch.rich_filters ?? current.rich_filters,
    display_filters: {
      ...current.display_filters,
      ...patch.display_filters,
    },
    display_properties: {
      ...current.display_properties,
      ...patch.display_properties,
    },
    preferences: {
      ...current.preferences,
      ...patch.preferences,
      pages: {
        ...current.preferences.pages,
        ...patch.preferences?.pages,
      },
      navigation: {
        ...current.preferences.navigation,
        ...patch.preferences?.navigation,
      },
    },
  };
}
