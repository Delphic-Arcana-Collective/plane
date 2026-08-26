/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type {
  GroupByColumnTypes,
  IIssueDisplayFilterOptions,
  ILayoutDisplayFiltersOptions,
  IIssueMap,
  TGroupedIssues,
  TIssue,
  TIssueComment,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import { ALL_ISSUES, ISSUE_DISPLAY_FILTERS_BY_PAGE } from "@plane/constants";

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
/** Workspace-wide issues list (no project selected) in Linear display mode. */
export function getLinearAllIssuesPath(workspaceSlug?: string): string {
  const slug = workspaceSlug || getLinearWorkspaceSlug();
  return `/${slug}/workspace-views/all-issues`;
}

/** Board, calendar, table, and timeline layouts for workspace all-issues in Linear mode. */
export const LINEAR_WORKSPACE_LAYOUTS = [
  EIssueLayoutTypes.KANBAN,
  EIssueLayoutTypes.CALENDAR,
  EIssueLayoutTypes.SPREADSHEET,
  EIssueLayoutTypes.GANTT,
] as const;

export function isLinearWorkspaceLayout(layout: EIssueLayoutTypes | undefined): boolean {
  return LINEAR_WORKSPACE_LAYOUTS.includes(layout as (typeof LINEAR_WORKSPACE_LAYOUTS)[number]);
}

export function getLinearWorkspaceLayoutFilterOptions(
  layout: EIssueLayoutTypes
): ILayoutDisplayFiltersOptions | undefined {
  return ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.layoutOptions[layout];
}

export function isLinearAllIssuesView(viewId: string | undefined): boolean {
  return isLinearDisplayMode() && viewId === "all-issues";
}

export function getLinearDefaultDisplayFilters(): IIssueDisplayFilterOptions {
  return {
    layout: EIssueLayoutTypes.KANBAN,
    order_by: "sort_order",
    group_by: "state",
    sub_group_by: null,
    sub_issue: false,
    show_empty_groups: false,
    calendar: {
      show_weekends: false,
      layout: "month",
    },
  };
}

function getLinearIssueGroupKey(issue: TIssue, groupBy: GroupByColumnTypes): string {
  switch (groupBy) {
    case "state":
      return issue.state_id ?? "none";
    case "priority":
      return issue.priority ?? "none";
    case "labels":
      return issue.label_ids?.[0] ?? "none";
    case "assignees":
      return issue.assignee_ids?.[0] ?? "none";
    case "state_detail.group":
      return issue.state__group ?? "none";
    case "project":
    case "team_project":
      return issue.project_id ?? "none";
    case "created_by":
      return issue.created_by ?? "none";
    case "cycle":
      return issue.cycle_id ?? "none";
    case "module":
      return issue.module_ids?.[0] ?? "none";
    default:
      return "none";
  }
}

/** Group a flat ALL_ISSUES list client-side for kanban — no extra API fetch. */
export function groupLinearIssuesFromFlatList(
  groupedIssueIds: TGroupedIssues,
  issueMap: IIssueMap,
  groupBy: GroupByColumnTypes | null
): TGroupedIssues {
  const flatIds = groupedIssueIds[ALL_ISSUES];
  if (!groupBy || !Array.isArray(flatIds) || flatIds.length === 0) {
    return groupedIssueIds;
  }

  const grouped: TGroupedIssues = {};
  for (const issueId of flatIds) {
    const issue = issueMap[issueId];
    if (!issue) continue;
    const key = getLinearIssueGroupKey(issue, groupBy);
    const bucket = grouped[key];
    if (Array.isArray(bucket)) {
      bucket.push(issueId);
    } else {
      grouped[key] = [issueId];
    }
  }
  return grouped;
}

/** Whether the store has issue ids usable for the active layout (avoids false "ready" on empty kanban). */
export function hasLinearGroupedIssueData(
  groupedIssueIds: TGroupedIssues | undefined,
  layout: EIssueLayoutTypes | undefined,
  groupBy: GroupByColumnTypes | null | undefined
): boolean {
  if (!groupedIssueIds) return false;

  const groupKeys = Object.keys(groupedIssueIds).filter((key) => key !== ALL_ISSUES);

  if (layout === EIssueLayoutTypes.KANBAN && groupBy) {
    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (Array.isArray(flatIds) && flatIds.length > 0) return true;

    return groupKeys.some((key) => {
      const bucket = groupedIssueIds[key];
      return Array.isArray(bucket) && bucket.length > 0;
    });
  }

  if (layout === EIssueLayoutTypes.LIST && groupBy) {
    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (Array.isArray(flatIds) && flatIds.length > 0) return true;

    return groupKeys.some((key) => {
      const bucket = groupedIssueIds[key];
      return Array.isArray(bucket) && bucket.length > 0;
    });
  }

  const flatIds = groupedIssueIds[ALL_ISSUES];
  if (Array.isArray(flatIds) && flatIds.length > 0) return true;

  return groupKeys.some((key) => {
    const bucket = groupedIssueIds[key];
    return Array.isArray(bucket) && bucket.length > 0;
  });
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
