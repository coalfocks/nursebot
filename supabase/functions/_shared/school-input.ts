export type NormalizedSchoolInput = { name: string; slug: string };

export type SchoolInputResult =
  | { ok: true; value: NormalizedSchoolInput }
  | { ok: false; error: string; code: string };

export function slugifySchoolName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function normalizeSchoolInput(input: unknown): SchoolInputResult {
  const rawName = typeof input === "string" ? input : "";
  const name = rawName.normalize("NFC").trim().replace(/\s+/g, " ");

  if (name.length < 2 || name.length > 120) {
    return { ok: false, error: "School name must be between 2 and 120 characters", code: "INVALID_SCHOOL_NAME" };
  }

  const slug = slugifySchoolName(name);
  if (!slug) {
    return { ok: false, error: "School name must include at least one English letter or number to create a URL slug", code: "INVALID_SCHOOL_SLUG" };
  }

  return { ok: true, value: { name, slug } };
}
