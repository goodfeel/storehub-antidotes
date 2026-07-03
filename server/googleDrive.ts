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

let cachedClient: drive_v3.Drive | null = null;

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

export interface UploadFileOptions {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  /** Defaults to `ENV.googleDriveFolderId`. */
  folderId?: string;
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
  const { fileName, mimeType, buffer } = options;
  const folderId = (options.folderId ?? ENV.googleDriveFolderId).trim();

  if (!folderId) {
    throw new Error(
      "Google Drive folder ID is not configured. Set GOOGLE_DRIVE_FOLDER_ID."
    );
  }

  const drive = await getDriveClient();

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
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

/** Test seam: clears the cached Drive client. */
export function __resetDriveClientForTests(): void {
  cachedClient = null;
}
