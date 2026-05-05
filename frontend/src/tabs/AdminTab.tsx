import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { CAMPAIGN_ABI } from "../abis";
import { CONTRACTS, ETHERSCAN_BASE } from "../config";
import { encryptUint64, publicDecryptEbool } from "../fhevm";
import { useRoleInfo } from "../useRoleInfo";

type FinalizeStep = "idle" | "submit" | "wait-tx" | "decrypt" | "callback" | "wait-cb" | "done";

export function AdminTab() {
  const { address } = useAccount();
  const { isAdmin, adminAddress } = useRoleInfo(address);

  const { data: declaredTotal, refetch: refetchDeclared } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "declaredTotal",
  });
  const { data: recipientCount, refetch: refetchCount } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "recipientCount",
  });
  const { data: finalized, refetch: refetchFinalized } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "finalized",
  });

  // 第一性原理：状态预览是 public read-only，不应强制连钱包。
  // 写操作（SetAllocation / Finalize）才需要 admin 钱包，未满足时显示内嵌提示而非整体守卫。
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Admin Console</h2>
        <p className="text-sm text-zinc-400 mt-1">
          设置每位 recipient 的加密 allocation，并在完成后触发 finalize 链上校验。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Declared Total" value={declaredTotal?.toString() ?? "—"} suffix="ZDT" />
        <Stat label="Recipients" value={recipientCount?.toString() ?? "—"} />
        <Stat
          label="Status"
          value={finalized === undefined ? "—" : finalized ? "Claiming" : "Setup"}
          highlight={finalized === true}
        />
      </div>

      {!address && (
        <InlineNotice tone="info">
          连接 admin 钱包后可设置 allocation 和触发 finalize。
          <div className="text-xs text-zinc-500 mt-1">
            Admin: <span className="font-mono">{adminAddress}</span>
          </div>
        </InlineNotice>
      )}

      {address && !isAdmin && (
        <InlineNotice tone="warn">
          当前钱包不是 admin，无法执行写操作。请切换到 admin 钱包：
          <span className="font-mono ml-1">{adminAddress}</span>
        </InlineNotice>
      )}

      {address && isAdmin && (
        <>
          <SetAllocationCard
            adminAddress={address}
            disabled={finalized === true}
            onSuccess={() => {
              refetchCount();
              refetchDeclared();
            }}
          />

          <FinalizeCard
            finalized={finalized === true}
            onDone={() => {
              refetchFinalized();
              refetchDeclared();
            }}
          />
        </>
      )}
    </div>
  );
}

