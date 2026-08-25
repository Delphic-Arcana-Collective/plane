/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { getBffBaseUrl, getLinearSyncPollIntervalMs, isLinearDisplayMode } from "@/helpers/linear-display.helper";

type BffHealthResponse = {
  cache?: {
    lastFetchedAt?: string | null;
  };
};

type UseLinearSyncRefreshOptions = {
  enabled?: boolean;
};

/**
 * Polls BFF /health and runs onSync when Linear data has been re-synced.
 * Skips the first observed timestamp so initial page load is not double-fetched.
 */
export function useLinearSyncRefresh(onSync: () => void | Promise<void>, options: UseLinearSyncRefreshOptions = {}) {
  const enabled = (options.enabled ?? true) && isLinearDisplayMode();
  const lastFetchedAtRef = useRef<string | null>(null);
  const onSyncRef = useRef(onSync);

  onSyncRef.current = onSync;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const checkForUpdates = async () => {
      if (document.hidden) return;

      try {
        const response = await fetch(`${getBffBaseUrl()}/health`);
        if (!response.ok || cancelled) return;

        const data = (await response.json()) as BffHealthResponse;
        const lastFetchedAt = data.cache?.lastFetchedAt ?? null;
        if (!lastFetchedAt || cancelled) return;

        if (lastFetchedAtRef.current && lastFetchedAtRef.current !== lastFetchedAt) {
          await onSyncRef.current();
        }

        lastFetchedAtRef.current = lastFetchedAt;
      } catch {
        // Ignore transient network errors during background polling.
      }
    };

    void checkForUpdates();

    const intervalId = window.setInterval(() => {
      void checkForUpdates();
    }, getLinearSyncPollIntervalMs());

    const handleVisibilityChange = () => {
      if (!document.hidden) void checkForUpdates();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);
}
