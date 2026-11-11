# ProRez

**ProRez** is a self-hosted, AI-powered job discovery and application management platform designed to streamline the job search process for software engineers, interns, co-op students, and recent graduates.

ProRez combines automated job monitoring, configurable search profiles, AI-assisted application generation, project development, and application tracking into one centralized platform.

The system is designed around a web dashboard, Telegram notifications, and a locally hosted Claude Code automation worker.

## Features

### 1. Automated Job Discovery

- Monitor job postings from supported company career pages and applicant tracking systems (ATS).
- Initial free integrations:
  - Greenhouse
  - Lever
  - Ashby
  - SmartRecruiters
- Planned support for employer-specific Workday career sites.
- Optional future integration with paid providers, including TheirStack, JSearch, and Adzuna.
- Periodically check supported sources for newly published opportunities.
- Deduplicate job listings discovered across multiple sources.
- Track when postings were first discovered and their source.
- Initially focus on Canadian software engineering opportunities.
- Browse internship, co-op, junior developer, and new graduate roles.

### 2. Configurable Job Search Profiles

Create and manage multiple independent job-search profiles.

**Preset profiles:**
- Software Engineering Co-op — Four-month internships and co-ops.
- Junior Software Developer — Entry-level and junior engineering positions.
- New Graduate Software Engineer — Graduate programs and recent graduate opportunities.

**Customizable filters:**
- Job titles and keywords
- Software engineering disciplines
- Employment type
- Internship/co-op duration
- Location and province
- Remote, hybrid, or on-site
- Experience requirements
- Minimum candidate-fit score
- Notification preferences
- Application generation preferences

Multiple profiles can run simultaneously.

A job matching multiple profiles is deduplicated to prevent repeated notifications.

### 3. AI-Powered Job Matching

- Analyze job descriptions against a verified candidate profile.
- Identify relevant technical skills, qualifications, and experience requirements.
- Generate candidate-fit scores with supporting explanations.
- Highlight missing or underrepresented qualifications.
- Distinguish confirmed eligibility from uncertain requirements.
- Prioritize relevant opportunities based on active search profiles.

### 4. Telegram Job Notifications & Approval

Receive notifications when newly discovered jobs match active search profiles.

Notifications include:
- Company name
- Position title
- Job location
- Employment type and duration
- Candidate-fit score
- Summary of relevant qualifications
- Original job posting link
- Matching search profile

**Interactive approval actions:**

- **Full Build:** Generate a relevant software project when appropriate, followed by a tailored resume and cover letter.
- **Quick Apply:** Generate a tailored resume and cover letter using verified existing experience and projects.
- **Skip:** Dismiss the opportunity without starting generation.

The bot also provides workflow progress, completion notifications, and error reporting.

Discord integration is planned as an additional notification option.

### 5. AI Resume & Cover Letter Generation

Integrate an existing Claude Code-based application preparation workflow.

Capabilities include:
- Tailor resumes to individual job descriptions.
- Generate role-specific cover letters.
- Optimize content for applicant tracking systems (ATS).
- Evaluate resumes against job requirements.
- Use verified professional experience and existing project history.
- Export generated documents as PDFs.
- Maintain historical document versions.
- Associate documents with specific job applications.
- Review generated documents before submission.

### 6. AI Software Project Generation

For selected opportunities, ProRez can use Claude Code to develop portfolio projects demonstrating relevant engineering skills.

Planned functionality:
- Analyze job requirements and technical expectations.
- Recommend projects aligned with relevant skills.
- Check existing projects before generating new ones.
- Generate project architecture and implementation plans.
- Implement projects using Claude Code.
- Run automated builds, tests, and validation.
- Track project generation progress.
- Associate projects with one or more job applications.
- Publish approved, validated projects to GitHub.
- Support private and public repositories.

Project generation is optional and should not unnecessarily delay application preparation.

### 7. Manual Job Submission

Submit opportunities independently of automated job discovery.

Supported inputs:
- Job posting URL
- Full job description text
- Company and position details
- Job description files (planned)

Manual submissions support the same matching, application generation, project recommendation, and tracking workflows as automatically discovered jobs.

### 8. Web Dashboard

A centralized browser-based interface accessible from Windows, macOS, and mobile devices.

