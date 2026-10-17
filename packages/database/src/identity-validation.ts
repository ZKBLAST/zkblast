const walletAddressPattern = /^0x[0-9a-fA-F]{40}$/u;
const usernamePattern = /^[a-zA-Z0-9_]{3,24}$/u;

export function normalizeWalletAddress(address: string): string {
  const trimmed = address.trim();
  if (!walletAddressPattern.test(trimmed)) {
    throw new Error("INVALID_WALLET_ADDRESS");
  }

  return trimmed.toLowerCase();
}

export function validateUsername(username: string): string {
  const trimmed = username.trim();
  if (!usernamePattern.test(trimmed)) {
    throw new Error("INVALID_USERNAME");
  }

  return trimmed;
}
