"use client";

import { RefreshCw } from "lucide-react";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";

function digestOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string") {
    return error.digest;
  }
  return null;
}

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  return (
    <ErrorState
      title="This page failed to load"
      description={
        <>
          An unexpected error occurred while rendering this view.
          {digest ? <span className="mt-1 block font-mono text-xs">Reference: {digest}</span> : null}
        </>
      }
      action={
        <Button variant="outline" size="sm" onClick={() => retry()}>
          <RefreshCw /> Try again
        </Button>
      }
    />
  );
}
