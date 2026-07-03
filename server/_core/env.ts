export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  storehubUsername: process.env.STOREHUB_USERNAME ?? "",
  storehubApiToken: process.env.STOREHUB_API_TOKEN ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Google Drive upload (scheduled exports). All optional — when unset the
  // export pipeline simply skips the Drive upload step. The service-account
  // credentials are supplied as individual values rather than a JSON blob.
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? "",
  googleDriveClientEmail: process.env.GOOGLE_DRIVE_CLIENT_EMAIL ?? "",
  googleDrivePrivateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY ?? "",
  googleDriveEnabled: process.env.GOOGLE_DRIVE_ENABLED ?? "",
};

export type StorehubCredentials = {
  username: string;
  apiToken: string;
};

/**
 * Reads StoreHub API credentials from the environment.
 * Throws a clear error if either value is missing — callers should let this
 * propagate so the UI surfaces it as a tRPC error.
 */
export function getStorehubCredentials(): StorehubCredentials {
  const username = ENV.storehubUsername.trim();
  const apiToken = ENV.storehubApiToken.trim();
  if (!username || !apiToken) {
    throw new Error(
      "StoreHub credentials are not configured. Set STOREHUB_USERNAME and STOREHUB_API_TOKEN in the service environment."
    );
  }
  return { username, apiToken };
}

export function hasStorehubCredentials(): boolean {
  return Boolean(ENV.storehubUsername.trim() && ENV.storehubApiToken.trim());
}

/**
 * Whether Google Drive uploads are configured. Requires a target folder ID
 * plus service-account credentials (inline JSON or a key-file path).
 *
 * `GOOGLE_DRIVE_ENABLED` acts as an explicit kill switch: setting it to
 * "false"/"0"/"off" disables uploads even when credentials are present.
 */
export function isGoogleDriveConfigured(): boolean {
  const toggle = ENV.googleDriveEnabled.trim().toLowerCase();
  if (toggle === "false" || toggle === "0" || toggle === "off" || toggle === "no") {
    return false;
  }
  const hasCredentials = Boolean(
    ENV.googleDriveClientEmail.trim() && ENV.googleDrivePrivateKey.trim()
  );
  return Boolean(ENV.googleDriveFolderId.trim() && hasCredentials);
}
