import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks for all of exportRunner's collaborators ─────────────────────────────

vi.mock("./storehubApi", () => ({
  fetchStores: vi.fn(async () => [{ id: "s1", name: "Store 1" }]),
  fetchAllTransactions: vi.fn(async () => []),
  fetchInventory: vi.fn(async () => []),
  fetchProductsMap: vi.fn(async () => new Map()),
  splitTagsAndSuppliers: vi.fn(() => ({ productTags: [], suppliers: [] })),
  buildSalesSummary: vi.fn(() => []),
  generateTransactionsCsv: vi.fn(() => "tx-csv"),
  generateInventoryCsv: vi.fn(() => "inv-csv"),
  generateSalesSummaryCsv: vi.fn(() => "sales-csv"),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `/api/files/${key}` })),
}));

vi.mock("./db", () => ({
  createExportFile: vi.fn(async () => 1),
  updateExportJob: vi.fn(async () => {}),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(async () => true),
}));

vi.mock("./_core/env", () => ({
  getStorehubCredentials: vi.fn(() => ({ username: "u", apiToken: "t" })),
  isGoogleDriveConfigured: vi.fn(() => true),
}));

vi.mock("./googleDrive", () => ({
  uploadFileToDrive: vi.fn(async () => ({
    id: "drive-file",
    name: "file.csv",
    webViewLink: "https://drive.google.com/drive-file",
  })),
}));

import { runExport } from "./exportRunner";
import { uploadFileToDrive } from "./googleDrive";
import { isGoogleDriveConfigured } from "./_core/env";
import { updateExportJob } from "./db";

const baseOptions = {
  jobId: 1,
  userId: 42,
  dateFrom: "2026-06-24",
  dateTo: "2026-06-25",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isGoogleDriveConfigured).mockReturnValue(true);
  vi.mocked(uploadFileToDrive).mockResolvedValue({
    id: "drive-file",
    name: "file.csv",
    webViewLink: "https://drive.google.com/drive-file",
  });
});

describe("runExport Google Drive integration", () => {
  it("uploads all 3 CSVs to Drive for a scheduled export when configured", async () => {
    await runExport({ ...baseOptions, triggerType: "scheduled" });

    expect(uploadFileToDrive).toHaveBeenCalledTimes(3);
    const uploadedNames = vi
      .mocked(uploadFileToDrive)
      .mock.calls.map((c) => c[0].fileName);
    expect(uploadedNames.some((n) => n.startsWith("inventory_"))).toBe(true);
    expect(uploadedNames.some((n) => n.startsWith("transactions_"))).toBe(true);
    expect(uploadedNames.some((n) => n.startsWith("sales_summary_"))).toBe(true);
  });

  it("uploads only the inventory CSV for a scheduled inventory-only export", async () => {
    await runExport({ ...baseOptions, triggerType: "scheduled", inventoryOnly: true });

    expect(uploadFileToDrive).toHaveBeenCalledTimes(1);
    expect(uploadFileToDrive.mock.calls[0]![0].fileName).toMatch(/^inventory_/);
  });

  it("does NOT upload to Drive for a manual export by default", async () => {
    await runExport({ ...baseOptions, triggerType: "manual" });
    expect(uploadFileToDrive).not.toHaveBeenCalled();
  });

  it("uploads for a manual export when uploadToDrive is opted in", async () => {
    await runExport({ ...baseOptions, triggerType: "manual", uploadToDrive: true });
    expect(uploadFileToDrive).toHaveBeenCalledTimes(3);
  });

  it("does NOT upload for a manual opt-in when Drive is not configured", async () => {
    vi.mocked(isGoogleDriveConfigured).mockReturnValue(false);
    await runExport({ ...baseOptions, triggerType: "manual", uploadToDrive: true });
    expect(uploadFileToDrive).not.toHaveBeenCalled();
  });

  it("does NOT upload to Drive when Drive is not configured", async () => {
    vi.mocked(isGoogleDriveConfigured).mockReturnValue(false);
    await runExport({ ...baseOptions, triggerType: "scheduled" });
    expect(uploadFileToDrive).not.toHaveBeenCalled();
  });

  it("fails the job when a scheduled Drive upload throws", async () => {
    vi.mocked(uploadFileToDrive).mockRejectedValueOnce(new Error("Drive boom"));

    await expect(
      runExport({ ...baseOptions, triggerType: "scheduled" })
    ).rejects.toThrow("Drive boom");

    const failedCall = vi
      .mocked(updateExportJob)
      .mock.calls.find((c) => (c[1] as { status?: string }).status === "failed");
    expect(failedCall).toBeTruthy();
    expect((failedCall![1] as { errorMessage?: string }).errorMessage).toContain("Drive boom");
  });
});
