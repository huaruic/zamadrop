import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useWalletClient } from "wagmi";

import { userDecryptEuint64, type UserDecryptStage } from "@/fhevm";

export type DecryptStage = UserDecryptStage | "idle" | "done";

/** Wraps fhevm.userDecryptEuint64 with wagmi WalletClient adapter and
 * stage tracking. Recipient + Auditor both call this — Recipient on their
 * own allocation handle, Auditor on the aggregate claimedTotal handle. */
export function useUserDecryptEuint64() {
  const { data: walletClient } = useWalletClient();
  const [stage, setStage] = useState<DecryptStage>("idle");

  const mutation = useMutation<
    bigint,
    Error,
    { handle: `0x${string}`; contractAddress: `0x${string}` }
  >({
    mutationFn: async ({ handle, contractAddress }) => {
      if (!walletClient) throw new Error("Wallet not connected");
      const signer = {
        address: walletClient.account.address,
        signTypedData: (params: Parameters<typeof walletClient.signTypedData>[0]) =>
          walletClient.signTypedData(params),
      };
      const value = await userDecryptEuint64(
        handle,
        contractAddress,
        signer,
        setStage,
      );
      setStage("done");
      return value;
    },
    onError: () => setStage("idle"),
  });

  return {
    decrypt: mutation.mutateAsync,
    data: mutation.data,
    error: mutation.error,
    isPending: mutation.isPending,
    stage,
    reset: () => {
      mutation.reset();
      setStage("idle");
    },
  };
}

export function describeStage(stage: DecryptStage): string {
  switch (stage) {
    case "idle":
      return "";
    case "sdk":
      return "Loading FHE SDK…";
    case "keypair":
      return "Generating ephemeral keypair…";
    case "signing":
      return "Awaiting wallet signature…";
    case "kms":
      return "Decrypting via KMS…";
    case "done":
      return "Decrypted ✓";
  }
}
