import type { AtsProvider } from "../types";
import { ashbyAdapter } from "./providers/ashby";
import { greenhouseAdapter } from "./providers/greenhouse";
import { leverAdapter } from "./providers/lever";
import { smartRecruitersAdapter } from "./providers/smartrecruiters";
import type { AtsAdapter } from "./types";

export const ATS_ADAPTERS: Record<AtsProvider, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  smartrecruiters: smartRecruitersAdapter,
};
