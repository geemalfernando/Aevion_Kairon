/**
 * URL switches that make every screen state reachable by link — for judges' deep links and for importing
 * each state into Figma with html.to.design.
 *
 *   ?demo=<preset>   open a sandboxed copy of the operation in that state (nothing is saved or synced)
 *   ?frame=1         hide presenter-only chrome (demo pill, install prompt, toasts, splash)
 *   ?theme=dark|light, ?lang=en|si|ta, ?modal=<name>
 */
const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)

export const PRESET = params.get('demo')
export const PREVIEW = !!PRESET
export const FRAME = params.has('frame')
export const THEME_OVERRIDE = (params.get('theme') as 'light' | 'dark' | null) ?? null
export const LANG_OVERRIDE = params.get('lang')
/** A dialog to open on load, e.g. ?modal=shortfall or ?modal=move-stop. */
export const MODAL = params.get('modal')
/** Which stop a stop-level dialog opens on, by outlet id, e.g. ?modal=move-stop&stop=OUT032. */
export const STOP = params.get('stop')
/** Pin the demo's ordering day, e.g. ?day=2026-09-27, so screenshots taken on different days match. */
export const DAY = params.get('day')
