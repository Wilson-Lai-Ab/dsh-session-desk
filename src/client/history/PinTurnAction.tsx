/**
  * Per-assistant-message pin toggle. Pinned turns ignore the minimap count limit.
  */
import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS, type SessionDeskSettings } from '../../shared.ts'
import { adoptHistoryStyles } from './history-styles.ts'

interface SettingsSnapshot {
  value?: SessionDeskSettings
}

export interface PinTurnActionProps {
  turn?: number
  sessionId?: string
  usePosition?: <T>(select: (snapshot: SettingsSnapshot) => T) => T
  usePinnedTurns?: <T>(select: (snapshot: SettingsSnapshot) => T) => T
  useScope?: <T>(select: (snapshot: SettingsSnapshot) => T) => T
  togglePin?: (turn: number) => void
  t?: (key: string) => string
}

function PinIcon(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
        fill="currentColor"
      />
    </svg>
  )
}

export function PinTurnAction(props: PinTurnActionProps): ReactNode {
  adoptHistoryStyles()
  const read = props.useScope ?? props.usePosition
  const pinnedRead = props.usePinnedTurns ?? props.useScope
  const position = (read?.(snapshot => snapshot.value?.historyPosition) ?? DEFAULT_SETTINGS.historyPosition)
  const sessionId = props.sessionId ?? ''
  const turn = props.turn
  const pinnedList = pinnedRead?.(snapshot => snapshot.value?.pinnedTurns?.[sessionId]) ?? []
  const pinned = typeof turn === 'number' && pinnedList.includes(turn)
  if (position === 'off' || typeof turn !== 'number') return null
  const label = pinned
    ? (props.t?.('pin.active') ?? 'Unpin')
    : (props.t?.('pin.pin') ?? 'Pin')
  return (
    <button
      type="button"
      className="dsd-pin"
      aria-label={label}
      aria-pressed={pinned}
      data-active={pinned || undefined}
      title={label}
      onClick={() => { props.togglePin?.(turn) }}
    >
      <PinIcon />
    </button>
  )
}
