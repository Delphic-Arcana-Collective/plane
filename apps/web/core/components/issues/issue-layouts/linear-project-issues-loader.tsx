/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Full-area centered loader for Linear project issue views — single loading UI for all layouts. */
export function LinearProjectIssuesLoader() {
  return (
    <div className="relative flex size-full min-h-[320px] items-center justify-center bg-surface-2">
      <div
        className="size-6 animate-spin rounded-full border-2 border-white/25 border-t-white"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
