"use server";
import { refresh } from "next/cache";
import { requireMutationAccess } from "@/lib/auth/server-actor";
import { getPrisma } from "@/lib/db/client";
import { fail, type MutationResult } from "@/lib/mutations/result";
import { parseSettingsInput } from "@/lib/settings/schema";
import { saveSettings } from "@/lib/settings/service";
import type { AppSettings } from "@/lib/types";

export async function saveSettingsAction(version: unknown, input: unknown): Promise<MutationResult<AppSettings>> {
  const access = await requireMutationAccess();
  if (!access.ok) return fail(access.code, access.message);
  if (!Number.isInteger(version) || (version as number) < 0) return fail("validation", "Invalid settings version.");
  const parsed = parseSettingsInput(input);
  if (!parsed.ok) return fail("validation", "Please fix the settings below.", { fieldErrors: parsed.fieldErrors, formErrors: parsed.formErrors });
  try {
    const result = await saveSettings(getPrisma(), version as number, parsed.settings, parsed.sources);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    console.error("[settings] save failed", error);
    return fail("unexpected", "Settings could not be saved. Nothing was changed.");
  }
}
