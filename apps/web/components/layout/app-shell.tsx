import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLinks } from "@/components/layout/nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getMutationAvailability } from "@/lib/auth/server-actor";

/** Accurate for the running mode: database mode with saving enabled does persist edits. */
function modeNotice() {
  return getMutationAvailability().enabled
    ? {
        long: "Demo records are fictional. Profiles and boards save to your local database; nothing is sent or submitted.",
        short: "Demo data · edits save locally · nothing is sent or submitted.",
      }
    : {
        long: "All data is fictional. Nothing is saved, sent, or submitted.",
        short: "Demo data only — nothing is saved or submitted.",
      };
}

function DemoModeNote() {
  return (
    <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
      <p className="flex items-center gap-1.5 font-medium">
        <FlaskConical className="size-3.5" aria-hidden="true" />
        Demo mode
      </p>
      <p className="mt-1 text-amber-900/75 dark:text-amber-200/75">{modeNotice().long}</p>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
        <div className="flex items-center justify-between px-1">
          <Brand />
          <ThemeToggle />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <DemoModeNote />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/85 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <MobileNav />
            <Brand />
          </div>
          <ThemeToggle />
        </header>

        <div
          role="note"
          className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-1.5 text-center text-xs text-amber-900 lg:hidden dark:text-amber-200"
        >
          <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
          {modeNotice().short}
        </div>

        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
