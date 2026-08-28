/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { Outlet } from "react-router";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { useLinearMobile } from "@/hooks/use-linear-mobile";
import { ProjectIssuesHeader } from "./header";
import { ProjectIssuesMobileHeader } from "./mobile-header";

export default function ProjectIssuesLayout() {
  const isLinearMobile = useLinearMobile();

  return (
    <>
      <AppHeader
        header={<ProjectIssuesHeader />}
        // Linear mobile shell already provides top Create + bottom More (layout picker).
        mobileHeader={isLinearMobile ? undefined : <ProjectIssuesMobileHeader />}
      />
      <ContentWrapper>
        <Outlet />
      </ContentWrapper>
    </>
  );
}
