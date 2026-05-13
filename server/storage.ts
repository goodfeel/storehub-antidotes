/**
 * Local filesystem storage helpers.
 *
 * CSV exports are written under `EXPORTS_ROOT` (default: `<project>/exports/`).
 * `storagePut` returns a relative URL (`/api/files/<key>`) that the Express
 * server serves through an auth-gated static handler registered in
 * `server/_core/index.ts`.
 *
 * The original implementation used a hosted storage proxy; this version keeps
 * the same `storagePut` / `storageGet` interface so call sites in
 * `exportRunner.ts` remain unchanged.
 */

import path from "node:path";
import { promises as fs } from "node:fs";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
export const EXPORTS_ROOT = path.resolve(PROJECT_ROOT, "exports");

const URL_PREFIX = "/api/files";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "").replace(/\\/g, "/");
}

/**
 * Resolve a storage key to an absolute filesystem path while guarding against
 * path-traversal attempts (e.g. `../../etc/passwd`).
 */
export function resolveStoragePath(relKey: string): string {
  const key = normalizeKey(relKey);
  const absolute = path.resolve(EXPORTS_ROOT, key);
  if (
    absolute !== EXPORTS_ROOT &&
    !absolute.startsWith(`${EXPORTS_ROOT}${path.sep}`)
  ) {
    throw new Error(`Invalid storage key: ${relKey}`);
  }
  return absolute;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  _contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const absolute = resolveStoragePath(key);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const buffer =
    typeof data === "string"
      ? Buffer.from(data, "utf-8")
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
  await fs.writeFile(absolute, buffer);
  return { key, url: `${URL_PREFIX}/${key}` };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `${URL_PREFIX}/${key}` };
}
