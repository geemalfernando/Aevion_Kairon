/** Test fixture: the demo delivery day from core (placeholder network, demo catalogue, story locks). */
import { seedDemoOps } from '@core/demo'
import type { OpsData } from '@core/types'

export function seedOps({ today = '2026-09-30' } = {}): OpsData {
  return seedDemoOps({ today })
}
