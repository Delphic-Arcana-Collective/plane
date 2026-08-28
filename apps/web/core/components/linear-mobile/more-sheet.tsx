/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EIssueFilterType } from "@plane/constants";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { cn } from "@plane/utils";
import { decodeRouteProjectId } from "@/helpers/linear-display.helper";
import { useIssues } from "@/hooks/store/use-issues";

type Props = {
  open: boolean;
  onClose: () => void;
};

const LAYOUTS: { id: EIssueLayoutTypes; label: string }[] = [
  { id: EIssueLayoutTypes.LIST, label: "List" },
  { id: EIssueLayoutTypes.KANBAN, label: "Board" },
  { id: EIssueLayoutTypes.CALENDAR, label: "Calendar" },
];

export const LinearMobileMoreSheet = observer(function LinearMobileMoreSheet(props: Props) {
  const { open, onClose } = props;
  const { workspaceSlug, projectId: routeProjectIdParam } = useParams();
  const routeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());
  const {
    issuesFilter: { issueFilters, updateFilters },
  } = useIssues(EIssuesStoreType.PROJECT);

  const activeLayout = issueFilters?.displayFilters?.layout;

  if (!open) return null;

  const handleLayout = (layout: EIssueLayoutTypes) => {
    if (!workspaceSlug || !routeProjectId) return;
    updateFilters(workspaceSlug.toString(), routeProjectId, EIssueFilterType.DISPLAY_FILTERS, { layout });
    onClose();
  };

  return (
    <>
      {/* oxlint-disable-next-line jsx_a11y/click-events-have-key-events jsx_a11y/no-static-element-interactions */}
      <div className="fixed inset-0 z-[40] bg-black/40" onClick={onClose} />
      <div className="shadow-lg fixed inset-x-0 bottom-0 z-[41] rounded-t-2xl border-t border-subtle bg-surface-1 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto mt-2 mb-3 h-1 w-10 rounded-full bg-layer-2" />
        <div className="px-4 pb-4">
          <p className="mb-2 text-12 font-medium text-tertiary">Layout</p>
          <div className="flex flex-col gap-1">
            {LAYOUTS.map((layout) => (
              <button
                key={layout.id}
                type="button"
                disabled={!routeProjectId}
                className={cn(
                  "flex h-11 items-center rounded-lg px-3 text-left text-14 text-primary transition-colors",
                  activeLayout === layout.id ? "bg-layer-1 font-medium" : "hover:bg-layer-transparent-hover",
                  !routeProjectId && "opacity-40"
                )}
                onClick={() => handleLayout(layout.id)}
              >
                {layout.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
});
