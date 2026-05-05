import type { PropsWithChildren } from "react";

import { TopBar } from "@/components/TopBar";

/** Shared shell: ambient background layers + TopBar + main container.
 * Every page renders inside this. */
export function PageLayout({ children }: PropsWithChildren) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div className="lp-bg" aria-hidden />
      <div className="lp-geo-lines" aria-hidden />
      <div className="lp-noise" aria-hidden />
      <div className="fluid-layer" aria-hidden>
        <div className="orb orb-a" />
        <div className="orb orb-b" />
      </div>

      <TopBar />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-12">
        {children}
      </main>
    </div>
  );
}
