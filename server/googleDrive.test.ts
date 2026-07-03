import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { filesCreate, googleAuthCtor, driveCtor } = vi.hoisted(() => ({
  filesCreate: vi.fn(),
  googleAuthCtor: vi.fn(),
  driveCtor: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: googleAuthCtor },
    drive: driveCtor,
  },
}));

// Provide a deterministic ENV so credentials/folder resolution is predictable.
vi.mock("./_core/env", () => ({
  ENV: {
    googleDriveFolderId: "folder-123",
    googleDriveClientEmail: "svc@project.iam.gserviceaccount.com",
    googleDrivePrivateKey:
      "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
    googleDriveEnabled: "",
  },
  isGoogleDriveConfigured: () => true,
}));

import {
  uploadFileToDrive,
  getDriveClient,
  __resetDriveClientForTests,
} from "./googleDrive";

beforeEach(() => {
  vi.clearAllMocks();
  __resetDriveClientForTests();
  googleAuthCtor.mockImplementation(() => ({ __fakeAuth: true }));
  driveCtor.mockReturnValue({ files: { create: filesCreate } });
  filesCreate.mockResolvedValue({
    data: { id: "file-1", name: "test.csv", webViewLink: "https://drive.google.com/file-1" },
  });
});

describe("uploadFileToDrive", () => {
  it("uploads with the configured folder, mime type, and supportsAllDrives", async () => {
    const result = await uploadFileToDrive({
      fileName: "inventory.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b,c"),
    });

    expect(filesCreate).toHaveBeenCalledTimes(1);
    const arg = filesCreate.mock.calls[0]![0];
    expect(arg.supportsAllDrives).toBe(true);
    expect(arg.requestBody.name).toBe("inventory.csv");
    expect(arg.requestBody.parents).toEqual(["folder-123"]);
    expect(arg.media.mimeType).toBe("text/csv");

    expect(result).toEqual({
      id: "file-1",
      name: "test.csv",
      webViewLink: "https://drive.google.com/file-1",
    });
  });

  it("uses an explicit folderId override when provided", async () => {
    await uploadFileToDrive({
      fileName: "x.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("x"),
      folderId: "other-folder",
    });

    const arg = filesCreate.mock.calls[0]![0];
    expect(arg.requestBody.parents).toEqual(["other-folder"]);
  });

  it("throws when no folder ID is available", async () => {
    await expect(
      uploadFileToDrive({
        fileName: "x.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("x"),
        folderId: "",
      })
    ).rejects.toThrow(/folder ID is not configured/i);
    expect(filesCreate).not.toHaveBeenCalled();
  });

  it("throws when the API response has no file ID", async () => {
    filesCreate.mockResolvedValueOnce({ data: { name: "no-id.csv" } });
    await expect(
      uploadFileToDrive({
        fileName: "no-id.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("x"),
      })
    ).rejects.toThrow(/did not return a file ID/i);
  });

  it("returns null webViewLink when Drive omits it", async () => {
    filesCreate.mockResolvedValueOnce({ data: { id: "file-2", name: "n.csv" } });
    const result = await uploadFileToDrive({
      fileName: "n.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("x"),
    });
    expect(result.webViewLink).toBeNull();
  });
});

describe("getDriveClient", () => {
  it("constructs auth with the parsed service-account credentials", async () => {
    await getDriveClient();
    expect(googleAuthCtor).toHaveBeenCalledTimes(1);
    const authArg = googleAuthCtor.mock.calls[0]![0];
    expect(authArg.credentials.client_email).toBe("svc@project.iam.gserviceaccount.com");
    // Escaped newlines in the env value must be unescaped for the PEM key.
    expect(authArg.credentials.private_key).toContain("\n");
    expect(authArg.credentials.private_key).not.toContain("\\n");
    expect(authArg.scopes).toContain("https://www.googleapis.com/auth/drive");
  });

  it("caches the client across calls", async () => {
    await getDriveClient();
    await getDriveClient();
    expect(googleAuthCtor).toHaveBeenCalledTimes(1);
    expect(driveCtor).toHaveBeenCalledTimes(1);
  });
});
