export interface WatchlistItem {
  id: number;
  priority: number;
  newOrUsed: string;
  myPrice: string | null;
  myQuantity: number | null;
  saleRate: number;
  priceLocked: boolean;
  description: string | null;
  marketMedian: number | null;
  marketQtyAvg: number | null;
  stockMedian: number | null;
  stockQtyAvg: number | null;
  trend: "up" | "down" | "stable" | null;
  suggestedPrice: number | null;
  suggestedRuleName: string | null;
  part: {
    id: number;
    partNo: string;
    colorId: number;
    itemType: string;
    partName: string | null;
    colorName: string | null;
    lastPriceUpdate: string | null;
  };
}

export type SortField = "partNo" | "name" | "condition" | "myPrice" | "marketPrice" | "diff" | "quantity" | "age";
export type SortDir = "asc" | "desc";
