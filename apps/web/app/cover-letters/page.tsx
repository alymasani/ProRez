import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/page-skeletons";
import { PreviewNotice } from "@/components/states";
import { getCoverLetters, getJobIndex } from "@/lib/data";
import { toDocumentItems } from "@/lib/documents";

export const metadata: Metadata = { title: "Cover letters" };

export default function CoverLettersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cover letter library"
        description="Tailored cover letters, their tone, and the job each was written for."
      />
      <PreviewNotice title="Demo records — no files exist yet">
        These entries illustrate the library layout. Cover letter generation and downloads arrive in a later milestone.
      </PreviewNotice>
      <Suspense fallback={<TableSkeleton label="Loading cover letters…" />}>
        <Library />
      </Suspense>
    </div>
  );
}

async function Library() {
  const [letters, jobIndex] = await Promise.all([getCoverLetters(), getJobIndex()]);
  return <DocumentLibrary items={toDocumentItems(letters, jobIndex)} noun="cover letter" />;
}
