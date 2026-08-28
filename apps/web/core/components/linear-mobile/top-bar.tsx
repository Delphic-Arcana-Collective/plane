/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { EIssuesStoreType } from "@plane/types";
import { Button } from "@plane/propel/button";
import { PlusIcon } from "@plane/propel/icons";
import { decodeRouteProjectId } from "@/helpers/linear-display.helper";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { useProject } from "@/hooks/store/use-project";

export const LinearMobileTopBar = observer(function LinearMobileTopBar() {
  const { projectId: routeProjectIdParam } = useParams();
  const routeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());
  const { getProjectById } = useProject();
  const { toggleCreateIssueModal } = useCommandPalette();

  const project = routeProjectId ? getProjectById(routeProjectId) : undefined;
  const title = project?.name ?? "Delphic";

  return (
    <header className="sticky top-0 z-[20] flex h-12 shrink-0 items-center justify-between gap-3 border-b border-subtle bg-surface-1 px-3 pt-[env(safe-area-inset-top)]">
      <h1 className="text-15 truncate font-semibold text-primary">{title}</h1>
      <Button
        variant="primary"
        size="sm"
        className="flex-shrink-0"
        onClick={() => toggleCreateIssueModal(true, EIssuesStoreType.PROJECT)}
      >
        <PlusIcon className="size-3.5" strokeWidth={2} />
        Create
      </Button>
    </header>
  );
});
