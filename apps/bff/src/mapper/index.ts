import type { IState } from "@plane/types";
import type { IIssueLabel } from "@plane/types";
import type { TIssue, TIssuePriorities, TIssuesResponse } from "@plane/types";
import type { TPartialProject } from "@plane/types";
import type { IWorkspace } from "@plane/types";
import type { IUserLite } from "@plane/types";
import type { TIssueComment } from "@plane/types";
import { EIssueCommentAccessSpecifier } from "@plane/types";
import { marked } from "marked";
import type { Env } from "../env.js";
import type {
  LinearComment,
  LinearIssue,
  LinearLabel,
  LinearSyncSnapshot,
  LinearWorkflowState,
  LinearUser,
} from "../linear/client.js";
import { LINEAR_TEAM_FALLBACK_PROJECT_PREFIX } from "../linear/client.js";
import { createBootstrapContext, BFF_WORKSPACE_ID } from "../bootstrap/session.js";

const PRIORITY_MAP: Record<number, TIssuePriorities> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

function parseSequenceId(identifier: string): number {
  const part = identifier.split("-").pop();
  const num = Number(part);
  return Number.isFinite(num) ? num : 0;
}

/** Linear issues have no planned start date — use the creation date for Plane's start_date. */
function toPayloadDate(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

function parseTargetDateQuery(
  value: string
): { type: "range"; start: string; end: string } | { type: "exact"; date: string } | null {
  if (value.includes(",")) {
    let after: string | null = null;
    let before: string | null = null;

    for (const part of value.split(",")) {
      const [datePart, direction] = part.split(";");
      if (!datePart || !direction) continue;
      if (direction === "after") after = datePart;
      if (direction === "before") before = datePart;
    }

    if (after && before) {
      return {
        type: "range",
        start: after < before ? after : before,
        end: after < before ? before : after,
      };
    }
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { type: "exact", date: value };
  }

  return null;
}

function markdownToHtml(markdown?: string | null): string {
  if (!markdown) return "";
  return marked.parse(markdown, { async: false }) as string;
}

function markdownToPlainText(markdown: string): string {
  return markdown.replace(/[#*_`~>[\]]/g, "").trim();
}

function markdownToCommentJson(body: string) {
  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] };
  }
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

export function mapComment(
  comment: LinearComment,
  ctx: {
    workspace: IWorkspace;
    project: TPartialProject;
    issue: TIssue;
    actor: IUserLite;
  }
): TIssueComment {
  const html = markdownToHtml(comment.body);
  return {
    id: comment.id,
    workspace: ctx.workspace.id,
    workspace_detail: {
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      slug: ctx.workspace.slug,
    },
    project: ctx.project.id,
    project_detail: {
      id: ctx.project.id,
      identifier: ctx.project.identifier,
      name: ctx.project.name,
      cover_image: "",
      description: "",
      emoji: null,
      icon_prop: null,
    },
    issue: ctx.issue.id,
    issue_detail: {
      id: ctx.issue.id,
      sequence_id: ctx.issue.sequence_id,
      sort_order: false as unknown as boolean,
      name: ctx.issue.name,
      description_html: ctx.issue.description_html ?? "",
      priority: ctx.issue.priority ?? "none",
      start_date: ctx.issue.start_date ?? "",
      target_date: ctx.issue.target_date ?? "",
      is_draft: false,
    },
    actor: ctx.actor.id,
    actor_detail: {
      id: ctx.actor.id,
      first_name: ctx.actor.first_name,
      last_name: ctx.actor.last_name,
      avatar_url: ctx.actor.avatar_url,
      is_bot: ctx.actor.is_bot ?? false,
      display_name: ctx.actor.display_name,
    },
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    edited_at: comment.updatedAt !== comment.createdAt ? comment.updatedAt : undefined,
    created_by: ctx.actor.id,
    updated_by: ctx.actor.id,
    attachments: [],
    comment_reactions: [],
    comment_stripped: markdownToPlainText(comment.body),
    comment_html: html,
    comment_json: markdownToCommentJson(comment.body),
    external_id: comment.id,
    external_source: "linear",
    access: EIssueCommentAccessSpecifier.INTERNAL,
    parent: comment.parentId,
  } as TIssueComment;
}

/** Keep Linear reply threads directly under their parent comment. */
export function orderCommentsForDisplay(comments: LinearComment[]): LinearComment[] {
  const knownIds = new Set(comments.map((comment) => comment.id));
  const childrenByParent = new Map<string, LinearComment[]>();
  const roots: LinearComment[] = [];

  for (const comment of comments) {
    if (comment.parentId && knownIds.has(comment.parentId)) {
      const list = childrenByParent.get(comment.parentId) ?? [];
      list.push(comment);
      childrenByParent.set(comment.parentId, list);
    } else {
      roots.push(comment);
    }
  }

  roots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const ordered: LinearComment[] = [];
  const visit = (comment: LinearComment) => {
    ordered.push(comment);
    for (const child of childrenByParent.get(comment.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return ordered;
}

export function mapLinearUserToPlane(user: LinearUser): IUserLite {
  const [firstName, ...rest] = (user.displayName || user.name).split(" ");
  return {
    id: user.id,
    avatar_url: user.avatarUrl ?? "",
    display_name: user.displayName || user.name,
    email: user.email,
    first_name: firstName ?? user.name,
    last_name: rest.join(" ") || "",
    is_bot: false,
  };
}

export function mapWorkspace(snapshot: LinearSyncSnapshot, env: Env): IWorkspace {
  const bootstrap = createBootstrapContext(env);
  const owner = snapshot.users[0] ? mapLinearUserToPlane(snapshot.users[0]) : bootstrap.viewer;

  return {
    ...bootstrap.workspace,
    id: BFF_WORKSPACE_ID,
    name: env.PLANE_WORKSPACE_NAME || snapshot.organization.name,
    slug: env.PLANE_WORKSPACE_SLUG,
    url: env.PLANE_WORKSPACE_SLUG,
    owner,
    total_members: snapshot.users.length || 1,
    total_projects: snapshot.projects.length,
    created_by: owner.id,
    updated_by: owner.id,
  } as unknown as IWorkspace;
}

export function mapLinearProject(
  project: { id: string; name: string; description?: string | null },
  teamKey: string,
  workspaceId: string,
  issueCount: number
): TPartialProject {
  return {
    id: project.id,
    name: project.name,
    identifier: teamKey,
    sort_order: 0,
    logo_props: {
      in_use: "emoji",
      emoji: { value: "📋" },
    },
    member_role: 20,
    archived_at: null,
    workspace: workspaceId,
    cycle_view: false,
    issue_views_view: true,
    module_view: false,
    page_view: false,
    inbox_view: false,
    guest_view_all_features: false,
    project_lead: null,
    network: 0,
    created_at: new Date(),
    updated_at: new Date(),
    intake_count: 0,
    description: project.description ?? "",
    total_issues: issueCount,
  } as TPartialProject;
}

/** @deprecated Use mapLinearProject — kept for tests */
export function mapProject(
  team: LinearSyncSnapshot["teams"][number],
  workspaceId: string,
  issueCount: number
): TPartialProject {
  return mapLinearProject(team, team.key, workspaceId, issueCount);
}

export function teamFallbackProjectId(teamId: string): string {
  return `${LINEAR_TEAM_FALLBACK_PROJECT_PREFIX}${teamId}`;
}

export function resolveIssueProjectId(issue: LinearIssue): string {
  if (issue.projectId) return issue.projectId;
  return teamFallbackProjectId(issue.teamId);
}

export function mapState(state: LinearWorkflowState, workspaceId: string, projectId: string): IState {
  return {
    id: state.id,
    color: state.color,
    default: state.position === 0,
    description: "",
    group: state.type,
    name: state.name,
    project_id: projectId,
    sequence: state.position,
    workspace_id: workspaceId,
    order: state.position,
  };
}

export function mapLabel(label: LinearLabel, workspaceId: string, projectId: string): IIssueLabel {
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    project_id: projectId,
    workspace_id: workspaceId,
    parent: null,
    sort_order: 0,
  };
}

export function mapIssue(issue: LinearIssue, stateGroup?: string): TIssue {
  const startDate = toPayloadDate(issue.createdAt);

  return {
    id: issue.id,
    sequence_id: parseSequenceId(issue.identifier),
    name: issue.title,
    sort_order: issue.sortOrder,
    state_id: issue.stateId,
    priority: PRIORITY_MAP[issue.priority] ?? "none",
    label_ids: issue.labelIds,
    assignee_ids: issue.assigneeId ? [issue.assigneeId] : [],
    estimate_point: issue.estimate != null ? String(issue.estimate) : null,
    sub_issues_count: issue.subIssuesCount,
    attachment_count: 0,
    link_count: 0,
    project_id: issue.projectId ?? teamFallbackProjectId(issue.teamId),
    parent_id: issue.parentId ?? null,
    cycle_id: null,
    module_ids: null,
    type_id: null,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    start_date: startDate,
    // Align with Plane calendar: target_date is the calendar anchor. Use Linear due date, or start date when unset.
    target_date: issue.dueDate ?? startDate,
    completed_at: null,
    archived_at: null,
    created_by: issue.createdById,
    updated_by: issue.createdById,
    is_draft: false,
    description_html: markdownToHtml(issue.description),
    state__group: (stateGroup as TIssue["state__group"]) ?? null,
  };
}

export function buildIssuesResponse(
  issues: TIssue[],
  groupBy?: string | null,
  subGroupBy?: string | null
): TIssuesResponse {
  const total = issues.length;

  if (!groupBy || groupBy === "null") {
    return {
      grouped_by: "none",
      next_cursor: "1000:0:0",
      prev_cursor: "1000:0:0",
      next_page_results: false,
      prev_page_results: false,
      total_count: total,
      count: total,
      total_pages: 1,
      extra_stats: null,
      results: issues,
      total_results: total,
    };
  }

  const normalizedGroupBy = normalizeGroupBy(groupBy);
  const normalizedSubGroupBy = subGroupBy && subGroupBy !== "null" ? normalizeGroupBy(subGroupBy) : null;

  if (normalizedSubGroupBy && normalizedSubGroupBy !== normalizedGroupBy) {
    const grouped: TIssuesResponse["results"] = {};

    for (const issue of issues) {
      const groupKey = getIssueGroupKey(issue, normalizedGroupBy);
      const subGroupKey = getIssueGroupKey(issue, normalizedSubGroupBy);

      if (!grouped[groupKey] || Array.isArray(grouped[groupKey])) {
        grouped[groupKey] = { results: {}, total_results: 0 };
      }

      const groupBucket = grouped[groupKey] as {
        results: Record<string, { results: TIssue[]; total_results: number }>;
        total_results: number;
      };

      if (!groupBucket.results[subGroupKey]) {
        groupBucket.results[subGroupKey] = { results: [], total_results: 0 };
      }

      const subBucket = groupBucket.results[subGroupKey];
      subBucket.results.push(issue);
      subBucket.total_results = subBucket.results.length;
      groupBucket.total_results += 1;
    }

    return {
      grouped_by: normalizedGroupBy,
      next_cursor: "1000:0:0",
      prev_cursor: "1000:0:0",
      next_page_results: false,
      prev_page_results: false,
      total_count: total,
      count: total,
      total_pages: 1,
      extra_stats: null,
      results: grouped,
      total_results: total,
    };
  }

  const grouped: TIssuesResponse["results"] = {};

  for (const issue of issues) {
    const key = getIssueGroupKey(issue, normalizedGroupBy);

    if (!grouped[key] || Array.isArray(grouped[key])) {
      grouped[key] = { results: [], total_results: 0 };
    }

    const bucket = grouped[key] as { results: TIssue[]; total_results: number };
    bucket.results.push(issue);
    bucket.total_results = bucket.results.length;
  }

  return {
    grouped_by: normalizedGroupBy,
    next_cursor: "1000:0:0",
    prev_cursor: "1000:0:0",
    next_page_results: false,
    prev_page_results: false,
    total_count: total,
    count: total,
    total_pages: 1,
    extra_stats: null,
    results: grouped,
    total_results: total,
  };
}

function normalizeGroupBy(groupBy: string): string {
  const map: Record<string, string> = {
    state: "state_id",
    labels: "labels__id",
    label: "labels__id",
    assignees: "assignees__id",
    assignee: "assignees__id",
    "state_detail.group": "state__group",
    module: "issue_module__module_id",
    cycle: "cycle_id",
    created_by: "created_by",
    target_date: "target_date",
    project: "project_id",
  };
  return map[groupBy] ?? groupBy;
}

function getIssueGroupKey(issue: TIssue, groupBy: string): string {
  switch (groupBy) {
    case "state_id":
      return issue.state_id ?? "none";
    case "priority":
      return issue.priority ?? "none";
    case "labels__id":
      return issue.label_ids[0] ?? "none";
    case "assignees__id":
      return issue.assignee_ids[0] ?? "none";
    case "state__group":
      return issue.state__group ?? "none";
    case "created_by":
      return issue.created_by ?? "none";
    case "cycle_id":
      return issue.cycle_id ?? "none";
    case "issue_module__module_id":
      return issue.module_ids?.[0] ?? "none";
    case "target_date":
      return issue.target_date ?? "none";
    case "project_id":
      return issue.project_id ?? "none";
    default:
      return "none";
  }
}

export function filterIssues(issues: TIssue[], query: Record<string, string | undefined>): TIssue[] {
  let filtered = [...issues];

  if (query.state) {
    const states = query.state.split(",");
    filtered = filtered.filter((i) => i.state_id && states.includes(i.state_id));
  }

  if (query.priority) {
    const priorities = query.priority.split(",");
    filtered = filtered.filter((i) => i.priority && priorities.includes(i.priority));
  }

  if (query.labels) {
    const labels = query.labels.split(",");
    filtered = filtered.filter((i) => i.label_ids.some((id: string) => labels.includes(id)));
  }

  if (query.assignees) {
    const assignees = query.assignees.split(",");
    filtered = filtered.filter((i) => i.assignee_ids.some((id: string) => assignees.includes(id)));
  }

  if (query.created_by) {
    const creators = query.created_by.split(",");
    filtered = filtered.filter((i) => i.created_by && creators.includes(i.created_by));
  }

  if (query.subscriber) {
    const subscribers = query.subscriber.split(",");
    filtered = filtered.filter((i) => {
      const subscriberIds = (i as TIssue & { subscriber_ids?: string[] }).subscriber_ids ?? i.assignee_ids;
      return subscriberIds.some((id: string) => subscribers.includes(id));
    });
  }

  if (query.target_date) {
    const targetDateQuery = parseTargetDateQuery(query.target_date);
    if (targetDateQuery?.type === "range") {
      filtered = filtered.filter((issue) => {
        if (!issue.target_date) return false;
        return issue.target_date >= targetDateQuery.start && issue.target_date <= targetDateQuery.end;
      });
    } else if (targetDateQuery?.type === "exact") {
      filtered = filtered.filter((issue) => issue.target_date === targetDateQuery.date);
    }
  }

  const orderBy = query.order_by ?? "-created_at";
  filtered.sort((a, b) => {
    if (orderBy === "-created_at") return b.created_at.localeCompare(a.created_at);
    if (orderBy === "created_at") return a.created_at.localeCompare(b.created_at);
    if (orderBy === "-updated_at") return b.updated_at.localeCompare(a.updated_at);
    if (orderBy === "updated_at") return a.updated_at.localeCompare(b.updated_at);
    if (orderBy === "priority") return (a.priority ?? "").localeCompare(b.priority ?? "");
    if (orderBy === "-priority") return (b.priority ?? "").localeCompare(a.priority ?? "");
    return a.sort_order - b.sort_order;
  });

  return filtered;
}
