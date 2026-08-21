/**
 * Built-in DeepSeek whale (inline SVG, no network). Used when petImage is empty
 * or rejected by the wallpaper URL whitelist.
 */
export const WHALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
  <ellipse cx="24" cy="26" rx="16" ry="11" fill="#4aa3e8"/>
  <path d="M10 24c-4 1-7 5-7 8 3-1 6-1 8 0 1-3 1-6-1-8z" fill="#3b8fd4"/>
  <path d="M36 20c4-6 10-8 12-7-2 4-2 8 0 11-4 0-8-1-12-4z" fill="#3b8fd4"/>
  <ellipse cx="18" cy="23" rx="2" ry="2.2" fill="#16324d"/>
  <ellipse cx="17.4" cy="22.4" rx=".7" ry=".7" fill="#fff"/>
  <path d="M16 29c3 2 8 2 11 0" fill="none" stroke="#16324d" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M22 16c1-4 4-7 7-8-1 3 0 6 2 8" fill="#7ec4f5"/>
  <circle cx="33" cy="28" r="1.4" fill="#7ec4f5"/>
</svg>`
