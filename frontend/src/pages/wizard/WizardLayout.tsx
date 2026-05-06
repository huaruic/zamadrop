import { NavLink, Outlet, useLocation } from "react-router-dom";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { useWizardStore } from "./state";

/** Shared shell for the 5-step Admin deployment wizard.
 *
 * Spec: openspec/changes/v7-dapp-wizard/specs/admin-deployment-flow/spec.md
 *
 * Renders a horizontal step indicator on top, then the active step's content
 * via <Outlet />. Step labels deep-link directly via NavLink so the user can
 * jump back to a completed step (e.g., to edit recipients after Step 4),
 * which by spec invalidates the snapshot via Step 2's bumpVersion. */

const STEPS = [
  { idx: 1 as const, slug: "basics", label: "Basics" },
  { idx: 2 as const, slug: "recipients", label: "Recipients" },
  { idx: 3 as const, slug: "auditor", label: "Auditor" },
  { idx: 4 as const, slug: "review", label: "Review" },
  { idx: 5 as const, slug: "deploy", label: "Deploy" },
];

export default function WizardLayout() {
  const location = useLocation();
  const currentStep = useWizardStore((s) => s.currentStep);

  // Highlight by URL primarily, falling back to store state. URL wins so the
  // strip stays consistent during in-flight navigation.
  const activeIdx = (() => {
    for (const s of STEPS) {
      if (location.pathname.endsWith(`/${s.slug}`)) return s.idx;
    }
    return currentStep;
  })();

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-mono text-2xl font-semibold tracking-tight md:text-3xl">
          Deploy a campaign
        </h1>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          5 steps · ZamaDrop wizard
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <ol className="flex flex-wrap items-center gap-2 md:flex-nowrap">
            {STEPS.map((s, i) => {
              const isActive = activeIdx === s.idx;
              const isComplete = activeIdx > s.idx;
              return (
                <li key={s.slug} className="flex items-center gap-2">
                  <NavLink
                    to={`/wizard/${s.slug}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
                      isActive
                        ? "border-primary/60 bg-primary/15 text-primary"
                        : isComplete
                          ? "border-cipher/40 bg-cipher/10 text-cipher hover:bg-cipher/15"
                          : "border-border bg-surface text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="font-semibold">{s.idx}</span>
                    <span>{s.label}</span>
                  </NavLink>
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        "hidden h-px w-6 md:block",
                        isComplete ? "bg-cipher/40" : "bg-border",
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Outlet />
    </div>
  );
}
