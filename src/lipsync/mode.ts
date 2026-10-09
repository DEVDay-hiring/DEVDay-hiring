export type LipSyncMode = 'photo' | 'musetalk' | 'off'

const configured = import.meta.env.VITE_LIPSYNC_MODE?.trim().toLowerCase()
export const lipSyncMode: LipSyncMode = configured === 'musetalk' || configured === 'off' ? configured : 'photo'
