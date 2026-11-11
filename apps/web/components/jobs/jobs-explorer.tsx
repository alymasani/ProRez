"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { JobFiltersPanel } from "@/components/jobs/job-filters-panel";
import { JobListItem } from "@/components/jobs/job-list-item";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterJobs,
  parseFilters,
  serializeFilters,
  type JobFilters,
  type SortOption,
} from "@/lib/jobs/filters";
import { initialSearchSync, markPushed, reconcileWithUrl } from "@/lib/jobs/search-sync";
import type { JobWithMatch } from "@/lib/types";

const SEARCH_DEBOUNCE_MS = 250;

export function JobsExplorer({ items }: { items: JobWithMatch[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const results = useMemo(() => filterJobs(items, filters), [items, filters]);
  const activeCount = countActiveFilters(filters);

  // The search box is locally controlled and pushed to the URL after a pause.
  // See lib/jobs/search-sync.ts for how URL changes are reconciled.
  const [sync, setSync] = useState(() => initialSearchSync(filters.query));
  const query = sync.input;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjust state during render when the URL query changes (React's recommended
  // alternative to syncing state in an effect).
  const [seenUrlQuery, setSeenUrlQuery] = useState(filters.query);
  const [externalChanges, setExternalChanges] = useState(0);
  if (filters.query !== seenUrlQuery) {
    setSeenUrlQuery(filters.query);
    const result = reconcileWithUrl(sync, filters.query);
    if (result.external) {
      setSync(result.state);
      setExternalChanges((n) => n + 1);
    }
  }

  // After an external change (e.g. back/forward), drop any pending push so a
  // stale debounced value cannot overwrite the navigation.
  useEffect(() => {
    if (externalChanges === 0 || !debounceRef.current) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, [externalChanges]);

  function replaceFilters(next: JobFilters) {
    setSync((s) => markPushed(s, next.query.trim()));
    const qs = serializeFilters(next).toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function update(patch: Partial<JobFilters>) {
    replaceFilters({ ...filters, query, ...patch });
  }

  function onQueryChange(value: string) {
    setSync((s) => ({ ...s, input: value }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      replaceFilters({ ...filters, query: value });
    }, SEARCH_DEBOUNCE_MS);
  }

  function clearAll() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setSync((s) => ({ ...s, input: "" }));
    replaceFilters({ ...EMPTY_FILTERS, sort: filters.sort });
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const hasAnyConstraint = activeCount > 0 || filters.query.trim() !== "";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
      <aside aria-label="Job filters" className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-xl border bg-card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Filters</h2>
            {activeCount > 0 ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAll}>
                Clear
              </Button>
            ) : null}
          </div>
          <JobFiltersPanel filters={filters} onChange={update} />
        </div>
      </aside>

      <section aria-label="Job results" className="min-w-0 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search title, company, or city"
              aria-label="Search jobs"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="lg:hidden">
                  <SlidersHorizontal /> Filters
                  {activeCount > 0 ? <Badge className="ml-0.5 px-1.5">{activeCount}</Badge> : null}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                  <SheetDescription>Results update as you select options.</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-6">
                  <JobFiltersPanel filters={filters} onChange={update} />
                  {activeCount > 0 ? (
                    <Button variant="outline" className="mt-6 w-full" onClick={clearAll}>
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </SheetContent>
            </Sheet>
            <label className="sr-only" htmlFor="job-sort">
              Sort jobs
            </label>
            <NativeSelect
              id="job-sort"
              value={filters.sort}
              onChange={(e) => update({ sort: e.target.value as SortOption })}
              className="w-full sm:w-44"
            >
              <option value="newest">Newest first</option>
              <option value="fit">Highest fit score</option>
            </NativeSelect>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p aria-live="polite" className="text-muted-foreground">
            <span className="font-medium text-foreground">{results.length}</span> of {items.length} demo
            postings
            {isPending ? <span className="ml-2 text-xs">Updating…</span> : null}
          </p>
          {hasAnyConstraint ? (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X /> Reset search &amp; filters
            </Button>
          ) : null}
        </div>

        {results.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No jobs match these filters"
            description="Try removing a filter or broadening your search terms."
            action={
              <Button variant="outline" size="sm" onClick={clearAll}>
                Reset search &amp; filters
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {results.map((item) => (
              <JobListItem key={item.job.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
