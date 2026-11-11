import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A visibly disabled control for functionality that needs backend support in
 * a later milestone. It never looks or behaves as if it works.
 */
export function FutureAction({
  children,
  reason = "Available in a later milestone",
  variant = "outline",
  size = "sm",
  className,
}: {
  children: ReactNode;
  reason?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  return (
    <Button type="button" variant={variant} size={size} disabled title={reason} className={className}>
      {children}
      <span className="rounded bg-muted px-1 py-px text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        Soon
      </span>
      <span className="sr-only">({reason})</span>
    </Button>
  );
}
