/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { observer } from "mobx-react";
// plane constants
import { EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { GroupByColumnTypes, TGroupedIssues, TIssueKanbanFilters } from "@plane/types";
import { EIssuesStoreType, EIssueLayoutTypes } from "@plane/types";
// components
import { AllIssueQuickActions } from "@/components/issues/issue-layouts/quick-action-dropdowns";
import { ListLayoutLoader } from "@/components/ui/loader/layouts/list-layout-loader";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useWorkspaceIssueProperties } from "@/hooks/use-workspace-issue-properties";
// local imports
import { IssueLayoutHOC } from "../../issue-layout-HOC";
import type { TRenderQuickActions } from "../list-view-types";
import { List } from "../default";

type Props = {
  isLoading?: boolean;
  workspaceSlug: string;
  globalViewId: string;
  fetchNextPages: () => void;
  issuesLoading: boolean;
};

export const WorkspaceListRoot = observer(function WorkspaceListRoot(props: Props) {
  const { isLoading = false, workspaceSlug, globalViewId, fetchNextPages, issuesLoading } = props;

  useWorkspaceIssueProperties(workspaceSlug);

  const {
    issuesFilter: { filters, updateFilters },
    issues: { getIssueLoader, groupedIssueIds },
  } = useIssues(EIssuesStoreType.GLOBAL);
  const { updateIssue, removeIssue, archiveIssue } = useIssuesActions(EIssuesStoreType.GLOBAL);
  const { allowPermissions } = useUserPermissions();
  const { issueMap } = useIssues();

  const issueFilters = globalViewId ? filters?.[globalViewId.toString()] : undefined;
  const displayFilters = issueFilters?.displayFilters;
  const displayProperties = issueFilters?.displayProperties;
  const group_by = (displayFilters?.group_by || null) as GroupByColumnTypes | null;
  const orderBy = displayFilters?.order_by || undefined;
  const showEmptyGroup = displayFilters?.show_empty_groups ?? false;
  const collapsedGroups = issueFilters?.kanbanFilters || ({ group_by: [], sub_group_by: [] } as TIssueKanbanFilters);

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

  const handleCollapsedGroups = useCallback(
    (value: string) => {
      if (!workspaceSlug || !globalViewId) return;

      let collapsedGroupIds = issueFilters?.kanbanFilters?.group_by || [];
      if (collapsedGroupIds.includes(value)) {
        collapsedGroupIds = collapsedGroupIds.filter((_value) => _value !== value);
      } else {
        collapsedGroupIds.push(value);
      }

      updateFilters(
        workspaceSlug.toString(),
        undefined,
        EIssueFilterType.KANBAN_FILTERS,
        { group_by: collapsedGroupIds } as TIssueKanbanFilters,
        globalViewId.toString()
      );
    },
    [workspaceSlug, globalViewId, issueFilters, updateFilters]
  );

  if ((isLoading && issuesLoading && getIssueLoader() === "init-loader") || !globalViewId || !groupedIssueIds) {
    return <ListLayoutLoader />;
  }

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.LIST}>
      <div className="relative size-full bg-surface-2">
        <List
          issuesMap={issueMap}
          displayProperties={displayProperties}
          group_by={group_by}
          orderBy={orderBy}
          updateIssue={updateIssue}
          quickActions={renderQuickActions}
          groupedIssueIds={(groupedIssueIds ?? {}) as TGroupedIssues}
          loadMoreIssues={fetchNextPages}
          showEmptyGroup={showEmptyGroup}
          enableIssueQuickAdd={false}
          canEditProperties={canEditProperties}
          disableIssueCreation
          handleOnDrop={async () => {}}
          handleCollapsedGroups={handleCollapsedGroups}
          collapsedGroups={collapsedGroups}
        />
      </div>
    </IssueLayoutHOC>
  );
});
