/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { FC } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane constants
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// types
import {
  EIssueLayoutTypes,
  EIssuesStoreType,
  type GroupByColumnTypes,
  type TGroupedIssues,
  type TIssueKanbanFilters,
} from "@plane/types";
import { decodeRouteProjectId, isLinearReadOnly, resolveLinearGroupedIssueIds } from "@/helpers/linear-display.helper";
// constants
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
// hooks
import { useGroupIssuesDragNDrop } from "@/hooks/use-group-dragndrop";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
// components
import { IssueLayoutHOC } from "../issue-layout-HOC";
import { List } from "./default";
// types
import type { IQuickActionProps, TRenderQuickActions } from "./list-view-types";

type ListStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.PROFILE
  | EIssuesStoreType.ARCHIVED
  | EIssuesStoreType.WORKSPACE_DRAFT
  | EIssuesStoreType.TEAM
  | EIssuesStoreType.TEAM_VIEW
  | EIssuesStoreType.EPIC;

interface IBaseListRoot {
  QuickActions: FC<IQuickActionProps>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  canEditPropertiesBasedOnProject?: (projectId: string) => boolean;
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}
export const BaseListRoot = observer(function BaseListRoot(props: IBaseListRoot) {
  const {
    QuickActions,
    viewId,
    addIssuesToView,
    canEditPropertiesBasedOnProject,
    isCompletedCycle = false,
    isEpic = false,
  } = props;
  // router
  const storeType = useIssueStoreType() as ListStoreType;
  //stores
  const { issuesFilter, issues } = useIssues(storeType);
  const {
    fetchIssues,
    fetchNextIssues,
    quickAddIssue,
    updateIssue,
    removeIssue,
    removeIssueFromView,
    archiveIssue,
    restoreIssue,
  } = useIssuesActions(storeType);
  // mobx store
  const { allowPermissions } = useUserPermissions();
  const { issueMap } = useIssues();

  const { workspaceSlug, projectId: routeProjectIdParam } = useParams();
  const workspaceSlugStr = workspaceSlug?.toString();
  const routeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());

  const issueFiltersForView =
    storeType === EIssuesStoreType.PROJECT && routeProjectId && issuesFilter && "getIssueFilters" in issuesFilter
      ? issuesFilter.getIssueFilters(routeProjectId)
      : issuesFilter?.issueFilters;

  const displayFilters = issueFiltersForView?.displayFilters;
  const displayProperties = issueFiltersForView?.displayProperties;
  const orderBy = displayFilters?.order_by || undefined;

  const group_by = (displayFilters?.group_by || null) as GroupByColumnTypes | null;
  const showEmptyGroup = displayFilters?.show_empty_groups ?? false;
  const layout = displayFilters?.layout;
  const { updateFilters } = useIssuesActions(storeType);
  const collapsedGroups =
    issueFiltersForView?.kanbanFilters || ({ group_by: [], sub_group_by: [] } as TIssueKanbanFilters);

  const isLinearProject = storeType === EIssuesStoreType.PROJECT && isLinearReadOnly();
  const linearLoadedProjectId = isLinearProject && "loadedProjectId" in issues ? issues.loadedProjectId : null;
  const isLinearProjectReady =
    isLinearProject && routeProjectId && "isProjectViewReady" in issues
      ? issues.isProjectViewReady(routeProjectId)
      : true;

  useEffect(() => {
    if (!displayFilters || !workspaceSlugStr || !routeProjectId) return;
    if (isLinearProject && linearLoadedProjectId === routeProjectId && isLinearProjectReady) {
      return;
    }
    fetchIssues(
      "init-loader",
      { canGroup: !isLinearProject, perPageCount: isLinearProject ? 100 : group_by ? 50 : 100 },
      viewId
    );
  }, [
    fetchIssues,
    storeType,
    group_by,
    viewId,
    layout,
    displayFilters,
    workspaceSlugStr,
    routeProjectId,
    isLinearProject,
    linearLoadedProjectId,
    isLinearProjectReady,
  ]);

  const groupedIssueIds = useMemo(() => {
    const raw = issues?.groupedIssueIds as TGroupedIssues | undefined;
    if (!raw) return undefined;
    if (isLinearProject && group_by) {
      return resolveLinearGroupedIssueIds(raw, issueMap, group_by);
    }
    return raw;
  }, [isLinearProject, group_by, issues?.groupedIssueIds, issueMap]);
  // auth
  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );
  const { enableInlineEditing, enableQuickAdd, enableIssueCreation } = issues?.viewFlags || {};

  const canEditProperties = useCallback(
    (targetProjectId: string | undefined) => {
      const isEditingAllowedBasedOnProject =
        canEditPropertiesBasedOnProject && targetProjectId
          ? canEditPropertiesBasedOnProject(targetProjectId)
          : isEditingAllowed;

      return !!enableInlineEditing && isEditingAllowedBasedOnProject;
    },
    [canEditPropertiesBasedOnProject, enableInlineEditing, isEditingAllowed]
  );

  const handleOnDrop = useGroupIssuesDragNDrop(storeType, orderBy, group_by);

  const renderQuickActions: TRenderQuickActions = useCallback(
    ({ issue, parentRef }) => (
      <QuickActions
        parentRef={parentRef}
        issue={issue}
        handleDelete={async () => removeIssue(issue.project_id, issue.id)}
        handleUpdate={async (data) => updateIssue && updateIssue(issue.project_id, issue.id, data)}
        handleRemoveFromView={async () => removeIssueFromView && removeIssueFromView(issue.project_id, issue.id)}
        handleArchive={async () => archiveIssue && archiveIssue(issue.project_id, issue.id)}
        handleRestore={async () => restoreIssue && restoreIssue(issue.project_id, issue.id)}
        readOnly={!canEditProperties(issue.project_id ?? undefined) || isCompletedCycle}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isCompletedCycle, canEditProperties, removeIssue, updateIssue, removeIssueFromView, archiveIssue, restoreIssue]
  );

  const loadMoreIssues = useCallback(
    (groupId?: string) => {
      fetchNextIssues(groupId);
    },
    [fetchNextIssues]
  );

  // kanbanFilters and EIssueFilterType.KANBAN_FILTERS are used because the state is shared between kanban view and list view
  const handleCollapsedGroups = useCallback(
    (value: string) => {
      if (workspaceSlugStr) {
        let collapsedGroupIds = issueFiltersForView?.kanbanFilters?.group_by || [];
        if (collapsedGroupIds.includes(value)) {
          collapsedGroupIds = collapsedGroupIds.filter((_value) => _value != value);
        } else {
          collapsedGroupIds.push(value);
        }
        updateFilters(routeProjectId ?? "", EIssueFilterType.KANBAN_FILTERS, {
          group_by: collapsedGroupIds,
        } as TIssueKanbanFilters);
      }
    },
    [workspaceSlugStr, issueFiltersForView, routeProjectId, updateFilters]
  );

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.LIST}>
      <div className={`relative size-full bg-surface-2`}>
        <List
          issuesMap={issueMap}
          displayProperties={displayProperties}
          group_by={group_by}
          orderBy={orderBy}
          updateIssue={updateIssue}
          quickActions={renderQuickActions}
          groupedIssueIds={groupedIssueIds ?? {}}
          loadMoreIssues={loadMoreIssues}
          showEmptyGroup={showEmptyGroup}
          quickAddCallback={quickAddIssue}
          enableIssueQuickAdd={!!enableQuickAdd}
          canEditProperties={canEditProperties}
          disableIssueCreation={!enableIssueCreation || !isEditingAllowed}
          addIssuesToView={addIssuesToView}
          isCompletedCycle={isCompletedCycle}
          handleOnDrop={handleOnDrop}
          handleCollapsedGroups={handleCollapsedGroups}
          collapsedGroups={collapsedGroups}
          isEpic={isEpic}
        />
      </div>
    </IssueLayoutHOC>
  );
});
