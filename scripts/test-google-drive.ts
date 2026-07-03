/**
 * Debug-only script: verifies Google Drive is configured and uploads a small
 * test CSV to the configured shared folder using the current .env credentials.
 *
 * Usage: pnpm tsx scripts/test-google-drive.ts
 */

import "dotenv/config";
import { ENV, isGoogleDriveConfigured } from "../server/_core/env";
import { uploadFileToDrive } from "../server/googleDrive";

async function main() {
  console.log("Google Drive configured:", isGoogleDriveConfigured());
  console.log("Folder ID:", ENV.googleDriveFolderId || "(missing)");
  console.log("Client email:", ENV.googleDriveClientEmail || "(missing)");
  console.log(
    "Private key:",
    ENV.googleDrivePrivateKey ? `set (${ENV.googleDrivePrivateKey.length} chars)` : "(missing)"
  );

  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive is not configured — check the GOOGLE_DRIVE_* vars in .env");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `storehub_drive_test_${stamp}.csv`;
  const content = `column_a,column_b\ntest,${stamp}\n`;
  const subfolders = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })
    .split("-");

  console.log(`\nUploading ${fileName} to ${subfolders.join("/")} ...`);
  const result = await uploadFileToDrive({
    fileName,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "utf-8"),
    subfolders,
  });

  console.log("\nUpload succeeded:");
  console.log("  File ID:      ", result.id);
  console.log("  Name:         ", result.name);
  console.log("  webViewLink:  ", result.webViewLink ?? "(none)");
}

main().catch((err) => {
  console.error("\nUpload FAILED:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
