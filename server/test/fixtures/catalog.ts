import type { Catalog } from '@core/catalog'
export const FIXTURE_CATALOG: Catalog = {
  Fresh: {
    chilled: [
      ['Dairy', 'crates', 0.045, 14],
      ['Yoghurt', 'crates', 0.04, 11],
      ['Meat & fish', 'crates', 0.05, 16],
      ['Frozen goods', 'cartons', 0.06, 12],
    ],
    ambient: [
      ['Dry groceries', 'cartons', 0.06, 11],
      ['Produce', 'crates', 0.07, 12],
      ['Bakery', 'trays', 0.04, 4],
      ['Beverages', 'cases', 0.035, 13],
    ],
  },
  // Garments fill a vehicle's volume long before its weight limit.
  Style: {
    chilled: [],
    ambient: [
      ['Hanging garments', 'rails', 0.9, 38],
      ['Apparel cartons', 'cartons', 0.12, 7],
      ['Footwear cartons', 'cartons', 0.09, 8],
    ],
  },
  // Heavy, fragile, valuable — often a single large item.
  Tech: {
    chilled: [],
    ambient: [
      ['Refrigerators', 'units', 0.9, 75],
      ['Washing machines', 'units', 0.45, 65],
      ['Televisions', 'units', 0.25, 18],
      ['Small appliances', 'cartons', 0.05, 5],
    ],
  },
}

