import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";

const LOCAL_OPEN_ID = "local-admin";
const LOCAL_NAME = "Admin";

type SessionPayload = { openId: string; name: string };

function getSecretKey(): Uint8Array {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function signSession(payload: SessionPayload): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ openId: payload.openId, name: payload.name })
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
    const { openId, name } = payload as Record<string, unknown>;
    if (typeof openId !== "string" || openId.length === 0) return null;
    return { openId, name: typeof name === "string" ? name : "" };
  } catch {
    return null;
  }
}

function readSessionCookie(req: Request): string | undefined {
  const parsed = parseCookieHeader(req.headers.cookie ?? "");
  return parsed[COOKIE_NAME];
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function ensureLocalUser(): Promise<User | null> {
  await db.upsertUser({
    openId: LOCAL_OPEN_ID,
    name: LOCAL_NAME,
    role: "admin",
    loginMethod: "local",
    lastSignedIn: new Date(),
  });
  return (await db.getUserByOpenId(LOCAL_OPEN_ID)) ?? null;
}

export async function getCurrentUser(req: Request): Promise<User | null> {
  const session = await verifySession(readSessionCookie(req));
  if (!session || session.openId !== LOCAL_OPEN_ID) return null;
  return (await db.getUserByOpenId(LOCAL_OPEN_ID)) ?? null;
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const expectedUsername = ENV.appUsername;
    const expectedPassword = ENV.appPassword;

    if (!expectedUsername || !expectedPassword) {
      console.error(
        "[Auth] APP_USERNAME or APP_PASSWORD is not configured in .env"
      );
      res.status(500).json({
        error:
          "Server auth is not configured. Set APP_USERNAME and APP_PASSWORD in .env.",
      });
      return;
    }

    const { username, password } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };

    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const ok =
      timingSafeStringEqual(username, expectedUsername) &&
      timingSafeStringEqual(password, expectedPassword);

    if (!ok) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = await ensureLocalUser().catch((err) => {
      console.error("[Auth] Failed to ensure local user:", err);
      return null;
    });

    if (!user) {
      res.status(503).json({
        error:
          "Database unavailable. Set DATABASE_URL in .env and run `pnpm db:push` before logging in.",
      });
      return;
    }

    const token = await signSession({
      openId: LOCAL_OPEN_ID,
      name: LOCAL_NAME,
    });

    res.cookie(COOKIE_NAME, token, {
      ...getSessionCookieOptions(req),
      maxAge: ONE_YEAR_MS,
    });

    res.json({
      success: true,
      user: { openId: user.openId, name: user.name ?? LOCAL_NAME },
    });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ success: true });
  });
}
