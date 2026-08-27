import { BFF_WORKSPACE_ID } from "../bootstrap/session.js";
import type { PlaneCache } from "./backend.js";

/** Keep workspace id consistent across workspace, projects, states, and labels in the snapshot. */
export function normalizePlaneCacheWorkspace(cache: PlaneCache): void {
  if (cache.workspace) {
    cache.workspace = { ...cache.workspace, id: BFF_WORKSPACE_ID };
  }

  for (const project of cache.projects) {
    project.workspace = BFF_WORKSPACE_ID;
  }

  for (const states of cache.statesByProject.values()) {
    for (const state of states) {
      state.workspace_id = BFF_WORKSPACE_ID;
    }
  }

  for (const labels of cache.labelsByProject.values()) {
    for (const label of labels) {
      label.workspace_id = BFF_WORKSPACE_ID;
    }
  }
}
