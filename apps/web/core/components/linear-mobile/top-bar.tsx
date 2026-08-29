/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { decodeRouteProjectId } from "@/helpers/linear-display.helper";
import { useProject } from "@/hooks/store/use-project";

type Props = {
  onOpenProjects: () => void;
};

export const LinearMobileTopBar = observer(function LinearMobileTopBar(props: Props) {
  const { onOpenProjects } = props;
  const { projectId: routeProjectIdParam } = useParams();
  const routeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());
  const { getProjectById } = useProject();

  const project = routeProjectId ? getProjectById(routeProjectId) : undefined;
  const title = project?.name ?? "Projects";

  return (
    <header className="sticky top-0 z-[20] flex h-12 shrink-0 items-center gap-2 border-b border-subtle bg-surface-1 px-2 pt-[env(safe-area-inset-top)]">
      <button
        type="button"
        aria-label="Open projects"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-layer-transparent-hover hover:text-primary"
        onClick={onOpenProjects}
      >
        <PanelLeft className="size-5" strokeWidth={1.75} />
      </button>
      <h1 className="text-15 min-w-0 flex-1 truncate font-semibold text-primary">{title}</h1>
    </header>
  );
});
