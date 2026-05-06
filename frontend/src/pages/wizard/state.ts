/**
 * Zustand store for the 5-step Admin deployment wizard.
 *
 * Spec: openspec/changes/v7-dapp-wizard/specs/admin-deployment-flow/spec.md
 *
 * The store is the single source of truth for in-progress wizard work. It
 * holds:
 *   - draft identity (`draftId`, `draftVersion`)            — backend coupling
 *   - navigation cursor (`currentStep`, `deployStep`)
 *   - user-entered campaign config (basics, recipients, auditor)
 *   - the Step-4 snapshot lock (`listHash`, `declaredTotal`, …)
 *   - deploy progress (`campaignAddress`, `allocatedSoFar`, `status`)
 *
 * IMPORTANT INVARIANT: any mutation that changes the recipient list MUST go
 * through `bumpVersion()`, which both increments `draftVersion` AND clears
 * `snapshot`. The Step-5 deploy executor rejects any deploy where
 * `snapshot.draftVersion !== state.draftVersion` — that guard is the L3 check
 * in the validation cascade.
 */

import { create } from "zustand";

export interface Recipient {
  /** Canonical 0x-prefixed checksummed-or-lowercase address. */
  address: `0x${string}`;
  /** What the user actually typed (may be ENS like "alice.eth"). Kept so we
   * can re-resolve at deploy time without losing the user-friendly label. */
  displayInput: string;
  /** uint64-sized allocation. */
  amount: bigint;
}

export interface DraftSnapshot {
  /** keccak256(abi.encode(addresses)) — must match the list hash passed to
   * the campaign constructor exactly. Computed in Step 4 from the in-store
   * recipient list. */
  listHash: `0x${string}`;
  declaredTotal: bigint;
  recipientCount: number;
  capturedAt: number;
  /** The `draftVersion` at the moment of capture. If state.draftVersion later
   * advances past this, the snapshot is stale and Step 5 must refuse. */
  draftVersion: number;
}

export type WizardStatus =
  | "draft"
  | "deploying"
  | "deployed"
  | "failed_partial";

export interface WizardState {
  // Draft identity
  draftId: string | null;
  draftVersion: number;

  // Navigation
  currentStep: 1 | 2 | 3 | 4 | 5;
  status: WizardStatus;

  // Step 1
  name: string;
  description: string;

  // Step 2
  recipients: Recipient[];

  // Step 3
  auditor: `0x${string}` | "";

  // Step 4
  snapshot: DraftSnapshot | null;

  // Step 5
  campaignAddress: `0x${string}` | null;
  /** Within Step 5, which sub-step is in flight. 0 = not started. */
  deployStep: 0 | 1 | 2 | 3 | 4 | 5;
  /** Lower-cased recipient addresses that have successfully completed
   * `setAllocation` on chain. Populated incrementally during sub-step 5.3. */
  allocatedSoFar: string[];

  // ── Actions ───────────────────────────────────────────────────────
  setDraftId: (id: string | null) => void;
  /** Advance the draftVersion (Step 2 commits) AND invalidate the snapshot.
   * Per spec: "如果用户回到 Step 2 修改任何内容,draftVersion SHALL 自增,
   * snapshot SHALL 失效". */
  bumpVersion: () => void;
  setStep: (step: 1 | 2 | 3 | 4 | 5) => void;
  setBasics: (name: string, description: string) => void;
  setRecipients: (recipients: Recipient[]) => void;
  setAuditor: (auditor: `0x${string}` | "") => void;
  setSnapshot: (snapshot: DraftSnapshot | null) => void;
  setCampaignAddress: (addr: `0x${string}` | null) => void;
  setDeployStep: (step: 0 | 1 | 2 | 3 | 4 | 5) => void;
  setStatus: (status: WizardStatus) => void;
  /** Append a successfully-allocated recipient to `allocatedSoFar`. */
  markAllocated: (address: string) => void;
  /** Wipe state to factory defaults (e.g., after successful deploy + nav-away,
   * or when explicitly starting over). */
  reset: () => void;
}

const initialState = {
  draftId: null,
  draftVersion: 0,
  currentStep: 1 as const,
  status: "draft" as const,
  name: "",
  description: "",
  recipients: [],
  auditor: "" as const,
  snapshot: null,
  campaignAddress: null,
  deployStep: 0 as const,
  allocatedSoFar: [],
};

export const useWizardStore = create<WizardState>((set) => ({
  ...initialState,

  setDraftId: (id) => set({ draftId: id }),

  bumpVersion: () =>
    set((s) => ({ draftVersion: s.draftVersion + 1, snapshot: null })),

  setStep: (currentStep) => set({ currentStep }),

  setBasics: (name, description) => set({ name, description }),

  setRecipients: (recipients) => set({ recipients }),

  setAuditor: (auditor) => set({ auditor }),

  setSnapshot: (snapshot) => set({ snapshot }),

  setCampaignAddress: (campaignAddress) => set({ campaignAddress }),

  setDeployStep: (deployStep) => set({ deployStep }),

  setStatus: (status) => set({ status }),

  markAllocated: (address) =>
    set((s) => {
      const lc = address.toLowerCase();
      if (s.allocatedSoFar.includes(lc)) return {};
      return { allocatedSoFar: [...s.allocatedSoFar, lc] };
    }),

  reset: () => set({ ...initialState }),
}));
