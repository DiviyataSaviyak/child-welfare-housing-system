import type { PrismaClient } from "@/generated/prisma/client";

/**
 * OPS-3: true when the app reaches its database within the time allowed. The container's health
 * check, the deploy and the monitoring's probe (OPS-4) all ask `/health`, which answers from this.
 */
export async function databaseReachable(db: PrismaClient, timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    await Promise.race([db.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
