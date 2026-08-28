/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue } from "@plane/types";
import { cn } from "@plane/utils";
import { getIssuePlatformKind, ISSUE_PLATFORM_META } from "@/helpers/linear-display.helper";
import { usePlatformOS } from "@/hooks/use-platform-os";

type Props = {
  issue: Partial<TIssue> | null | undefined;
  className?: string;
  /** Match label chips inside layout property rows (default: bordered pill). */
  noBorder?: boolean;
};

/** Read-only platform pill — styled like issue labels, not editable. */
export const IssuePlatformBadge = observer(function IssuePlatformBadge(props: Props) {
  const { issue, className, noBorder = false } = props;
  const { isMobile } = usePlatformOS();
  const kind = getIssuePlatformKind(issue);
  if (!kind) return null;

  const { label, color } = ISSUE_PLATFORM_META[kind];

  return (
    <Tooltip
      position="top"
      tooltipHeading="Platform"
      tooltipContent={label}
      isMobile={isMobile}
      renderByDefault={false}
    >
      <div
        className={cn(
          "flex h-5 max-w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-sm px-2.5 text-caption-sm-regular",
          noBorder ? "rounded-none" : "border-[0.5px] border-strong",
          "cursor-default select-none",
          className
        )}
        aria-label={`Platform: ${label}`}
      >
        <div className="flex max-w-full items-center gap-1.5 overflow-hidden text-secondary">
          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <div className="line-clamp-1 inline-block w-auto max-w-[200px] truncate">{label}</div>
        </div>
      </div>
    </Tooltip>
  );
});
