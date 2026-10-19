export type WalletChallenge = Readonly<{
  challengeId: string;
  message: string;
  expiresAt?: string;
}>;

export function createWalletVerifyPayload(
  challenge: WalletChallenge,
  walletAddress: string,
  signature: string,
) {
  return {
    challengeId: challenge.challengeId,
    walletAddress,
    message: challenge.message,
    signature,
  } as const;
}
