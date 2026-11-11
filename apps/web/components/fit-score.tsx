import { cn } from "@/lib/utils";

function tone(score: number): string {
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 70) return "text-sky-600 dark:text-sky-400";
  if (score >= 55) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function bar(score: number): string {
  if (score >= 85) return "bg-emerald-500";
  if (score >= 70) return "bg-sky-500";
  if (score >= 55) return "bg-amber-500";
  return "bg-muted-foreground/50";
}

/** Fictional fit score (0–100). `null` renders an explicit "Not scored" state. */
export function FitScore({ score, className }: { score: number | null; className?: string }) {
  if (score === null) {
    return <span className={cn("text-xs text-muted-foreground", className)}>Not scored</span>;
  }
  return (
    <div className={cn("flex items-center gap-2", className)} title="Fictional demo fit score">
      <span className={cn("w-7 text-right text-sm font-semibold tabular-nums", tone(score))}>
        {score}
        <span className="sr-only"> out of 100 fit score (demo)</span>
      </span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", bar(score))} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
