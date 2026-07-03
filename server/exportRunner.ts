/**
 * Export Runner
 * Orchestrates fetching stores → transactions → inventory → CSV → S3 upload
 */

import {
  fetchStores,
  fetchAllTransactions,
  fetchInventory,
  fetchProductsMap,
  splitTagsAndSuppliers,
  buildSalesSummary,
  generateTransactionsCsv,
  generateInventoryCsv,
  generateSalesSummaryCsv,
  type StoreHubStore,
  type StoreHubTransaction,
  type EnrichedInventoryItem,
} from "./storehubApi";
import { storagePut } from "./storage";
import { uploadFileToDrive } from "./googleDrive";
import { createExportFile, updateExportJob } from "./db";
import { getStorehubCredentials, isGoogleDriveConfigured } from "./_core/env";
import { notifyOwner } from "./_core/notification";

/**
 * Stores whose exact name appears here are filtered out of every export
 * (transactions, inventory, sales summary).
 *
 * Exact match is intentional — "Warehouse Suanluang Square" stays included
 * because only "Warehouse" matches. Add the literal store name to remove a
 * location from all CSVs without touching StoreHub itself.
 */
const EXCLUDED_STORE_NAMES = new Set<string>([
  "Warehouse",
]);

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

function formatDateTimeBangkok(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

export interface RunExportOptions {
  jobId: number;
  userId: number;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
  includeOnline?: boolean;
  triggerType: "manual" | "scheduled";
  /**
   * When true, skip transactions + sales-summary fetching/uploading and only
   * produce the inventory CSV. Used by the non-admin "User" role which is
   * limited to inventory snapshots.
   */
  inventoryOnly?: boolean;
}

export async function runExport(options: RunExportOptions): Promise<void> {
  const { jobId, userId, dateFrom, dateTo, includeOnline, triggerType, inventoryOnly } = options;

  // Mark job as running
  await updateExportJob(jobId, { status: "running" });

  // Google Drive uploads only run for scheduled exports (the "daily export to
  // Drive" use case). Manual exports stay local-only. Drive links are tracked
  // per file so the completion notification can surface them.
  const driveEnabled = triggerType === "scheduled" && isGoogleDriveConfigured();
  const driveLinks = new Map<string, string | null>();

  async function maybeUploadToDrive(fileName: string, buffer: Buffer): Promise<void> {
    if (!driveEnabled) return;
    console.log(`[Export ${jobId}] Uploading ${fileName} to Google Drive...`);
    const result = await uploadFileToDrive({
      fileName,
      mimeType: "text/csv",
      buffer,
    });
    driveLinks.set(fileName, result.webViewLink);
    console.log(`[Export ${jobId}]   → Drive file ${result.id}`);
  }

  try {
    const { username, apiToken } = getStorehubCredentials();

    // 1. Fetch all stores
    console.log(`[Export ${jobId}] Fetching stores...`);
    const allStores: StoreHubStore[] = await fetchStores(username, apiToken);
    console.log(`[Export ${jobId}] Found ${allStores.length} stores`);

    if (allStores.length === 0) {
      throw new Error("No stores returned from StoreHub API. Please verify your credentials.");
    }

    const excluded = allStores.filter((s) => EXCLUDED_STORE_NAMES.has(s.name));
    const stores = allStores.filter((s) => !EXCLUDED_STORE_NAMES.has(s.name));
    if (excluded.length > 0) {
      console.log(
        `[Export ${jobId}] Excluding ${excluded.length} store(s) by name: ${excluded
          .map((s) => `${s.name} (${s.id})`)
          .join(", ")}`,
      );
    }

    // Build a storeId → storeName map (post-filter)
    const storeMap = new Map<string, string>(stores.map((s) => [s.id, s.name]));

    // 2. Fetch transactions for all stores (skipped in inventory-only mode)
    const allTransactions: StoreHubTransaction[] = [];
    if (!inventoryOnly) {
      for (const store of stores) {
        console.log(`[Export ${jobId}] Fetching transactions for store: ${store.name} (${store.id})`);
        try {
          const txs = await fetchAllTransactions(username, apiToken, {
            storeId: store.id,
            from: dateFrom,
            to: dateTo,
            includeOnline: includeOnline ?? true,
          });
          console.log(`[Export ${jobId}]   → ${txs.length} transactions`);
          allTransactions.push(...txs);
        } catch (err) {
          console.error(`[Export ${jobId}] Failed to fetch transactions for store ${store.name}:`, err);
          // Continue with other stores rather than aborting
        }
      }
    } else {
      console.log(`[Export ${jobId}] Inventory-only mode: skipping transactions fetch`);
    }

    // 3. Fetch product catalogue (once, not per store) for enrichment
    console.log(`[Export ${jobId}] Fetching product catalogue...`);
    let productsMap = new Map();
    try {
      productsMap = await fetchProductsMap(username, apiToken);
      console.log(`[Export ${jobId}] Loaded ${productsMap.size} products`);
    } catch (err) {
      console.warn(`[Export ${jobId}] Could not fetch products (will export inventory without enrichment):`, err);
    }

    // 4. Fetch inventory for all stores and enrich with product data
    const allInventory: EnrichedInventoryItem[] = [];
    for (const store of stores) {
      console.log(`[Export ${jobId}] Fetching inventory for store: ${store.name} (${store.id})`);
      try {
        const items = await fetchInventory(username, apiToken, store.id);
        console.log(`[Export ${jobId}]   → ${items.length} inventory items`);
        for (const item of items) {
          const product = productsMap.get(item.productId);
          const { productTags, suppliers } = splitTagsAndSuppliers(product?.tags ?? []);
          allInventory.push({
            ...item,
            storeId: store.id,
            storeName: store.name,
            productName: product?.name,
            sku: product?.sku,
            barcode: product?.barcode,
            cost: product?.cost,
            unitPrice: product?.unitPrice,
            category: product?.category,
            productTags,
            suppliers,
          });
        }
      } catch (err) {
        console.error(`[Export ${jobId}] Failed to fetch inventory for store ${store.name}:`, err);
      }
    }

    // 5. Generate CSVs
    const timestamp = formatDate(new Date()).replace(/-/g, "");
    const invCsv = generateInventoryCsv(allInventory);
    const invFileName = `inventory_${dateFrom}_to_${dateTo}_${timestamp}_${randomSuffix()}.csv`;
    const invKey = `exports/user-${userId}/${invFileName}`;
    const invBuffer = Buffer.from(invCsv, "utf-8");

    console.log(`[Export ${jobId}] Uploading inventory CSV (${invBuffer.length} bytes)...`);
    const { url: invUrl } = await storagePut(invKey, invBuffer, "text/csv");
    await createExportFile(jobId, userId, "inventory", invFileName, invUrl, invKey, invBuffer.length);
    await maybeUploadToDrive(invFileName, invBuffer);

    let txFileName: string | null = null;
    let salesFileName: string | null = null;
    let salesSummaryRowCount = 0;

    if (!inventoryOnly) {
      const txCsv = generateTransactionsCsv(allTransactions, storeMap);
      const salesSummaryRows = buildSalesSummary(allTransactions, productsMap, storeMap);
      const salesCsv = generateSalesSummaryCsv(salesSummaryRows);
      salesSummaryRowCount = salesSummaryRows.length;

      txFileName = `transactions_${dateFrom}_to_${dateTo}_${timestamp}_${randomSuffix()}.csv`;
      salesFileName = `sales_summary_${dateFrom}_to_${dateTo}_${timestamp}_${randomSuffix()}.csv`;

      const txKey = `exports/user-${userId}/${txFileName}`;
      const salesKey = `exports/user-${userId}/${salesFileName}`;

      const txBuffer = Buffer.from(txCsv, "utf-8");
      const salesBuffer = Buffer.from(salesCsv, "utf-8");

      console.log(`[Export ${jobId}] Uploading transactions CSV (${txBuffer.length} bytes)...`);
      const { url: txUrl } = await storagePut(txKey, txBuffer, "text/csv");

      console.log(`[Export ${jobId}] Uploading sales summary CSV (${salesBuffer.length} bytes, ${salesSummaryRows.length} products)...`);
      const { url: salesUrl } = await storagePut(salesKey, salesBuffer, "text/csv");

      await createExportFile(jobId, userId, "transactions", txFileName, txUrl, txKey, txBuffer.length);
      await createExportFile(jobId, userId, "sales_summary", salesFileName, salesUrl, salesKey, salesBuffer.length);

      await maybeUploadToDrive(txFileName, txBuffer);
      await maybeUploadToDrive(salesFileName, salesBuffer);
    }

    // 8. Mark job completed
    await updateExportJob(jobId, {
      status: "completed",
      storeCount: stores.length,
      transactionCount: allTransactions.length,
      inventoryCount: allInventory.length,
      completedAt: new Date(),
    });

    console.log(`[Export ${jobId}] Completed successfully. ${allTransactions.length} transactions, ${allInventory.length} inventory items, ${salesSummaryRowCount} products in sales summary across ${stores.length} stores.`);

    // 9. Notify owner
    const completedAt = formatDateTimeBangkok(new Date());
    const formatFileLine = (fileName: string): string => {
      const link = driveLinks.get(fileName);
      return link ? `- ${fileName} (Drive: ${link})` : `- ${fileName}`;
    };
    const fileLines: string[] = [formatFileLine(invFileName)];
    if (txFileName) fileLines.push(formatFileLine(txFileName));
    if (salesFileName) fileLines.push(formatFileLine(salesFileName));

    const driveNote = driveEnabled
      ? `Google Drive: uploaded ${driveLinks.size} file(s) to the shared folder.\n`
      : "";

    await notifyOwner({
      title: `StoreHub Export Completed (${triggerType}${inventoryOnly ? ", inventory-only" : ""})`,
      content: `Export job #${jobId} completed successfully at ${completedAt} (GMT+7).\n\n` +
        `Date range: ${dateFrom} to ${dateTo}\n` +
        `Stores: ${stores.length}\n` +
        driveNote +
        (inventoryOnly
          ? `Inventory items: ${allInventory.length}\n\n`
          : `Transactions: ${allTransactions.length}\n` +
            `Inventory items: ${allInventory.length}\n` +
            `Sales summary products: ${salesSummaryRowCount}\n\n`) +
        `Files:\n${fileLines.join("\n")}`,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Export ${jobId}] Failed:`, errorMessage);

    await updateExportJob(jobId, {
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    });

    // Notify owner of failure
    const failedAt = formatDateTimeBangkok(new Date());
    await notifyOwner({
      title: `StoreHub Export FAILED (${triggerType})`,
      content: `Export job #${jobId} failed at ${failedAt} (GMT+7).\n\n` +
        `Date range: ${dateFrom} to ${dateTo}\n\n` +
        `Error: ${errorMessage}`,
    });

    throw err;
  }
}
