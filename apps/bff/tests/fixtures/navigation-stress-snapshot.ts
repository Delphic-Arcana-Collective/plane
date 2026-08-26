import { BFF_VIEWER_USER_ID } from "../../src/bootstrap/session.js";
import type { LinearSyncSnapshot } from "../../src/linear/client.js";

export const NAV_PROJECT_A_ID = "project-nav-alpha";
export const NAV_PROJECT_B_ID = "project-nav-beta";
export const NAV_PROJECT_A_NAME = "Nav Project Alpha";
export const NAV_PROJECT_B_NAME = "Nav Project Beta";
export const NAV_ISSUE_A_MARKER = "NAV-A-1";
export const NAV_ISSUE_B_MARKER = "NAV-B-1";

function buildIssues(projectId: string, teamId: string, prefix: string, count: number, stateId: string) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `issue-${prefix}-${n}`,
      identifier: `${prefix}-${n}`,
      title: `${prefix}-${n} stress issue`,
      description: `Navigation stress fixture issue ${prefix}-${n}`,
      priority: 2,
      sortOrder: n,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      dueDate: null,
      estimate: null,
      teamId,
      projectId,
      stateId,
      assigneeId: BFF_VIEWER_USER_ID,
      labelIds: [],
      parentId: null,
      subIssuesCount: 0,
      createdById: BFF_VIEWER_USER_ID,
    };
  });
}

/** Two projects with distinct issue markers for sidebar navigation stress tests. */
export function createNavigationStressSnapshot(): LinearSyncSnapshot {
  return {
    organization: {
      id: "org-nav-stress",
      name: "Delphic Arcana Collective",
      urlKey: "delphic-arcana-collective",
    },
    users: [
      {
        id: BFF_VIEWER_USER_ID,
        name: "Linear Viewer",
        displayName: "Linear Viewer",
        email: "dev@linear.local",
        avatarUrl: "",
      },
    ],
    teams: [
      {
        id: "team-nav",
        key: "NAV",
        name: "NAV",
        description: "Navigation stress team",
      },
    ],
    projects: [
      {
        id: NAV_PROJECT_A_ID,
        name: "Nav Project Alpha",
        description: "Navigation stress project A",
        slugId: "nav-alpha",
        teamIds: ["team-nav"],
        primaryTeamId: "team-nav",
        primaryTeamKey: "NAV",
      },
      {
        id: NAV_PROJECT_B_ID,
        name: "Nav Project Beta",
        description: "Navigation stress project B",
        slugId: "nav-beta",
        teamIds: ["team-nav"],
        primaryTeamId: "team-nav",
        primaryTeamKey: "NAV",
      },
    ],
    states: [
      {
        id: "state-nav-todo",
        name: "Todo",
        color: "#cccccc",
        type: "unstarted",
        position: 0,
        teamId: "team-nav",
      },
      {
        id: "state-nav-done",
        name: "Done",
        color: "#00aa00",
        type: "completed",
        position: 1,
        teamId: "team-nav",
      },
    ],
    labels: [],
    issues: [
      ...buildIssues(NAV_PROJECT_A_ID, "team-nav", "NAV-A", 6, "state-nav-todo"),
      ...buildIssues(NAV_PROJECT_B_ID, "team-nav", "NAV-B", 8, "state-nav-todo"),
    ],
    comments: [],
  };
}
