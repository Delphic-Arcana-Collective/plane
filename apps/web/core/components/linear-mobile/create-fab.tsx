/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EIssuesStoreType } from "@plane/types";
import { PlusIcon } from "@plane/propel/icons";
import { useCommandPalette } from "@/hooks/store/use-command-palette";

/** Floating create button — Plane accent circle with white plus (Linear-away, Plane-themed). */
export const LinearMobileCreateFab = observer(function LinearMobileCreateFab() {
  const { toggleCreateIssueModal } = useCommandPalette();

  return (
    <button
      type="button"
      aria-label="Create issue"
      className="shadow-lg fixed right-4 z-[35] flex size-14 items-center justify-center rounded-full bg-accent-primary text-on-color transition-transform active:scale-95"
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}
      onClick={() => toggleCreateIssueModal(true, EIssuesStoreType.PROJECT)}
    >
      <PlusIcon className="size-7 text-white" strokeWidth={2.5} />
    </button>
  );
});
