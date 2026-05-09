import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";

import { ERC20_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CONTRACTS } from "@/config";
import { cn } from "@/lib/utils";

import { useWizardStore, type Recipient } from "./state";
import {
  parseRecipientList,
  validateListL2,
  type ValidationIssue,
} from "./validators";

const TOKEN_ADDRESS = ((): `0x${string}` => {
  const env = import.meta.env.VITE_TOKEN_ADDRESS as `0x${string}` | undefined;
  return env ?? CONTRACTS.token;
})();

const CSV_TEMPLATE_PATH = "/zamadrop-recipients-template.csv";
const MAX_VISIBLE_ROWS = 100;

interface Row {
  id: string;
  address: string;
  amount: string;
}

interface RowValidation {
  recipient: Recipient | null;
  issue?: ValidationIssue;
  isEmpty: boolean;
}

const newRow = (address = "", amount = ""): Row => ({
  id: crypto.randomUUID(),
  address,
  amount,
});

const isRowEmpty = (row: Row): boolean =>
  row.address.trim() === "" && row.amount.trim() === "";

function validateRow(row: Row): RowValidation {
  if (isRowEmpty(row)) {
    return { recipient: null, isEmpty: true };
  }
  const blob = `${row.address.trim()} ${row.amount.trim()}`;
  const { recipients, lineIssues } = parseRecipientList(blob);
  if (recipients.length > 0) {
    return { recipient: recipients[0], isEmpty: false };
  }
  return {
    recipient: null,
    issue: lineIssues[0]?.issue ?? {
      level: "error",
      message: "Invalid row.",
    },
    isEmpty: false,
  };
}

function parseCsvText(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return [];

  const firstCell = lines[0].split(/[,\s]/)[0]?.trim().toLowerCase() ?? "";
  const dataLines =
    firstCell === "address" || firstCell === "recipient_address"
      ? lines.slice(1)
      : lines;

  const rows: Row[] = [];
  for (const line of dataLines) {
    const commaIdx = line.indexOf(",");
    let address: string;
    let amount: string;
    if (commaIdx >= 0) {
      address = line.slice(0, commaIdx).trim();
      amount = line.slice(commaIdx + 1).trim();
    } else {
      const parts = line.split(/\s+/);
      address = parts[0] ?? "";
      amount = parts[1] ?? "";
    }
    rows.push(newRow(address, amount));
  }
  return rows;
}

