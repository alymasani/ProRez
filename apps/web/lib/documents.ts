import type { JobIndex } from "./data";
import type { DocumentArtifact } from "./types";

/** Resolves the job display info for each artifact (server-side, before passing to the client). */
export function toDocumentItems(artifacts: readonly DocumentArtifact[], jobs: JobIndex) {
  return artifacts.map((artifact) => {
    const job = jobs.get(artifact.jobId);
    return {
      artifact,
      job: job ? { id: job.id, title: job.title, company: job.company } : null,
    };
  });
}
