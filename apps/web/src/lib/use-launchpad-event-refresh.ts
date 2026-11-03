"use client";

import { useEffect, useRef } from "react";
import { apiProxyAssetPath } from "./api-client";

export function useLaunchpadEventRefresh(
  onEvent: () => void,
  chainId?: number | null,
) {
  const callback = useRef(onEvent);
  callback.current = onEvent;

  useEffect(() => {
    if (!chainId) return;
    const source = new EventSource(
      apiProxyAssetPath("/v1/launchpads/events/stream?cursor=0:0&limit=100"),
      { withCredentials: true },
    );
    let queued: number | null = null;
    const update = () => {
      if (queued !== null) return;
      queued = window.setTimeout(() => {
        queued = null;
        callback.current();
      }, 250);
    };
    source.addEventListener("launchpad", update);
    return () => {
      if (queued !== null) window.clearTimeout(queued);
      source.removeEventListener("launchpad", update);
      source.close();
    };
  }, [chainId]);
}
