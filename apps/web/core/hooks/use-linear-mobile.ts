/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isLinearDisplayMode } from "@/helpers/linear-display.helper";
import useSize from "@/hooks/use-window-size";

/** Matches Plane sidebar mobile threshold (768). */
export const LINEAR_MOBILE_BREAKPOINT = 768;

/**
 * Linear display mode on a phone-width viewport.
 * Uses viewport width (not UA) so narrow desktop windows get the same shell.
 */
export function useLinearMobile(): boolean {
  const [width] = useSize();
  return isLinearDisplayMode() && width < LINEAR_MOBILE_BREAKPOINT;
}
