/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Logo } from "@plane/propel/emoji-icon-picker";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
import {
  decodeRouteProjectId,
  getLinearProjectIssuesPath,
  getLinearWorkspaceSlug,
} from "@/helpers/linear-display.helper";
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";

type Props = {
  open: boolean;
  onClose: () => void;
};

export const LinearMobileProjectDrawer = observer(function LinearMobileProjectDrawer(props: Props) {
  const { open, onClose } = props;
  const router = useAppRouter();
  const { workspaceSlug: routeWorkspaceSlug, projectId: routeProjectIdParam } = useParams();
  const workspaceSlug = routeWorkspaceSlug?.toString() || getLinearWorkspaceSlug();
  const activeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());
  const { loader, joinedProjectIds, getPartialProjectById } = useProject();

  const selectProject = (projectId: string) => {
    router.push(getLinearProjectIssuesPath(workspaceSlug, projectId));
    onClose();
  };

  return (
    <>
      {/* oxlint-disable-next-line jsx_a11y/click-events-have-key-events jsx_a11y/no-static-element-interactions */}
      <div
        className={cn(
          "fixed inset-0 z-[45] bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "shadow-xl fixed inset-y-0 left-0 z-[46] flex w-[min(20rem,85vw)] flex-col bg-surface-1 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Projects"
        aria-hidden={!open}
      >
        <div className="flex h-12 shrink-0 items-center border-b border-subtle px-4">
          <h2 className="text-15 font-semibold text-primary">Projects</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loader === "init-loader" && (
            <div className="px-2 py-4">
              <Loader className="space-y-2">
                <Loader.Item height="36px" width="100%" />
                <Loader.Item height="36px" width="100%" />
                <Loader.Item height="36px" width="100%" />
              </Loader>
            </div>
          )}
          {joinedProjectIds.map((projectId) => {
            const project = getPartialProjectById(projectId);
            if (!project) return null;
            const isActive = activeProjectId === projectId;
            return (
              <button
                key={projectId}
                type="button"
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-14 transition-colors",
                  isActive ? "bg-layer-1 font-medium text-primary" : "text-secondary hover:bg-layer-transparent-hover"
                )}
                onClick={() => selectProject(projectId)}
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <Logo logo={project.logo_props} size={16} />
                </span>
                <span className="truncate">{project.name}</span>
              </button>
            );
          })}
          {loader !== "init-loader" && joinedProjectIds.length === 0 && (
            <p className="px-3 py-6 text-center text-13 text-tertiary">No projects</p>
          )}
        </div>
      </aside>
    </>
  );
});