**Dashboard sections:**

- **Overview:** Job discovery statistics, pending approvals, generated applications, and recent activity.
- **Job Discovery:** Search, browse, filter, and manage job listings.
- **Manual Submission:** Submit job descriptions and initiate application workflows.
- **Applications:** Track application status and related documents.
- **Resume Library:** Browse and download previously generated resumes.
- **Cover Letter Library:** Browse and download previously generated cover letters.
- **Project Library:** Manage software projects and associated GitHub repositories.
- **Search Profiles:** Create and configure independent job-search filters.
- **Settings:** Manage integrations, preferences, and automation controls.

The dashboard will support responsive layouts and dark/light themes.

### 9. Application Tracking

Track opportunities throughout the application lifecycle.

**Application statuses:**
- Discovered
- Saved
- Preparing
- Ready for Review
- Applied
- Interviewing
- Offer
- Rejected
- Withdrawn

Track:
- Company and position
- Job posting URL
- Discovery and application dates
- Current application status
- Generated resume and cover letter versions
- Associated portfolio projects
- Application notes and history

Application preparation and actual submission are tracked separately.

### 10. GitHub Integration

- Create repositories for approved AI-generated projects.
- Push validated project files to GitHub.
- Associate GitHub repositories with project records.
- Support configurable repository visibility.
- Verify build and test results before publication.
- Inspect Git commit attribution and metadata.
- Preserve project version history.

### 11. Browser Autofill Integration (Planned)

ProRez will initially support a manual handoff to external application autofill tools such as Simplify Copilot.

Future development may include:
- Browser extension integration
- Verified candidate profile autofill
- Resume and cover letter attachment assistance
- Application form validation
- User review before final submission

Direct integration with Simplify's automation services is not currently guaranteed.

### 12. Self-Hosting & Desktop Installation

ProRez is designed to support self-hosted deployment on a personal computer or dedicated server.

**Planned hosting capabilities:**
- Persistent job-discovery service
- Background task queue
- Local Claude Code execution
- Database and artifact storage
- Telegram bot connectivity
- Secure web dashboard access
- Automatic service startup
- Task recovery following restarts

A future installer wizard will streamline Windows deployment, dependency checks, and integration configuration.

## Planned Technology Stack

| Component | Technology |
|---|---|
| Frontend | Next.js, TypeScript |
| Styling | Tailwind CSS, shadcn/ui |
| Backend | Node.js / TypeScript |
| Database | PostgreSQL, Prisma |
| Authentication | Supabase Auth |
| Artifact Storage | Supabase Storage or self-hosted storage |
| Job Discovery | Provider-specific ATS adapters |
| AI Automation | Claude Code CLI |
| Notifications | Telegram Bot API |
| Version Control | Git and GitHub |
| Testing | Playwright and automated unit tests |
| Deployment | Docker / Self-hosted services |
| Desktop Packaging | To be determined |

## Development Roadmap

- [ ] **Phase 1:** Web dashboard and responsive UI
- [ ] **Phase 2:** Database, manual job submissions, and configurable search profiles
- [ ] **Phase 3:** Automated job discovery using free ATS APIs
- [ ] **Phase 4:** Job filtering, matching, and deduplication
- [ ] **Phase 5:** Telegram notification and approval system
- [ ] **Phase 6:** Claude Code resume and cover letter generation
- [ ] **Phase 7:** AI project generation and GitHub integration
- [ ] **Phase 8:** Application history and document management
- [ ] **Phase 9:** Self-hosted deployment and installer wizard
- [ ] **Phase 10:** Paid job API integrations and browser autofill improvements

## Project Status

**Early Development**

The initial Next.js development environment has been established on macOS.

The features described above represent the intended functionality of ProRez and will be implemented incrementally.

## Project Goals

ProRez aims to:

1. Reduce the time between job publication and candidate discovery.
2. Eliminate repetitive job-search and application preparation tasks.
3. Improve the relevance and quality of tailored resumes and cover letters.
4. Provide controlled AI-assisted portfolio development.
5. Centralize job discovery, application materials, and application history.
6. Give users control over which opportunities trigger AI automation.

**ProRez discovers opportunities, prepares personalized applications, and helps developers manage their job search from one place.**