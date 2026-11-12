/**
 * DEMO FIXTURES — every company, posting, and score below is fictional.
 * URLs use the reserved `.example` TLD so they can never resolve to a real site.
 */
import { normalizeJobUrl } from "@/lib/jobs/url";
import type {
  Discipline,
  JobDescriptionSnapshot,
  JobEvent,
  JobMatch,
  JobPosting,
  JobSighting,
  JobSource,
} from "@/lib/types";

export const DEMO_JOB_SOURCES: JobSource[] = [
  {
    id: "src-greenhouse",
    provider: "greenhouse",
    label: "Greenhouse job boards",
    description: "Public Greenhouse job board API for employers you choose to monitor.",
    enabled: true,
    integrationStatus: "planned",
    lastCheckedAt: null,
  },
  {
    id: "src-lever",
    provider: "lever",
    label: "Lever postings",
    description: "Public Lever postings API for employers you choose to monitor.",
    enabled: true,
    integrationStatus: "planned",
    lastCheckedAt: null,
  },
  {
    id: "src-ashby",
    provider: "ashby",
    label: "Ashby job boards",
    description: "Public Ashby job board API for employers you choose to monitor.",
    enabled: true,
    integrationStatus: "planned",
    lastCheckedAt: null,
  },
  {
    id: "src-smartrecruiters",
    provider: "smartrecruiters",
    label: "SmartRecruiters postings",
    description: "Public SmartRecruiters posting API for employers you choose to monitor.",
    enabled: false,
    integrationStatus: "planned",
    lastCheckedAt: null,
  },
  {
    id: "src-company-site",
    provider: "company_site",
    label: "Company career sites",
    description: "Employer career pages that are not on a supported ATS.",
    enabled: false,
    integrationStatus: "planned",
    lastCheckedAt: null,
  },
  {
    id: "src-manual",
    provider: "manual",
    label: "Manual submissions",
    description: "Jobs you paste in yourself via the Add job form.",
    enabled: true,
    integrationStatus: "planned",
    lastCheckedAt: null,
  },
];

const RESPONSIBILITIES: Record<Discipline, string> = {
  backend: "Design and ship service endpoints with automated tests and code review",
  frontend: "Build accessible, responsive UI components in a shared design system",
  full_stack: "Deliver features end-to-end across the web client, API, and database",
  mobile: "Implement native mobile features and improve app start-up performance",
  infrastructure: "Automate deployments and improve observability for production services",
  data: "Build and maintain batch and streaming data pipelines",
  machine_learning: "Prototype, evaluate, and document ML models on internal datasets",
  embedded: "Write and test firmware for microcontroller-based devices",
  security: "Triage findings and contribute to secure-by-default tooling",
  qa_automation: "Expand automated end-to-end test coverage and reduce flaky tests",
};

const QUALIFICATIONS: Record<Discipline, string> = {
  backend: "Experience with a typed backend language (e.g. Java, Go, TypeScript)",
  frontend: "Comfort with React, TypeScript, and modern CSS",
  full_stack: "Familiarity with both a web framework and a relational database",
  mobile: "Experience with Kotlin, Swift, or a cross-platform mobile framework",
  infrastructure: "Familiarity with containers, CI pipelines, and Linux",
  data: "Strong SQL and experience with Python for data processing",
  machine_learning: "Coursework or projects in machine learning with Python",
  embedded: "Proficiency in C or C++ and comfort reading hardware datasheets",
  security: "Interest in application security and threat modelling",
  qa_automation: "Experience with a test framework such as Playwright or pytest",
};

type JobSeed = Omit<
  JobPosting,
  | "responsibilities"
  | "qualifications"
  | "isDemo"
  | "externalId"
  | "postingUrl"
  | "origin"
  | "version"
  | "description"
  | "experienceRequirement"
  | "salary"
  | "notes"
  | "createdAt"
  | "updatedAt"
> & { slug: string; extraQualifications?: string[] } & Partial<
    Pick<JobPosting, "description" | "experienceRequirement" | "salary" | "notes">
  >;

