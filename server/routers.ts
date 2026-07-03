import { clearSessionCookie } from "./_core/auth";
import {
  ENV,
  getStorehubCredentials,
  hasStorehubCredentials,
  isGoogleDriveConfigured,
} from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getSchedulerConfig,
  upsertSchedulerConfig,
  createExportJob,
  getExportJobs,
  getExportJobById,
  getExportFilesByJobId,
  getExportFilesByUserId,
  listUsers,
  createUserWithPassword,
  updateUserPassword,
  updateUserRole,
  deleteUserById,
  countAdmins,
  getUserById,
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

  // ─── Credentials (read-only view of service-env config) ────────────────────
  // Admin-only: regular users don't need (or should see) the StoreHub key.
  credentials: router({
    /**
     * Reports whether the StoreHub creds are configured in the process env.
     * The API token is never returned; only a short mask for confirmation.
     */
    get: adminProcedure.query(() => {
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
    test: adminProcedure.mutation(async () => {
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
  // Admin-only: regular users can't configure scheduled exports.
  scheduler: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const config = await getSchedulerConfig(ctx.user.id);
      return config ?? {
        enabled: true,
        frequencyDays: 7,
        dayOfWeek: 1,
        hourOfDay: 8,
        includeOnline: true,
      };
    }),

    save: adminProcedure
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

    /**
     * Reports whether Google Drive uploads are configured. Returns a boolean
     * only — no credentials are exposed — so it's safe for any authenticated
     * user (the manual Export page uses it to show the opt-in toggle).
     */
    getDriveStatus: protectedProcedure.query(() => {
      return { configured: isGoogleDriveConfigured() };
    }),
  }),

  // ─── Users (admin-only) ─────────────────────────────────────────────────────
  // Lets admins create / delete / reset-password / change-role for other
  // accounts. Several invariants are enforced:
  //   * an admin cannot delete themselves
  //   * an admin cannot demote themselves
  //   * the last remaining admin cannot be demoted or deleted
  users: router({
    list: adminProcedure.query(async () => {
      return listUsers();
    }),

    create: adminProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email(),
          name: z.string().trim().min(1).max(120),
          role: z.enum(["admin", "user"]),
          password: z.string().min(4).max(200),
        })
      )
      .mutation(async ({ input }) => {
        const user = await createUserWithPassword({
          email: input.email,
          name: input.name,
          role: input.role,
          plainPassword: input.password,
        });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      }),

    resetPassword: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          password: z.string().min(4).max(200),
        })
      )
      .mutation(async ({ input }) => {
        const target = await getUserById(input.id);
        if (!target) throw new Error("User not found");
        await updateUserPassword(input.id, input.password);
        return { success: true } as const;
      }),

    setRole: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          role: z.enum(["admin", "user"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const target = await getUserById(input.id);
        if (!target) throw new Error("User not found");

        if (input.role === target.role) {
          return { success: true } as const;
        }

        if (input.role === "user") {
          if (target.id === ctx.user.id) {
            throw new Error("You cannot demote your own admin account");
          }
          if (target.role === "admin") {
            const admins = await countAdmins();
            if (admins <= 1) {
              throw new Error(
                "Refusing to demote the last remaining admin"
              );
            }
          }
        }

        await updateUserRole(input.id, input.role);
        return { success: true } as const;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (input.id === ctx.user.id) {
          throw new Error("You cannot delete your own account");
        }
        const target = await getUserById(input.id);
        if (!target) throw new Error("User not found");

        if (target.role === "admin") {
          const admins = await countAdmins();
          if (admins <= 1) {
            throw new Error("Refusing to delete the last remaining admin");
          }
        }

        await deleteUserById(input.id);
        return { success: true } as const;
      }),
  }),

  // ─── Export ─────────────────────────────────────────────────────────────────
  export: router({
    /**
     * Trigger an export. Admins get the full export (transactions + inventory
     * + sales summary); regular users are forced into inventory-only mode
     * regardless of what they send.
     */
    trigger: protectedProcedure
      .input(z.object({
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
        includeOnline: z.boolean().default(true),
        uploadToDrive: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!hasStorehubCredentials()) {
          throw new Error(
            "StoreHub credentials are not configured. Set STOREHUB_USERNAME and STOREHUB_API_TOKEN in the service environment."
          );
        }

        const inventoryOnly = ctx.user.role !== "admin";
        // Only honour the Drive opt-in when Drive is actually configured.
        const uploadToDrive = input.uploadToDrive && isGoogleDriveConfigured();
        const jobId = await createExportJob(ctx.user.id, "manual", input.dateFrom, input.dateTo);

        // Run export asynchronously – don't await so the UI gets the jobId immediately
        runExport({
          jobId,
          userId: ctx.user.id,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          includeOnline: input.includeOnline,
          triggerType: "manual",
          inventoryOnly,
          uploadToDrive,
        }).catch((err) => {
          console.error(`[Export] Job ${jobId} failed:`, err);
        });

        return { jobId, status: "pending", inventoryOnly, uploadToDrive };
      }),

    getJob: protectedProcedure
      .input(z.object({ jobId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const job = await getExportJobById(input.jobId);
        if (!job || job.userId !== ctx.user.id) throw new Error("Job not found");
        let files = await getExportFilesByJobId(input.jobId);
        if (ctx.user.role !== "admin") {
          files = files.filter((f) => f.fileType === "inventory");
        }
        return { job, files };
      }),

    listJobs: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        const jobs = await getExportJobs(ctx.user.id, input.limit);
        let files = await getExportFilesByUserId(ctx.user.id, 200);
        if (ctx.user.role !== "admin") {
          files = files.filter((f) => f.fileType === "inventory");
        }

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
