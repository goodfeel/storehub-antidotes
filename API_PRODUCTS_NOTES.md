# StoreHub Products API Notes

## Endpoint
- GET /products — returns all products (no query params)
- GET /products/<id> — get single product

## Product Schema Fields Available
- id: String
- name: String
- sku: String
- barcode: String (comma-separated if multiple)
- category: String
- subCategory: String
- tags: Array of String
- priceType: Enum (Fixed | Variable)
- unitPrice: Number (price before tax)
- cost: Number
- trackStockLevel: Boolean
- isParentProduct: Boolean
- variantGroups: Array (parent products only)
- variantValues: Array (child products only)
- parentProductId: String (child products only)

## Notes
- NO "suppliers" field in the API schema
- Suppliers appear to be stored as tags in the format "[SLQ Only] Raw Material" etc.
- The "Suppliers" column in the desired output likely comes from tags that match supplier naming conventions
- taxCode is available in transaction items but NOT in product schema
- unitPrice is the price (tax-excluded) as shown in the desired output
- Margin = (unitPrice - cost) / unitPrice * 100

## Desired CSV Columns
Product Name | SKU | Barcode | Quantity On Hand | Cost | Price (tax-excluded) | Cost*Quantity | Price*Quantity | Margin | Category | Product Tags | Suppliers

## Strategy
1. Fetch all products from /products (once, not per store)
2. Build a productId -> product map
3. For each store inventory item, join with product data
4. Suppliers = tags that look like supplier names (or just use all tags as "Suppliers" column, separate from product tags)
   - Looking at the sample data: tags=["White","2025","Gift"] and Suppliers="Antidotes & Co;[SLQ Only] Raw Material;..."
   - This suggests Suppliers is a separate field NOT in the public API - it may just be tags
   - OR: the back-office has a separate suppliers field not exposed in the public API
   - Decision: Use tags for "Product Tags" and leave "Suppliers" empty or use tags that start with "[" as supplier indicators