function job(seed: JobSeed): JobPosting {
  const { slug, extraQualifications = [], description = null, experienceRequirement = null, salary = null, notes = "", ...rest } = seed;
  return {
    ...rest,
    origin: seed.sourceId === "src-manual" ? "manual" : "automatic",
    version: 1,
    description,
    experienceRequirement,
    salary,
    notes,
    createdAt: seed.discoveredAt,
    updatedAt: seed.discoveredAt,
    externalId: seed.sourceId === "src-manual" ? null : `demo-${seed.id}`,
    postingUrl: `https://careers.example/${slug}/${seed.id}`,
    responsibilities: [
      ...seed.disciplines.map((d) => RESPONSIBILITIES[d]),
      "Collaborate with a mentor and present your work at the end of the term",
    ],
    qualifications: [
      "Currently enrolled in or recently graduated from a Canadian post-secondary program",
      ...seed.disciplines.map((d) => QUALIFICATIONS[d]),
      ...extraQualifications,
    ],
    isDemo: true,
  };
}

const SILVERBIRCH_DESCRIPTION = `Silverbirch Studio (fictional) is hiring a Full Stack Developer Co-op for Summer 2027.

What you'll do
- Build accessible React components for client websites
- Extend a small TypeScript and PostgreSQL API
- Write automated tests and take part in code review

What we're looking for
- Enrolled in a Canadian co-op program
- No prior professional experience required; projects count
- Curiosity about design systems

This posting is demo data. The company and role do not exist.`;

