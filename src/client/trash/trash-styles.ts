/**
 * Trash footer action + flying drop target stylesheet: injected once.
 *
 * The drop target is a fixed element anchored at `--tx/--ty` (the center drop
 * spot); the `--fx/--fy` custom properties carry the footer→target offset so
 * the fly-in/out keyframes animate the trash from the footer button to the
 * center and back. Hover scale lives on the inner core so it never fights the
 * outer transform animation.
 */

export const STYLE_ID = 'dsh-session-desk-trash-style'

export const cssText = `
.dsd-trash-foot {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.dsd-trash-foot:hover { background: var(--dsw-alias-bg-layer-2); }
.dsd-trash-foot:active { transform: scale(0.96); }
.dsd-trash-foot__icon { font-size: 22px; line-height: 1; }
.dsd-trash-foot__label { font-size: 13px; font-weight: 500; }

.dsd-trash-pop {
  position: fixed;
  z-index: 10000;
  width: 300px;
  max-height: 320px;
  overflow-y: auto;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  color: var(--dsw-alias-label-primary);
  padding: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.dsd-trash-pop__empty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  padding: 8px 4px;
}
.dsd-trash-pop__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsd-trash-pop__row:last-of-type { border-bottom: none; }
.dsd-trash-pop__meta { flex: 1; min-width: 0; }
.dsd-trash-pop__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsd-trash-pop__sub {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  margin-top: 2px;
}
.dsd-trash-pop__row button,
.dsd-trash-pop__all {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  color: inherit;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}
.dsd-trash-pop__row button:hover { background: var(--dsw-alias-bg-layer-2); }
.dsd-trash-pop__all {
  display: block;
  width: 100%;
  margin-top: 6px;
  color: var(--dsw-alias-danger, #dc2626);
}
.dsd-trash-pop__notice {
  margin-top: 6px;
  font-size: 11px;
  color: var(--dsw-alias-danger, #dc2626);
}

/* Flying drop target: anchored at the center spot, flies in from the footer. */
.dsd-trash-target {
  position: fixed;
  z-index: 10001;
  left: var(--tx, 50vw);
  top: var(--ty, 50vh);
  width: 160px;
  height: 160px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: dsd-trash-fly-in 300ms cubic-bezier(0.2, 0.9, 0.3, 1.15) forwards;
}
.dsd-trash-target--back { animation: dsd-trash-fly-back 240ms ease forwards; }
.dsd-trash-target--swallowed { animation: dsd-trash-swallow 460ms ease forwards; }
.dsd-trash-target__core {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 50%;
  /* Frosted glass drop plate: translucent tint + backdrop blur so the workspace
     behind blurs through, with an asymmetric glass rim (bright top edge, faint
     dark bottom). The blur/tint/saturate come from the configurable trashGlass
     level via CSS variables (defaults = frosted); the first background line is
     the fallback for browsers without CSS-variable alpha support. */
  background: radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.10) 82%);
  background: radial-gradient(
    circle at 50% 30%,
    rgba(255, 255, 255, var(--dsd-trash-alpha-c, 0.24)) 0%,
    rgba(255, 255, 255, var(--dsd-trash-alpha-e, 0.10)) 82%
  );
  -webkit-backdrop-filter: blur(var(--dsd-trash-blur, 16px)) saturate(var(--dsd-trash-saturate, 1.5));
  backdrop-filter: blur(var(--dsd-trash-blur, 16px)) saturate(var(--dsd-trash-saturate, 1.5));
  border: 1px solid rgba(255, 255, 255, 0.42);
  box-shadow:
    0 12px 34px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -1px 0 rgba(0, 0, 0, 0.05);
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.dsd-trash-target--active .dsd-trash-target__core {
  transform: scale(1.15);
  box-shadow:
    0 18px 52px rgba(0, 0, 0, 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 -1px 0 rgba(0, 0, 0, 0.05);
}
.dsd-trash-target__icon { font-size: 62px; line-height: 1; filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.2)); }
.dsd-trash-target__hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-weight: 500; }

/* Paper ball: crumple into a ball, arc up, then drop into the trash center. */
.dsd-trash-paper {
  position: fixed;
  z-index: 10002;
  width: 46px;
  height: 58px;
  margin: -23px 0 0 -29px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-overlay, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  animation: dsd-paper-crumple 640ms cubic-bezier(0.35, 0.1, 0.45, 1) forwards;
}
@keyframes dsd-trash-fly-in {
  from {
    transform: translate(calc(-50% + var(--fx, 0px)), calc(-50% + var(--fy, 0px))) scale(0.3);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}
@keyframes dsd-trash-fly-back {
  from {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
  to {
    transform: translate(calc(-50% + var(--fx, 0px)), calc(-50% + var(--fy, 0px))) scale(0.3);
    opacity: 0;
  }
}
@keyframes dsd-trash-swallow {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  35% { transform: translate(-50%, -50%) scale(1.18); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(0.04); opacity: 0; }
}
@keyframes dsd-paper-crumple {
  0% {
    transform: translate(0, 0) scale(1) rotate(0deg);
    border-radius: 6px;
    opacity: 1;
  }
  30% {
    transform: translate(calc(var(--dx) * 0.3), calc(var(--dy) * 0.3 - 90px)) scale(0.62) rotate(170deg);
    border-radius: 48%;
    opacity: 1;
  }
  100% {
    transform: translate(var(--dx), var(--dy)) scale(0.1) rotate(760deg);
    border-radius: 50%;
    opacity: 0;
  }
}
`

export function adoptTrashStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-session-desk'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
}
