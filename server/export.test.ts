import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateTransactionsCsv, generateInventoryCsv, splitTagsAndSuppliers } from "./storehubApi";
import type { StoreHubTransaction, EnrichedInventoryItem } from "./storehubApi";

// ─── CSV Generation Tests ─────────────────────────────────────────────────────

describe("generateTransactionsCsv", () => {
  const storeMap = new Map([
    ["store-001", "Main Branch"],
    ["store-002", "City Center"],
  ]);

  it("generates a CSV with correct headers", () => {
    const csv = generateTransactionsCsv([], storeMap);
    const headers = csv.split("\n")[0]!;
    expect(headers).toContain("Store Name");
    expect(headers).toContain("Ref ID");
    expect(headers).toContain("Invoice Number");
    expect(headers).toContain("Transaction Type");
    expect(headers).toContain("Total");
    expect(headers).toContain("Payment Methods");
  });

  it("returns only headers for empty transactions", () => {
    const csv = generateTransactionsCsv([], storeMap);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1); // only header
  });

  it("maps storeId to store name correctly", () => {
    const tx: StoreHubTransaction = {
      refId: "TX-001",
      storeId: "store-001",
      invoiceNumber: "INV-001",
      transactionType: "Sale",
      transactionTime: "2024-01-15T10:00:00Z",
      total: 100,
      subTotal: 100,
      tax: 0,
      discount: 0,
      roundedAmount: 0,
      serviceCharge: 0,
      isCancelled: false,
      channel: "OFFLINE_PAYMENTS",
      payments: [{ paymentMethod: "Cash", amount: 100 }],
      items: [{ itemType: "Item", quantity: 1, unitPrice: 100 }],
    };
    const csv = generateTransactionsCsv([tx], storeMap);
    expect(csv).toContain("Main Branch");
    expect(csv).toContain("TX-001");
    expect(csv).toContain("INV-001");
    expect(csv).toContain("Cash");
  });

  it("falls back to storeId when store name not in map", () => {
    const tx: StoreHubTransaction = {
      refId: "TX-002",
      storeId: "store-unknown",
      total: 50,
    };
    const csv = generateTransactionsCsv([tx], storeMap);
    expect(csv).toContain("store-unknown");
  });

  it("escapes commas and quotes in CSV fields", () => {
    const tx: StoreHubTransaction = {
      refId: "TX-003",
      storeId: "store-001",
      invoiceNumber: 'INV "special", test',
      total: 0,
    };
    const csv = generateTransactionsCsv([tx], storeMap);
    // Should be wrapped in quotes
    expect(csv).toContain('"INV ""special"", test"');
  });

  it("handles multiple transactions from different stores", () => {
    const txs: StoreHubTransaction[] = [
      { refId: "TX-A", storeId: "store-001", total: 100 },
      { refId: "TX-B", storeId: "store-002", total: 200 },
      { refId: "TX-C", storeId: "store-001", total: 300 },
    ];
    const csv = generateTransactionsCsv(txs, storeMap);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(4); // 1 header + 3 rows
    expect(csv).toContain("Main Branch");
    expect(csv).toContain("City Center");
  });
});

