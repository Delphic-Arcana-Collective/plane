/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Navigate } from "react-router";
import { LogoSpinner } from "@/components/common/logo-spinner";
import { getLinearProjectIssuesPath } from "@/helpers/linear-display.helper";
import { useProject } from "@/hooks/store/use-project";

/** Linear mode shows one project at a time — redirect merged all-issues routes to the first project. */
export const LinearDefaultProjectRedirect = observer(function LinearDefaultProjectRedirect() {
  const { workspaceSlug } = useParams();
  const { joinedProjectIds, loader } = useProject();

  if (loader) {
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  }

  const slug = workspaceSlug?.toString();
  const firstProjectId = joinedProjectIds[0];
  if (slug && firstProjectId) {
    return <Navigate to={getLinearProjectIssuesPath(slug, firstProjectId)} replace />;
  }

  return null;
});
