import { clearSessionCookie } from "./_core/auth";
import { ENV, getStorehubCredentials, hasStorehubCredentials } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getSchedulerConfig,
  upsertSchedulerConfig,
  createExportJob,
  getExportJobs,
  getExportJobById,
  getExportFilesByJobId,
  getExportFilesByUserId,
} from "./db";
import { fetchStores } from "./storehubApi";
import { runExport } from "./exportRunner";

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      clearSessionCookie(ctx.req, ctx.res);
      return { success: true } as const;
    }),
  }),

  // ─── Credentials (read-only view of .env config) ────────────────────────────
  credentials: router({
    /**
     * Reports whether the StoreHub creds are configured in `.env`.
     * The API token is never returned; only a short mask for confirmation.
     */
    get: protectedProcedure.query(() => {
      if (!hasStorehubCredentials()) {
        return { configured: false as const };
      }
      return {
        configured: true as const,
        username: ENV.storehubUsername,
        apiTokenMasked: maskToken(ENV.storehubApiToken),
      };
    }),

    /**
     * Calls StoreHub `/stores` with the env credentials to verify they work.
     */
    test: protectedProcedure.mutation(async () => {
      const { username, apiToken } = getStorehubCredentials();
      const stores = await fetchStores(username, apiToken);
      return {
        success: true,
        storeCount: stores.length,
        stores: stores.map((s) => ({ id: s.id, name: s.name })),
      };
    }),
  }),

  // ─── Scheduler ──────────────────────────────────────────────────────────────
  scheduler: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const config = await getSchedulerConfig(ctx.user.id);
      return config ?? {
        enabled: true,
        frequencyDays: 7,
        dayOfWeek: 1,
        hourOfDay: 8,
        includeOnline: true,
      };
    }),

    save: protectedProcedure
      .input(z.object({
        enabled: z.boolean(),
        frequencyDays: z.number().int().min(1).max(365),
        dayOfWeek: z.number().int().min(0).max(6),
        hourOfDay: z.number().int().min(0).max(23),
        includeOnline: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertSchedulerConfig(ctx.user.id, input);
        return { success: true };
      }),
  }),

  // ─── Export ─────────────────────────────────────────────────────────────────
  export: router({
    trigger: protectedProcedure
      .input(z.object({
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
        includeOnline: z.boolean().default(true),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!hasStorehubCredentials()) {
          throw new Error(
            "StoreHub credentials are not configured. Set STOREHUB_USERNAME and STOREHUB_API_TOKEN in .env."
          );
        }

        const jobId = await createExportJob(ctx.user.id, "manual", input.dateFrom, input.dateTo);

        // Run export asynchronously – don't await so the UI gets the jobId immediately
        runExport({
          jobId,
          userId: ctx.user.id,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          includeOnline: input.includeOnline,
          triggerType: "manual",
        }).catch((err) => {
          console.error(`[Export] Job ${jobId} failed:`, err);
        });

        return { jobId, status: "pending" };
      }),

    getJob: protectedProcedure
      .input(z.object({ jobId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const job = await getExportJobById(input.jobId);
        if (!job || job.userId !== ctx.user.id) throw new Error("Job not found");
        const files = await getExportFilesByJobId(input.jobId);
        return { job, files };
      }),

    listJobs: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        const jobs = await getExportJobs(ctx.user.id, input.limit);
        const files = await getExportFilesByUserId(ctx.user.id, 200);

        // Attach files to jobs
        const filesByJob = new Map<number, typeof files>();
        for (const file of files) {
          if (!filesByJob.has(file.jobId)) filesByJob.set(file.jobId, []);
          filesByJob.get(file.jobId)!.push(file);
        }

        return jobs.map((job) => ({
          ...job,
          files: filesByJob.get(job.id) ?? [],
        }));
      }),

    listStores: protectedProcedure.query(async () => {
      if (!hasStorehubCredentials()) return [];
      const { username, apiToken } = getStorehubCredentials();
      return fetchStores(username, apiToken);
    }),
  }),
});

export type AppRouter = typeof appRouter;
