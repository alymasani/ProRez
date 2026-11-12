import { resetE2EDatabase } from "./db-reset";

export default function globalSetup() {
  resetE2EDatabase({ full: true });
}
