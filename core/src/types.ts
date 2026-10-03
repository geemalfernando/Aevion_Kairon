import type { BrandName, CalendarRow, CsvName, DemandForecastRow, DepotName, DistrictTravelRow, DockType, FleetStatusRow, OutletRow, ParkingConstraint, ServiceAllowanceRow, VehicleRow } from './csv'
import type { Minutes } from './time'

export type { Minutes }
export type Role = 'DISPATCHER' | 'LOADER' | 'DRIVER' | 'STORE_MANAGER'
export type Brand = BrandName
export type Temp = 'CHILLED' | 'AMBIENT'
export type Depot = DepotName
export type District = string
export type Severity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL'
export type { DockType, ParkingConstraint }

export interface Outlet {
  latitude?: number
  longitude?: number
  id: string
  name: string
  brand: Brand
  district: District
  depot: Depot
  dock: DockType
  parking: ParkingConstraint
  /** Fixed mall access window, for mall_dock outlets. */
  mallWindow?: [Minutes, Minutes]
  /** The outlet's own requested delivery window (window_open_time → window_close_time). */
  requestedWindow: [Minutes, Minutes]
  /** The window a delivery must actually hit: the requested window, narrowed by the mall window. */
  window: [Minutes, Minutes]
  /** Derived from parking_constraint for convenience. */
  vanOnly: boolean
  mall: boolean
  /** Stylised map coordinates (0–100), placed around the district centre. */
  x: number
  y: number
  lastServedDaysAgo: number
  deferralsThisWeek: number
  /** deferred_yesterday: the outlet was skipped on the previous run. */
  deferredYesterday: boolean
  manager: string
}

/** Display key combining vehicles.csv `type` and `temp`. */
export type VehicleType = 'REEFER_TRUCK' | 'REEFER_VAN' | 'TRUCK' | 'VAN'
export type VehicleStatus = 'AVAILABLE' | 'IN_WORKSHOP' | 'BREAKDOWN'

export interface Vehicle {
  id: string
  kind: 'truck' | 'van'
  temp: 'reefer' | 'ambient'
  type: VehicleType
  depot: Depot
  capacityKg: number
  capacityM3: number
  fuelType: string
  kmPerL: number
  fuelQuotaL: number
  /** Fuel already used this week before the planned day. */
  fuelUsedL: number
  status: VehicleStatus
  driver: string
  /** Held back from planning so a breakdown can be recovered (team policy: two reefers). */
  reserve?: boolean
}

export interface OrderItem {
  name: string
  unit: string
  qty: number
}

export type OrderStatus = 'CONFIRMED' | 'PLANNED' | 'DEFERRED' | 'LOADED' | 'IN_TRANSIT' | 'ARRIVED' | 'DELIVERED' | 'PARTIAL' | 'FAILED' | 'RECEIVED'

/** Why an order moved to a later run. Codes match the shared i18n vocabulary. */
export type DeferralCode =
  | 'reefer_capacity'
  | 'van_capacity'
  | 'vehicle_capacity'
  | 'weight_cap'
  | 'volume_cap'
  | 'time_budget'
  | 'delivery_window'
  | 'fuel_quota'
  | 'vehicle_unavailable'
  | 'dispatcher_choice'
  | 'inventory'
  | 'breakdown'

export interface Deferral {
  code: DeferralCode
  /** Short reason, e.g. "No reefer space". */
  reason: string
  /** The calculation behind it, e.g. "All 6 reefers at Peliyagoda already run 2 trips". */
  detail?: string
  customerMessage: string
  internalNote?: string
  /** Next operating day the order is planned for. */
  nextRun: string
  nextRecommendation: string
  /** The outlet was also skipped on the previous run — this is its second deferral in a row. */
  repeat?: boolean
  acknowledged?: boolean
  /** Planner proposals stay unconfirmed until the dispatcher accepts them. */
  confirmed?: boolean
  at: number
}

export interface DeliveryRecord {
  outcome: 'DELIVERED' | 'PARTIAL' | 'REFUSED' | 'CLOSED' | 'NO_ACCESS'
  receiver?: string
  notes?: string
  photo?: string
  signature?: string
  arrivedAt?: number
  completedAt?: number
  offline?: boolean
}

export interface Receipt {
  received: number
  condition: 'GOOD' | 'MISSING' | 'DAMAGED' | 'INCORRECT'
  receiver: string
  at: number
}

