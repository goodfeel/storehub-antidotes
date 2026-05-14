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

export interface DeleteOldFilesResult {
  deletedKeys: string[];
  deletedBytes: number;
}

/**
 * Recursively delete files under `EXPORTS_ROOT` whose last-modified time is
 * older than `maxAgeMs`. Empty directories are pruned afterwards (except
 * `EXPORTS_ROOT` itself).
 *
 * Returns the list of deleted storage keys (relative to `EXPORTS_ROOT`) and
 * the total number of bytes reclaimed. Missing directories are treated as a
 * no-op so callers don't need to special-case a fresh install.
 */
export async function storageDeleteOlderThan(
  maxAgeMs: number,
  now: Date = new Date()
): Promise<DeleteOldFilesResult> {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error(`storageDeleteOlderThan: invalid maxAgeMs ${maxAgeMs}`);
  }

  const cutoff = now.getTime() - maxAgeMs;
  const result: DeleteOldFilesResult = { deletedKeys: [], deletedBytes: 0 };

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        // Remove the directory if it became empty after recursing
        try {
          const remaining = await fs.readdir(absolute);
          if (remaining.length === 0) await fs.rmdir(absolute);
        } catch {
          // Best-effort prune; ignore failures (e.g. race with another writer)
        }
        continue;
      }
      if (!entry.isFile()) continue;

      let stat;
      try {
        stat = await fs.stat(absolute);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      if (stat.mtimeMs >= cutoff) continue;

      try {
        await fs.unlink(absolute);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }

      const relKey = path
        .relative(EXPORTS_ROOT, absolute)
        .split(path.sep)
        .join("/");
      result.deletedKeys.push(relKey);
      result.deletedBytes += stat.size;
    }
  }

  await walk(EXPORTS_ROOT);
  return result;
}
