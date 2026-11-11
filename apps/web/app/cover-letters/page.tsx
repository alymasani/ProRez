import type { Metadata } from "next";
import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/page-header";
import { PreviewNotice } from "@/components/states";
import { getCoverLetters, getJobIndex } from "@/lib/data";
import { toDocumentItems } from "@/lib/documents";

export const metadata: Metadata = { title: "Cover letters" };

export default function CoverLettersPage() {
  const items = toDocumentItems(getCoverLetters(), getJobIndex());
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cover letter library"
        description="Tailored cover letters, their tone, and the job each was written for."
      />
      <PreviewNotice title="Demo records — no files exist yet">
        These entries illustrate the library layout. Cover letter generation and downloads arrive in a later milestone.
      </PreviewNotice>
      <DocumentLibrary items={items} noun="cover letter" />
    </div>
  );
}
