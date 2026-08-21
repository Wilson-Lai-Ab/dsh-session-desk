/**
 * Preview-mode visibility store for the floating F2 hint overlay.
 * `exit` hides the bar and restores the last saved theme (Cancel preview).
 */

const state = {
  visible: false,
  restore: undefined as (() => void) | undefined,
  listeners: new Set<() => void>(),
}

const notify = (): void => {
  for (const listener of [...state.listeners]) listener()
}

/** HostObservable<boolean> face the preview bar entry binds. */
export const previewBar = {
  getSnapshot: (): boolean => state.visible,
  subscribe: (listener: () => void): (() => void) => {
    state.listeners.add(listener)
    return () => { state.listeners.delete(listener) }
  },
  /** Register the restore callback used by F2 / overlay exit. */
  setRestore: (restore: (() => void) | undefined): void => {
    state.restore = restore
  },
  show: (): void => {
    state.visible = true
    notify()
  },
  hide: (): void => {
    if (!state.visible) return
    state.visible = false
    notify()
  },
  /** Hide the hint and re-apply the last saved theme. */
  exit: (): void => {
    const restore = state.restore
    state.visible = false
    notify()
    restore?.()
  },
}
