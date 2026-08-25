/**
 * Board-tab stylesheet: injected once (single client bundle, no CSS artifact).
 */

export const STYLE_ID = 'dsh-session-desk-board-style'

export const cssText = `
.dsd-board {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--dsh-chat-content-width, 760px);
  margin: 0 auto;
  padding: 16px 20px 32px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsd-board__toggle {
  display: inline-flex;
  gap: 6px;
  align-self: flex-start;
}
.dsd-board__toggle button {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  color: inherit;
  border-radius: 999px;
  padding: 4px 12px;
  cursor: pointer;
}
.dsd-board__toggle button[aria-pressed="true"] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsd-board__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  gap: 8px;
}
.dsd-board__card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsd-board__card-label {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.dsd-board__card-value {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsd-board__section {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  padding: 10px 12px;
}
.dsd-board__section h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.dsd-board__empty {
  color: var(--dsw-alias-label-tertiary);
  margin: 8px 0 0;
}
.dsd-board__rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.dsd-board__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.dsd-board__row span:last-child {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsd-board__note {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  margin-top: 6px;
}
.dsd-board__sub {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsd-board__sub h4 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dsd-chart { display: flex; gap: 6px; margin: 4px 0 2px; }
.dsd-chart--cols { height: 96px; align-items: flex-end; }
.dsd-chart__col {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 3px;
}
.dsd-chart__col-bar {
  width: 100%;
  max-width: 28px;
  border-radius: 4px 4px 0 0;
  background: var(--dsw-alias-brand-primary, #4176e6);
  min-height: 2px;
}
.dsd-chart__col-ttft {
  position: absolute;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--dsw-alias-warning, #f59e0b);
}
.dsd-chart__col-x {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #94a3b8);
  line-height: 1;
}
.dsd-chart--bars { flex-direction: column; align-items: stretch; }
.dsd-chart__bar-row {
  display: grid;
  grid-template-columns: 96px 1fr auto;
  gap: 8px;
  align-items: center;
}
.dsd-chart__bar-label {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #475569);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsd-chart__bar-track {
  height: 10px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2, #f1f5f9);
  overflow: hidden;
}
.dsd-chart__bar-fill {
  height: 100%;
  border-radius: 5px;
  background: var(--dsw-alias-brand-primary, #4176e6);
}
.dsd-chart__bar-value {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #94a3b8);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dsd-chart__donut-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0 2px;
}
.dsd-chart__donut {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
}
.dsd-chart__donut::before {
  content: "";
  position: absolute;
  inset: 15px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-3, #ffffff);
}
.dsd-chart__donut-center {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dsd-chart__legend { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.dsd-chart__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #475569);
}
.dsd-chart__legend-item i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
.dsd-chart__phase {
  display: flex;
  height: 14px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2, #f1f5f9);
  margin: 4px 0 8px;
}
.dsd-chart__phase-seg {
  flex-basis: 0;
  min-width: 2px;
  height: 100%;
}
.dsd-board__map {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsd-board__map-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 8px 10px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, #f1f5f9);
  scrollbar-width: thin;
}
.dsd-board__map-btn {
  flex: none;
  margin: 0;
  padding: 6px 2px;
  border: 0;
  background: transparent;
  cursor: pointer;
  line-height: 0;
}
.dsd-board__dash {
  display: block;
  width: 12px;
  height: 3px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2, #cbd5e1);
}
.dsd-board__map-btn:hover .dsd-board__dash {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 55%, var(--dsw-alias-border-l2, #cbd5e1));
}
.dsd-board__map-btn[aria-selected="true"] .dsd-board__dash {
  width: 16px;
  background: var(--dsw-alias-brand-primary, #4176e6);
}
.dsd-board__map-caption {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-height: 16px;
}
`

export function adoptBoardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-session-desk'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
}
