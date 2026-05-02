import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useWalletClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { CAMPAIGN_ABI, ERC20_ABI } from "../abis";
import { CONTRACTS, ETHERSCAN_BASE } from "../config";
import { userDecryptEuint64, publicDecryptEuint64 } from "../fhevm";

type DecryptStage = "idle" | "keypair" | "signing" | "kms" | "done" | "error";

export function RecipientTab() {
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

  // ── Decrypt my allocation ─────────────────────────────────────────
  const [decryptStage, setDecryptStage] = useState<DecryptStage>("idle");
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [myAmount, setMyAmount] = useState<bigint | null>(null);

  async function handleDecrypt() {
    if (!walletClient || !address || !allocationHandle) return;
    setDecryptError(null);
    try {
      setDecryptStage("keypair");
      const signer = {
        address: walletClient.account.address,
        signTypedData: (params: any) => walletClient.signTypedData(params),
      };
      setDecryptStage("signing");
      // userDecryptEuint64 internally generates keypair, asks for signature, then talks to KMS
      const amount = await userDecryptEuint64(
        allocationHandle as `0x${string}`,
        CONTRACTS.campaign,
        signer,
      );
      setDecryptStage("kms");
      setMyAmount(amount);
      setDecryptStage("done");
    } catch (err: any) {
      setDecryptError(err?.message ?? String(err));
      setDecryptStage("error");
    }
  }

  // ── Claim ─────────────────────────────────────────────────────────
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

  if (claimSuccess && !claimed) {
    refetchClaimed();
    refetchPending();
  }

  // ── Execute transfer ──────────────────────────────────────────────
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

  if (transferSuccess && !transferred) {
    refetchTransferred();
    refetchBalance();
  }

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

  // ── Render ────────────────────────────────────────────────────────
  if (!isConnected || !address) {
    return (
      <EmptyState
        title="Recipient view"
        message="Connect your wallet to view your allocation."
      />
    );
  }

  if (allocationSet === false) {
    return (
      <EmptyState
        title="No allocation"
        message="No allocation found for this address. Ask the admin to add you."
      />
    );
  }

  const balanceStr = balance !== undefined ? (balance as bigint).toString() : "—";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Recipient</h2>
        <p className="text-sm text-zinc-400 mt-1">
          解密自己的 allocation，claim 后由任何人触发 ZDT 转账。**金额仅你本人可见**。
        </p>
      </div>

      {/* Card 1 — Encrypted allocation + decrypt */}
      <Card title="Your Encrypted Allocation">
        <Row label="Handle" value={shortHandle(allocationHandle as string | undefined)} mono />
        <div className="text-xs text-zinc-500">Encrypted on-chain (euint64)</div>

        <div className="pt-3">
          {myAmount !== null ? (
            <div className="text-3xl font-bold text-white">
              {myAmount.toString()}{" "}
              <span className="text-sm text-zinc-400 font-normal">ZDT</span>
            </div>
          ) : (
            <button
              onClick={handleDecrypt}
              disabled={
                !walletClient ||
                !allocationHandle ||
                decryptStage === "keypair" ||
                decryptStage === "signing" ||
                decryptStage === "kms"
              }
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium text-sm"
            >
              {decryptStage === "idle" || decryptStage === "error" || decryptStage === "done"
                ? "Decrypt my amount"
                : decryptStage === "keypair"
                ? "Generating keypair..."
                : decryptStage === "signing"
                ? "Awaiting signature..."
                : "Decrypting via KMS..."}
            </button>
          )}
          {decryptError && (
            <div className="mt-2 text-xs text-red-400">{decryptError}</div>
          )}
        </div>
      </Card>

      {/* Card 2 — Claim & Withdraw */}
      <Card title="Claim & Withdraw">
        {!finalized && (
          <div className="text-sm text-amber-400">
            Waiting for admin to finalize. Claim will open after the on-chain total check passes.
          </div>
        )}

        {finalized && !claimed && (
          <div className="space-y-3">
            <div className="text-sm text-zinc-400">
              Step 1 of 2 — Submit a <code className="text-purple-300">claim()</code> tx so the contract emits your encrypted amount for public decrypt.
            </div>
            <button
              onClick={handleClaim}
              disabled={claimPending || claimMining}
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium text-sm"
            >
              {claimPending
                ? "Confirm in wallet..."
                : claimMining
                ? "Mining..."
                : "Claim allocation"}
            </button>
            {claimError && (
              <div className="text-xs text-red-400">{claimError.message}</div>
            )}
          </div>
        )}

        {finalized && claimed && !transferred && (
          <div className="space-y-3">
            <div className="text-sm text-zinc-400">
              Step 2 of 2 — Public-decrypt the pending handle and call <code className="text-purple-300">executeTransfer</code> to receive ZDT.
            </div>
            <Row label="Pending handle" value={shortHandle(pendingHandle as string | undefined)} mono />
            {transferStage === "decrypting" && (
              <div className="text-sm text-zinc-400">Awaiting public decrypt (~30s)...</div>
            )}
            {decryptedClaim !== null && (
              <div className="text-sm text-zinc-300">
                Decrypted: <span className="font-mono text-white">{decryptedClaim.toString()}</span> ZDT
              </div>
            )}
            <button
              onClick={handleExecuteTransfer}
              disabled={
                !pendingHandle ||
                transferStage === "decrypting" ||
                transferStage === "submitting" ||
                transferPending ||
                transferMining
              }
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium text-sm"
            >
              {transferStage === "decrypting"
                ? "Public decrypting..."
                : transferPending
                ? "Confirm in wallet..."
                : transferMining
                ? "Mining..."
                : "Execute transfer"}
            </button>
            {transferError && (
              <div className="text-xs text-red-400">{transferError}</div>
            )}
          </div>
        )}

        {transferred && (
          <div className="text-sm text-emerald-400">
            ✓ Transferred. Check your wallet for ZDT.
          </div>
        )}
      </Card>

      {/* Card 3 — ZDT balance */}
      <Card title="Your ZDT Balance">
        <div className="text-3xl font-bold text-white">
          {balanceStr}
          <span className="ml-2 text-sm text-zinc-400 font-normal">ZDT</span>
        </div>
        <a
          href={`${ETHERSCAN_BASE}/token/${CONTRACTS.token}?a=${address}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-purple-400 hover:text-purple-300"
        >
          View on Etherscan ↗
        </a>
      </Card>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={mono ? "font-mono text-zinc-300" : "text-zinc-300"}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
        {message}
      </div>
    </div>
  );
}

function shortHandle(h?: string) {
  if (!h) return undefined;
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}
