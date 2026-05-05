# ZamaDrop — Product Requirements Document

🌐 [中文](./prd.md) | English

> **Private allocations. Public accountability.**

**Hackathon**: Zama Protocol Bounty — Confidential Onchain Finance | **Deadline**: 2026-05-10 23:59 AOE

---

## 1. Product Positioning

**ZamaDrop** is a **confidential token distribution protocol** that lets project teams distribute tokens to their community while keeping the **campaign-level totals, recipient count, and rules** fully public and verifiable, yet keeping **each beneficiary's individual allocation amount** confidential. It addresses a long-overlooked structural flaw in the current airdrop ecosystem: a public allocation list doubles as a **target-acquisition database** for attackers, turning large recipients into precise targets for phishing, social engineering, and long-term doxxing.

**Core promise in one sentence**: *Merkle airdrops verify "who can claim" but leak "how much." ZamaDrop fills in the missing allocation privacy layer.*

The **primary customer** is any protocol team preparing for a token launch. **Secondary customers** are DAOs and Web3 startups with contributor grant or early backer allocation needs. **Explicitly out of scope**: anti-Sybil mechanisms, KYC integration, vesting unlock curves, and Merkle eligibility verification (architecturally reserved, but not implemented in the MVP).

---

## 2. User Roles and Scenarios

ZamaDrop involves four roles, each tied to a distinct scenario. The **project team (Admin)** creates the campaign, declares the total amount, configures encrypted allocations for each recipient, and finally triggers finalize to move the campaign into the claim phase. The **third-party observer (Public)** is anyone interested in campaign transparency: they can see aggregate information such as total amount, recipient count, and rules, but cannot see any individual amounts. The **recipient (Recipient)** connects a wallet to confirm their allocation, triggers decryption to view the amount, and completes the claim. The **auditor (Auditor)** is explicitly authorized by the project team and can decrypt aggregate statistics such as the *total claimed amount* for compliance verification, but **still cannot see any individual allocation**.

Together the four roles embody the literal meaning of the slogan—**campaign-level transparency, individual-level privacy**. These two properties are bundled together in traditional designs; FHE decouples them for the first time.

---

## 3. Core Flow

The full campaign lifecycle is divided into three phases.

**Setup phase**: The project team deploys the campaign container, declares the total distribution amount (publicly in plaintext), locks the corresponding tokens into the contract as escrow, and then configures encrypted allocations for each recipient one by one. Each setAllocation call is an independent, successfully committed on-chain action that cannot be tampered with after the fact. During this phase no recipient can claim, because the campaign state has not yet entered Finalized.

**Finalize phase**: Once all allocations are set, the project team triggers the finalize operation. The system automatically reconciles, in encrypted form, whether the *sum of all individual allocations* equals the *declared total*—this is a cryptographically enforced total-amount reconciliation, so **the project team cannot quietly skim the total under the cover of ciphertext**. If reconciliation passes, the campaign enters the claim phase; if it fails, the finalize transaction reverts, the campaign remains stuck in Setup, but the previously written allocation data is fully preserved so the project team can fix the issue and retry. Failures during this phase are **permanently and publicly recorded** on-chain, visible to the community, and cannot be hidden by the project team.

**Claim phase**: A recipient connects their wallet, confirms their encrypted allocation, triggers decryption to see the exact amount, and signs the claim transaction. Each claim updates the *total claimed* accumulator that the authorized auditor can decrypt, enabling real-time progress tracking on the audit layer.

---

## 4. Key Differentiation

ZamaDrop's differentiation against the bounty's evaluation dimensions concentrates in three areas.

**Innovation**: We articulate the precise gap of *eligibility ≠ allocation privacy*, acknowledging the value of Merkle proofs while accurately pinpointing their design blind spot. This gap-analysis framing avoids the over-claim of "fully replacing existing solutions" and is therefore more credible.

**Compliance awareness**: The auditor role gives a concrete shape to *programmable compliance*—regulators receive aggregate-level compliance answers without obtaining individual-level private data. This is listed as a standalone scoring dimension in the bounty, one that the vast majority of entrants will overlook; addressing it is structural differentiation.

**Real-world potential**: The same cryptographic primitive extends to three adjacent scenarios—DAO payroll, investor & contributor vesting, and sealed contributor airdrops—all sharing the same underlying contract components. This demonstrates **technical leverage**, a key signal for investor-minded judges.

---

## 5. Success Criteria

**Hackathon level**: Hit all six bounty scoring dimensions (Innovation, Compliance awareness, Real-world potential, Technical implementation, Production readiness, Usability) and place in the top 5. The video must capture the judges' attention in the first 30 seconds, leave a repeatable slogan in the final 10 seconds, and walk through the four-role comparison in the middle demo segment.

**Product level (long-term, outside MVP scope)**: The protocol becomes one of the standard pieces of token launch infrastructure, gets adopted by at least one real airdrop campaign, and processes actual distribution to more than 1,000 recipients.

**The MVP is only accountable for the hackathon-level success criteria.** Product-level metrics appear as vision statements in the README and at the end of the video, not as deliverables.

---

## 6. Scope Boundaries

The MVP must deliver: complete end-to-end flows for all four roles, a campaign creation and finalize state machine, encrypted allocation storage with strict ACL isolation, the auditor aggregate view, clear project documentation, and a 2-minute live-action video.

The MVP does **not** include: linear vesting unlocks, Merkle proof eligibility verification, multi-campaign factory patterns, CSV bulk import, cross-chain bridging, mobile clients, KYC integration, anti-Sybil mechanisms, or complex auditor queries (e.g., sanctioned address detection). These features either do not affect the video presentation, exceed the 10-day implementation window, or contribute nothing directly to the bounty scoring dimensions—they are mentioned uniformly as a single line in the roadmap.

---

## 7. Submission Checklist

The final submission must include: a dApp that runs the full four-role flow end-to-end on a testnet, a public GitHub repository, a clear README (with architecture diagram, contract addresses, deployment steps, and technical highlights), a 2-minute live-action video, and bilingual (Chinese + English) subtitles. The slogan **"Private allocations. Public accountability."** must appear at least twice in the video, the auditor view must appear for at least 5 seconds, and all narration must be recorded by a real human—**no AI-synthesized voices or virtual avatars are allowed**.

---

## 8. Landing Page

The Landing Page has moved to a separate repository `secret-drop` as a marketing surface (no wallet connection; CTAs link to the `app.zamadrop.xyz` subdomain). The dApp repository no longer maintains landing visual specifications; design tokens are shared via `frontend/src/styles/tokens.css` and `frontend/src/styles/effects.css`, keeping the dApp's visual language aligned with the landing site.
