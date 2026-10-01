# Real operation data

Place these files directly in this directory (or set `DATA_DIR` to another directory):

| File | Required contents |
|---|---|
| `outlets.csv` | Outlet IDs, brand, district, depot, dock, parking and delivery windows |
| `vehicles.csv` | Vehicle IDs, type, refrigeration, capacities and fuel profile |
| `calendar.csv` | Actual operating dates and calendar attributes |
| `district_travel.csv` | Depot and district travel distances and times |
| `service_allowance.csv` | Handling minutes per brand and dock type |
| `fleet_status.csv` | Each vehicle ID and `available` or `in_workshop` |
| `catalog.json` | Your product names, units, volume and weight per unit |

The exact CSV column names and enums are documented in [`core/src/csv.ts`](../core/src/csv.ts). Outlets can additionally include `name`, `manager`, `latitude`, and `longitude`. Maps show imported coordinates only; they no longer invent outlet locations or animate vehicle GPS positions.

The catalogue is an object keyed by `Fresh`, `Style`, or `Tech`, each containing `chilled` and `ambient` arrays. Each product is a four-element array: `[name, unit, cubicMetresPerUnit, kilogramsPerUnit]`. Names must be unique within a brand and measurements must be positive. Start with this empty structure and add your actual products:

```json
{
  "Fresh": { "chilled": [], "ambient": [] },
  "Style": { "chilled": [], "ambient": [] },
  "Tech": { "chilled": [], "ambient": [] }
}
```

Run `npm --prefix server run import:data` from the repository root after running the Supabase migration. Imports preserve existing operation history. Missing files cause an error; there are no generated replacements. CSVs and the catalogue are git-ignored.
