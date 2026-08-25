import { describe, expect, it } from "vitest";
import { buildIssuesResponse, filterIssues, mapIssue, orderCommentsForDisplay } from "../src/mapper/index.js";
import type { LinearIssue } from "../src/linear/client.js";

const sampleIssue: LinearIssue = {
  id: "issue-1",
  identifier: "DEL-42",
  title: "Test issue",
  description: "## Hello",
  priority: 2,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  dueDate: null,
  estimate: null,
  teamId: "team-1",
  projectId: "project-1",
  stateId: "state-1",
  assigneeId: "user-1",
  labelIds: ["label-1"],
  parentId: null,
  subIssuesCount: 0,
  createdById: "user-1",
};

describe("mapper", () => {
  it("maps linear issue to plane issue", () => {
    const mapped = mapIssue(sampleIssue, "started");
    expect(mapped.sequence_id).toBe(42);
    expect(mapped.name).toBe("Test issue");
    expect(mapped.priority).toBe("high");
    expect(mapped.assignee_ids).toEqual(["user-1"]);
    expect(mapped.project_id).toBe("project-1");
    expect(mapped.start_date).toBe("2026-01-01");
    expect(mapped.target_date).toBe("2026-01-01");
    expect(mapped.description_html).toContain("Hello");
  });

  it("groups issues by state", () => {
    const a = mapIssue({ ...sampleIssue, id: "a", stateId: "s1" }, "started");
    const b = mapIssue({ ...sampleIssue, id: "b", stateId: "s2" }, "backlog");
    const response = buildIssuesResponse([a, b], "state");
    expect(response.grouped_by).toBe("state_id");
    expect(response.results).toHaveProperty("s1");
    expect(response.results).toHaveProperty("s2");
  });

  it("maps missing due date to target_date using start date", () => {
    const issue = mapIssue(sampleIssue, "started");
    expect(issue.start_date).toBe("2026-01-01");
    expect(issue.target_date).toBe("2026-01-01");

    const response = buildIssuesResponse([issue], "target_date");
    expect(response.results).toHaveProperty("2026-01-01");
  });

  it("keeps linear due date as target_date for calendar grouping", () => {
    const issue = mapIssue({ ...sampleIssue, dueDate: "2026-02-15" }, "started");
    expect(issue.target_date).toBe("2026-02-15");
    expect(issue.start_date).toBe("2026-01-01");

    const response = buildIssuesResponse([issue], "target_date");
    expect(response.results).toHaveProperty("2026-02-15");
    expect(response.results).not.toHaveProperty("2026-01-01");
  });

  it("filters calendar issues by target_date range", () => {
    const withDueDate = mapIssue({ ...sampleIssue, id: "due", dueDate: "2026-02-01" }, "started");
    const withoutDueDate = mapIssue({ ...sampleIssue, id: "start", createdAt: "2026-01-10T00:00:00.000Z" }, "started");

    const filtered = filterIssues([withDueDate, withoutDueDate], {
      target_date: "2026-01-01;after,2026-01-31;before",
    });

    expect(filtered.map((issue) => issue.id)).toEqual(["start"]);
  });

  it("orders threaded comments under their parent", () => {
    const comments = orderCommentsForDisplay([
      {
        id: "parent",
        issueId: "issue-1",
        body: "parent",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "user-1",
        parentId: null,
      },
      {
        id: "other",
        issueId: "issue-1",
        body: "other",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        userId: "user-1",
        parentId: null,
      },
      {
        id: "reply",
        issueId: "issue-1",
        body: "reply",
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        userId: "user-1",
        parentId: "parent",
      },
    ]);

    expect(comments.map((comment) => comment.id)).toEqual(["parent", "reply", "other"]);
  });
});
