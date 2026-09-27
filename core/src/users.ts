import type { Role, User } from './types'

/** Seeded demo accounts, one per role. The API stores these with hashed passwords. */
export const DEMO_USERS: Record<Role, User> = {
  DISPATCHER: { name: 'Geemal', email: 'dispatcher@kairon.demo', role: 'DISPATCHER', depot: 'Peliyagoda' },
  LOADER: { name: 'Kamal', email: 'loader@kairon.demo', role: 'LOADER', depot: 'Peliyagoda' },
  DRIVER: { name: 'Nimal', email: 'driver@kairon.demo', role: 'DRIVER', depot: 'Peliyagoda', assignedVehicle: 'VEH014' },
  STORE_MANAGER: { name: 'Dilini', email: 'store@kairon.demo', role: 'STORE_MANAGER', depot: 'Peliyagoda', assignedOutlet: 'OUT032' },
}

export const DEMO_PASSWORD = 'kairon-demo'