describe("generateInventoryCsv", () => {
  it("generates a CSV with correct headers", () => {
    const csv = generateInventoryCsv([]);
    const headers = csv.split("\n")[0]!;
    const headerCols = headers.split(",");
    expect(headers).toContain("Store Name");
    expect(headerCols[headerCols.length - 1]).toBe("Store Name"); // Store Name must be last column
    expect(headers).toContain("Product Name");
    expect(headers).toContain("SKU");
    expect(headers).toContain("Barcode");
    expect(headers).toContain("Quantity On Hand");
    expect(headers).toContain("Cost");
    expect(headers).toContain("Price (tax-excluded)");
    expect(headers).toContain("Cost * Quantity");
    expect(headers).toContain("Price * Quantity");
    expect(headers).toContain("Margin");
    expect(headers).toContain("Category");
    expect(headers).toContain("Product Tags");
    expect(headers).toContain("Suppliers");
  });

  it("returns only headers for empty inventory", () => {
    const csv = generateInventoryCsv([]);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("includes enriched product details", () => {
    const items: EnrichedInventoryItem[] = [
      {
        productId: "prod-001",
        quantityOnHand: 50,
        warningStock: 10,
        idealStock: 100,
        storeId: "store-001",
        storeName: "Main Branch",
        productName: "Coffee Beans",
        sku: "CB-001",
        barcode: "1234567890",
        cost: 20,
        unitPrice: 50,
        category: "Beverages",
        productTags: "Hot;Organic",
        suppliers: "[SLQ Only] Raw Material",
      },
    ];
    const csv = generateInventoryCsv(items);
    expect(csv).toContain("Main Branch"); // Store Name is now the last column
    expect(csv).toContain("Coffee Beans");
    expect(csv).toContain("CB-001");
    expect(csv).toContain("1234567890");
    expect(csv).toContain("50"); // qty
    expect(csv).toContain("1000"); // cost * qty = 20 * 50
    expect(csv).toContain("2500"); // price * qty = 50 * 50
    expect(csv).toContain("60.00%"); // margin = (50-20)/50
    expect(csv).toContain("Beverages");
    expect(csv).toContain("Hot;Organic");
    expect(csv).toContain("[SLQ Only] Raw Material");
  });

  it("handles multiple products correctly (no store name column)", () => {
    const items: EnrichedInventoryItem[] = [
      { productId: "p1", storeName: "Store A", storeId: "s1", quantityOnHand: 10, productName: "Product A" },
      { productId: "p2", storeName: "Store B", storeId: "s2", quantityOnHand: 20, productName: "Product B" },
      { productId: "p3", storeName: "Store A", storeId: "s1", quantityOnHand: 5, productName: "Product C" },
    ];
    const csv = generateInventoryCsv(items);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(4); // 1 header + 3 rows
    expect(csv).toContain("Store A"); // Store Name is now the last column
    expect(csv).toContain("Store B");
    expect(csv).toContain("Product A");
    expect(csv).toContain("Product B");
    expect(csv).toContain("Product C");
  });

  it("calculates margin correctly", () => {
    const items: EnrichedInventoryItem[] = [
      { productId: "p1", storeName: "Store A", storeId: "s1", quantityOnHand: 10, cost: 30, unitPrice: 100 },
    ];
    const csv = generateInventoryCsv(items);
    expect(csv).toContain("70.00%"); // (100-30)/100 = 70%
    expect(csv).toContain("300");    // cost * qty = 30 * 10
    expect(csv).toContain("1000");   // price * qty = 100 * 10
  });

  it("splits tags into product tags and suppliers correctly", () => {
    const { productTags, suppliers } = splitTagsAndSuppliers(["White", "2025", "Gift", "[SLQ Only] Raw Material", "Antidotes & Co"]);
    expect(productTags).toContain("White");
    expect(productTags).toContain("2025");
    expect(productTags).toContain("Gift");
    expect(suppliers).toContain("[SLQ Only] Raw Material");
    expect(suppliers).toContain("Antidotes & Co");
  });
});

// ─── Sales Summary Tests ────────────────────────────────────────────────────────────

import { buildSalesSummary, generateSalesSummaryCsv } from "./storehubApi";
import type { StoreHubProduct } from "./storehubApi";

describe("buildSalesSummary", () => {
  const makeProduct = (id: string, name: string, sku: string, cost: number, category: string): StoreHubProduct => ({
    id, name, sku, barcode: "", cost, unitPrice: cost * 2, category, tags: [],
  });

  const makeTx = (productId: string, qty: number, unitPrice: number, isCancelled = false): StoreHubTransaction => ({
    refId: `TX-${Math.random()}`,
    storeId: "store-1",
    invoiceNumber: "INV-001",
    transactionType: "Sale",
    transactionTime: "2024-01-15T10:00:00Z",
    total: qty * unitPrice,
    subTotal: qty * unitPrice,
    tax: 0,
    discount: 0,
    roundedAmount: 0,
    serviceCharge: 0,
    isCancelled,
    channel: "OFFLINE_PAYMENTS",
    payments: [],
    items: [{ itemType: "Item", productId, quantity: qty, unitPrice, total: qty * unitPrice, discount: 0 }],
  });

  it("aggregates items sold and total sales per store per product", () => {
    const productsMap = new Map([["p1", makeProduct("p1", "Coffee", "CF-001", 10, "Drinks")]]);
    const storeMap = new Map([["store-1", "Main Branch"]]);
    const txs = [makeTx("p1", 3, 20), makeTx("p1", 2, 20)];
    const rows = buildSalesSummary(txs, productsMap, storeMap);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.storeId).toBe("store-1");
    expect(rows[0]!.storeName).toBe("Main Branch");
    expect(rows[0]!.totalItemsSold).toBe(5);
    expect(rows[0]!.totalSales).toBe(100);
  });

  it("separates cancelled transactions into totalSalesReturned", () => {
    const productsMap = new Map([["p1", makeProduct("p1", "Tea", "TE-001", 5, "Drinks")]]);
    const txs = [makeTx("p1", 4, 15), makeTx("p1", 1, 15, true)];
    const rows = buildSalesSummary(txs, productsMap);
    expect(rows[0]!.totalSalesReturned).toBe(15);
    expect(rows[0]!.totalItemsSold).toBe(4); // cancelled items not counted
    expect(rows[0]!.storeId).toBe("store-1"); // storeId always present
  });

  it("calculates itemNetSales, grossProfit, and grossProfitPct correctly", () => {
    const productsMap = new Map([["p1", makeProduct("p1", "Bag", "BG-001", 30, "Bags")]]);
    // 10 items at 100 each = 1000 sales, no returns, no discount
    const txs = [makeTx("p1", 10, 100)];
    const rows = buildSalesSummary(txs, productsMap);
    const r = rows[0]!;
    expect(r.itemNetSales).toBe(1000);
    expect(r.grossProfit).toBe(700); // 1000 - (30 * 10)
    expect(r.grossProfitPct).toBe(70); // 700/1000 * 100
  });

  it("produces separate rows for same product in different stores", () => {
    const productsMap = new Map([["p1", makeProduct("p1", "Bag", "BG-001", 30, "Bags")]]);
    const storeMap = new Map([["store-1", "Branch A"], ["store-2", "Branch B"]]);
    const tx1: StoreHubTransaction = { refId: "TX-1", storeId: "store-1", isCancelled: false,
      items: [{ productId: "p1", quantity: 5, unitPrice: 100, total: 500, discount: 0 }] };
    const tx2: StoreHubTransaction = { refId: "TX-2", storeId: "store-2", isCancelled: false,
      items: [{ productId: "p1", quantity: 3, unitPrice: 100, total: 300, discount: 0 }] };
    const rows = buildSalesSummary([tx1, tx2], productsMap, storeMap);
    expect(rows).toHaveLength(2); // one row per store
    const storeNames = rows.map(r => r.storeName).sort();
    expect(storeNames).toEqual(["Branch A", "Branch B"]);
  });

  it("skips items without productId", () => {
    const productsMap = new Map<string, StoreHubProduct>();
    const tx: StoreHubTransaction = {
      refId: "TX-X", storeId: "s1", invoiceNumber: "INV-X", transactionType: "Sale",
      transactionTime: "2024-01-15T10:00:00Z", total: 50, subTotal: 50, tax: 0, discount: 0,
      roundedAmount: 0, serviceCharge: 0, isCancelled: false, channel: "OFFLINE_PAYMENTS",
      payments: [], items: [{ itemType: "Item", quantity: 1, unitPrice: 50 }],
    };
    const rows = buildSalesSummary([tx], productsMap);
    expect(rows).toHaveLength(0);
  });
});

describe("generateSalesSummaryCsv", () => {
  it("generates correct headers including Store Name", () => {
    const csv = generateSalesSummaryCsv([]);
    const headers = csv.split("\n")[0]!;
    expect(headers).toContain("Store Name");
    expect(headers).toContain("Product Name");
    expect(headers).toContain("Product Category");
    expect(headers).toContain("Product SKU");
    expect(headers).toContain("SKU ID");
    expect(headers).toContain("Total Items Sold");
    expect(headers).toContain("Total Sales");
    expect(headers).toContain("Total Sales Returned");
    expect(headers).toContain("Total Discount");
    expect(headers).toContain("Discount");
    expect(headers).toContain("Item Net Sales");
    expect(headers).toContain("Average Cost");
    expect(headers).toContain("Average Net Sales");
    expect(headers).toContain("Gross Profit");
    expect(headers).toContain("Gross Profit %");
  });

  it("outputs one data row per store-product combination", () => {
    const rows = [
      { storeId: "s1", storeName: "Main Branch", productId: "p1", productName: "Coffee",
        productCategory: "Drinks", productSku: "Coffee", skuId: "CF-001",
        totalItemsSold: 5, totalSales: 100, totalSalesReturned: 0, totalDiscount: 0, discountPct: 0,
        itemNetSales: 100, averageCost: 10, averageNetSales: 20, grossProfit: 50, grossProfitPct: 50 },
    ];
    const csv = generateSalesSummaryCsv(rows);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2); // header + 1 row
    expect(csv).toContain("Main Branch");
    expect(csv).toContain("Coffee");
    expect(csv).toContain("CF-001");
    expect(csv).toContain("50%");
  });
});

// ─── Router Procedure Tests ───────────────────────────────────────────────────

function makeCtx() {
  return {
    user: {
      id: 1,
      openId: "local-admin",
      name: "Admin",
      email: null,
      loginMethod: "local",
      role: "admin" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

describe("scheduler router", () => {
  it("validates frequencyDays range", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.scheduler.save({ enabled: true, frequencyDays: 0, dayOfWeek: 1, hourOfDay: 8, includeOnline: true })
    ).rejects.toThrow();
  });

  it("validates hourOfDay range", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.scheduler.save({ enabled: true, frequencyDays: 7, dayOfWeek: 1, hourOfDay: 25, includeOnline: true })
    ).rejects.toThrow();
  });
});

describe("export router", () => {
  it("validates date format for trigger", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.export.trigger({ dateFrom: "invalid-date", dateTo: "2024-01-15", includeOnline: true })
    ).rejects.toThrow();
  });
});
