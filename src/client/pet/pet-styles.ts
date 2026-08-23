/**
 * Pet overlay stylesheet: injected once (single client bundle, no CSS artifact).
 */
import { apThemesCss } from './ap-themes.ts'

export const STYLE_ID = 'dsh-session-desk-pet-style'

export const cssText = `
.dsd-pet-layer {
  position: fixed;
  inset: 0;
  z-index: 240;
  pointer-events: none;
}
body:has([aria-modal="true"]) .dsd-pet-layer {
  display: none;
}
.dsd-pet-layer[data-shell] .dsd-pet__hit,
.dsd-pet-layer[data-shell] .dsd-pet__callout,
.dsd-pet-layer[data-shell] .dsd-pet__mode-menu,
.dsd-pet-layer[data-shell] .dsd-pet__preparing {
  pointer-events: auto;
}
.dsd-pet-layer[data-shell] {
  overflow: visible;
}
.dsd-pet-layer[data-shell] .dsd-pet {
  pointer-events: none;
  overflow: visible;
}
.dsd-pet-layer[data-shell] .dsd-pet__callout {
  max-height: min(220px, calc(100vh - 220px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dsd-pet__callout[data-anchor="above"] {
  transform: translate(-50%, 0);
}
.dsd-pet {
  position: fixed;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
  pointer-events: none;
  display: grid;
  place-items: center;
  overflow: visible;
  touch-action: none;
  user-select: none;
  contain: layout;
}
.dsd-pet:active {
  cursor: grabbing;
}
.dsd-pet__hit {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 52%;
  height: 72%;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: grab;
  z-index: 1;
}
.dsd-pet[data-kind="running"] .dsd-pet__art,
.dsd-pet[data-kind="subagent"] .dsd-pet__art {
  animation: dsd-pet-bob 2.4s ease-in-out infinite;
}
.dsd-pet[data-kind="awaiting"] .dsd-pet__art {
  filter: drop-shadow(0 0 6px #f59e0b);
}
.dsd-pet[data-kind="error"] .dsd-pet__art {
  filter: drop-shadow(0 0 6px #ef4444);
}
.dsd-pet__art,
.dsd-pet__art img,
.dsd-pet__art video,
.dsd-pet__art svg {
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
.dsd-pet__art {
  position: relative;
}
.dsd-pet__art svg {
  pointer-events: visiblePainted;
  cursor: grab;
}
.dsd-pet__art img,
.dsd-pet__art video {
  pointer-events: none;
}
.dsd-pet__art img {
  object-fit: contain;
}
.dsd-pet__art video {
  object-fit: contain;
}
.dsd-pet__art img[src$="whale.png"] {
  animation: dsd-pet-float 3.2s ease-in-out infinite;
}
.dsd-pet__layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
}
.dsd-pet__layer--on {
  opacity: 1;
}
.dsd-pet__callout {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  max-width: min(320px, calc(100vw - 24px));
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.3;
  font-weight: 600;
  color: #fff;
  background: #1e3a8a;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.22);
}
.dsd-pet__callout__head {
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
  background: inherit;
}
.dsd-pet__callout__toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  border-radius: 4px;
}
.dsd-pet__callout__toggle:hover {
  background: rgba(255, 255, 255, 0.14);
}
.dsd-pet__callout__chevron {
  flex: 0 0 auto;
  opacity: 0.85;
}
.dsd-pet__callout__sub {
  font-weight: 500;
  opacity: 0.92;
  white-space: nowrap;
}
.dsd-pet__callout__item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  border-radius: 4px;
}
.dsd-pet__callout__item:hover {
  background: rgba(255, 255, 255, 0.14);
}
.dsd-pet__mode-menu {
  position: fixed;
  transform: translate(-50%, 0);
  pointer-events: auto;
  z-index: 250;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 132px;
  padding: 8px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.92);
  color: #fff;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.28);
}
.dsd-pet__mode-menu__title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.7;
  padding: 0 4px 2px;
}
.dsd-pet__mode-menu__item {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.dsd-pet__mode-menu__item:hover,
.dsd-pet__mode-menu__item[data-selected] {
  background: rgba(255, 255, 255, 0.16);
}
.dsd-pet__callout::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 100%;
  translate: -50% 0;
  border: 6px solid transparent;
  border-top-color: #1e3a8a;
  border-bottom-width: 0;
}
.dsd-pet__callout[data-kind="awaiting"] { background: #b45309; }
.dsd-pet__callout[data-kind="awaiting"]::after { border-top-color: #b45309; }
.dsd-pet__callout[data-kind="error"] { background: #b91c1c; }
.dsd-pet__callout[data-kind="error"]::after { border-top-color: #b91c1c; }
.dsd-pet__callout[data-kind="running"] { background: #1e3a8a; }
.dsd-pet__callout[data-kind="running"]::after { border-top-color: #1e3a8a; }
.dsd-pet__callout[data-kind="subagent"] { background: #1e3a8a; }
.dsd-pet__callout[data-kind="subagent"]::after { border-top-color: #1e3a8a; }
.dsd-pet__callout[data-kind="idle"] {
  pointer-events: none;
}
.dsd-pet__callout[data-kind="error"] { pointer-events: none; }
.dsd-pet__callout[data-celebrating] { pointer-events: auto; }
.dsd-pet__callout[data-below] { transform: translate(-50%, 0); }
.dsd-pet__callout[data-below]::after {
  top: auto;
  bottom: 100%;
  border-top-width: 0;
  border-bottom-width: 6px;
  border-bottom-color: #1e3a8a;
}
.dsd-pet__callout[data-below][data-kind="awaiting"]::after { border-bottom-color: #b45309; }
.dsd-pet__callout[data-below][data-kind="error"]::after { border-bottom-color: #b91c1c; }
.dsd-pet__callout[data-below][data-kind="running"]::after { border-bottom-color: #1e3a8a; }
.dsd-pet__callout[data-below][data-kind="subagent"]::after { border-bottom-color: #1e3a8a; }
.dsd-pet__preparing {
  position: absolute;
  left: 50%;
  top: calc(100% + 10px);
  translate: -50% 0;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(30, 41, 59, 0.85);
  color: #e2e8f0;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.dsd-pet__preparing[data-kind="error"] {
  background: rgba(185, 28, 28, 0.9);
}
.dsd-pet__cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  padding-top: 6px;
  white-space: normal;
  max-height: 168px;
  overflow-y: auto;
}
.dsd-pet__card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
}
.dsd-pet__card__head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-weight: 600;
}
.dsd-pet__card__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsd-pet__card__label {
  font-weight: 500;
  opacity: 0.9;
  white-space: nowrap;
}
.dsd-pet__card__pct {
  font-weight: 700;
  white-space: nowrap;
}
.dsd-pet__card__bar {
  position: relative;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.28);
}
.dsd-pet__card__bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: linear-gradient(90deg, #3b82f6, #22d3ee);
  transition: width 0.5s ease;
}
.dsd-pet__card[data-phase="error"] .dsd-pet__card__bar > span { background: linear-gradient(90deg, #ef4444, #f97316); }
.dsd-pet__card[data-phase="tool"] .dsd-pet__card__bar > span { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.dsd-pet__card__stats {
  display: flex;
  gap: 8px;
  font-size: 10px;
  font-weight: 500;
  opacity: 0.85;
  white-space: nowrap;
}
.dsd-pet__card__trace {
  list-style: none;
  margin: 2px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
}
.dsd-pet__card__trace li {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.dsd-pet__card__dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #60a5fa;
  animation: dsd-pet-card-pulse 1.4s ease-in-out infinite;
}
.dsd-pet__card__trace li[data-status="done"] .dsd-pet__card__dot {
  background: #34d399;
  animation: none;
}
.dsd-pet__card__trace li[data-status="error"] .dsd-pet__card__dot {
  background: #f87171;
  animation: none;
}
.dsd-pet__card__trace-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsd-pet__card__trace-detail {
  flex: 0 0 auto;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.78;
}
.dsd-pet__card__trace-time {
  flex: 0 0 auto;
  opacity: 0.7;
  white-space: nowrap;
}
@keyframes dsd-pet-card-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.55); }
  50% { box-shadow: 0 0 0 4px rgba(96, 165, 250, 0); }
}
@keyframes dsd-pet-bob {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -4px; }
}
@keyframes dsd-pet-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.dsd-whale {
  display: block;
  transform-origin: 50% 70%;
}
.dsd-whale[data-variant="idle"],
.dsd-whale[data-variant="breath"],
.dsd-whale[data-variant="bubble"] {
  animation: dsd-whale-breath 2.6s ease-in-out infinite;
}
.dsd-whale[data-variant="wag"] {
  animation: dsd-whale-wag 1.8s ease-in-out infinite;
}
.dsd-whale[data-variant="turn"] {
  animation: dsd-whale-turn 3s ease-in-out infinite;
}
.dsd-whale[data-variant="run"] {
  animation: dsd-whale-run 0.7s ease-in-out infinite;
}
.dsd-whale[data-variant="shake"] {
  animation: dsd-whale-shake 0.5s ease-in-out infinite;
}
.dsd-whale[data-variant="swim"] {
  animation: dsd-whale-swim 2.2s ease-in-out infinite;
}
.dsd-whale__bubble {
  opacity: 0;
}
.dsd-whale[data-variant="bubble"] .dsd-whale__bubble {
  animation: dsd-whale-bubble 1.6s ease-out infinite;
}
@keyframes dsd-whale-breath {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.06, 0.94); }
}
@keyframes dsd-whale-wag {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}
@keyframes dsd-whale-turn {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-9deg); }
  75% { transform: rotate(9deg); }
}
@keyframes dsd-whale-run {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes dsd-whale-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-3px); }
  40%, 80% { transform: translateX(3px); }
}
@keyframes dsd-whale-swim {
  0%, 100% { transform: translateX(-3px) rotate(-2deg); }
  50% { transform: translateX(3px) rotate(2deg); }
}
@keyframes dsd-whale-bubble {
  0% { opacity: 0; transform: translate(0, 6px) scale(0.4); }
  30% { opacity: 0.9; }
  100% { opacity: 0; transform: translate(0, -14px) scale(1); }
}
`

export function adoptPetStyles(): void {
  if (typeof document === 'undefined') return
  const next = `${cssText}\n${apThemesCss()}`
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.dataset.plugin = 'dsh-session-desk'
    style.dataset.pluginCss = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== next) style.textContent = next
}
