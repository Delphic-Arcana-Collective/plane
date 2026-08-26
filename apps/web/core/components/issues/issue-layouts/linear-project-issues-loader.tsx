/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { LogoSpinner } from "@/components/common/logo-spinner";

/** Full-area centered loader for Linear project issue views — single loading UI for all layouts. */
export function LinearProjectIssuesLoader() {
  return (
    <div className="relative flex size-full min-h-[320px] items-center justify-center bg-surface-2">
      <LogoSpinner />
    </div>
  );
}
