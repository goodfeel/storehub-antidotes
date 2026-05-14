import "dotenv/config";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { startScheduler } from "../scheduler";
import { appRouter } from "../routers";
import { getExportFileByKey } from "../db";
import { EXPORTS_ROOT, resolveStoragePath } from "../storage";
import { getCurrentUser, registerAuthRoutes } from "./auth";
import { createContext } from "./context";
import { seedDefaultUsers } from "./seed";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerAuthRoutes(app);

  // Auth-gated static handler for exported CSV files. Enforces ownership and
  // role: regular users may only download `inventory` files; admins can
  // download anything they own.
  app.get(
    "/api/files/*",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = await getCurrentUser(req);
        if (!user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        const key = decodeURIComponent(
          (req.params as { 0?: string })[0] ?? ""
        );
        if (!key) {
          res.status(400).json({ error: "File key is required" });
          return;
        }

        const fileRecord = await getExportFileByKey(key);
        if (!fileRecord || fileRecord.userId !== user.id) {
          res.status(404).json({ error: "File not found" });
          return;
        }
        if (user.role !== "admin" && fileRecord.fileType !== "inventory") {
          res.status(403).json({ error: "Forbidden" });
          return;
        }

        const absolute = resolveStoragePath(key);
        res.sendFile(absolute, (err) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              res.status(404).json({ error: "File not found" });
            } else {
              next(err);
            }
          }
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  console.log(`[Storage] Exports will be written to ${path.relative(process.cwd(), EXPORTS_ROOT)}/`);

  await seedDefaultUsers();

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);

startScheduler();
