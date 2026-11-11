import Link from "next/link";

export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm"
      >
        P
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-semibold tracking-tight">ProRez</span>
        <span className="mt-0.5 text-[11px] text-muted-foreground">Canadian SWE jobs</span>
      </span>
    </Link>
  );
}
