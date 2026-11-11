/**
 * CASE-12: the Application Number as compared, in capitals without any spaces, so `KDW/147` and
 * `kdw / 147` are the same number. Unique within the DS office of residence (`case.application_key`).
 */
export function applicationKey(applicationNumber: string): string {
  return applicationNumber.replace(/\s+/g, "").toUpperCase();
}
