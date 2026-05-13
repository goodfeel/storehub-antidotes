totalItemsSold = 45
totalSales = 80.15
totalSalesReturned = 112.15
totalDiscount = 11.22
discount_col = 2.54
itemNetSales_expected = 37.38
averageCost = 54.29
averageNetSales_expected = 72.92
grossProfit_expected = 20.22
grossProfitPct_expected = 50.35

print('=== Verifying formulas ===')

print(f'Discount% from totalDiscount/totalSales*100: {totalDiscount/totalSales*100:.2f}% (expected 2.54%)')
print(f'Discount% from totalDiscount/itemNetSales*100: {totalDiscount/itemNetSales_expected*100:.2f}% (expected 2.54%)')

net1 = totalSales - totalSalesReturned - totalDiscount
print(f'itemNetSales (sales-returned-discount): {net1:.2f} (expected 37.38)')
net2 = totalSales - totalDiscount
print(f'itemNetSales (sales-discount): {net2:.2f}')

print(f'averageNetSales (itemNetSales/qty): {itemNetSales_expected/totalItemsSold:.2f} (expected 72.92)')
print(f'averageNetSales (totalSales/qty): {totalSales/totalItemsSold:.2f}')

gp1 = itemNetSales_expected - averageCost * totalItemsSold
print(f'grossProfit (netSales - cost*qty): {gp1:.2f} (expected 20.22)')
gp2 = averageNetSales_expected - averageCost
print(f'grossProfit (avgNetSales - avgCost): {gp2:.2f}')

print(f'grossProfitPct (gp/netSales*100): {grossProfit_expected/itemNetSales_expected*100:.2f}% (expected 50.35%)')
print(f'grossProfitPct (gp/avgNetSales*100): {grossProfit_expected/averageNetSales_expected*100:.2f}%')
