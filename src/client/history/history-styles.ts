/**
 * History-minimap stylesheet: injected once (single client bundle, no CSS artifact).
 */

export const STYLE_ID = 'dsh-session-desk-history-style'

export const cssText = `
.dsd-minimap {
  position: fixed;
  top: 50%;
  translate: 0 -50%;
  z-index: 230;
  box-sizing: border-box;
  padding: 12px;
  pointer-events: auto;
  max-height: calc(100vh - 96px);
}
.dsd-minimap--right {
  /* Fallback until the conversation column is measured. */
  right: 0;
  display: flex;
  justify-content: flex-end;
}
.dsd-minimap--left {
  left: 0;
  display: flex;
  justify-content: flex-start;
}
.dsd-minimap__capsule {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 28px;
  max-height: calc(100vh - 120px);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 0;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 1px 10px rgba(15, 23, 42, 0.12);
  transition: width 180ms ease, padding 180ms ease;
}
.dsd-minimap--right .dsd-minimap__capsule {
  align-items: flex-end;
  padding-right: 8px;
  padding-left: 8px;
}
.dsd-minimap--left .dsd-minimap__capsule {
  align-items: flex-start;
  padding-left: 8px;
  padding-right: 8px;
}
.dsd-minimap--open .dsd-minimap__capsule {
  width: min(280px, 46vw);
  padding-left: 10px;
  padding-right: 10px;
}
.dsd-minimap__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, #475569);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: inherit;
}
.dsd-minimap--right .dsd-minimap__row {
  justify-content: flex-end;
  flex-direction: row;
}
.dsd-minimap--left .dsd-minimap__row {
  justify-content: flex-start;
  flex-direction: row;
}
.dsd-minimap__dash {
  flex: none;
  width: 10px;
  height: 2px;
  border-radius: 1px;
  background: #cbd5e1;
}
.dsd-minimap__row--current .dsd-minimap__dash {
  background: var(--dsw-alias-brand-primary, #4176e6);
}
.dsd-minimap__row--pinned .dsd-minimap__dash {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 45%, transparent);
}
.dsd-minimap__q {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsd-minimap--right .dsd-minimap__q {
  text-align: right;
}
.dsd-minimap--left .dsd-minimap__q {
  text-align: left;
}
.dsd-minimap__row--current .dsd-minimap__q {
  color: var(--dsw-alias-brand-primary, #4176e6);
  font-weight: 600;
}
.dsd-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 6px;
  border: none;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #94a3b8);
  cursor: pointer;
}
.dsd-pin:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.06));
  color: var(--dsw-alias-label-secondary, #475569);
}
.dsd-pin[data-active] {
  color: var(--dsd-accent, var(--dsw-alias-brand-primary, #4176e6));
}
`

export function adoptHistoryStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-session-desk'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
}
