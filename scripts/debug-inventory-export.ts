/**
 * Debug-only script: runs the same fetch + enrichment pipeline as the real
 * inventory export and writes the CSV to disk. Bypasses DB, S3 and notifications.
 *
 * Usage: pnpm tsx scripts/debug-inventory-export.ts
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  fetchStores,
  fetchInventory,
  fetchProductsMap,
  splitTagsAndSuppliers,
  generateInventoryCsv,
  type EnrichedInventoryItem,
} from "../server/storehubApi";

const TARGET_NAME = "Warehouse Suanluang Square";
// Mirror the export runner's filter so the debug output matches what users get.
const EXCLUDED_STORE_NAMES = new Set<string>(["Warehouse"]);

function getCreds() {
  const username = process.env.STOREHUB_USERNAME;
  const apiToken = process.env.STOREHUB_API_TOKEN;
  if (!username || !apiToken) {
    throw new Error("STOREHUB_USERNAME / STOREHUB_API_TOKEN missing in .env");
  }
  return { username, apiToken };
}

async function main() {
  const { username, apiToken } = getCreds();

  console.log("→ Fetching stores...");
  const allStores = await fetchStores(username, apiToken);
  const excluded = allStores.filter((s) => EXCLUDED_STORE_NAMES.has(s.name));
  const stores = allStores.filter((s) => !EXCLUDED_STORE_NAMES.has(s.name));
  console.log(`  found ${allStores.length} stores, excluding ${excluded.length}: ${excluded.map((s) => s.name).join(", ") || "(none)"}`);
  console.log(`  proceeding with ${stores.length} stores`);

  console.log("→ Fetching products catalogue...");
  const productsMap = await fetchProductsMap(username, apiToken);
  console.log(`  loaded ${productsMap.size} products`);

  const allInventory: EnrichedInventoryItem[] = [];
  const perStoreCounts: { storeId: string; storeName: string; raw: number; enriched: number; nonZero: number }[] = [];

  for (const store of stores) {
    process.stdout.write(`→ Inventory: ${store.name.padEnd(30)} (${store.id}) ... `);
    try {
      const items = await fetchInventory(username, apiToken, store.id);
      let nonZero = 0;
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
        if ((item.quantityOnHand ?? 0) !== 0) nonZero++;
      }
      perStoreCounts.push({ storeId: store.id, storeName: store.name, raw: items.length, enriched: items.length, nonZero });
      console.log(`${items.length} items (${nonZero} non-zero)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED — ${msg}`);
      perStoreCounts.push({ storeId: store.id, storeName: store.name, raw: 0, enriched: 0, nonZero: 0 });
    }
  }

  const csv = generateInventoryCsv(allInventory);
  const outDir = resolve(process.cwd(), "exports/debug");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `debug-inventory-${Date.now()}.csv`);
  writeFileSync(outPath, csv, "utf-8");

  console.log("\n=== Per-store row counts in CSV ===");
  console.table(perStoreCounts);

  const targetCount = allInventory.filter((r) => r.storeName === TARGET_NAME).length;
  const targetNonZero = allInventory.filter((r) => r.storeName === TARGET_NAME && (r.quantityOnHand ?? 0) !== 0).length;
  console.log(`\n=== Verdict for "${TARGET_NAME}" ===`);
  console.log(`  rows in CSV : ${targetCount}`);
  console.log(`  non-zero qty: ${targetNonZero}`);
  console.log(`\nCSV written to: ${outPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
