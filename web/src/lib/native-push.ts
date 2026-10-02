import { registerPlugin } from '@capacitor/core'
import type { FirebaseMessagingPlugin } from '@capacitor-firebase/messaging'

// Use the native bridge only. Browser push uses the standard Push API and has no Firebase JS dependency.
export const FirebaseMessaging = registerPlugin<FirebaseMessagingPlugin>('FirebaseMessaging')
