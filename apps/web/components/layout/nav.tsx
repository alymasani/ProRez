"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import {
  Building,
  BriefcaseBusiness,
  FilePlus,
  FileText,
  FolderGit2,
  LayoutDashboard,
  ListFilter,
  Mail,
  Settings,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href:
    | "/"
    | "/jobs"
    | "/jobs/new"
    | "/applications"
    | "/resumes"
    | "/cover-letters"
    | "/projects"
    | "/profiles"
    | "/boards"
    | "/settings";
  label: string;
  icon: LucideIcon;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Discover",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/jobs", label: "Job discovery", icon: BriefcaseBusiness },
      { href: "/jobs/new", label: "Add a job", icon: FilePlus },
    ],
  },
  {
    title: "Apply",
    items: [
      { href: "/applications", label: "Applications", icon: SquareKanban },
      { href: "/resumes", label: "Resumes", icon: FileText },
      { href: "/cover-letters", label: "Cover letters", icon: Mail },
      { href: "/projects", label: "Projects", icon: FolderGit2 },
    ],
  },
  {
    title: "Configure",
    items: [
      { href: "/profiles", label: "Search profiles", icon: ListFilter },
      { href: "/boards", label: "Employer boards", icon: Building },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function isActive(pathname: string | null, href: NavItem["href"]): boolean {
  if (pathname === null) return false;
  if (href === "/") return pathname === "/";
  if (href === "/jobs") return pathname === "/jobs" || (pathname.startsWith("/jobs/") && pathname !== "/jobs/new");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Main navigation. The active-link highlight needs the pathname, which is not
 * known at build time for dynamic routes (e.g. /jobs/[jobId]) under Cache
 * Components, so it is read inside a Suspense boundary. The fallback renders
 * the same links without a highlight, keeping the shell prerendered.
 */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
      <ActiveNavList onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveNavList({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">
            {section.title}
          </p>
          {section.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onNavigate={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
