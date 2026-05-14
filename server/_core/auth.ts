import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { verifyPassword } from "./passwordHash";

type SessionPayload = { userId: number };

function getSecretKey(): Uint8Array {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function signSession(payload: SessionPayload): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSecretKey());
}

async function verifySession(
  value: string | undefined | null
): Promise<SessionPayload | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const { userId } = payload as Record<string, unknown>;
    if (typeof userId !== "number" || !Number.isInteger(userId)) return null;
    return { userId };
  } catch {
    return null;
  }
}

function readSessionCookie(req: Request): string | undefined {
  const parsed = parseCookieHeader(req.headers.cookie ?? "");
  return parsed[COOKIE_NAME];
}

export async function getCurrentUser(req: Request): Promise<User | null> {
  const session = await verifySession(readSessionCookie(req));
  if (!session) return null;
  return (await db.getUserById(session.userId)) ?? null;
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}

function isValidEmail(value: string): boolean {
  // Lightweight check — Postgres uniqueness is the real validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    if (!isValidEmail(email)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    let user;
    try {
      user = await db.getUserByEmail(email);
    } catch (err) {
      console.error("[Auth] Failed to look up user:", err);
      const detail = err instanceof Error ? err.message : String(err);
      const isProd = process.env.NODE_ENV === "production";
      res.status(503).json({
        error:
          "Database unavailable. Verify DATABASE_URL and run `pnpm db:migrate` against the target database.",
        ...(isProd ? {} : { detail }),
      });
      return;
    }

    const ok = user && (await verifyPassword(password, user.passwordHash));
    if (!user || !ok) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    await db.touchUserLastSignedIn(user.id).catch((err) => {
      console.warn("[Auth] Failed to update lastSignedIn:", err);
    });

    const token = await signSession({ userId: user.id });

    res.cookie(COOKIE_NAME, token, {
      ...getSessionCookieOptions(req),
      maxAge: ONE_YEAR_MS,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ success: true });
  });
}
