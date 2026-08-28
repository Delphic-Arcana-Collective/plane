/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { cn } from "@plane/utils";
import { useLinearMobile } from "@/hooks/use-linear-mobile";
import { LinearMobileBottomTabs } from "./bottom-tabs";
import { LinearMobileTopBar } from "./top-bar";

type Props = {
  children: ReactNode;
  sidebar: ReactNode;
  extendedSidebar?: ReactNode;
};

/**
 * Linear-mode workspace chrome.
 * Desktop (≥768): Plane sidebar shell unchanged.
 * Mobile (<768): full-bleed content + top Create bar + bottom tabs (Linear Mobile pattern).
 */
export const LinearMobileShell = observer(function LinearMobileShell(props: Props) {
  const { children, sidebar, extendedSidebar } = props;
  const isLinearMobile = useLinearMobile();

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden",
        !isLinearMobile && "rounded-lg border border-subtle"
      )}
    >
      <div id="full-screen-portal" className="absolute inset-0 w-full" />
      <div className="relative flex size-full overflow-hidden">
        {!isLinearMobile && sidebar}
        {!isLinearMobile && extendedSidebar}
        <main
          className={cn(
            "relative flex h-full w-full flex-col overflow-hidden bg-surface-1",
            isLinearMobile && "pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
          )}
        >
          {isLinearMobile && <LinearMobileTopBar />}
          {children}
          {isLinearMobile && <LinearMobileBottomTabs />}
        </main>
      </div>
    </div>
  );
});
