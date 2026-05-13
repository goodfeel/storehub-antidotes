/**
 * StoreHub REST API Service
 * Base URL: https://api.storehubhq.com
 * Auth: Basic (username = store subdomain, password = API token)
 * Rate limit: max 3 calls/second
 */

const BASE_URL = "https://api.storehubhq.com";
const MAX_CALLS_PER_SECOND = 3;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoreHubStore {
  id: string;
  name: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface TransactionItem {
  productId?: string;
  quantity?: number;
  total?: number;
  subTotal?: number;
  taxCode?: string;
  discount?: number;
  unitPrice?: number;
  itemType?: string;
  notes?: string;
  promotions?: unknown[];
  selectedOptions?: unknown[];
}

export interface TransactionPayment {
  paymentMethod?: string;
  amount?: number;
}

export interface StoreHubTransaction {
  refId: string;
  invoiceNumber?: string;
  storeId?: string;
  registerId?: string;
  employeeId?: string;
  customerRefId?: string;
  transactionType?: string;
  transactionTime?: string;
  total?: number;
  subTotal?: number;
  tax?: number;
  discount?: number;
  roundedAmount?: number;
  serviceCharge?: number;
  promotions?: unknown[];
  items?: TransactionItem[];
  payments?: TransactionPayment[];
  isCancelled?: boolean;
  channel?: string;
  deliveryInformation?: unknown[];
}

export interface InventoryItem {
  productId: string;
  quantityOnHand?: number;
  warningStock?: number;
  idealStock?: number;
  storeId?: string; // added by us when merging across stores
}

export interface StoreHubProduct {
  id: string;
  name?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  subCategory?: string;
  tags?: string[];
  priceType?: string;
  unitPrice?: number;
  cost?: number;
  trackStockLevel?: boolean;
  isParentProduct?: boolean;
  parentProductId?: string;
}

/** Enriched inventory row: inventory stock joined with product details */
export interface EnrichedInventoryItem extends InventoryItem {
  storeName: string;
  productName?: string;
  sku?: string;
  barcode?: string;
  cost?: number;
  unitPrice?: number;
  category?: string;
  productTags?: string;
  suppliers?: string;
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private callTimestamps: number[] = [];

  async throttle(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than 1 second
    this.callTimestamps = this.callTimestamps.filter((t) => now - t < 1000);

    if (this.callTimestamps.length >= MAX_CALLS_PER_SECOND) {
      const oldest = this.callTimestamps[0]!;
      const waitMs = 1000 - (now - oldest) + 50; // +50ms buffer
      await sleep(waitMs);
      this.callTimestamps = this.callTimestamps.filter((t) => Date.now() - t < 1000);
    }

    this.callTimestamps.push(Date.now());
  }
}

const rateLimiter = new RateLimiter();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core Fetch ───────────────────────────────────────────────────────────────

async function storehubFetch<T>(
  path: string,
  username: string,
  apiToken: string,
  params?: Record<string, string>
): Promise<T> {
  const credentials = Buffer.from(`${username}:${apiToken}`).toString("base64");
  const url = new URL(`${BASE_URL}${path}`);

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, v);
      }
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await rateLimiter.throttle();

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (response.status === 429) {
        // Rate limited – wait longer before retry
        const retryAfter = parseInt(response.headers.get("Retry-After") ?? "5", 10);
        console.warn(`[StoreHub] Rate limited. Waiting ${retryAfter}s before retry ${attempt}/${MAX_RETRIES}`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      // Handle chunked/streaming JSON (Transfer-Encoding: chunked)
      const text = await response.text();
      if (!text || text.trim() === "") return [] as unknown as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        // Some endpoints return NDJSON or concatenated objects – try to parse as array
        const fixed = `[${text.replace(/}\s*{/g, "},{")}]`;
        return JSON.parse(fixed) as T;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[StoreHub] Attempt ${attempt}/${MAX_RETRIES} failed for ${path}: ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${path} after ${MAX_RETRIES} attempts`);
}

// ─── Public API Methods ───────────────────────────────────────────────────────

export async function fetchStores(username: string, apiToken: string): Promise<StoreHubStore[]> {
  return storehubFetch<StoreHubStore[]>("/stores", username, apiToken);
}

export interface FetchTransactionsOptions {
  storeId?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  includeOnline?: boolean;
}

/**
 * Fetches ALL transactions for a store, handling the 5000-record pagination limit
 * by splitting the date range into smaller chunks when needed.
 */
export async function fetchAllTransactions(
  username: string,
  apiToken: string,
  options: FetchTransactionsOptions,
  onProgress?: (count: number) => void
): Promise<StoreHubTransaction[]> {
  const allTransactions: StoreHubTransaction[] = [];

  const params: Record<string, string> = {};
  if (options.storeId) params.storeId = options.storeId;
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;
  if (options.includeOnline) params.includeOnline = "true";

  const batch = await storehubFetch<StoreHubTransaction[]>("/transactions", username, apiToken, params);
  allTransactions.push(...batch);
  onProgress?.(allTransactions.length);

  // If we hit the 5000 limit, split the date range and recurse
  if (batch.length >= 5000 && options.from && options.to) {
    const fromDate = new Date(options.from);
    const toDate = new Date(options.to);
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 1) {
      // Split into two halves
      const midDate = new Date(fromDate.getTime() + Math.floor(diffDays / 2) * 24 * 60 * 60 * 1000);
      const midStr = midDate.toISOString().split("T")[0]!;

      const firstHalf = await fetchAllTransactions(username, apiToken, {
        ...options,
        from: options.from,
        to: midStr,
      }, onProgress);

      const secondHalf = await fetchAllTransactions(username, apiToken, {
        ...options,
        from: midStr,
        to: options.to,
      }, onProgress);

      // Deduplicate by refId
      const seen = new Set<string>();
      const combined: StoreHubTransaction[] = [];
      for (const tx of [...firstHalf, ...secondHalf]) {
        if (!seen.has(tx.refId)) {
          seen.add(tx.refId);
          combined.push(tx);
        }
      }
      return combined;
    }
  }

  return allTransactions;
}

export async function fetchInventory(
  username: string,
  apiToken: string,
  storeId: string
): Promise<InventoryItem[]> {
  // The endpoint is /inventory/<storeId> — storeId is a URL path segment, NOT a query param
  return storehubFetch<InventoryItem[]>(`/inventory/${storeId}`, username, apiToken);
}

/**
 * Fetches all products from /products.
 * Returns a Map<productId, StoreHubProduct> for fast lookup.
 */
export async function fetchProductsMap(
  username: string,
  apiToken: string
): Promise<Map<string, StoreHubProduct>> {
  const products = await storehubFetch<StoreHubProduct[]>("/products", username, apiToken);
  const map = new Map<string, StoreHubProduct>();
  for (const p of products) {
    if (p.id) map.set(p.id, p);
  }
  return map;
}

/**
 * Splits product tags into two groups:
 * - Suppliers: tags that look like supplier names (contain "&", "Co", start with "[", or contain known supplier keywords)
 * - Product Tags: all other tags
 * Returns { productTags, suppliers } as semicolon-separated strings.
 */
export function splitTagsAndSuppliers(tags: string[] = []): { productTags: string; suppliers: string } {
  const supplierTags: string[] = [];
  const regularTags: string[] = [];
  for (const tag of tags) {
    // Heuristic: supplier tags start with "[" or contain "&" or "Co" or "Antidotes"
    if (tag.startsWith("[") || tag.includes(" & ") || /\bCo\b/.test(tag)) {
      supplierTags.push(tag);
    } else {
      regularTags.push(tag);
    }
  }
  return {
    productTags: regularTags.join(";"),
    suppliers: supplierTags.join(";"),
  };
}

// ─── CSV Generation ───────────────────────────────────────────────────────────

export function generateTransactionsCsv(
  transactions: StoreHubTransaction[],
  storeMap: Map<string, string>
): string {
  const headers = [
    "Store Name",
    "Store ID",
    "Ref ID",
    "Invoice Number",
    "Transaction Type",
    "Transaction Time",
    "Total",
    "Sub Total",
    "Tax",
    "Discount",
    "Rounded Amount",
    "Service Charge",
    "Is Cancelled",
    "Channel",
    "Customer Ref ID",
    "Register ID",
    "Employee ID",
    "Payment Methods",
    "Payment Amounts",
    "Item Count",
    "Items Summary",
  ];

  const rows = transactions.map((tx) => {
    const storeName = tx.storeId ? (storeMap.get(tx.storeId) ?? tx.storeId) : "";
    const paymentMethods = (tx.payments ?? []).map((p) => p.paymentMethod ?? "").join("|");
    const paymentAmounts = (tx.payments ?? []).map((p) => p.amount ?? 0).join("|");
    const itemCount = (tx.items ?? []).length;
    const itemsSummary = (tx.items ?? [])
      .map((i) => `${i.itemType ?? ""}:${i.quantity ?? 0}x${i.unitPrice ?? 0}`)
      .join("|");

    return [
      csvEscape(storeName),
      csvEscape(tx.storeId ?? ""),
      csvEscape(tx.refId),
      csvEscape(tx.invoiceNumber ?? ""),
      csvEscape(tx.transactionType ?? ""),
      csvEscape(tx.transactionTime ?? ""),
      tx.total ?? 0,
      tx.subTotal ?? 0,
      tx.tax ?? 0,
      tx.discount ?? 0,
      tx.roundedAmount ?? 0,
      tx.serviceCharge ?? 0,
      tx.isCancelled ? "true" : "false",
      csvEscape(tx.channel ?? ""),
      csvEscape(tx.customerRefId ?? ""),
      csvEscape(tx.registerId ?? ""),
      csvEscape(tx.employeeId ?? ""),
      csvEscape(paymentMethods),
      csvEscape(paymentAmounts),
      itemCount,
      csvEscape(itemsSummary),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function generateInventoryCsv(
  inventoryItems: EnrichedInventoryItem[],
): string {
  // Columns match StoreHub back-office inventory export format (no Store Name — per-product view)
  const headers = [
    "Product Name",
    "SKU",
    "Barcode",
    "Quantity On Hand",
    "Cost",
    "Price (tax-excluded)",
    "Cost * Quantity",
    "Price * Quantity",
    "Margin",
    "Category",
    "Product Tags",
    "Suppliers",
    "Store Name",
  ];
  const rows = inventoryItems.map((item) => {
    const qty = item.quantityOnHand ?? 0;
    const cost = item.cost ?? 0;
    const price = item.unitPrice ?? 0;
    const costQty = +(cost * qty).toFixed(2);
    const priceQty = +(price * qty).toFixed(2);
    // Margin = (Price - Cost) / Price × 100; show 0.00% when price = 0
    const margin = price > 0
      ? `${(((price - cost) / price) * 100).toFixed(2)}%`
      : "0.00%";
    return [
      csvEscape(item.productName ?? ""),
      csvEscape(item.sku ?? ""),
      csvEscape(item.barcode ?? ""),
      qty,
      cost,
      price,
      costQty,
      priceQty,
      margin,
      csvEscape(item.category ?? ""),
      csvEscape(item.productTags ?? ""),
      csvEscape(item.suppliers ?? ""),
      csvEscape(item.storeName ?? ""),
    ].join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Sales Summary ────────────────────────────────────────────────────────────

export interface SalesSummaryRow {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productCategory: string;
  productSku: string;    // full display name used as "Product SKU" column
  skuId: string;         // the sku field from product
  totalItemsSold: number;
  totalSales: number;
  totalSalesReturned: number;
  totalDiscount: number;
  discountPct: number;   // totalDiscount / totalSales * 100
  itemNetSales: number;  // totalSales - totalSalesReturned - totalDiscount
  averageCost: number;   // cost from product catalogue
  averageNetSales: number; // itemNetSales / totalItemsSold
  grossProfit: number;   // itemNetSales - (averageCost * totalItemsSold)
  grossProfitPct: number; // grossProfit / itemNetSales * 100
}

/**
 * Aggregates transaction line items into a per-store per-product sales summary.
 * - Sale transactions (not cancelled) contribute to totalSales / totalItemsSold.
 * - Cancelled transactions contribute to totalSalesReturned.
 * - Product details (name, sku, category, cost) come from the productsMap.
 * - Results are broken down by store (one row per store per product).
 */
export function buildSalesSummary(
  transactions: StoreHubTransaction[],
  productsMap: Map<string, StoreHubProduct>,
  storeMap?: Map<string, string>  // storeId -> storeName
): SalesSummaryRow[] {
  // Accumulator keyed by "storeId::productId"
  const acc = new Map<string, {
    storeId: string;
    productId: string;
    totalItemsSold: number;
    totalSales: number;
    totalSalesReturned: number;
    totalDiscount: number;
  }>();

  for (const tx of transactions) {
    const isCancelled = tx.isCancelled === true;
    const sid = tx.storeId ?? "";
    for (const item of tx.items ?? []) {
      const pid = item.productId;
      if (!pid) continue;
      const key = `${sid}::${pid}`;
      const qty = item.quantity ?? 0;
      const lineTotal = item.total ?? item.subTotal ?? (qty * (item.unitPrice ?? 0));
      const lineDiscount = item.discount ?? 0;

      if (!acc.has(key)) {
        acc.set(key, { storeId: sid, productId: pid, totalItemsSold: 0, totalSales: 0, totalSalesReturned: 0, totalDiscount: 0 });
      }
      const row = acc.get(key)!;

      if (isCancelled) {
        row.totalSalesReturned += lineTotal;
      } else {
        row.totalItemsSold += qty;
        row.totalSales += lineTotal;
        row.totalDiscount += lineDiscount;
      }
    }
  }

  const result: SalesSummaryRow[] = [];
  for (const [, data] of Array.from(acc.entries())) {
    const product = productsMap.get(data.productId);
    const averageCost = product?.cost ?? 0;
    const itemNetSales = +(data.totalSales - data.totalSalesReturned - data.totalDiscount).toFixed(2);
    const averageNetSales = data.totalItemsSold > 0 ? +(itemNetSales / data.totalItemsSold).toFixed(2) : 0;
    const grossProfit = +(itemNetSales - averageCost * data.totalItemsSold).toFixed(2);
    const grossProfitPct = itemNetSales !== 0 ? +((grossProfit / itemNetSales) * 100).toFixed(2) : 0;
    const discountPct = data.totalSales !== 0 ? +((data.totalDiscount / data.totalSales) * 100).toFixed(2) : 0;

    result.push({
      storeId: data.storeId,
      storeName: storeMap?.get(data.storeId) ?? data.storeId,
      productId: data.productId,
      productName: product?.name ?? data.productId,
      productCategory: product?.category ?? "",
      productSku: product?.name ?? data.productId,   // "Product SKU" column = product name (matches back-office format)
      skuId: product?.sku ?? "",
      totalItemsSold: +data.totalItemsSold.toFixed(2),
      totalSales: +data.totalSales.toFixed(2),
      totalSalesReturned: +data.totalSalesReturned.toFixed(2),
      totalDiscount: +data.totalDiscount.toFixed(2),
      discountPct,
      itemNetSales,
      averageCost,
      averageNetSales,
      grossProfit,
      grossProfitPct,
    });
  }

  // Sort by storeName then totalSales descending
  result.sort((a, b) => {
    const storeCompare = a.storeName.localeCompare(b.storeName);
    if (storeCompare !== 0) return storeCompare;
    return b.totalSales - a.totalSales;
  });
  return result;
}

export function generateSalesSummaryCsv(rows: SalesSummaryRow[]): string {
  const headers = [
    "Store Name",
    "Product Name",
    "Product Category",
    "Product SKU",
    "SKU ID",
    "Total Items Sold",
    "Total Sales",
    "Total Sales Returned",
    "Total Discount",
    "Discount",
    "Item Net Sales",
    "Average Cost",
    "Average Net Sales",
    "Gross Profit",
    "Gross Profit %",
  ];

  const csvRows = rows.map((r) => [
    csvEscape(r.storeName),
    csvEscape(r.productName),
    csvEscape(r.productCategory),
    csvEscape(r.productSku),
    csvEscape(r.skuId),
    r.totalItemsSold,
    r.totalSales,
    r.totalSalesReturned,
    r.totalDiscount,
    r.discountPct ? `${r.discountPct}%` : "0%",
    r.itemNetSales,
    r.averageCost,
    r.averageNetSales,
    r.grossProfit,
    r.grossProfitPct ? `${r.grossProfitPct}%` : "0%",
  ].join(","));

  return [headers.join(","), ...csvRows].join("\n");
}
