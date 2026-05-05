import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWalletClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { CAMPAIGN_ABI, ERC20_ABI } from "../abis";
import { CONTRACTS, ETHERSCAN_BASE } from "../config";
import { publicDecryptEuint64, userDecryptEuint64 } from "../fhevm";

type DecryptStage = "idle" | "sdk" | "keypair" | "signing" | "kms" | "done" | "error";

export function RecipientClaimPanel({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const { data: allocationSet } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "allocationSet",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: finalized } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "finalized",
  });
  const { data: claimed, refetch: refetchClaimed } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "claimed",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: transferred, refetch: refetchTransferred } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "transferred",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: allocationHandle } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "requestMyAllocation",
    account: address,
    query: { enabled: !!address && !!allocationSet },
  });
  const { data: pendingHandle, refetch: refetchPending } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "pendingClaimHandle",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!claimed && !transferred },
  });
  const { data: balance, refetch: refetchBalance } = useReadContract({
    abi: ERC20_ABI,
    address: CONTRACTS.token,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const [decryptStage, setDecryptStage] = useState<DecryptStage>("idle");
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [myAmount, setMyAmount] = useState<bigint | null>(null);

  async function handleDecrypt() {
    if (!walletClient || !address || !allocationHandle) return;
    setDecryptError(null);
    setDecryptStage("sdk");
    try {
      const signer = {
        address: walletClient.account.address,
        signTypedData: (params: any) => walletClient.signTypedData(params),
      };
      const amount = await userDecryptEuint64(
        allocationHandle as `0x${string}`,
        CONTRACTS.campaign,
        signer,
        (stage) => setDecryptStage(stage),
      );
      setMyAmount(amount);
      setDecryptStage("done");
    } catch (err: any) {
      setDecryptError(err?.message ?? String(err));
      setDecryptStage("error");
    }
  }

  const {
    writeContract: writeClaim,
    data: claimTxHash,
    isPending: claimPending,
    error: claimError,
  } = useWriteContract();
  const { isLoading: claimMining, isSuccess: claimSuccess } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });

  function handleClaim() {
    writeClaim({
      abi: CAMPAIGN_ABI,
      address: CONTRACTS.campaign,
      functionName: "claim",
    });
  }

  useEffect(() => {
    if (!claimSuccess || claimed) return;
    void refetchClaimed();
    void refetchPending();
  }, [claimSuccess, claimed, refetchClaimed, refetchPending]);

  const [transferStage, setTransferStage] = useState<
    "idle" | "decrypting" | "ready" | "submitting" | "error"
  >("idle");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [decryptedClaim, setDecryptedClaim] = useState<bigint | null>(null);

  const {
    writeContract: writeTransfer,
    data: transferTxHash,
    isPending: transferPending,
  } = useWriteContract();
  const { isLoading: transferMining, isSuccess: transferSuccess } =
    useWaitForTransactionReceipt({ hash: transferTxHash });

  useEffect(() => {
    if (!transferSuccess || transferred) return;
    void refetchTransferred();
    void refetchBalance();
  }, [transferSuccess, transferred, refetchTransferred, refetchBalance]);

  async function handleExecuteTransfer() {
    if (!address || !pendingHandle) return;
    setTransferError(null);
    try {
      setTransferStage("decrypting");
      const amount = await publicDecryptEuint64(pendingHandle as `0x${string}`);
      setDecryptedClaim(amount);
      setTransferStage("submitting");
      writeTransfer({
        abi: CAMPAIGN_ABI,
        address: CONTRACTS.campaign,
        functionName: "executeTransfer",
        args: [address, amount],
      });
      setTransferStage("ready");
    } catch (err: any) {
      setTransferError(err?.message ?? String(err));
      setTransferStage("error");
    }
  }

  if (!isConnected || !address) {
    return standalone ? (
      <RecipientEmptyState
        title="Recipient view"
        message="Connect your wallet to check only your own eligibility and claim flow."
      />
    ) : null;
  }

  if (allocationSet === false) {
    return (
      <section className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
        <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Recipient</div>
        <h3 className="mt-3 text-[32px] font-medium tracking-[-0.04em] text-[#111111]">
          Not eligible
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[#5d5a53]">
          This wallet has no allocation in the current campaign. The page does not
          reveal any other address or recipient information.
        </p>
      </section>
    );
  }

  const balanceStr = balance !== undefined ? (balance as bigint).toString() : "—";

  return (
    <section className="space-y-5">
      {standalone ? (
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Recipient</div>
          <h2 className="mt-2 text-[36px] font-medium tracking-[-0.05em] text-[#111111]">
            Private claim flow
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#5d5a53]">
            Decrypt your own allocation, submit claim, then receive transferred ZDT.
            No other recipient amount is exposed.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">
                Your allocation
              </div>
              <div className="mt-2 text-[32px] font-medium tracking-[-0.04em] text-[#111111]">
                Private decryption
              </div>
            </div>
            <span className="rounded-full border border-[#e4c75e] bg-[#fff4c4] px-3 py-1 text-[11px] text-[#785a00]">
              wallet-gated
            </span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[0.86fr_1.14fr]">
            <div className="rounded-[22px] border border-dashed border-[#d9d3c8] p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#7a746b]">
                Status
              </div>
              <div className="mt-4 space-y-3 text-sm text-[#222222]">
                <InfoRow label="Address" value={shortAddr(address)} />
                <InfoRow label="Eligibility" value="eligible" />
                <InfoRow label="Claim status" value={claimed ? "submitted" : "ready"} />
                <InfoRow
                  label="Transfer status"
                  value={transferred ? "received" : claimed ? "pending" : "not started"}
                />
              </div>
              <div className="mt-5 rounded-[18px] bg-[#f5f1e8] p-4 text-sm leading-6 text-[#5b574f]">
                Only this wallet can decrypt this amount. The page never exposes another
                recipient's data.
              </div>
            </div>

            <div className="rounded-[22px] border border-[#1a1a1a] p-4 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#6a655d]">
                  Decrypt amount
                </div>
                <span className="rounded-full border border-[#d9d3c8] px-3 py-1 text-[11px] text-[#5d5a53]">
                  {myAmount !== null ? "decrypted" : "private"}
                </span>
              </div>

              <div className="mt-5">
                {myAmount !== null ? (
                  <div
                    className="text-[72px] leading-none tracking-[-0.08em] text-[#111111]"
                    data-testid="recipient-decrypted-amount"
                  >
                    {myAmount.toString()}
                    <span className="ml-2 text-[24px] tracking-[-0.04em]">ZDT</span>
                  </div>
                ) : (
                  <button
                    onClick={handleDecrypt}
                    data-testid="recipient-decrypt-button"
                    disabled={
                      !walletClient ||
                      !allocationHandle ||
                      decryptStage === "sdk" ||
                      decryptStage === "keypair" ||
                      decryptStage === "signing" ||
                      decryptStage === "kms"
                    }
                    className="w-full rounded-none bg-[#111111] px-5 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:bg-[#d2cbc0] disabled:text-[#7a746b]"
                  >
                    {decryptStage === "idle" || decryptStage === "error" || decryptStage === "done"
                      ? "Decrypt my amount"
                      : decryptStage === "sdk"
                        ? "Loading FHE SDK..."
                        : decryptStage === "keypair"
                          ? "Generating keypair..."
                          : decryptStage === "signing"
                            ? "Awaiting wallet signature..."
                            : "Decrypting via KMS..."}
                  </button>
                )}
              </div>

              <div className="mt-4 text-sm leading-6 text-[#5d5a53]">
                {myAmount !== null
                  ? "Visible only after you decrypt with your connected wallet."
                  : "The encrypted handle stays on-chain until you choose to decrypt."}
              </div>
              {decryptError ? <div className="mt-3 text-xs text-red-600">{decryptError}</div> : null}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
            <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Claim flow</div>
            <div className="mt-2 text-[32px] font-medium tracking-[-0.04em] text-[#111111]">
              Submit and settle
            </div>

            {!finalized ? (
              <div className="mt-5 rounded-[20px] border border-[#f0dca3] bg-[#fff8dc] p-4 text-sm leading-6 text-[#7b6300]">
                Waiting for admin finalize. Claim opens only after the on-chain total check passes.
              </div>
            ) : null}

            {finalized && !claimed ? (
              <div className="mt-5 space-y-4">
                <div className="text-sm leading-6 text-[#5d5a53]">
                  Step 1. Submit <code className="text-[#111111]">claim()</code> so the contract
                  emits your encrypted amount for public decrypt.
                </div>
                <button
                  onClick={handleClaim}
                  data-testid="recipient-claim-button"
                  disabled={claimPending || claimMining}
                  className="w-full rounded-none bg-[#111111] px-5 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:bg-[#d2cbc0] disabled:text-[#7a746b]"
                >
                  {claimPending
                    ? "Confirm in wallet..."
                    : claimMining
                      ? "Mining..."
                      : "Claim allocation"}
                </button>
                {claimError ? <div className="text-xs text-red-600">{claimError.message}</div> : null}
              </div>
            ) : null}

            {finalized && claimed && !transferred ? (
              <div className="mt-5 space-y-4">
                <div className="text-sm leading-6 text-[#5d5a53]">
                  Step 2. Public-decrypt the pending handle and execute transfer to receive ZDT.
                </div>
                <InfoRow label="Pending handle" value={shortHandle(pendingHandle as string | undefined) ?? "—"} />
                {transferStage === "decrypting" ? (
                  <div className="text-sm text-[#5d5a53]">Awaiting public decrypt...</div>
                ) : null}
                {decryptedClaim !== null ? (
                  <div className="text-sm text-[#222222]">
                    Decrypted pending amount:{" "}
                    <span className="font-medium">{decryptedClaim.toString()} ZDT</span>
                  </div>
                ) : null}
                <button
                  onClick={handleExecuteTransfer}
                  data-testid="recipient-execute-transfer-button"
                  disabled={
                    !pendingHandle ||
                    transferStage === "decrypting" ||
                    transferStage === "submitting" ||
                    transferPending ||
                    transferMining
                  }
                  className="w-full rounded-none bg-[#111111] px-5 py-4 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:bg-[#d2cbc0] disabled:text-[#7a746b]"
                >
                  {transferStage === "decrypting"
                    ? "Public decrypting..."
                    : transferPending
                      ? "Confirm in wallet..."
                      : transferMining
                        ? "Mining..."
                        : "Execute transfer"}
                </button>
                {transferError ? <div className="text-xs text-red-600">{transferError}</div> : null}
              </div>
            ) : null}

            {transferred ? (
              <div className="mt-5 rounded-[20px] border border-[#cfe5bf] bg-[#f4fbef] p-4 text-sm leading-6 text-[#355f1d]">
                Received. Transfer is complete and your wallet balance has been updated.
              </div>
            ) : null}
          </div>

          <div className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
            <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Your balance</div>
            <div className="mt-3 text-[52px] leading-none tracking-[-0.07em] text-[#111111]">
              {balanceStr}
              <span className="ml-2 text-[18px] tracking-[-0.03em]">ZDT</span>
            </div>
            <a
              href={`${ETHERSCAN_BASE}/token/${CONTRACTS.token}?a=${address}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-sm text-[#8a6700] hover:text-[#6e5200]"
            >
              View token balance on Etherscan ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function RecipientEmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
      <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">{title}</div>
      <div className="mt-3 text-sm leading-7 text-[#5d5a53]">{message}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[#6a655d]">{label}</span>
      <span className="font-medium text-[#111111]">{value}</span>
    </div>
  );
}

function shortHandle(h?: string) {
  if (!h) return undefined;
  return h.length > 18 ? `${h.slice(0, 10)}...${h.slice(-6)}` : h;
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
