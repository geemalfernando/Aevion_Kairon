/**
 * Demo mode (VITE_DEMO_MODE=true, the docker compose build for judges). Off in production, where every switch below
 * is inert. In demo mode, URL switches make every screen state reachable by link:
 *
 *   ?demo=<preset>   open a sandboxed copy of the operation in that state (nothing is saved or synced)
 *   ?frame=1         hide presenter-only chrome (demo dock, install prompt, toasts, splash)
 *   ?theme=dark|light, ?lang=en|si|ta, ?modal=<name>, ?stop=<outlet>, ?day=<yyyy-mm-dd>
 */
export const DEMO = import.meta.env.VITE_DEMO_MODE === 'true'
const params = !DEMO || typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search)

export const PRESET = params.get('demo')
export const PREVIEW = !!PRESET
export const FRAME = params.has('frame')
export const THEME_OVERRIDE = (params.get('theme') as 'light' | 'dark' | null) ?? null
export const LANG_OVERRIDE = params.get('lang')
/** A dialog to open on load, e.g. ?modal=shortfall or ?modal=move-stop. */
export const MODAL = params.get('modal')
/** Which stop a stop-level dialog opens on, by outlet id, e.g. ?modal=move-stop&stop=OUT005. */
export const STOP = params.get('stop')
/** Pin the demo's ordering day, e.g. ?day=2026-09-27, so screenshots taken on different days match. */
export const DAY = params.get('day')
