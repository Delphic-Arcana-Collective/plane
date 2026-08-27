/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TIssueComment } from "@plane/types";

/**
 * Linear display mode: Plane UI backed by apps/bff instead of Django.
 * Enabled via VITE_LINEAR_DISPLAY_MODE=true in apps/web/.env
 */
export function isLinearDisplayMode(): boolean {
  return import.meta.env.VITE_LINEAR_DISPLAY_MODE === "true";
}

/** Read-only Linear viewer — no create/edit/write actions in the UI. */
export function isLinearReadOnly(): boolean {
  return isLinearDisplayMode();
}

export const LINEAR_READ_ONLY_VIEW_FLAGS = {
  enableQuickAdd: false,
  enableIssueCreation: false,
  enableInlineEditing: false,
} as const;

export function getLinearWorkspaceSlug(): string {
  return import.meta.env.VITE_LINEAR_WORKSPACE_SLUG || "delphic";
}

/** Decode URL-encoded project ids (e.g. linear-team:…). */
export function decodeRouteProjectId(projectId: string | undefined): string | undefined {
  if (!projectId) return undefined;
  try {
    return decodeURIComponent(projectId);
  } catch {
    return projectId;
  }
}
/** Project-scoped issues list in Linear display mode. */
export function getLinearProjectIssuesPath(workspaceSlug: string, projectId: string): string {
  return `/${workspaceSlug}/projects/${encodeURIComponent(projectId)}/issues`;
}

/** Workspace-wide issues list (no project selected) in Linear display mode. */
export function getLinearAllIssuesPath(workspaceSlug?: string): string {
  const slug = workspaceSlug || getLinearWorkspaceSlug();
  return `/${slug}/workspace-views/all-issues`;
}

export function isLinearAllIssuesView(viewId: string | undefined): boolean {
  return isLinearDisplayMode() && viewId === "all-issues";
}

/** Default list/kanban display filters for Linear read-only mode. */
export function getLinearDefaultDisplayFilters() {
  return {
    layout: "list" as const,
    order_by: "sort_order" as const,
    group_by: "state" as const,
    sub_group_by: null,
    sub_issue: false,
    show_empty_groups: false,
    calendar: {
      show_weekends: false,
      layout: "month" as const,
    },
  };
}

export function getBffBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
}

/** BFF maps Linear comment.parent → Plane comment.parent (not in core types yet). */
export function getLinearCommentParentId(comment: TIssueComment): string | null {
  return (comment as TIssueComment & { parent?: string | null }).parent ?? null;
}

export function buildLinearCommentThreads(comments: TIssueComment[], commentOrder: string[]) {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const childrenByParent = new Map<string, TIssueComment[]>();
  const roots: TIssueComment[] = [];

  for (const comment of comments) {
    const parentId = getLinearCommentParentId(comment);
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(comment);
      childrenByParent.set(parentId, list);
    } else {
      roots.push(comment);
    }
  }

  const rank = new Map(commentOrder.map((id, index) => [id, index]));
  const byStoreOrder = (a: TIssueComment, b: TIssueComment) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);

  roots.sort(byStoreOrder);
  for (const children of childrenByParent.values()) children.sort(byStoreOrder);

  return { roots, childrenByParent };
}
