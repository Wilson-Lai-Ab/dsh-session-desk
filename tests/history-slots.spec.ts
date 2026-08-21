import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { SessionDeskSettings } from '../src/shared.ts'
import {
  canTakeLoadOlderBatch,
  conversationEdgeStyle,
  historySlotsActive,
  historySlotsWanted,
  MAX_LOAD_OLDER_BATCHES,
  pagerIdentity,
  resetBatchesIfIdentityChanged,
} from '../src/history/minimap-control.ts'

describe('historySlotsActive', () => {
  it('is true only for left and right (off unregisters slots)', () => {
    expect(historySlotsActive('off')).toBe(false)
    expect(historySlotsActive('left')).toBe(true)
    expect(historySlotsActive('right')).toBe(true)
    expect(historySlotsActive(undefined)).toBe(false)
  })

  it('treats a missing snapshot field as the default right dock', () => {
    expect(historySlotsWanted(undefined)).toBe(true)
    expect(historySlotsWanted('right')).toBe(true)
    expect(historySlotsWanted('off')).toBe(false)
  })
})

describe('conversationEdgeStyle', () => {
  it('docks the right strip inside the conversation column, not the viewport', () => {
    // sidebar 280 | conversation 280–900 | details 900–1400
    expect(conversationEdgeStyle('right', { left: 280, right: 900 }, 1400, 8)).toEqual({ right: 508 })
    expect(conversationEdgeStyle('left', { left: 280, right: 900 }, 1400, 8)).toEqual({ left: 288 })
  })
})

describe('loadOlder pager identity', () => {
  it('resets the batch counter when the session identity changes', () => {
    let state = { identity: pagerIdentity('a', 'right', 10), loaded: MAX_LOAD_OLDER_BATCHES }
    expect(canTakeLoadOlderBatch(state.loaded)).toBe(false)
    state = resetBatchesIfIdentityChanged(state, pagerIdentity('b', 'right', 10))
    expect(state.loaded).toBe(0)
    expect(canTakeLoadOlderBatch(state.loaded)).toBe(true)
  })

  it('keeps the counter when session, position, and limit are unchanged', () => {
    const identity = pagerIdentity('a', 'right', 10)
    const next = resetBatchesIfIdentityChanged({ identity, loaded: 7 }, identity)
    expect(next.loaded).toBe(7)
  })

  it('stops after the hard batch cap', () => {
    expect(canTakeLoadOlderBatch(MAX_LOAD_OLDER_BATCHES - 1)).toBe(true)
    expect(canTakeLoadOlderBatch(MAX_LOAD_OLDER_BATCHES)).toBe(false)
  })
})

describe('client inject', () => {
  it('declares settingsScope so history scope is ready at apply (rc.7+)', () => {
    expect(inject).toContain('settingsScope')
    expect(inject).toContain('connection')
    expect(inject).toContain('remote')
    expect(inject).not.toContain('settings')
  })

  it('lists ui-slots in package.json dsh.client.inject so ctx.slots is wired', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { client: { inject: string[] } }
    }
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-runtime')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-locale')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-connection')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-api-remotes')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-slots')
    expect(pkg.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-conversation')
  })
})

function fakeClient(position: SessionDeskSettings['historyPosition'] | undefined, boardTab = true, petEnabled = true) {
  const injected: string[] = []
  const listeners: Array<() => void> = []
  const value: Partial<SessionDeskSettings> = { pinnedTurns: {}, boardTab, petEnabled }
  if (position !== undefined) value.historyPosition = position
  const boundScope = {
    getSnapshot: () => ({ value }),
    subscribe: (fn: () => void) => {
      listeners.push(fn)
      return () => {}
    },
    set: async () => {},
    unset: async () => {},
  }
  return {
    injected,
    overlayCount() {
      return injected.filter(name => name === 'shell.overlay').length
    },
    setPosition(next: SessionDeskSettings['historyPosition']) {
      value.historyPosition = next
      for (const fn of listeners) fn()
    },
    setBoardTab(next: boolean) {
      value.boardTab = next
      for (const fn of listeners) fn()
    },
    setPetEnabled(next: boolean) {
      value.petEnabled = next
      for (const fn of listeners) fn()
    },
    ctx: {
      effect(fn: () => (() => void) | void) {
        fn()
      },
      locale: {
        register: () => () => {},
        bind: () => (key: string) => key,
      },
      slots: {
        inject(name: string) {
          injected.push(name)
          return () => {
            const index = injected.lastIndexOf(name)
            if (index >= 0) injected.splice(index, 1)
          }
        },
        register() {
          return {}
        },
      },
      sessions: {},
      settingsScope: {
        bind: () => boundScope,
      },
    },
  }
}

describe('history slot registration', () => {
  it('occupies the minimap when the settings snapshot has not hydrated historyPosition', () => {
    const harness = fakeClient(undefined)
    apply(harness.ctx)
    expect(harness.injected).toContain('details')
    expect(harness.injected).toContain('conversation.chat.assistant-actions')
  })

  it('does not inject details or pin when historyPosition is off', () => {
    const harness = fakeClient('off')
    apply(harness.ctx)
    expect(harness.injected).not.toContain('details')
    expect(harness.injected).not.toContain('conversation.chat.assistant-actions')
  })

  it('unregisters details and pin when historyPosition flips to off', () => {
    const harness = fakeClient('right')
    apply(harness.ctx)
    expect(harness.injected).toContain('details')
    expect(harness.injected).toContain('conversation.chat.assistant-actions')
    harness.setPosition('off')
    expect(harness.injected).not.toContain('details')
    expect(harness.injected).not.toContain('conversation.chat.assistant-actions')
  })
})

describe('board slot registration', () => {
  it('injects conversation.view when boardTab is true (default)', () => {
    const harness = fakeClient('off')
    apply(harness.ctx)
    expect(harness.injected).toContain('conversation.view')
  })

  it('does not inject conversation.view when boardTab is false', () => {
    const harness = fakeClient('off', false)
    apply(harness.ctx)
    expect(harness.injected).not.toContain('conversation.view')
  })

  it('unregisters conversation.view when boardTab flips to false', () => {
    const harness = fakeClient('off', true)
    apply(harness.ctx)
    expect(harness.injected).toContain('conversation.view')
    harness.setBoardTab(false)
    expect(harness.injected).not.toContain('conversation.view')
  })
})

describe('pet slot registration', () => {
  it('injects shell.overlay pet when petEnabled is true (default)', () => {
    const harness = fakeClient('off', true, true)
    apply(harness.ctx)
    // preview overlay is always present; pet adds a second shell.overlay
    expect(harness.overlayCount()).toBe(2)
  })

  it('does not inject the pet overlay when petEnabled is false', () => {
    const harness = fakeClient('off', true, false)
    apply(harness.ctx)
    expect(harness.overlayCount()).toBe(1)
  })

  it('unregisters the pet overlay when petEnabled flips to false', () => {
    const harness = fakeClient('off', true, true)
    apply(harness.ctx)
    expect(harness.overlayCount()).toBe(2)
    harness.setPetEnabled(false)
    expect(harness.overlayCount()).toBe(1)
  })
})
