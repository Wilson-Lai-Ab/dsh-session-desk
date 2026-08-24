/**
 * Host-side writer for desktop-pet HTTP patches. Always wait for the
 * settings-scope `update` so a close cannot beat persistence.
 */
import type { SessionDeskSettings } from '../shared.ts'

export function bindPetSettingWriter(
  update: ((patch: Partial<SessionDeskSettings>) => unknown) | undefined,
): (patch: Partial<SessionDeskSettings>) => Promise<void> {
  if (typeof update !== 'function') return () => Promise.resolve()
  return async (patch) => {
    await update(patch)
  }
}