export interface Order {
  /** Server-computed ETA, retained when the store's response excludes preceding stops at other outlets. */
  projectedEta?: { minutes: number; window: [Minutes, Minutes] }
  id: string
  outletId: string
  brand: Brand
  temp: Temp
  items: OrderItem[]
  units: number
  volumeM3: number
  weightKg: number
  /** order_date: the delivery date the store ordered for. */
  deliveryDate: string
  status: OrderStatus
  priority: number
  /** Human-readable parts of the priority score, for explaining allocation. */
  priorityWhy?: string[]
  tripId?: string
  deferral?: Deferral
  /** How many runs this order has already been deferred. */
  runsDeferred?: number
  delivery?: DeliveryRecord
  receipt?: Receipt
  /** Loader count per item name. */
  loaded?: Record<string, number>
  shortfall?: { item: string; missing: number; reason: string; decision?: string }
  notes?: string
  createdAt: number
  /**
   * The stop is locked to a vehicle. The planner keeps it on that vehicle at the same arrival time and may only use
   * the vehicle's remaining capacity and time around it. Set by the dispatcher, or by the seed for the demo story.
   */
  lock?: StopLock
}

/**
 * Team policy: a dispatcher can pin a stop to a vehicle so re-planning never moves it. With `wholeTrip`, the stops
 * locked to the same vehicle (and brand and district) also form a closed trip: no other order may join it.
 * The lock lives on the orders, so it survives re-planning, which rebuilds draft trips.
 */
export interface StopLock {
  vehicleId: string
  by: 'DISPATCHER' | 'SYSTEM'
  at: number
  wholeTrip?: boolean
}

export type TripStatus = 'DRAFT' | 'PLANNED' | 'LOADING' | 'LOADED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'ABORTED'

/** A change to a trip after it was published: shown to the loader (before departure) or the driver (on the road). */
export interface TripChange {
  id: string
  at: number
  phase: 'loading' | 'route'
  added: string[]
  removed: { orderId: string; to?: string; reason: string }[]
  reason: string
  /** When the loader or driver confirmed they have seen and acted on it. */
  ackAt?: number
}

export interface Trip {
  id: string
  vehicleId: string
  number: 1 | 2
  brand: Brand
  district: District
  /** Planned departure from the depot (minutes, Colombo time). Fixed once the trip starts. */
  departure: Minutes
  stops: string[]
  status: TripStatus
  startedAt?: number
  /** Unacknowledged change made after loading began: the vehicle may not depart until the loader confirms. */
  pendingChange?: TripChange
  /** History of changes made while the trip was on the road. */
  changes?: TripChange[]
  /** Rescue trips leave at a fixed time and carry re-picked or transferred goods. */
  rescue?: { from?: string; reason: string }
  /** The driver reported a road problem: how late they expect to be, for one stop or (without orderId) the rest of the route. */
  reportedDelay?: { orderId?: string; minutes: number; note?: string; at: number }
}

export type IssueKind = 'BREAKDOWN' | 'REEFER_FAILURE' | 'SHORTFALL' | 'LATE_RISK' | 'DELIVERY_FAILED' | 'STORE_ISSUE' | 'FUEL' | 'OFFLINE_DRIVER'

export interface Issue {
  id: string
  kind: IssueKind
  severity: Severity
  title: string
  detail: string
  vehicleId?: string
  tripId?: string
  orderIds?: string[]
  createdAt: number
  resolved?: { at: number; by: Role; decision: string }
}

export interface DispatcherNotice {
  audience: 'ALL' | 'LOADER' | 'DRIVER' | 'STORE_MANAGER'
  targetId?: string
  depot: Depot
  severity: Severity
  title: string
  body: string
}

export interface Notification {
  depot?: Depot
  readByUserIds?: string[]
  id: string
  to: Role[]
  /** Restrict to a single outlet (store) or vehicle (driver). */
  outletId?: string
  vehicleId?: string
  severity: Severity
  title: string
  body: string
  at: number
  link?: string
  readBy: Role[]
}

export interface AuditEvent {
  depot?: Depot
  userId?: string
  id: string
  entity: string
  at: number
  actor: Role | 'SYSTEM'
  text: string
}

