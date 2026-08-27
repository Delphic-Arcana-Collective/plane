/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
// components
import { LayoutErrorBoundary } from "@/components/common/layout-error-boundary";
import { CalendarLayoutLoader } from "@/components/ui/loader/layouts/calendar-layout-loader";
import { GanttLayoutLoader } from "@/components/ui/loader/layouts/gantt-layout-loader";
import { KanbanLayoutLoader } from "@/components/ui/loader/layouts/kanban-layout-loader";
import { ListLayoutLoader } from "@/components/ui/loader/layouts/list-layout-loader";
import { SpreadsheetLayoutLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { decodeRouteProjectId, isLinearReadOnly } from "@/helpers/linear-display.helper";
// local imports
import { IssueLayoutEmptyState } from "./empty-states";

function ActiveLoader(props: { layout: EIssueLayoutTypes }) {
  const { layout } = props;
  switch (layout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayoutLoader />;
    case EIssueLayoutTypes.KANBAN:
      return <KanbanLayoutLoader />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <SpreadsheetLayoutLoader />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayoutLoader />;
    case EIssueLayoutTypes.GANTT:
      return <GanttLayoutLoader />;
    default:
      return null;
  }
}

interface Props {
  children: string | React.ReactNode | React.ReactNode[];
  layout: EIssueLayoutTypes;
}

export const IssueLayoutHOC = observer(function IssueLayoutHOC(props: Props) {
  const { layout } = props;

  const storeType = useIssueStoreType();
  const { projectId: routeProjectIdParam } = useParams();
  const routeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());
  const { issues } = useIssues(storeType);

  const isLinearProject =
    storeType === EIssuesStoreType.PROJECT && isLinearReadOnly() && "isProjectDataReady" in issues;

  if (isLinearProject) {
    if (!routeProjectId || !issues.isProjectDataReady(routeProjectId)) {
      return <ActiveLoader layout={layout} />;
    }
    return <LayoutErrorBoundary key={layout}>{props.children}</LayoutErrorBoundary>;
  }

  const issueCount = issues.getGroupIssueCount(undefined, undefined, false);

  if (issues?.getIssueLoader() === "init-loader" || issueCount === undefined) {
    return <ActiveLoader layout={layout} />;
  }

  if (issueCount === 0 && layout !== EIssueLayoutTypes.CALENDAR) {
    return <IssueLayoutEmptyState storeType={storeType} />;
  }

  return <LayoutErrorBoundary key={layout}>{props.children}</LayoutErrorBoundary>;
});
