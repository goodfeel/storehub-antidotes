/**
 * Idempotently seeds default accounts on server startup.
 *
 * Uses upsert-by-email so we never clobber an existing user's password — once
 * an admin has changed their password, restarts will not reset it back to the
 * default. Override defaults via `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`.
 */

import { getDb, seedUser } from "../db";

const DEFAULT_ADMIN_EMAIL = "admin@examle.com";
const DEFAULT_ADMIN_PASSWORD = "admin";
const DEFAULT_ADMIN_NAME = "Admin";

export async function seedDefaultUsers(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn(
      "[Seed] Skipping admin seed: database not configured (DATABASE_URL)"
    );
    return;
  }

  const email = (process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_EMAIL).trim();
  const password = process.env.ADMIN_SEED_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;

  try {
    const user = await seedUser({
      email,
      plainPassword: password,
      name: DEFAULT_ADMIN_NAME,
      role: "admin",
      openId: "seed:admin",
    });
    if (user) {
      console.log(`[Seed] Admin account ready: ${user.email}`);
    }
  } catch (err) {
    console.error("[Seed] Failed to seed admin user:", err);
  }
}