export const DEMO_JOBS: JobPosting[] = [
  job({
    id: "job-001",
    slug: "northlight-robotics",
    sourceId: "src-greenhouse",
    company: "Northlight Robotics",
    title: "Software Engineering Intern, Embedded Systems",
    locations: [{ city: "Waterloo", province: "ON", arrangement: "onsite" }],
    jobType: "internship",
    durationMonths: 4,
    term: "Summer 2027",
    disciplines: ["embedded", "backend"],
    summary:
      "Join a small team building control software for fictional warehouse robots, from firmware to the fleet-management service.",
    postedAt: "2026-11-09T13:00:00Z",
    discoveredAt: "2026-11-10T14:12:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-002",
    slug: "maplewave-analytics",
    sourceId: "src-lever",
    company: "Maplewave Analytics",
    title: "Data Engineering Co-op",
    locations: [{ city: "Toronto", province: "ON", arrangement: "hybrid" }],
    jobType: "co_op",
    // Deliberately unstated: demonstrates the "needs review" path for duration.
    durationMonths: null,
    term: "Summer 2027",
    disciplines: ["data", "backend"],
    summary:
      "Help a demo analytics company move nightly batch jobs to an event-driven pipeline and improve data quality checks.",
    postedAt: "2026-11-08T15:30:00Z",
    discoveredAt: "2026-11-10T09:45:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-003",
    slug: "tidewater-fintech",
    sourceId: "src-ashby",
    company: "Tidewater Fintech",
    title: "Backend Developer Co-op",
    locations: [{ city: "Halifax", province: "NS", arrangement: "hybrid" }],
    jobType: "co_op",
    durationMonths: 8,
    term: "Summer–Fall 2027",
    disciplines: ["backend"],
    summary:
      "Work on the ledger and reconciliation services of a fictional payments startup with a strong testing culture.",
    postedAt: "2026-10-24T12:00:00Z",
    discoveredAt: "2026-10-25T11:20:00Z",
    discoveryStatus: "saved",
  }),
  job({
    id: "job-004",
    slug: "borealis-health",
    sourceId: "src-greenhouse",
    company: "Borealis Health Systems",
    title: "Software Developer, New Graduate",
    locations: [
      { city: "Vancouver", province: "BC", arrangement: "hybrid" },
      { city: "Victoria", province: "BC", arrangement: "remote" },
    ],
    jobType: "new_grad",
    durationMonths: null,
    term: "Starting 2027",
    disciplines: ["full_stack"],
    summary:
      "Build scheduling tools for a demo clinic-management platform used across several fictional provinces.",
    postedAt: "2026-10-12T16:00:00Z",
    discoveredAt: "2026-10-13T08:05:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-005",
    slug: "prairie-grid",
    sourceId: "src-smartrecruiters",
    company: "Prairie Grid Energy",
    title: "Full Stack Developer Intern",
    locations: [{ city: "Calgary", province: "AB", arrangement: "onsite" }],
    jobType: "internship",
    durationMonths: 4,
    term: "Summer 2027",
    disciplines: ["full_stack", "frontend"],
    summary:
      "Create internal dashboards that visualize simulated power-grid load for operations staff.",
    postedAt: "2026-11-06T17:00:00Z",
    discoveredAt: "2026-11-09T19:30:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-006",
    slug: "glacier-labs",
    sourceId: "src-ashby",
    company: "Glacier Labs",
    title: "Machine Learning Intern",
    locations: [{ city: "Montréal", province: "QC", arrangement: "hybrid" }],
    jobType: "internship",
    durationMonths: 4,
    term: "Winter 2027",
    disciplines: ["machine_learning", "data"],
    summary:
      "Evaluate small language-understanding models for a fictional document-search product. French is an asset.",
    postedAt: "2026-11-07T14:00:00Z",
    discoveredAt: "2026-11-09T10:15:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-007",
    slug: "harbourline-security",
    sourceId: "src-lever",
    company: "Harbourline Security",
    title: "Security Engineering Co-op",
    locations: [{ city: "Ottawa", province: "ON", arrangement: "onsite" }],
    jobType: "co_op",
    durationMonths: 4,
    term: "Winter 2027",
    disciplines: ["security", "infrastructure"],
    summary:
      "Contribute to static-analysis tooling and help harden CI pipelines at a demo security consultancy.",
    postedAt: "2026-10-28T13:00:00Z",
    discoveredAt: "2026-10-29T15:40:00Z",
    discoveryStatus: "saved",
  }),
  job({
    id: "job-008",
    slug: "cedarpine-interactive",
    sourceId: "src-greenhouse",
    company: "Cedarpine Interactive",
    title: "Game Tools Developer Intern",
    locations: [{ city: "Montréal", province: "QC", arrangement: "onsite" }],
    jobType: "internship",
    durationMonths: 8,
    term: "Winter–Summer 2027",
    disciplines: ["full_stack"],
    summary: "Build editor tooling that helps designers at a fictional studio iterate on levels faster.",
    postedAt: "2026-10-20T14:00:00Z",
    discoveredAt: "2026-10-21T09:00:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-009",
    slug: "lakeshore-logistics",
    sourceId: "src-lever",
    company: "Lakeshore Logistics",
    title: "Mobile Developer Co-op",
    locations: [{ city: "Mississauga", province: "ON", arrangement: "hybrid" }],
    jobType: "co_op",
    durationMonths: 4,
    term: "Summer 2027",
    disciplines: ["mobile"],
    summary: "Improve the driver companion app for a demo delivery network on Android and iOS.",
    postedAt: "2026-11-03T12:00:00Z",
    discoveredAt: "2026-11-04T13:25:00Z",
    discoveryStatus: "saved",
  }),
  job({
    id: "job-010",
    slug: "quillstone-software",
    sourceId: "src-ashby",
    company: "Quillstone Software",
    title: "Junior Software Engineer",
    locations: [{ city: "Toronto", province: "ON", arrangement: "remote" }],
    jobType: "junior",
    extraQualifications: ["1–2 years of professional software development experience"],
    durationMonths: null,
    term: null,
    disciplines: ["backend", "infrastructure"],
    summary: "Join the platform team of a fictional developer-tools company. Remote within Canada.",
    postedAt: "2026-11-05T15:00:00Z",
    discoveredAt: "2026-11-10T16:50:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-011",
    slug: "fernhill-biotech",
    sourceId: "src-smartrecruiters",
    company: "Fernhill Biotech",
    title: "QA Automation Co-op",
    locations: [{ city: "Winnipeg", province: "MB", arrangement: "hybrid" }],
    jobType: "co_op",
    durationMonths: 4,
    term: "Winter 2027",
    disciplines: ["qa_automation"],
    summary: "Automate regression tests for lab-inventory software at a demo biotech company.",
    postedAt: "2026-10-15T13:00:00Z",
    discoveredAt: "2026-10-16T12:10:00Z",
    discoveryStatus: "dismissed",
  }),
  job({
    id: "job-012",
    slug: "aurorafield-cloudworks",
    sourceId: "src-greenhouse",
    company: "Aurorafield Cloudworks",
    title: "Site Reliability Engineering Intern",
    locations: [{ city: "Edmonton", province: "AB", arrangement: "remote" }],
    jobType: "internship",
    durationMonths: 12,
    term: "May 2027 – April 2028",
    disciplines: ["infrastructure"],
    summary: "A 12-month placement improving alerting and incident tooling for a fictional cloud host.",
    postedAt: "2026-11-02T18:00:00Z",
    discoveredAt: "2026-11-08T07:55:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-013",
    slug: "saltmarsh-media",
    sourceId: "src-lever",
    company: "Saltmarsh Media",
    title: "Frontend Developer Intern",
    locations: [{ city: "Victoria", province: "BC", arrangement: "hybrid" }],
    jobType: "internship",
    durationMonths: 4,
    term: "Fall 2026",
    disciplines: ["frontend"],
    summary: "Build reader-facing features for a demo digital publication. This posting has closed.",
    postedAt: "2026-08-30T12:00:00Z",
    discoveredAt: "2026-09-01T10:00:00Z",
    discoveryStatus: "expired",
  }),
  job({
    id: "job-014",
    slug: "kestrel-transit",
    sourceId: "src-ashby",
    company: "Kestrel Transit Labs",
    title: "Software Engineer Co-op, Platform",
    locations: [
      { city: "Montréal", province: "QC", arrangement: "hybrid" },
      { city: "Toronto", province: "ON", arrangement: "hybrid" },
    ],
    jobType: "co_op",
    durationMonths: 4,
    term: "Summer 2027",
    disciplines: ["backend", "infrastructure"],
    summary: "Normalize real-time transit feeds for a fictional trip-planning platform.",
    postedAt: "2026-10-30T14:00:00Z",
    discoveredAt: "2026-10-31T09:30:00Z",
    discoveryStatus: "saved",
  }),
  job({
    id: "job-015",
    slug: "driftwood-payments",
    sourceId: "src-greenhouse",
    company: "Driftwood Payments",
    title: "New Grad Software Engineer",
    locations: [{ city: "Toronto", province: "ON", arrangement: "onsite" }],
    jobType: "new_grad",
    // Mixed requirements: demonstrates the ambiguous-experience path.
    extraQualifications: ["0–2 years of experience; 3+ years with payment systems is an asset"],
    durationMonths: null,
    term: "Starting Summer 2027",
    disciplines: ["backend", "full_stack"],
    summary: "Work on idempotent payment APIs and merchant tooling at a demo payments processor.",
    postedAt: "2026-10-26T13:00:00Z",
    discoveredAt: "2026-10-27T14:00:00Z",
    discoveryStatus: "saved",
  }),
  job({
    id: "job-016",
    slug: "brightwater-ed",
    sourceId: "src-smartrecruiters",
    company: "Brightwater Learning",
    title: "Software Developer Co-op",
    locations: [{ city: "Saskatoon", province: "SK", arrangement: "remote" }],
    jobType: "co_op",
    durationMonths: 4,
    term: "Winter 2027",
    disciplines: ["full_stack"],
    summary: "Ship classroom features for a fictional education platform. Remote within Canada.",
    postedAt: "2026-10-05T13:00:00Z",
    discoveredAt: "2026-10-06T11:45:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-017",
    slug: "ironwood-systems",
    sourceId: "src-lever",
    company: "Ironwood Systems",
    title: "Firmware Developer Intern",
    locations: [{ city: "Ottawa", province: "ON", arrangement: "onsite" }],
    jobType: "internship",
    durationMonths: 16,
    term: "May 2027 – Aug 2028",
    disciplines: ["embedded"],
    summary: "A 16-month placement writing firmware for demo networking hardware. Not yet scored.",
    postedAt: "2026-11-10T12:00:00Z",
    discoveredAt: "2026-11-11T08:20:00Z",
    discoveryStatus: "discovered",
  }),
  job({
    id: "job-018",
    slug: "silverbirch-studio",
    sourceId: "src-manual",
    company: "Silverbirch Studio",
    title: "Full Stack Developer Co-op",
    locations: [{ city: "Fredericton", province: "NB", arrangement: "hybrid" }],
    jobType: "co_op",
    durationMonths: 4,
    term: "Summer 2027",
    disciplines: ["full_stack", "frontend"],
    summary: "An example of a manually added posting for a fictional design studio.",
    description: SILVERBIRCH_DESCRIPTION,
    experienceRequirement: "No prior professional experience required",
    salary: { min: 24, max: 28, currency: "CAD", period: "hour" },
    notes: "Added manually from a (fictional) campus job fair flyer.",
    postedAt: null,
    discoveredAt: "2026-11-07T20:10:00Z",
    discoveryStatus: "discovered",
  }),
];

