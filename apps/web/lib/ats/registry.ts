import type { AtsProvider } from "../types";
import { ashbyAdapter } from "./providers/ashby";
import { genericAdapter } from "./providers/generic";
import { greenhouseAdapter } from "./providers/greenhouse";
import { leverAdapter } from "./providers/lever";
import { smartRecruitersAdapter } from "./providers/smartrecruiters";
import { workdayAdapter } from "./providers/workday";
import type { AtsAdapter } from "./types";

export const ATS_ADAPTERS: Record<AtsProvider, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  smartrecruiters: smartRecruitersAdapter,
  workday: workdayAdapter,
  company_site: genericAdapter,
};
