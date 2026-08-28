/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type { ComponentType } from "react";
import { observer } from "mobx-react";
import { useParams, usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { EIssuesStoreType } from "@plane/types";
import { HomeIcon, PlusIcon, SearchIcon, WorkItemsIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";
import {
  decodeRouteProjectId,
  getLinearAllIssuesPath,
  getLinearProjectIssuesPath,
  getLinearWorkspaceSlug,
} from "@/helpers/linear-display.helper";
import { useCommandPalette } from "@/hooks/store/use-command-palette";
import { usePowerK } from "@/hooks/store/use-power-k";
import { useAppRouter } from "@/hooks/use-app-router";
import { LinearMobileMoreSheet } from "./more-sheet";

type TabId = "home" | "issues" | "create" | "search" | "more";

export const LinearMobileBottomTabs = observer(function LinearMobileBottomTabs() {
  const router = useAppRouter();
  const pathname = usePathname() ?? "";
  const { workspaceSlug: routeWorkspaceSlug, projectId: routeProjectIdParam } = useParams();
  const workspaceSlug = routeWorkspaceSlug?.toString() || getLinearWorkspaceSlug();
  const routeProjectId = decodeRouteProjectId(routeProjectIdParam?.toString());
  const { toggleCreateIssueModal } = useCommandPalette();
  const { togglePowerKModal } = usePowerK();
  const [moreOpen, setMoreOpen] = useState(false);

  const homeHref = `/${workspaceSlug}/projects/`;
  const issuesHref = routeProjectId
    ? getLinearProjectIssuesPath(workspaceSlug, routeProjectId)
    : getLinearAllIssuesPath(workspaceSlug);

  const isIssuesPath = pathname.includes("/issues") || pathname.includes("/workspace-views/all-issues");
  const isHomePath = pathname.includes("/projects") && !isIssuesPath;

  const active: TabId | null = moreOpen ? "more" : isHomePath ? "home" : isIssuesPath ? "issues" : null;

  const tabs: {
    id: TabId;
    label: string;
    // Propel icons accept a broader SVG props shape than a minimal className/strokeWidth type.
    icon: ComponentType<Record<string, unknown>>;
    onClick: () => void;
    primary?: boolean;
  }[] = [
    {
      id: "home",
      label: "Home",
      icon: HomeIcon as ComponentType<Record<string, unknown>>,
      onClick: () => router.push(homeHref),
    },
    {
      id: "issues",
      label: "Issues",
      icon: WorkItemsIcon as ComponentType<Record<string, unknown>>,
      onClick: () => router.push(issuesHref),
    },
    {
      id: "create",
      label: "Create",
      icon: PlusIcon as ComponentType<Record<string, unknown>>,
      primary: true,
      onClick: () => toggleCreateIssueModal(true, EIssuesStoreType.PROJECT),
    },
    {
      id: "search",
      label: "Search",
      icon: SearchIcon as ComponentType<Record<string, unknown>>,
      onClick: () => togglePowerKModal(true),
    },
    {
      id: "more",
      label: "More",
      icon: MoreHorizontal as ComponentType<Record<string, unknown>>,
      onClick: () => setMoreOpen(true),
    },
  ];

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-[30] border-t border-subtle bg-surface-1 pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        <div className="flex h-14 items-stretch justify-around px-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = active === tab.id;
            if (tab.primary) {
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-label={tab.label}
                  className="flex flex-1 flex-col items-center justify-center gap-0.5"
                  onClick={tab.onClick}
                >
                  <span className="shadow-sm flex size-10 items-center justify-center rounded-full bg-accent-primary text-on-color">
                    <Icon className="size-5" strokeWidth={2} />
                  </span>
                </button>
              );
            }
            return (
              <button
                key={tab.id}
                type="button"
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-11 transition-colors",
                  isActive ? "text-primary" : "text-tertiary"
                )}
                onClick={tab.onClick}
              >
                <Icon className="size-5" strokeWidth={isActive ? 2 : 1.5} />
                <span className={cn(isActive && "font-medium")}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <LinearMobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
});
