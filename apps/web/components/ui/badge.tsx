import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        // Semantic tones (see lib/labels.ts `Tone`).
        neutral: "border-transparent bg-secondary text-secondary-foreground",
        info: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        progress: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warning: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        danger: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
        muted: "border-border bg-transparent text-muted-foreground",
        demo: "border-dashed border-amber-500/50 bg-amber-500/5 text-amber-800 dark:text-amber-300 uppercase tracking-wide text-[10px] px-1.5",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