export default function Step2Recipients() {
  const navigate = useNavigate();
  const { address: walletAddress } = useAccount();

  const recipientsInStore = useWizardStore((s) => s.recipients);
  const setRecipients = useWizardStore((s) => s.setRecipients);
  const bumpVersion = useWizardStore((s) => s.bumpVersion);
  const setStep = useWizardStore((s) => s.setStep);

  const [rows, setRows] = useState<Row[]>(() => {
    if (recipientsInStore.length === 0) return [newRow()];
    return recipientsInStore.map((r) =>
      newRow(r.displayInput, r.amount.toString()),
    );
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: balanceRaw } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress },
  });
  const balance = balanceRaw as bigint | undefined;

  const rowValidations = useMemo(() => rows.map(validateRow), [rows]);

  const recipients = useMemo(
    () =>
      rowValidations
        .map((v) => v.recipient)
        .filter((r): r is Recipient => r !== null),
    [rowValidations],
  );

  const listIssues = useMemo(
    () => validateListL2(recipients, balance),
    [recipients, balance],
  );

  const sum = useMemo(
    () => recipients.reduce((acc, r) => acc + r.amount, 0n),
    [recipients],
  );

  const hasRowError = rowValidations.some(
    (v) => v.issue && v.issue.level === "error",
  );
  const hasListError = listIssues.some((i) => i.level === "error");
  const balanceOk = balance !== undefined && sum <= balance;

  const handleAddRow = () => {
    setRows((prev) => [...prev, newRow()]);
  };

  const handleDeleteRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length === 0 ? [newRow()] : next;
    });
  };

  const handleUpdateRow = (id: string, patch: Partial<Omit<Row, "id">>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const imported = parseCsvText(text);
      input.value = "";
      if (imported.length === 0) return;

      const existingNonEmpty = rows.filter((r) => !isRowEmpty(r));
      if (existingNonEmpty.length > 0) {
        const replace = window.confirm(
          `Replace existing ${existingNonEmpty.length} row${
            existingNonEmpty.length === 1 ? "" : "s"
          } with imported data?`,
        );
        if (replace) {
          setRows(imported);
        } else {
          setRows((prev) => [
            ...prev.filter((r) => !isRowEmpty(r)),
            ...imported,
          ]);
        }
      } else {
        setRows(imported);
      }
    };
    reader.readAsText(file);
  };

  const handleNext = () => {
    if (hasRowError) return;
    if (hasListError) return;
    if (recipients.length === 0) return;
    if (!balanceOk) return;
    setRecipients(recipients);
    bumpVersion();
    setStep(3);
    void navigate("/wizard/auditor");
  };

  const visibleRows = rows.slice(0, MAX_VISIBLE_ROWS);
  const truncated = rows.length > MAX_VISIBLE_ROWS;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>
            Enter one recipient per row. ZDT decimals = 0, so amounts are
            plain integers. Use the CSV template for bulk lists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={CSV_TEMPLATE_PATH}
              download
              className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-transparent px-3 font-mono text-xs font-medium uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
            >
              Download CSV template
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImportClick}
            >
              Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse font-mono text-xs">
              <thead className="bg-surface">
                <tr className="text-left">
                  <th className="w-10 border-b border-border px-2 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    #
                  </th>
                  <th className="border-b border-border px-2 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Address
                  </th>
                  <th className="w-40 border-b border-border px-2 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Amount
                  </th>
                  <th className="w-10 border-b border-border px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, idx) => {
                  const validation = rowValidations[idx];
                  const showError =
                    !validation.isEmpty &&
                    validation.issue?.level === "error";
                  return (
                    <tr key={row.id} className="border-b border-border last:border-b-0 align-top">
                      <td className="px-2 py-2 text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={row.address}
                          onChange={(e) =>
                            handleUpdateRow(row.id, { address: e.target.value })
                          }
                          placeholder="0x…"
                          spellCheck={false}
                          autoComplete="off"
                          className={cn(
                            "h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            showError && "border-destructive",
                          )}
                          title={showError ? validation.issue?.message : undefined}
                        />
                        {showError && (
                          <p className="mt-1 text-[10px] text-destructive">
                            {validation.issue?.message}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.amount}
                          onChange={(e) =>
                            handleUpdateRow(row.id, { amount: e.target.value })
                          }
                          placeholder="0"
                          spellCheck={false}
                          autoComplete="off"
                          className={cn(
                            "h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            showError && "border-destructive",
                          )}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(row.id)}
                          aria-label={`Delete row ${idx + 1}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-transparent font-mono text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-2 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddRow}
              >
                + Add row
              </Button>
              {truncated && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  Showing {MAX_VISIBLE_ROWS} of {rows.length} rows. CSV import
                  is the recommended path for large lists.
                </span>
              )}
            </div>
          </div>

          <Summary
            recipientCount={recipients.length}
            sum={sum}
            balance={balance}
          />

          {listIssues.length > 0 && <ListIssuesPanel issues={listIssues} />}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep(1);
            void navigate("/wizard/basics");
          }}
        >
          Back
        </Button>
        <Button
          onClick={handleNext}
          disabled={
            hasRowError ||
            hasListError ||
            recipients.length === 0 ||
            !balanceOk
          }
        >
          Next · Auditor
        </Button>
      </div>
    </div>
  );
}

function Summary({
  recipientCount,
  sum,
  balance,
}: {
  recipientCount: number;
  sum: bigint;
  balance: bigint | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Cell label="Recipients" value={recipientCount.toString()} />
      <Cell label="Total" value={`${sum.toString()} ZDT`} />
      <Cell
        label="Wallet balance"
        value={balance === undefined ? "Loading…" : `${balance.toString()} ZDT`}
      />
    </div>
  );
}

function ListIssuesPanel({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>List errors</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}
