/** Test fixture: the placeholder network now lives in core/src/demo.ts, shared with the demo seed and the web demo states. */
import { buildDemoReference } from '@core/demo'
export * from '@core/demo'
export const buildReference = buildDemoReference
