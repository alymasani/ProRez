import type { Metadata } from "next";
import Link from "next/link";
import { FolderGit2, GitBranch, Lock } from "lucide-react";
import { FutureAction } from "@/components/future-action";
import { PageHeader } from "@/components/page-header";
import { EmptyState, PreviewNotice } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getJobIndex, getProjects } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { CHECK_STATUS } from "@/lib/labels";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  const projects = getProjects();
  const jobs = getJobIndex();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Software projects generated to demonstrate fit for specific roles during a Full Build."
      />
      <PreviewNotice title="Demo records — nothing has been built or published">
        Repository names are planned placeholders. Project generation, build/test runs, and GitHub publishing arrive in
        later milestones.
      </PreviewNotice>

      {projects.length === 0 ? (
        <EmptyState icon={FolderGit2} title="No projects yet" description="Projects appear here after a Full Build." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="font-mono text-base">{project.name}</CardTitle>
                    <DemoBadge />
                  </div>
                  <p className="text-sm text-muted-foreground">{project.description}</p>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <ul className="flex flex-wrap gap-1.5" aria-label="Technologies">
                    {project.technologies.map((t) => (
                      <li key={t}>
                        <Badge variant="secondary">{t}</Badge>
                      </li>
                    ))}
                  </ul>

                  <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    <div className="space-y-1">
                      <dt className="text-xs text-muted-foreground">Build</dt>
                      <dd>
                        <StatusBadge meta={CHECK_STATUS[project.buildStatus]} srPrefix="Build:" />
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs text-muted-foreground">Tests</dt>
                      <dd>
                        <StatusBadge meta={CHECK_STATUS[project.testStatus]} srPrefix="Tests:" />
                      </dd>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">Repository</dt>
                      <dd className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                          <GitBranch className="size-3.5" aria-hidden="true" />
                          {project.repository.owner}/{project.repository.name}
                        </span>
                        <Badge variant="muted">
                          <Lock aria-hidden="true" /> Not published
                        </Badge>
                      </dd>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">Associated jobs</dt>
                      <dd>
                        <ul className="space-y-0.5">
                          {project.jobIds.map((id) => {
                            const job = jobs.get(id);
                            return (
                              <li key={id}>
                                {job ? (
                                  <Link href={`/jobs/${id}`} className="hover:underline">
                                    {job.company} — {job.title}
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground">Unknown job</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
                <CardFooter className="flex-wrap justify-between gap-2 border-t pt-4">
                  <span className="text-xs text-muted-foreground">Created {formatDate(project.createdAt)}</span>
                  <div className="flex flex-wrap gap-2">
                    <FutureAction>Run checks</FutureAction>
                    <FutureAction>Publish to GitHub</FutureAction>
                  </div>
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
