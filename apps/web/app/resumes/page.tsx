import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/page-skeletons";
import { PreviewNotice } from "@/components/states";
import { getJobIndex, getResumes } from "@/lib/data";
import { toDocumentItems } from "@/lib/documents";

export const metadata: Metadata = { title: "Resumes" };

export default function ResumesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Resume library"
        description="Every tailored resume version and the job it was created for."
      />
      <PreviewNotice title="Demo records — no files exist yet">
        These entries illustrate the library layout. Resume generation and downloads arrive in a later milestone.
      </PreviewNotice>
      <Suspense fallback={<TableSkeleton label="Loading resumes…" />}>
        <Library />
      </Suspense>
    </div>
  );
}

async function Library() {
  const [resumes, jobIndex] = await Promise.all([getResumes(), getJobIndex()]);
  return <DocumentLibrary items={toDocumentItems(resumes, jobIndex)} noun="resume" />;
}
