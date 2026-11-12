"use client";

import { useLayoutEffect, useState, useTransition } from "react";
import { Archive, LoaderCircle, Trash2 } from "lucide-react";
import { deleteProfileAction } from "@/app/profiles/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Delete with history protection. Profiles referenced by stored job matches
 * are archived (hidden, disabled, history kept); others are deleted outright.
 * The server makes the final decision, so a stale count can never lose data.
 */
export function DeleteProfileButton({
  profileId,
  profileName,
  matchCount,
  onDone,
  className,
}: {
  profileId: string;
  profileName: string;
  matchCount: number;
  onDone?: (outcome: "deleted" | "archived") => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const willArchive = matchCount > 0;

  // Close if this route is hidden by <Activity> during navigation.
  useLayoutEffect(() => () => setOpen(false), []);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProfileAction(profileId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      onDone?.(result.value.outcome);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={className}>
          <Trash2 /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{willArchive ? "Archive" : "Delete"} “{profileName}”?</DialogTitle>
          <DialogDescription>
            {willArchive
              ? `This profile is part of ${matchCount} job result${matchCount === 1 ? "" : "s"} that already produced a notification. To keep that history intact it will be archived: hidden, disabled and no longer evaluated. Its name becomes available again.`
              : "This profile has no notification history, so it will be permanently deleted with its saved versions. Current job matches are recalculated without it."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={isPending}>
            {isPending ? <LoaderCircle className="animate-spin" /> : willArchive ? <Archive /> : <Trash2 />}
            {isPending ? "Working…" : willArchive ? "Archive profile" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
