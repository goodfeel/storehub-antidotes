/**
 * Export Scheduler
 * Runs a periodic check every minute to determine if any user's scheduled export is due.
 * All times are evaluated in GMT+7 (Asia/Bangkok).
 */

import { getDb } from "./db";
import { schedulerConfig, exportJobs } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { runExport } from "./exportRunner";
import { createExportJob } from "./db";
import { hasStorehubCredentials } from "./_core/env";

const BANGKOK_TZ = "Asia/Bangkok";

function nowInBangkok(): Date {
  // Returns a Date whose local time matches Bangkok time
  const now = new Date();
  const bangkokStr = now.toLocaleString("en-US", { timeZone: BANGKOK_TZ });
  return new Date(bangkokStr);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (schedulerInterval) return;

  console.log("[Scheduler] Starting export scheduler (checks every minute)...");

  schedulerInterval = setInterval(async () => {
    try {
      await checkAndRunScheduledExports();
    } catch (err) {
      console.error("[Scheduler] Error during scheduled check:", err);
    }
  }, 60 * 1000); // Every minute
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Stopped.");
  }
}

async function checkAndRunScheduledExports(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // StoreHub credentials now come from .env; if they're missing there's no
  // point iterating scheduled configs because every job would fail anyway.
  if (!hasStorehubCredentials()) return;

  const bangkokNow = nowInBangkok();
  const currentHour = bangkokNow.getHours();
  const currentMinute = bangkokNow.getMinutes();
  const currentDayOfWeek = bangkokNow.getDay(); // 0=Sun, 1=Mon...6=Sat

  // Only trigger at the top of the hour (minute 0)
  if (currentMinute !== 0) return;

  // Fetch all enabled scheduler configs
  const configs = await db.select().from(schedulerConfig).where(eq(schedulerConfig.enabled, true));

  for (const config of configs) {
    try {
      // Check if it's the right hour
      if (config.hourOfDay !== currentHour) continue;

      // Check frequency
      let shouldRun = false;

      if (config.frequencyDays === 1) {
        // Daily: run every day at the configured hour
        shouldRun = true;
      } else if (config.frequencyDays === 7) {
        // Weekly: run on the configured day of week
        shouldRun = currentDayOfWeek === config.dayOfWeek;
      } else if (config.frequencyDays === 30) {
        // Monthly: run on the 1st of each month
        shouldRun = bangkokNow.getDate() === 1;
      } else {
        // Custom: check if it's been at least N days since last run
        const lastJob = await db.select().from(exportJobs)
          .where(and(
            eq(exportJobs.userId, config.userId),
            eq(exportJobs.triggerType, "scheduled")
          ))
          .orderBy(exportJobs.createdAt)
          .limit(1);

        if (!lastJob.length) {
          shouldRun = true;
        } else {
          const lastRun = new Date(lastJob[0]!.createdAt);
          const daysSinceLastRun = (bangkokNow.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24);
          shouldRun = daysSinceLastRun >= config.frequencyDays;
        }
      }

      if (!shouldRun) continue;

      // Determine date range: last N days
      const dateTo = formatDate(bangkokNow);
      const dateFrom = formatDate(subtractDays(bangkokNow, config.frequencyDays));

      console.log(`[Scheduler] Triggering export for userId=${config.userId}, range=${dateFrom} to ${dateTo}`);

      const jobId = await createExportJob(config.userId, "scheduled", dateFrom, dateTo);

      // Run async without blocking the scheduler
      runExport({
        jobId,
        userId: config.userId,
        dateFrom,
        dateTo,
        includeOnline: config.includeOnline,
        triggerType: "scheduled",
      }).catch((err) => {
        console.error(`[Scheduler] Export job ${jobId} failed:`, err);
      });
    } catch (err) {
      console.error(`[Scheduler] Error processing config for userId=${config.userId}:`, err);
    }
  }
}
