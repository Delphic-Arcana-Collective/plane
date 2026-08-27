/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  IssuePaginationOptions,
  TGroupedIssueCount,
  TGroupedIssues,
  TIssue,
  TIssuePaginationData,
} from "@plane/types";

/** Cached issue list payload — lives in sessionStorage for the tab. */
export type TLinearProjectSnapshot = {
  groupedIssueIds: TGroupedIssues;
  groupedIssueCount: TGroupedIssueCount;
  issuePaginationData: TIssuePaginationData;
  paginationOptions: IssuePaginationOptions | undefined;
  issues: TIssue[];
};

const STORAGE_PREFIX = "plane:linear:project:";
const WORKSPACE_ALL_ISSUES_KEY = "plane:linear:workspace:all-issues";
const ACTIVE_PROJECT_KEY = "plane:linear:active-project-id";

let lockChain: Promise<void> = Promise.resolve();

/** Serialize every sessionStorage read/write for Linear navigation. */
export async function withLinearStorageLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = lockChain.then(() => fn());
  lockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function requireSessionStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Linear project storage requires a browser sessionStorage context");
  }
  return window.sessionStorage;
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectId)}`;
}

function readJsonUnsafe<T>(key: string): T | null {
  const storage = requireSessionStorage();
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function writeJsonUnsafe<T>(key: string, value: T): void {
  requireSessionStorage().setItem(key, JSON.stringify(value));
}

function deleteKeyUnsafe(key: string): void {
  requireSessionStorage().removeItem(key);
}

function readProjectSnapshotUnsafe(projectId: string): TLinearProjectSnapshot | null {
  return readJsonUnsafe<TLinearProjectSnapshot>(storageKey(projectId));
}

function writeProjectSnapshotUnsafe(projectId: string, snapshot: TLinearProjectSnapshot): void {
  writeJsonUnsafe(storageKey(projectId), snapshot);
}

function deleteProjectSnapshotUnsafe(projectId: string): void {
  deleteKeyUnsafe(storageKey(projectId));
}

function readWorkspaceSnapshotUnsafe(): TLinearProjectSnapshot | null {
  return readJsonUnsafe<TLinearProjectSnapshot>(WORKSPACE_ALL_ISSUES_KEY);
}

function writeWorkspaceSnapshotUnsafe(snapshot: TLinearProjectSnapshot): void {
  writeJsonUnsafe(WORKSPACE_ALL_ISSUES_KEY, snapshot);
}

function deleteWorkspaceSnapshotUnsafe(): void {
  deleteKeyUnsafe(WORKSPACE_ALL_ISSUES_KEY);
}

function readActiveProjectIdUnsafe(): string | null {
  return requireSessionStorage().getItem(ACTIVE_PROJECT_KEY);
}

function writeActiveProjectIdUnsafe(projectId: string | null): void {
  const storage = requireSessionStorage();
  if (projectId) {
    storage.setItem(ACTIVE_PROJECT_KEY, projectId);
  } else {
    storage.removeItem(ACTIVE_PROJECT_KEY);
  }
}

export async function readLinearProjectSnapshot(projectId: string): Promise<TLinearProjectSnapshot | null> {
  return withLinearStorageLock(() => readProjectSnapshotUnsafe(projectId));
}

export async function deleteLinearProjectSnapshot(projectId: string): Promise<void> {
  return withLinearStorageLock(() => {
    deleteProjectSnapshotUnsafe(projectId);
  });
}

export async function readLinearActiveProjectId(): Promise<string | null> {
  return withLinearStorageLock(() => readActiveProjectIdUnsafe());
}

/** Open project: set active id and return cached snapshot (single lock). */
export async function openLinearProjectFromCache(projectId: string): Promise<TLinearProjectSnapshot | null> {
  return withLinearStorageLock(() => {
    writeActiveProjectIdUnsafe(projectId);
    return readProjectSnapshotUnsafe(projectId);
  });
}

/** Persist project snapshot. Returns whether this project is still active. */
export async function persistLinearProjectSnapshot(
  projectId: string,
  snapshot: TLinearProjectSnapshot
): Promise<boolean> {
  return withLinearStorageLock(() => {
    if (readActiveProjectIdUnsafe() !== projectId) return false;
    writeProjectSnapshotUnsafe(projectId, snapshot);
    return true;
  });
}

/** Open all-issues: clear active project and return cached workspace snapshot. */
export async function openLinearAllIssuesFromCache(): Promise<TLinearProjectSnapshot | null> {
  return withLinearStorageLock(() => {
    writeActiveProjectIdUnsafe(null);
    return readWorkspaceSnapshotUnsafe();
  });
}

/** Persist all-issues snapshot. Returns whether no project is active. */
export async function persistLinearAllIssuesSnapshot(snapshot: TLinearProjectSnapshot): Promise<boolean> {
  return withLinearStorageLock(() => {
    if (readActiveProjectIdUnsafe() !== null) return false;
    writeWorkspaceSnapshotUnsafe(snapshot);
    return true;
  });
}

export async function deleteLinearAllIssuesSnapshot(): Promise<void> {
  return withLinearStorageLock(() => {
    deleteWorkspaceSnapshotUnsafe();
  });
}

/** Clear active project and delete cached project snapshot (single lock). */
export async function clearLinearProjectCache(projectId: string): Promise<void> {
  return withLinearStorageLock(() => {
    if (readActiveProjectIdUnsafe() === projectId) {
      writeActiveProjectIdUnsafe(null);
    }
    deleteProjectSnapshotUnsafe(projectId);
  });
}

export async function clearLinearAllIssuesCache(): Promise<void> {
  return withLinearStorageLock(() => {
    deleteWorkspaceSnapshotUnsafe();
  });
}
