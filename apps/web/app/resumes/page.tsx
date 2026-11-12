import type { Metadata } from "next";
import { DocumentLibrary } from "@/components/documents/document-library";
import { PageHeader } from "@/components/page-header";
import { PreviewNotice } from "@/components/states";
import { getJobIndex, getResumes } from "@/lib/data";
import { toDocumentItems } from "@/lib/documents";

export const metadata: Metadata = { title: "Resumes" };

export default async function ResumesPage() {
  const [resumes, jobIndex] = await Promise.all([getResumes(), getJobIndex()]);
  const items = toDocumentItems(resumes, jobIndex);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Resume library"
        description="Every tailored resume version and the job it was created for."
      />
      <PreviewNotice title="Demo records — no files exist yet">
        These entries illustrate the library layout. Resume generation and downloads arrive in a later milestone.
      </PreviewNotice>
      <DocumentLibrary items={items} noun="resume" />
    </div>
  );
}
