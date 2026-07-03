/**
 * Google Drive upload helper for scheduled exports.
 *
 * Authentication uses a Google **service account** (no interactive OAuth), which
 * is the right fit for unattended daily runs. Set up is a one-time manual step:
 *
 *   1. Create a Google Cloud project and enable the **Google Drive API**.
 *   2. Create a **service account** and download its JSON key.
 *   3. Create / pick the target **shared folder** in Google Drive.
 *   4. Share that folder with the service account email (e.g.
 *      `storehub-export@<project>.iam.gserviceaccount.com`) as **Editor**
 *      (or "Content manager" on a Shared drive).
 *   5. Copy the folder ID from the URL
 *      `https://drive.google.com/drive/folders/<FOLDER_ID>`.
 *
 * Then configure the service environment with individual values pulled from the
 * downloaded key JSON:
 *
 *   - `GOOGLE_DRIVE_FOLDER_ID`     → target folder ID
 *   - `GOOGLE_DRIVE_CLIENT_EMAIL`  → the key's `client_email`
 *   - `GOOGLE_DRIVE_PRIVATE_KEY`   → the key's `private_key` (newlines may be
 *     escaped as `\n`; they are un-escaped automatically)
 *   - `GOOGLE_DRIVE_ENABLED`       → optional kill switch
 *
 * Store `GOOGLE_DRIVE_PRIVATE_KEY` as a secret env var in production.
 *
 * Uploaded files are organised into date subfolders `YYYY/MM/DD` under the
 * configured root folder (created on demand).
 */

import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { ENV, isGoogleDriveConfigured } from "./_core/env";

export { isGoogleDriveConfigured };

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

/**
 * Builds service-account credentials from the individual env vars. Returns null
 * when either value is missing.
 */
function loadCredentials(): ServiceAccountCredentials | null {
  const clientEmail = ENV.googleDriveClientEmail.trim();
  const privateKey = ENV.googleDrivePrivateKey.trim();
  if (!clientEmail || !privateKey) return null;

  return {
    client_email: clientEmail,
    // Env vars often store the private key with escaped newlines.
    private_key: privateKey.replace(/\\n/g, "\n"),
  };
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

let cachedClient: drive_v3.Drive | null = null;
// Caches resolved folder IDs keyed by `${parentId}/${name}` so repeated uploads
// on the same day don't re-query/re-create the date folders.
const folderCache = new Map<string, string>();

/**
 * Returns an authenticated Drive v3 client. Throws if credentials are missing
 * or malformed. The client is cached for the lifetime of the process.
 */
export async function getDriveClient(): Promise<drive_v3.Drive> {
  if (cachedClient) return cachedClient;

  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error(
      "Google Drive credentials are not configured. Set GOOGLE_DRIVE_CLIENT_EMAIL and GOOGLE_DRIVE_PRIVATE_KEY."
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: DRIVE_SCOPES,
  });

  cachedClient = google.drive({ version: "v3", auth });
  return cachedClient;
}

/**
 * Finds a direct child folder by name under `parentId`, creating it if it
 * doesn't exist. Results are cached for the process lifetime.
 */
async function findOrCreateFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const escapedName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const list = await drive.files.list({
    q: `name = '${escapedName}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const existing = list.data.files?.[0];
  if (existing?.id) {
    folderCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: "id",
  });

  const id = created.data.id;
  if (!id) {
    throw new Error(`Failed to create Google Drive folder "${name}".`);
  }
  folderCache.set(cacheKey, id);
  return id;
}

/**
 * Walks/creates a nested folder path under `rootId` and returns the leaf
 * folder ID. e.g. segments `["2026", "07", "04"]` → `<root>/2026/07/04`.
 */
async function ensureFolderPath(
  drive: drive_v3.Drive,
  rootId: string,
  segments: string[]
): Promise<string> {
  let parent = rootId;
  for (const segment of segments) {
    parent = await findOrCreateFolder(drive, parent, segment);
  }
  return parent;
}

export interface UploadFileOptions {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  /** Defaults to `ENV.googleDriveFolderId`. */
  folderId?: string;
  /**
   * Optional nested subfolder path (relative to `folderId`) to place the file
   * in. Each segment is created if missing. e.g. `["2026", "07", "04"]`.
   */
  subfolders?: string[];
}

export interface UploadFileResult {
  id: string;
  name: string;
  webViewLink: string | null;
}

/**
 * Uploads a single file into the configured shared folder.
 *
 * `supportsAllDrives: true` is required so uploads work for both folders in
 * "My Drive" shared with the service account and folders living on a Shared
 * drive.
 */
export async function uploadFileToDrive(
  options: UploadFileOptions
): Promise<UploadFileResult> {
  const { fileName, mimeType, buffer, subfolders } = options;
  const folderId = (options.folderId ?? ENV.googleDriveFolderId).trim();

  if (!folderId) {
    throw new Error(
      "Google Drive folder ID is not configured. Set GOOGLE_DRIVE_FOLDER_ID."
    );
  }

  const drive = await getDriveClient();

  const targetFolderId =
    subfolders && subfolders.length > 0
      ? await ensureFolderPath(drive, folderId, subfolders)
      : folderId;

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [targetFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id, name, webViewLink",
  });

  const { id, name, webViewLink } = res.data;
  if (!id) {
    throw new Error("Google Drive upload did not return a file ID.");
  }

  return { id, name: name ?? fileName, webViewLink: webViewLink ?? null };
}

/** Test seam: clears the cached Drive client and folder cache. */
export function __resetDriveClientForTests(): void {
  cachedClient = null;
  folderCache.clear();
}
