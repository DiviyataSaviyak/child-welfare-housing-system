/**
 * Application log lines, one JSON object each. SEC-8: never pass names, NICs, addresses, phone
 * numbers, email addresses or usernames here. Log IDs and outcomes only. Values are limited to plain primitives,
 * so a whole record can't be logged by accident.
 */
type Field = string | number | boolean | null;

export function logEvent(event: string, fields: Record<string, Field> = {}): void {
  console.info(JSON.stringify({ at: new Date().toISOString(), level: "info", event, ...fields }));
}

export function logWarning(event: string, fields: Record<string, Field> = {}): void {
  console.warn(JSON.stringify({ at: new Date().toISOString(), level: "warn", event, ...fields }));
}

/** Logs an error by its name and code only: messages can quote the data that caused them. */
export function logError(event: string, error: unknown, fields: Record<string, Field> = {}): void {
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
  console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", event, error: name, code, ...fields }));
}
