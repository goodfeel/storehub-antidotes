import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  exportFiles,
  exportJobs,
  schedulerConfig,
  users,
  type ExportFile,
  type ExportJob,
  type InsertUser,
  type SchedulerConfig,
} from "../drizzle/schema";

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _client = postgres(process.env.DATABASE_URL, { max: 10 });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;

  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Scheduler Config ─────────────────────────────────────────────────────────

export async function getSchedulerConfig(userId: number): Promise<SchedulerConfig | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(schedulerConfig).where(eq(schedulerConfig.userId, userId)).limit(1);
  return result[0];
}

export async function upsertSchedulerConfig(
  userId: number,
  config: { enabled: boolean; frequencyDays: number; dayOfWeek: number; hourOfDay: number; includeOnline: boolean }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getSchedulerConfig(userId);
  if (existing) {
    await db.update(schedulerConfig).set(config).where(eq(schedulerConfig.userId, userId));
  } else {
    await db.insert(schedulerConfig).values({ userId, ...config });
  }
}

// ─── Export Jobs ──────────────────────────────────────────────────────────────

export async function createExportJob(
  userId: number,
  triggerType: "manual" | "scheduled",
  dateFrom: string,
  dateTo: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const inserted = await db
    .insert(exportJobs)
    .values({
      userId,
      triggerType,
      dateFrom,
      dateTo,
      status: "pending",
      startedAt: new Date(),
    })
    .returning({ id: exportJobs.id });

  const insertId = inserted[0]?.id;
  if (!insertId) throw new Error("Failed to get inserted id from database insert");
  return insertId;
}

export async function updateExportJob(
  jobId: number,
  update: Partial<{
    status: "pending" | "running" | "completed" | "failed";
    storeCount: number;
    transactionCount: number;
    inventoryCount: number;
    errorMessage: string;
    completedAt: Date;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(exportJobs).set(update).where(eq(exportJobs.id, jobId));
}

export async function getExportJobs(userId: number, limit = 50): Promise<ExportJob[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(exportJobs)
    .where(eq(exportJobs.userId, userId))
    .orderBy(desc(exportJobs.createdAt))
    .limit(limit);
}

export async function getExportJobById(jobId: number): Promise<ExportJob | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  return result[0];
}

// ─── Export Files ─────────────────────────────────────────────────────────────

export async function createExportFile(
  jobId: number,
  userId: number,
  fileType: "transactions" | "inventory" | "sales_summary",
  fileName: string,
  fileUrl: string,
  fileKey: string,
  fileSizeBytes: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(exportFiles).values({ jobId, userId, fileType, fileName, fileUrl, fileKey, fileSizeBytes });
}

export async function getExportFilesByJobId(jobId: number): Promise<ExportFile[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(exportFiles).where(eq(exportFiles.jobId, jobId));
}

export async function getExportFilesByUserId(userId: number, limit = 100): Promise<ExportFile[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(exportFiles)
    .where(eq(exportFiles.userId, userId))
    .orderBy(desc(exportFiles.createdAt))
    .limit(limit);
}

// Re-export `and` for any external consumers that previously imported it from here.
export { and };
