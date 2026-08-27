/**
 * Poll BFF /health and refresh workspace metadata when Linear webhook sync updates KV.
 * Does not fetch issues — projectIssues is a single shared store; parallel issue fetches
 * abort each other and clear the list the user is viewing.
 */

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getBffBaseUrl,
  getLinearWorkspaceSlug,
  isLinearDisplayMode,
  decodeRouteProjectId,
} from "@/helpers/linear-display.helper";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useIssues } from "@/hooks/store/use-issues";
import { EIssuesStoreType } from "@plane/types";

const POLL_MS = 8_000;

interface HealthResponse {
  cache?: {
    lastFetchedAt?: string | null;
  };
}

export function useLinearCacheRefresh(workspaceSlug: string | undefined) {
  const { projectId: routeProjectId } = useParams();
  const projectId = decodeRouteProjectId(routeProjectId?.toString());
  const { fetchPartialProjects } = useProject();
  const { fetchWorkspaceStates } = useProjectState();
  const { issues: projectIssues } = useIssues(EIssuesStoreType.PROJECT);
  const { issues: workspaceIssues } = useIssues(EIssuesStoreType.GLOBAL);
  const lastFetchedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLinearDisplayMode() || !workspaceSlug || workspaceSlug !== getLinearWorkspaceSlug()) return;

    let cancelled = false;

    const refreshWorkspaceData = async () => {
      await fetchPartialProjects(workspaceSlug);
      await fetchWorkspaceStates(workspaceSlug);

      if (projectId) {
        await projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
      } else {
        await workspaceIssues.fetchIssuesWithExistingPagination(workspaceSlug, "all-issues", "mutation");
      }
    };

    const poll = async () => {
      try {
        const response = await fetch(`${getBffBaseUrl()}/health`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as HealthResponse;
        const lastFetchedAt = body.cache?.lastFetchedAt ?? null;
        if (!lastFetchedAt) return;

        if (lastFetchedAtRef.current && lastFetchedAtRef.current !== lastFetchedAt) {
          if (!cancelled) await refreshWorkspaceData();
        }
        lastFetchedAtRef.current = lastFetchedAt;
      } catch {
        // ignore transient network errors
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [workspaceSlug, projectId, fetchPartialProjects, fetchWorkspaceStates, projectIssues, workspaceIssues]);
}
