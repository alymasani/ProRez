import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { StatusMeta } from "@/lib/labels";
import { cn } from "@/lib/utils";

const DOT: Record<StatusMeta["tone"], string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-sky-500",
  progress: "bg-violet-500 animate-pulse",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  muted: "bg-muted-foreground/40",
};

export function StatusBadge({
  meta,
  className,
  srPrefix,
}: {
  meta: StatusMeta;
  className?: string;
  /** Screen-reader context, e.g. "Preparation:". */
  srPrefix?: string;
}) {
  return (
    <Badge variant={meta.tone} className={className}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[meta.tone])} />
      {srPrefix ? <span className="sr-only">{srPrefix} </span> : null}
      {meta.label}
    </Badge>
  );
}

export function DemoBadge({ className, label = "Demo" }: { className?: string; label?: string }) {
  return (
    <Badge variant="demo" className={className} title="Fictional development fixture — not a real record">
      <FlaskConical aria-hidden="true" />
      {label}
    </Badge>
  );
}
