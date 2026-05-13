import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const exportJobStatus = pgEnum("export_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);
export const exportJobTrigger = pgEnum("export_job_trigger", [
  "manual",
  "scheduled",
]);
export const exportFileType = pgEnum("export_file_type", [
  "transactions",
  "inventory",
  "sales_summary",
]);

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Scheduler configuration per user.
 */
export const schedulerConfig = pgTable("scheduler_config", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  frequencyDays: integer("frequencyDays").default(7).notNull(), // 1=daily, 7=weekly, 30=monthly
  dayOfWeek: integer("dayOfWeek").default(1).notNull(), // 0=Sun, 1=Mon ... 6=Sat (used when frequencyDays=7)
  hourOfDay: integer("hourOfDay").default(8).notNull(), // 0-23
  includeOnline: boolean("includeOnline").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type SchedulerConfig = typeof schedulerConfig.$inferSelect;

/**
 * Tracks each export job run.
 */
export const exportJobs = pgTable("export_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  status: exportJobStatus("status").default("pending").notNull(),
  triggerType: exportJobTrigger("triggerType").default("manual").notNull(),
  dateFrom: varchar("dateFrom", { length: 10 }).notNull(), // YYYY-MM-DD
  dateTo: varchar("dateTo", { length: 10 }).notNull(),
  storeCount: integer("storeCount").default(0),
  transactionCount: integer("transactionCount").default(0),
  inventoryCount: integer("inventoryCount").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExportJob = typeof exportJobs.$inferSelect;

/**
 * Files generated per export job (one per type: transactions, inventory, sales_summary).
 */
export const exportFiles = pgTable("export_files", {
  id: serial("id").primaryKey(),
  jobId: integer("jobId").notNull(),
  userId: integer("userId").notNull(),
  fileType: exportFileType("fileType").notNull(),
  fileName: varchar("fileName", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }).default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExportFile = typeof exportFiles.$inferSelect;