function InlineNotice({
  tone,
  children,
}: {
  tone: "info" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warn"
      ? "border-amber-900/50 bg-amber-950/20 text-amber-200"
      : "border-zinc-800 bg-zinc-900/50 text-zinc-300";
  return (
    <div className={`rounded-lg border ${cls} p-4 text-sm`}>{children}</div>
  );
}

// ─── Set Allocation ───────────────────────────────────────────────

function SetAllocationCard({
  adminAddress,
  disabled,
  onSuccess,
}: {
  adminAddress: `0x${string}`;
  disabled: boolean;
  onSuccess: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { writeContract, data: txHash, error: writeError, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      setRecipient("");
      setAmount("");
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const submit = async () => {
    setLocalError(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      setLocalError("Invalid recipient address");
      return;
    }
    let amountBig: bigint;
    try {
      amountBig = BigInt(amount);
      if (amountBig <= 0n) throw new Error("Amount must be > 0");
    } catch {
      setLocalError("Amount must be a positive integer");
      return;
    }

    setEncrypting(true);
    try {
      const { handle, proof } = await encryptUint64(
        CONTRACTS.campaign,
        adminAddress,
        amountBig,
      );
      writeContract({
        abi: CAMPAIGN_ABI,
        address: CONTRACTS.campaign,
        functionName: "setAllocation",
        args: [recipient as `0x${string}`, handle, proof],
      });
    } catch (e: any) {
      setLocalError(e?.message ?? "Encryption failed");
    } finally {
      setEncrypting(false);
    }
  };

  const busy = encrypting || isPending || isConfirming;
  const txError = writeError?.message;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-white">Set Allocation</h3>
        {disabled && (
          <span className="text-xs text-zinc-500">Campaign finalized — locked</span>
        )}
      </div>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs text-zinc-500">Recipient address</span>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            disabled={disabled || busy}
            className="mt-1 w-full px-3 py-2 rounded bg-zinc-950 border border-zinc-800 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">Amount (ZDT, integer)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000"
            disabled={disabled || busy}
            className="mt-1 w-full px-3 py-2 rounded bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500 focus:outline-none disabled:opacity-50"
          />
        </label>
      </div>

      <button
        onClick={submit}
        disabled={disabled || busy || !recipient || !amount}
        className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {encrypting && "Encrypting…"}
        {isPending && "Sending tx…"}
        {isConfirming && "Confirming…"}
        {!busy && "Set Allocation"}
      </button>

      {localError && <div className="text-sm text-red-400">{localError}</div>}
      {txError && (
        <div className="text-sm text-red-400 break-all">
          Tx error: {txError}
          <button
            onClick={() => reset()}
            className="ml-2 underline text-red-300 hover:text-red-200"
          >
            dismiss
          </button>
        </div>
      )}
      {txHash && (
        <div className="text-xs text-zinc-400">
          {isSuccess ? "Confirmed" : "Pending"}:{" "}
          <a
            href={`${ETHERSCAN_BASE}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-purple-400 hover:text-purple-300"
          >
            {txHash.slice(0, 10)}…{txHash.slice(-8)} ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Finalize ─────────────────────────────────────────────────────

function FinalizeCard({
  finalized,
  onDone,
}: {
  finalized: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState<FinalizeStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [decryptedResult, setDecryptedResult] = useState<boolean | null>(null);
  const [finalizeTx, setFinalizeTx] = useState<`0x${string}` | undefined>();
  const [callbackTx, setCallbackTx] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: finalizeConfirmed } = useWaitForTransactionReceipt({ hash: finalizeTx });
  const { isSuccess: callbackConfirmed } = useWaitForTransactionReceipt({ hash: callbackTx });

  // 第二步：finalize tx 上链后，读取 finalizeCheckHandle 并公开解密
  const { refetch: refetchCheckHandle } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "finalizeCheckHandle",
    query: { enabled: false },
  });

  useEffect(() => {
    if (step !== "wait-tx" || !finalizeConfirmed) return;
    (async () => {
      try {
        setStep("decrypt");
        const { data: handle } = await refetchCheckHandle();
        if (!handle || handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
          throw new Error("finalizeCheckHandle is empty — finalize tx may not have set it");
        }
        const result = await publicDecryptEbool(handle as `0x${string}`);
        setDecryptedResult(result);

        setStep("callback");
        const cbHash = await writeContractAsync({
          abi: CAMPAIGN_ABI,
          address: CONTRACTS.campaign,
          functionName: "callbackFinalize",
          args: [result],
        });
        setCallbackTx(cbHash);
        setStep("wait-cb");
      } catch (e: any) {
        setError(e?.message ?? "Finalize flow failed");
        setStep("idle");
      }
    })();
  }, [finalizeConfirmed, step, refetchCheckHandle, writeContractAsync]);

  useEffect(() => {
    if (step === "wait-cb" && callbackConfirmed) {
      setStep("done");
      onDone();
    }
  }, [callbackConfirmed, step, onDone]);

  const startFinalize = async () => {
    setError(null);
    setDecryptedResult(null);
    setFinalizeTx(undefined);
    setCallbackTx(undefined);
    try {
      setStep("submit");
      const hash = await writeContractAsync({
        abi: CAMPAIGN_ABI,
        address: CONTRACTS.campaign,
        functionName: "finalize",
        args: [],
      });
      setFinalizeTx(hash);
      setStep("wait-tx");
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit finalize");
      setStep("idle");
    }
  };

  if (finalized) {
    return (
      <div className="rounded-lg border border-green-900/50 bg-green-950/20 p-4">
        <div className="font-medium text-green-300">Status: Claiming</div>
        <div className="text-sm text-zinc-400 mt-1">
          Campaign 已 finalize，recipients 现在可以 claim。
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      <div>
        <h3 className="font-medium text-white">Finalize Campaign</h3>
        <p className="text-xs text-zinc-500 mt-1">
          在密文状态下校验「∑allocation = declaredTotal」，整个过程不解密任何个人金额。
          KMS 公开解密耗时约 30 秒。
        </p>
      </div>

      <div className="space-y-1.5 text-sm">
        <Progress label="1. 提交 finalize tx" state={progressState(step, ["submit", "wait-tx"], ["decrypt", "callback", "wait-cb", "done"])} />
        <Progress label="2. 等待 KMS 公开解密 (~30s)" state={progressState(step, ["decrypt"], ["callback", "wait-cb", "done"])} />
        <Progress label="3. 提交 callbackFinalize" state={progressState(step, ["callback", "wait-cb"], ["done"])} />
        <Progress label="✓ 完成" state={step === "done" ? "active" : "pending"} />
      </div>

      {decryptedResult !== null && (
        <div className={`text-sm ${decryptedResult ? "text-green-400" : "text-red-400"}`}>
          KMS 解密结果：{decryptedResult ? "总量校验通过 ✓" : "总量校验失败 ✗"}
        </div>
      )}

      <button
        onClick={startFinalize}
        disabled={step !== "idle" && step !== "done"}
        className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {step === "idle" || step === "done" ? "Run Finalize" : "Running…"}
      </button>

      {error && <div className="text-sm text-red-400 break-all">{error}</div>}

      {finalizeTx && (
        <TxLink label="finalize" hash={finalizeTx} />
      )}
      {callbackTx && (
        <TxLink label="callbackFinalize" hash={callbackTx} />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function progressState(
  current: FinalizeStep,
  activeSteps: FinalizeStep[],
  doneSteps: FinalizeStep[],
): "pending" | "active" | "done" {
  if (doneSteps.includes(current)) return "done";
  if (activeSteps.includes(current)) return "active";
  return "pending";
}

function Progress({ label, state }: { label: string; state: "pending" | "active" | "done" }) {
  const dot =
    state === "done" ? "bg-green-500" : state === "active" ? "bg-purple-500 animate-pulse" : "bg-zinc-700";
  const text =
    state === "done" ? "text-green-300" : state === "active" ? "text-white" : "text-zinc-500";
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
      <span className={text}>{label}</span>
    </div>
  );
}

function TxLink({ label, hash }: { label: string; hash: `0x${string}` }) {
  return (
    <div className="text-xs text-zinc-400">
      {label}:{" "}
      <a
        href={`${ETHERSCAN_BASE}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-purple-400 hover:text-purple-300"
      >
        {hash.slice(0, 10)}…{hash.slice(-8)} ↗
      </a>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? "border-green-900/50 bg-green-950/20" : "border-zinc-800 bg-zinc-900/50"
      }`}
    >
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? "text-green-300" : "text-white"}`}>
        {value}
        {suffix && <span className="ml-2 text-sm text-zinc-400 font-normal">{suffix}</span>}
      </div>
    </div>
  );
}
