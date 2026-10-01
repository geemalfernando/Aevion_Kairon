# Competition data

Drop the Tech-Triathlon CSVs here (any sub-folder layout works, e.g. the supplied `General Data/`):

| File | Used for |
|---|---|
| `outlets.csv` | Outlets, access (`dock_type`, `parking_constraint`, `mall_window`) and delivery windows |
| `vehicles.csv` | Fleet: `type` truck/van, `temp` reefer/ambient, capacities, fuel profile, home depot |
| `calendar.csv` | Operating days (Monday–Saturday per `is_operating`), paydays, festivals, monsoon |
| `district_travel.csv` | `depot_to_district_freeflow_min` and `inter_stop_freeflow_min` for trip time |
| `service_allowance.csv` | Handling allowance per brand and dock type |
| `fleet_status.csv` (optional) | `vehicle_id,status` with `available` / `in_workshop` |

On the next start (or **Demo → Reset**), the server loads whatever is present and falls back to built-in
placeholders for anything missing. `GET /api/health` reports which files were used (`dataSources`).
The static web build (no server) uses the placeholders.

The competition terms forbid redistributing the datasets, so **do not commit the CSVs**: `data/*.csv` is git-ignored.
