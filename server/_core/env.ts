export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  appUsername: process.env.APP_USERNAME ?? "",
  appPassword: process.env.APP_PASSWORD ?? "",
  storehubUsername: process.env.STOREHUB_USERNAME ?? "",
  storehubApiToken: process.env.STOREHUB_API_TOKEN ?? "",
  isProduction: process.env.NODE_ENV === "production",
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
