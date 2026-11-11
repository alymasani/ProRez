"use client";

import { useId, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function optionsFrom<T extends string>(values: readonly T[], labels: Record<T, string>): Option<T>[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** Multi-select as a labelled fieldset of checkboxes. */
export function CheckboxGroup<T extends string>({
  legend,
  description,
  options,
  value,
  onChange,
  columns = 1,
  error,
  disabled,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  options: Option<T>[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  columns?: 1 | 2 | 3;
  error?: string;
  disabled?: boolean;
  className?: string;
}) {
  const baseId = useId();
  const errorId = `${baseId}-error`;

  function toggle(option: T, checked: boolean) {
    const next = checked ? [...value, option] : value.filter((v) => v !== option);
    // Keep option order stable regardless of click order.
    onChange(options.map((o) => o.value).filter((v) => next.includes(v)));
  }

  return (
    <fieldset
      className={cn("space-y-2.5", className)}
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
    >
      <legend className="text-sm font-medium">{legend}</legend>
      {description ? <p className="-mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <div
        className={cn(
          "grid grid-cols-1 gap-x-4 gap-y-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {options.map((option) => {
          const id = `${baseId}-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <Checkbox
                id={id}
                checked={value.includes(option.value)}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
                disabled={disabled}
                className="mt-0.5"
              />
              <label htmlFor={id} className="cursor-pointer text-sm leading-snug">
                {option.label}
                {option.hint ? <span className="block text-xs text-muted-foreground">{option.hint}</span> : null}
              </label>
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
