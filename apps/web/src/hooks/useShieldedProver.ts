"use client";
import { useEffect, useState } from "react";
import {
  checkShieldedProverAssets,
  loadShieldedProver,
} from "@/lib/shielded-prover";
import type { PublicConfig } from "@/types/application";

export function useShieldedProver(config: PublicConfig | null | undefined) {
  const [result, setResult] = useState<{
    config: PublicConfig;
    ready: boolean;
    failed: boolean;
  }>();
  useEffect(() => {
    let active = true;
    if (!config?.shielded) return;
    loadShieldedProver(config)
      .then(checkShieldedProverAssets)
      .then(
        () => {
          if (active) setResult({ config, ready: true, failed: false });
        },
        () => {
          if (active) setResult({ config, ready: false, failed: true });
        },
      );
    return () => {
      active = false;
    };
  }, [config]);
  return {
    ready: result?.config === config && result?.ready === true,
    failed: result?.config === config && result?.failed === true,
  };
}