/** Fixed UUIDs so fixture mode and the seeded database return identical ids. */
const demoUuid = (group: number, n: number) =>
  `00000000-0000-4000-8000-${group.toString(16).padStart(4, "0")}${n.toString(16).padStart(8, "0")}`;

/** A second sighting of one job on another board, to demonstrate canonical-job merging. */
const SYNDICATED: DemoSighting = {
  id: demoUuid(0x51, 999),
  jobId: "job-010",
  sourceId: "src-lever",
  provider: "lever",
  externalId: "demo-job-010-syndicated",
  sourceUrl: "https://careers.example/quillstone-software/job-010?via=lever",
  canonicalUrl: normalizeJobUrl("https://careers.example/quillstone-software/job-010?via=lever"),
  atsPosting: null,
  firstSeenAt: "2026-11-10T18:30:00Z",
  lastSeenAt: "2026-11-10T18:30:00Z",
};

export type DemoSighting = JobSighting & { jobId: string };

/** One sighting per demo job (its primary source), plus one syndicated sighting. */
export const DEMO_SIGHTINGS: DemoSighting[] = [
  ...DEMO_JOBS.map((j, i): DemoSighting => ({
    id: demoUuid(0x51, i + 1),
    jobId: j.id,
    sourceId: j.sourceId,
    provider: DEMO_JOB_SOURCES.find((s) => s.id === j.sourceId)!.provider,
    externalId: j.externalId,
    sourceUrl: j.postingUrl,
    canonicalUrl: j.postingUrl ? normalizeJobUrl(j.postingUrl) : null,
    atsPosting: null,
    firstSeenAt: j.discoveredAt,
    lastSeenAt: j.discoveredAt,
  })),
  SYNDICATED,
];