export interface User {
  name: string
  email: string
  role: Role
  depot: Depot
  assignedVehicle?: string
  assignedOutlet?: string
}

/** A device came back online and replayed what it recorded offline. */
export interface SyncReport {
  depot?: Depot
  id: string
  email: string
  name: string
  role: Role
  vehicleId?: string
  offlineFrom: number
  syncedAt: number
  events: number
  deliveries: number
  /** Orders whose offline record collided with a dispatcher change. */
  conflicts: string[]
  routeChanged: boolean
  ackAt?: number
}

export interface DistrictInfo extends DistrictTravelRow {
  /** Map centre for the stylised network map. */
  x: number
  y: number
}

/** What limited the day's plan, shown to the dispatcher next to the plan. */
export interface PlanAnalysis {
  at: number
  served: number
  deferred: number
  byCode: Partial<Record<DeferralCode, number>>
  binding?: DeferralCode
  resources: { key: 'reefer' | 'van' | 'dry' | 'fuel'; label: string; used: number; available: number; unit: string; note?: string }[]
  /** How many more orders would be served if the recovery reserve were released. */
  reserveImpact?: { vehicles: string[]; extraServed: number }
  repeatSkips: string[]
}

export interface Predictions {
  /** Datathon Task 1 outputs keyed by delivery_id (our order id). */
  service: Record<string, { pred_service_min: number; pred_late_prob: number }>
  /** Datathon Task 2A outputs. */
  demand: DemandForecastRow[]
  source?: string
  loadedAt?: number
}

/** The single operational state every role looks at. */
export interface OpsData {
  ordersClosedByDepot?: Partial<Record<Depot, boolean>>
  planByDepot?: Partial<Record<Depot, 'NONE' | 'DRAFT' | 'PUBLISHED'>>
  analysisByDepot?: Partial<Record<Depot, PlanAnalysis>>
  catalog: import('./catalog').Catalog
  version: number
  deliveryDate: string
  /** Operation clock: op time = sim + (Date.now() − real). Lets a demo run the 03:30 Fresh window at any hour. */
  clock: { sim: number; real: number }
  ordersClosed: boolean
  plan: 'NONE' | 'DRAFT' | 'PUBLISHED'
  outlets: Outlet[]
  vehicles: Vehicle[]
  districts: DistrictInfo[]
  allowances: ServiceAllowanceRow[]
  calendar: CalendarRow[]
  orders: Order[]
  trips: Trip[]
  issues: Issue[]
  notifications: Notification[]
  audit: AuditEvent[]
  syncLog: SyncReport[]
  /** Last contact per user email (wall-clock ms). */
  presence: Record<string, number>
  predictions: Predictions
  analysis?: PlanAnalysis
  /**
   * Demo days only: the reference rows the day was built from (calendar and allowances are already above), so a demo
   * reset on a server without the CSVs (Vercel) rebuilds the same network and fleet.
   */
  demoSource?: { outlets: OutletRow[]; vehicles: VehicleRow[]; districts: DistrictTravelRow[]; fleet: FleetStatusRow[]; sources: Record<CsvName, 'csv' | 'placeholder' | 'missing'> }
}

/** Actions that happen in the field and can be queued while offline. */
export type FieldEvent =
  | { type: 'LOAD_START'; tripId: string }
  | { type: 'LOAD_COUNT'; orderId: string; item: string; count: number }
  | { type: 'SHORTFALL'; orderId: string; item: string; missing: number; reason: string; photo?: string }
  | { type: 'LOAD_COMPLETE'; tripId: string }
  | { type: 'LOAD_CHANGE_ACK'; tripId: string; changeId: string }
  | { type: 'START_ROUTE'; tripId: string }
  | { type: 'ARRIVE'; orderId: string; tripId: string }
  | { type: 'DELIVER'; orderId: string; tripId: string; record: DeliveryRecord }
  | { type: 'PROOF'; orderId: string; photo?: string; signature?: string }
  | { type: 'VEHICLE_ISSUE'; vehicleId: string; tripId?: string; kind: string; note?: string; delayOrderId?: string; delayMin?: number }
  | { type: 'ROUTE_ACK'; tripId: string; changeIds: string[] }

export interface QueuedEvent {
  id: string
  /** Operation-clock time the action happened on the device. */
  at: number
  actor: Role
  event: FieldEvent
  status: 'pending' | 'failed'
  error?: string
}
