/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { observer } from "mobx-react";
// plane constants
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { GroupByColumnTypes, TGroupedIssues, TIssueKanbanFilters } from "@plane/types";
import { EIssuesStoreType, EIssueLayoutTypes } from "@plane/types";
// components
import { AllIssueQuickActions } from "@/components/issues/issue-layouts/quick-action-dropdowns";
import { KanbanLayoutLoader } from "@/components/ui/loader/layouts/kanban-layout-loader";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
import { groupLinearIssuesFromFlatList, isLinearAllIssuesView } from "@/helpers/linear-display.helper";
// local imports
import { IssueLayoutHOC } from "../../issue-layout-HOC";
import type { TRenderQuickActions } from "../../list/list-view-types";
import { KanBan } from "../default";
import { KanBanSwimLanes } from "../swimlanes";

type Props = {
  isLoading?: boolean;
  workspaceSlug: string;
  globalViewId: string;
  issuesLoading: boolean;
};

export const WorkspaceKanbanRoot = observer(function WorkspaceKanbanRoot(props: Props) {
  const { isLoading = false, workspaceSlug, globalViewId, issuesLoading } = props;

  useWorkspaceIssueProperties(workspaceSlug);

  const scrollableContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    issuesFilter: { filters, updateFilters },
    issues: { getIssueLoader, groupedIssueIds, getGroupIssueCount, isViewDataReady },
  } = useIssues(EIssuesStoreType.GLOBAL);
  const { updateIssue, removeIssue, archiveIssue, fetchNextIssues } = useIssuesActions(EIssuesStoreType.GLOBAL);
  const { allowPermissions } = useUserPermissions();
  const { issueMap } = useIssues();

  const issueFilters = globalViewId ? filters?.[globalViewId.toString()] : undefined;
  const displayFilters = issueFilters?.displayFilters;
  const displayProperties = issueFilters?.displayProperties;
  const group_by = (displayFilters?.group_by || null) as GroupByColumnTypes | null;
  const sub_group_by = displayFilters?.sub_group_by;
  const orderBy = displayFilters?.order_by || undefined;
  const showEmptyGroup = displayFilters?.show_empty_groups ?? true;
  const collapsedGroups = issueFilters?.kanbanFilters || ({ group_by: [], sub_group_by: [] } as TIssueKanbanFilters);

  const KanBanView = sub_group_by ? KanBanSwimLanes : KanBan;
  const kanbanGroupedIssueIds = useMemo(() => {
    if (!groupedIssueIds) return {} as TGroupedIssues;
    if (isLinearAllIssuesView(globalViewId) && group_by) {
      return groupLinearIssuesFromFlatList(groupedIssueIds as TGroupedIssues, issueMap, group_by);
    }
    return groupedIssueIds as TGroupedIssues;
  }, [globalViewId, group_by, groupedIssueIds, issueMap]);

  const getKanbanGroupIssueCount = useCallback(
    (groupId: string | undefined, subGroupId: string | undefined, isSubGroupCumulative: boolean) => {
      if (isLinearAllIssuesView(globalViewId) && group_by && groupId) {
        const ids = kanbanGroupedIssueIds[groupId];
        return Array.isArray(ids) ? ids.length : 0;
      }
      return getGroupIssueCount(groupId, subGroupId, isSubGroupCumulative);
    },
    [globalViewId, group_by, kanbanGroupedIssueIds, getGroupIssueCount]
  );

  const canEditProperties = useCallback(
    (projectId: string | undefined) => {
      if (!projectId) return false;
      return allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.PROJECT,
        workspaceSlug.toString(),
        projectId
      );
    },
    [allowPermissions, workspaceSlug]
  );

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef, customActionButton, placement, portalElement }) => (
      <AllIssueQuickActions
        parentRef={parentRef}
        customActionButton={customActionButton}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        portalElement={portalElement}
        readOnly={!canEditProperties(issue.project_id ?? undefined)}
        placements={placement}
      />
    ),
    [canEditProperties, removeIssue, updateIssue, archiveIssue]
  );

  const fetchMoreIssues = useCallback(
    (groupId?: string, subgroupId?: string) => {
      if (getIssueLoader(groupId, subgroupId) !== "pagination") {
        void fetchNextIssues(groupId, subgroupId);
      }
    },
    [fetchNextIssues, getIssueLoader]
  );

  const handleCollapsedGroups = useCallback(
    (toggle: "group_by" | "sub_group_by", value: string) => {
      if (!workspaceSlug || !globalViewId) return;

      let collapsedGroupIds = issueFilters?.kanbanFilters?.[toggle] || [];
      if (collapsedGroupIds.includes(value)) {
        collapsedGroupIds = collapsedGroupIds.filter((_value) => _value !== value);
      } else {
        collapsedGroupIds.push(value);
      }

      updateFilters(
        workspaceSlug.toString(),
        undefined,
        EIssueFilterType.KANBAN_FILTERS,
        { [toggle]: collapsedGroupIds } as TIssueKanbanFilters,
        globalViewId.toString()
      );
    },
    [workspaceSlug, globalViewId, issueFilters, updateFilters]
  );

  useEffect(() => {
    const element = scrollableContainerRef.current;
    if (!element) return;

    return combine(
      autoScrollForElements({
        element,
      })
    );
  }, []);

  if (
    (isLoading && issuesLoading && getIssueLoader() === "init-loader") ||
    !globalViewId ||
    (isLinearAllIssuesView(globalViewId) && !isViewDataReady(globalViewId)) ||
    (!isLinearAllIssuesView(globalViewId) && !groupedIssueIds)
  ) {
    return <KanbanLayoutLoader />;
  }

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.KANBAN}>
      <div
        className={`horizontal-scrollbar relative flex scrollbar-lg h-full w-full bg-surface-2 ${sub_group_by ? "vertical-scrollbar overflow-y-auto" : "overflow-x-auto overflow-y-hidden"}`}
        ref={scrollableContainerRef}
      >
        <div className="relative h-full w-max min-w-full bg-surface-2">
          <div className="h-full w-max">
            <KanBanView
              issuesMap={issueMap}
              groupedIssueIds={kanbanGroupedIssueIds}
              getGroupIssueCount={getKanbanGroupIssueCount}
              displayProperties={displayProperties}
              sub_group_by={sub_group_by}
              group_by={group_by}
              orderBy={orderBy}
              updateIssue={updateIssue}
              quickActions={renderQuickActions}
              handleCollapsedGroups={handleCollapsedGroups}
              collapsedGroups={collapsedGroups}
              enableQuickIssueCreate={false}
              showEmptyGroup={showEmptyGroup}
              quickAddCallback={undefined}
              disableIssueCreation
              canEditProperties={canEditProperties}
              scrollableContainerRef={scrollableContainerRef}
              handleOnDrop={async () => {}}
              loadMoreIssues={fetchMoreIssues}
            />
          </div>
        </div>
      </div>
    </IssueLayoutHOC>
  );
});
