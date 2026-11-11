/**
 * The cases ticked on a letter or a release (REL-2, REL-6) as its form sends them, each as
 * "<case id>:<version>"; null if any is malformed or there are more than `max`.
 */
export function tickedCases(sent: FormDataEntryValue[], max: number): { id: string; version: number }[] | null {
  if (sent.length > max) return null;
  const cases: { id: string; version: number }[] = [];
  for (const value of sent) {
    const [id, version, extra] = typeof value === "string" ? value.split(":") : [];
    if (!id || id.length > 64 || extra !== undefined || !/^\d+$/.test(version ?? "")) return null;
    cases.push({ id, version: Number(version) });
  }
  return cases;
}
