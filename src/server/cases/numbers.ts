/**
 * CASE-12: the Application Number as compared, in capitals without any spaces, so `KDW/147` and
 * `kdw / 147` are the same number. Unique within the DS office of residence (`case.application_key`).
 */
export function applicationKey(applicationNumber: string): string {
  return applicationNumber.replace(/\s+/g, "").toUpperCase();
}

/**
 * Version 1's case number (its CASE-5): {DS code}-{year}-{NNN}, for example HMG-2026-011. NNN has at least
 * 3 digits. The system no longer gives numbers (CASE-12); only the load-test and demo data still make
 * them, until change 0006's task 10.
 */
export function formatCaseNumber(officeCode: string, year: number, sequence: number): string {
  return `${officeCode}-${year}-${String(sequence).padStart(3, "0")}`;
}