export const DEMO_DESCRIPTION_SNAPSHOTS: JobDescriptionSnapshot[] = [
  {
    id: demoUuid(0x52, 1),
    jobId: "job-018",
    content: SILVERBIRCH_DESCRIPTION,
    // SHA-256 of SILVERBIRCH_DESCRIPTION (verified by lib/fixtures/fixtures.test.ts).
    contentHash: "7a6231361705ec1c6b5a592173cbb73ca1df5d914b1ae56bacbaeca75bfc4569",
    source: "manual_submission",
    capturedAt: "2026-11-07T20:10:00Z",
  },
];

export const DEMO_JOB_EVENTS: JobEvent[] = [
  {
    id: demoUuid(0x53, 1),
    jobId: "job-018",
    type: "created",
    fromValue: null,
    toValue: "discovered",
    message: "Added manually (demo).",
    occurredAt: "2026-11-07T20:10:00Z",
    isDemo: true,
  },
];

type MatchSeed = Pick<JobMatch, "jobId" | "fitScore" | "matchedSkills" | "missingSkills" | "reasons">;

function match(seed: MatchSeed): JobMatch {
  return {
    ...seed,
    id: `match-${seed.jobId}`,
    computedAt: "2026-11-11T09:00:00Z",
    isDemo: true,
  };
}

