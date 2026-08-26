/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { ISSUE_DISPLAY_FILTERS_BY_PAGE } from "@plane/constants";
import { EmptyStateDetailed } from "@plane/propel/empty-state";
import { EIssueLayoutTypes, EIssuesStoreType, STATIC_VIEW_TYPES } from "@plane/types";
// assets
// components
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { WorkspaceActiveLayout } from "@/components/views/helper";
import { WorkspaceLevelWorkItemFiltersHOC } from "@/components/work-item-filters/filters-hoc/workspace-level";
import { WorkItemFiltersRow } from "@/components/work-item-filters/filters-row";
// hooks
import { useGlobalView } from "@/hooks/store/use-global-view";
import { useIssues } from "@/hooks/store/use-issues";
import { useAppRouter } from "@/hooks/use-app-router";
import { IssuesStoreContext } from "@/hooks/use-issue-layout-store";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
import { isLinearAllIssuesView } from "@/helpers/linear-display.helper";

type Props = {
  isDefaultView: boolean;
  isLoading?: boolean;
  toggleLoading: (value: boolean) => void;
};

export const AllIssueLayoutRoot = observer(function AllIssueLayoutRoot(props: Props) {
  const { isDefaultView, isLoading = false, toggleLoading } = props;
  // router
  const router = useAppRouter();
  const { workspaceSlug: routerWorkspaceSlug, globalViewId: routerGlobalViewId } = useParams();
  const workspaceSlug = routerWorkspaceSlug ? routerWorkspaceSlug.toString() : undefined;
  const globalViewId = routerGlobalViewId ? routerGlobalViewId.toString() : undefined;
  // search params
  const searchParams = useSearchParams();
  // store hooks
  const {
    issuesFilter,
    issuesFilter: { filters, fetchFilters, updateFilterExpression },
    issues: { clear, groupedIssueIds, fetchIssues, fetchNextIssues, isViewDataReady },
  } = useIssues(EIssuesStoreType.GLOBAL);
  const { fetchAllGlobalViews, getViewDetailsById } = useGlobalView();
  // Derived values
  const viewDetails = globalViewId ? getViewDetailsById(globalViewId) : undefined;
  const workItemFilters = globalViewId ? filters?.[globalViewId] : undefined;
  const isLinearAllIssues = isLinearAllIssuesView(globalViewId);
  const filtersToShowByLayout = isLinearAllIssues
    ? ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters
    : ISSUE_DISPLAY_FILTERS_BY_PAGE.my_issues.filters;
  // Determine initial work item filters based on view type and availability
  const initialWorkItemFilters = useMemo(() => {
    if (!globalViewId) return undefined;

    const isStaticView = STATIC_VIEW_TYPES.includes(globalViewId);
    const hasViewDetails = Boolean(viewDetails);

    if (!isStaticView && !hasViewDetails) return undefined;

    return {
      displayFilters: workItemFilters?.displayFilters,
      displayProperties: workItemFilters?.displayProperties,
      kanbanFilters: workItemFilters?.kanbanFilters,
      richFilters: viewDetails?.rich_filters ?? {},
    };
  }, [globalViewId, viewDetails, workItemFilters]);

  const activeLayout: EIssueLayoutTypes | undefined = workItemFilters?.displayFilters?.layout;

  // Custom hooks
  useWorkspaceIssueProperties(workspaceSlug);

  // Route filters
  const routeFilters: { [key: string]: string } = {};
  searchParams.forEach((value: string, key: string) => {
    routeFilters[key] = value;
  });

  // Fetch next pages callback
  const fetchNextPages = useCallback(() => {
    if (workspaceSlug && globalViewId) fetchNextIssues(workspaceSlug, globalViewId);
  }, [fetchNextIssues, workspaceSlug, globalViewId]);

  // Fetch global views
  const { isLoading: globalViewsLoading } = useSWR(
    workspaceSlug ? `WORKSPACE_GLOBAL_VIEWS_${workspaceSlug}` : null,
    async () => {
      if (workspaceSlug) {
        await fetchAllGlobalViews(workspaceSlug);
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  // Fetch issues — SWR runs once per workspace view; linear mode uses in-memory cache on navigation.
  const { isLoading: issuesLoading } = useSWR(
    workspaceSlug && globalViewId ? `WORKSPACE_GLOBAL_VIEW_ISSUES_${workspaceSlug}_${globalViewId}` : null,
    async () => {
      if (workspaceSlug && globalViewId) {
        if (isLinearAllIssuesView(globalViewId) && isViewDataReady(globalViewId)) {
          return;
        }
        if (!isLinearAllIssuesView(globalViewId) || !groupedIssueIds) {
          clear();
        }
        toggleLoading(true);
        await fetchFilters(workspaceSlug, globalViewId);
        const displayFilters = issuesFilter.getIssueFilters(globalViewId)?.displayFilters;
        const layout = displayFilters?.layout;

        if (layout === EIssueLayoutTypes.CALENDAR || layout === EIssueLayoutTypes.GANTT) {
          toggleLoading(false);
          return;
        }

        const subGroupBy = displayFilters?.sub_group_by;
        const isLinearAll = isLinearAllIssuesView(globalViewId);
        const canGroup = !isLinearAll && layout === EIssueLayoutTypes.KANBAN;
        const perPageCount = isLinearAll ? 100 : layout === EIssueLayoutTypes.KANBAN ? (subGroupBy ? 10 : 30) : 100;

        await fetchIssues(workspaceSlug, globalViewId, groupedIssueIds ? "mutation" : "init-loader", {
          canGroup,
          perPageCount,
        });
        toggleLoading(false);
      }
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  // Linear all-issues: refetch on navigation when SWR cache is stale but MobX store is empty.
  useEffect(() => {
    if (!workspaceSlug || !globalViewId || !isLinearAllIssues) return;
    if (isViewDataReady(globalViewId)) return;

    let cancelled = false;

    void (async () => {
      await fetchFilters(workspaceSlug, globalViewId);
      if (cancelled) return;

      const displayFilters = issuesFilter.getIssueFilters(globalViewId)?.displayFilters;
      const layout = displayFilters?.layout;

      if (layout === EIssueLayoutTypes.CALENDAR || layout === EIssueLayoutTypes.GANTT) {
        return;
      }

      await fetchIssues(workspaceSlug, globalViewId, "init-loader", {
        canGroup: false,
        perPageCount: 100,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, globalViewId, isLinearAllIssues, isViewDataReady, fetchFilters, fetchIssues, issuesFilter]);

  // Empty state
  if (!isLoading && !globalViewsLoading && !issuesLoading && !viewDetails && !isDefaultView) {
    return (
      <EmptyStateDetailed
        title="View does not exist"
        description="The view you are looking for does not exist or you don't have permission to view it."
        assetKey="view"
        actions={[
          {
            label: "Go to All work items",
            onClick: () => router.push(`/${workspaceSlug}/workspace-views/all-issues`),
            variant: "primary",
          },
        ]}
      />
    );
  }

  if (!workspaceSlug || !globalViewId) return null;
  return (
    <IssuesStoreContext.Provider value={EIssuesStoreType.GLOBAL}>
      <WorkspaceLevelWorkItemFiltersHOC
        enableSaveView
        saveViewOptions={{
          label: "Save as",
        }}
        enableUpdateView
        entityId={globalViewId}
        entityType={EIssuesStoreType.GLOBAL}
        filtersToShowByLayout={filtersToShowByLayout}
        initialWorkItemFilters={initialWorkItemFilters}
        updateFilters={updateFilterExpression.bind(updateFilterExpression, workspaceSlug, globalViewId)}
        workspaceSlug={workspaceSlug}
      >
        {({ filter: globalWorkItemsFilter }) => (
          <div className="h-full overflow-hidden bg-surface-1">
            <div className="flex h-full w-full flex-col border-b border-strong">
              {globalWorkItemsFilter && <WorkItemFiltersRow filter={globalWorkItemsFilter} />}
              <WorkspaceActiveLayout
                activeLayout={activeLayout}
                isDefaultView={isDefaultView}
                isLoading={isLoading}
                toggleLoading={toggleLoading}
                workspaceSlug={workspaceSlug}
                globalViewId={globalViewId}
                routeFilters={routeFilters}
                fetchNextPages={fetchNextPages}
                globalViewsLoading={globalViewsLoading}
                issuesLoading={issuesLoading}
              />
            </div>
            {/* peek overview */}
            <IssuePeekOverview />
          </div>
        )}
      </WorkspaceLevelWorkItemFiltersHOC>
    </IssuesStoreContext.Provider>
  );
});
