/**
 * Suspense fallbacks for database-backed page content.
 *
 * With Cache Components, every page renders its static parts (title,
 * description, notices) into the static shell / App Shell and streams the
 * request-time database content into one of these placeholders. Each fallback
 * is announced to assistive technology and roughly matches the final layout so
 * content does not jump when it arrives.
 */
import { Skeleton } from "@/components/ui/skeleton";

function Announce({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}

/** Filters sidebar + result cards (job discovery). */
export function ExplorerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]" role="status" aria-live="polite" data-testid="page-skeleton">
      <Announce label="Loading jobs…" />
      <Skeleton className="hidden h-[32rem] rounded-xl lg:block" />
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** A toolbar and a table or list of rows (applications, libraries, boards). */
export function TableSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite" data-testid="page-skeleton">
      <Announce label={label} />
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="space-y-2 rounded-xl border p-4">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A grid of cards (projects, profiles). */
export function CardGridSkeleton({ label, cards = 4 }: { label: string; cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" role="status" aria-live="polite" data-testid="page-skeleton">
      <Announce label={label} />
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}

/** Stacked form sections (settings, profile editor). */
export function FormSkeleton({ label, sections = 3 }: { label: string; sections?: number }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" data-testid="page-skeleton">
      <Announce label={label} />
      {Array.from({ length: sections }, (_, i) => (
        <Skeleton key={i} className="h-56 rounded-xl" />
      ))}
    </div>
  );
}

/** A record page whose title itself comes from the database (job, profile). */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-live="polite" data-testid="page-skeleton">
      <Announce label={label} />
      <Skeleton className="h-8 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-96 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