/** Fictional fit scores. job-017 intentionally has no match to show the unscored state. */
export const DEMO_JOB_MATCHES: JobMatch[] = [
  match({
    jobId: "job-001",
    fitScore: 88,
    matchedSkills: ["C++", "Python", "ROS"],
    missingSkills: ["RTOS"],
    reasons: ["Embedded coursework aligns", "4-month term matches preference"],
  }),
  match({
    jobId: "job-002",
    fitScore: 82,
    matchedSkills: ["SQL", "Python", "Airflow"],
    missingSkills: ["Kafka"],
    reasons: ["Strong data pipeline overlap", "Toronto hybrid matches preference"],
  }),
  match({
    jobId: "job-003",
    fitScore: 91,
    matchedSkills: ["Java", "PostgreSQL", "JUnit"],
    missingSkills: [],
    reasons: ["Backend focus", "Prior fintech project"],
  }),
  match({
    jobId: "job-004",
    fitScore: 76,
    matchedSkills: ["React", "TypeScript", "Node.js"],
    missingSkills: ["GraphQL"],
    reasons: ["Full stack experience", "BC location is outside primary preference"],
  }),
  match({
    jobId: "job-005",
    fitScore: 71,
    matchedSkills: ["React", "TypeScript"],
    missingSkills: ["D3", "Django"],
    reasons: ["Frontend overlap", "On-site in Calgary"],
  }),
  match({
    jobId: "job-006",
    fitScore: 64,
    matchedSkills: ["Python", "PyTorch"],
    missingSkills: ["French", "Information retrieval"],
    reasons: ["ML coursework", "Language requirement may not match"],
  }),
  match({
    jobId: "job-007",
    fitScore: 79,
    matchedSkills: ["Python", "GitHub Actions", "Linux"],
    missingSkills: ["Semgrep"],
    reasons: ["CI tooling experience", "4-month term matches preference"],
  }),
  match({
    jobId: "job-008",
    fitScore: 58,
    matchedSkills: ["TypeScript"],
    missingSkills: ["C#", "Unity"],
    reasons: ["8-month term outside preference", "Limited game-tools experience"],
  }),
  match({
    jobId: "job-009",
    fitScore: 85,
    matchedSkills: ["Kotlin", "Swift", "REST APIs"],
    missingSkills: ["Offline sync"],
    reasons: ["Mobile projects", "GTA hybrid matches preference"],
  }),
  match({
    jobId: "job-010",
    fitScore: 73,
    matchedSkills: ["Go", "Docker"],
    missingSkills: ["Kubernetes", "Terraform"],
    reasons: ["Remote within Canada", "New grad role"],
  }),
  match({
    jobId: "job-011",
    fitScore: 42,
    matchedSkills: ["pytest"],
    missingSkills: ["Selenium", "LIMS domain"],
    reasons: ["QA focus is outside preferred disciplines"],
  }),
  match({
    jobId: "job-012",
    fitScore: 68,
    matchedSkills: ["Linux", "Prometheus"],
    missingSkills: ["On-call experience"],
    reasons: ["Infrastructure interest", "12-month term outside preference"],
  }),
  match({
    jobId: "job-013",
    fitScore: 61,
    matchedSkills: ["React", "CSS"],
    missingSkills: ["Next.js"],
    reasons: ["Posting expired"],
  }),
  match({
    jobId: "job-014",
    fitScore: 80,
    matchedSkills: ["Go", "PostgreSQL", "Protobuf"],
    missingSkills: ["GTFS"],
    reasons: ["Backend + infrastructure", "Toronto hybrid option"],
  }),
  match({
    jobId: "job-015",
    fitScore: 87,
    matchedSkills: ["TypeScript", "Node.js", "PostgreSQL"],
    missingSkills: ["Ruby"],
    reasons: ["Payments project relevance", "Toronto location"],
  }),
  match({
    jobId: "job-016",
    fitScore: 69,
    matchedSkills: ["React", "Node.js"],
    missingSkills: ["Accessibility audits"],
    reasons: ["Remote co-op", "Full stack overlap"],
  }),
  match({
    jobId: "job-018",
    fitScore: 74,
    matchedSkills: ["React", "Tailwind CSS"],
    missingSkills: ["Figma"],
    reasons: ["Full stack co-op", "4-month term"],
  }),
];
