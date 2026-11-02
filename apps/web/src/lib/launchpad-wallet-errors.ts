export function launchpadWalletError(error: unknown,fallback: string): string {
  const candidate=error as { code?: unknown;message?: unknown;data?: { originalError?: { code?: unknown;message?: unknown } } };
  const code=candidate?.data?.originalError?.code??candidate?.code;
  const message=[candidate?.message,candidate?.data?.originalError?.message].filter((value): value is string=>typeof value==="string").join(" ");
  if (code===4001||/user rejected|user denied|4001/iu.test(message)) return "Request cancelled in the wallet. Your form is unchanged.";
  const known: Record<string,string>={
    LAUNCHPAD_CATALOG_UNAVAILABLE:"Approved presets are temporarily unavailable. Retry shortly.",
    LAUNCHPAD_CREATED_EVENT_NOT_FOUND:"The receipt is confirmed but its launchpad record is still syncing. Open Manage and retry refresh.",
    LAUNCHPAD_METADATA_COMMITMENT_MISMATCH:"Branding no longer matches the deployed commitment. Keep the original form values and assets.",
    LAUNCHPAD_OWNER_SIGNATURE_INVALID:"Sign with the launchpad owner wallet shown in the review.",
    LAUNCHPAD_SIGNATURE_EXPIRED:"The branding signature expired. Sign again to publish.",
    LAUNCHPAD_DOMAIN_CHALLENGE_MISMATCH:"DNS TXT record is not visible yet. Check the exact name and value, then retry after propagation.",
    LAUNCHPAD_DOMAIN_CHALLENGE_EXPIRED:"The DNS challenge expired. Request a new challenge.",
    LAUNCHPAD_DOMAIN_OWNER_INVALID:"Sign the domain request with the current launchpad owner wallet.",
  };
  if (known[message]) return known[message];
  if (/Switch wallet to chain/iu.test(message)||/image|logo|favicon/iu.test(message)) return message;
  return fallback;
}
