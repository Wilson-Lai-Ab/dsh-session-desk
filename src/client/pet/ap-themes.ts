/**
 * Answer-pet PetTheme v1 themes, ported from dsh-answer-pet (MIT, Nanki-nn).
 *
 * Each theme is a declarative SVG `markup` + scoped `css` + per-phase
 * `animation`/`bubble` metadata. The original themes key animations off
 * `[data-answer-pet][data-ap-theme=...][data-ap-phase=...]` and
 * `[data-ap-click-blink]`; we re-scope the leading host selector to `.dsd-pet`
 * so the same SVG + CSS drives the pet inside the existing dsh-session-desk
 * overlay shell. The silver-shaded cat uses a served PNG (not inline base64) —
 * rendered through an <image> element whose URL is the served asset.
 */
import type { PetKind } from './status.ts'

/** Phases a theme can be in (mirrors answer-pet's PET_PHASES). */
export const AP_PHASES = {
  IDLE: 'idle', TURN: 'turn', THINK: 'think', STREAM: 'stream',
  TOOL: 'tool', DONE: 'done', ERROR: 'error',
} as const
export type ApPhase = typeof AP_PHASES[keyof typeof AP_PHASES]

/** One theme phase: which normalized animation + bubble text to show. */
export interface ApPhaseMeta {
  animation: string
  bubble: string | null
}

export interface ApThemeModel {
  id: string
  name: string
  /** Container width / height ratio. */
  aspect: number
  /** SVG markup. Class `ap-pet-svg` marks the root so the CSS animation arms. */
  markup: string
  /** Theme-scoped CSS (host ruled via `.dsd-pet[data-ap-theme=...]`). */
  css: string
  phases: Record<ApPhase, ApPhaseMeta>
}

const SILVER_CAT_ASSET = '/session-desk/assets/pet/silver-cat-cropped.png'

const BLUE_WHALE: ApThemeModel = {
  id: 'blue-whale',
  name: '蓝鲸',
  aspect: 200 / 120,
  markup: `<svg class="ap-pet-svg ap-whale-svg" viewBox="0 0 200 120" aria-hidden="true">
  <defs>
    <linearGradient id="apWhaleBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#63A9D0"/><stop offset=".48" stop-color="#3D86B7"/><stop offset="1" stop-color="#276B9D"/>
    </linearGradient>
    <linearGradient id="apWhaleFin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#448FBE"/><stop offset="1" stop-color="#245F90"/>
    </linearGradient>
    <clipPath id="apBellyClip"><path d="M13 70 C31 78 48 79 66 77 C86 75 99 68 109 62 C113 83 122 96 140 100 C123 111 99 116 72 114 C39 113 18 100 11 82 Z"/></clipPath>
  </defs>
  <g class="ap-tail">
    <path d="M153 65 C154 50 149 34 147 21 C160 27 169 38 169 50 C177 40 188 35 198 34 C195 50 184 61 169 66 C163 68 158 68 152 65 Z" fill="url(#apWhaleFin)" stroke="#174F7C" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M168 50 C170 55 170 61 169 66" fill="none" stroke="#72B6D8" stroke-width="2" opacity=".45"/>
  </g>
  <path d="M12 62 C12 32 39 17 74 18 C105 19 117 35 130 55 C140 71 148 76 158 68 C164 63 167 57 169 51 C172 66 168 78 158 85 C151 90 143 92 135 89 C123 107 101 114 72 114 C48 114 30 102 12 84 C10 78 9 70 12 62 Z" fill="url(#apWhaleBody)" stroke="#174F7C" stroke-width="3.4" stroke-linejoin="round"/>
  <path d="M22 54 C28 31 51 23 50 24 C70 25 84 34 96 46" fill="none" stroke="#91C9E4" stroke-width="3.2" stroke-linecap="round" opacity=".55"/>
  <path d="M13 70 C31 78 48 79 62 77 C74 77 83 75 92 72 C101 70 107 64 119 60 C122 77 127 88 137 93 C129 102 112 108 92 110 C71 111 43 110 20 102 C13 94 12 86 13 79 Z" fill="#F3E4BC" stroke="#BFA878" stroke-width="2.6"/>
  <g clip-path="url(#apBellyClip)" fill="none" stroke="#BCA675" stroke-width="2.2" opacity=".72">
    <path d="M25 68 Q30 91 48 112"/><path d="M39 70 Q45 95 62 113"/><path d="M54 72 Q61 98 78 114"/><path d="M70 72 Q78 93 95 112"/><path d="M86 69 Q94 93 111 108"/><path d="M101 64 Q108 84 128 103"/>
  </g>
  <g class="ap-fin">
    <path d="M102 72 C110 81 121 97 124 108 C111 108 99 100 92 87 C90 79 93 71 102 72 Z" fill="url(#apWhaleFin)" stroke="#174F7C" stroke-width="3" stroke-linejoin="round"/>
    <path d="M101 78 C107 86 113 96 116 105" fill="none" stroke="#72B6D8" stroke-width="2" opacity=".45"/>
  </g>
  <path d="M45 108 C43 116 46 120 50 118 C57 116 61 112 60 105 Z" fill="url(#apWhaleFin)" stroke="#174F7C" stroke-width="2.6"/>
  <g class="ap-spout" fill="none" stroke="#3D86B7" stroke-width="4" stroke-linecap="round"><path d="M58 22 C58 11 54 5 49 2"/><path d="M58 21 C61 10 66 6 72 6"/></g>
  <ellipse cx="58" cy="24" rx="5" ry="2.5" fill="#174F7C" opacity=".72"/>
  <g class="ap-eye"><ellipse cx="69" cy="54" rx="12" ry="13" fill="#fff" stroke="#174F7C" stroke-width="3"/><ellipse class="ap-pupil" cx="72" cy="57" rx="6" ry="7" fill="#16232D"/><circle cx="70" cy="53" r="2.4" fill="#fff"/></g>
  <g class="ap-eye-happy"><path d="M60 55 Q69 44 78 55" fill="none" stroke="#16232D" stroke-width="4" stroke-linecap="round"/></g>
  <path d="M62 41 Q74 36 84 42" fill="none" stroke="#174F7C" stroke-width="3.2" stroke-linecap="round"/><path class="ap-mouth" d="M58 72 Q68 77 76 69" fill="none" stroke="#174F7C" stroke-width="3.2" stroke-linecap="round"/>
</svg>`,
  css: `
.dsd-pet[data-ap-theme="blue-whale"] .ap-pet-svg{filter:drop-shadow(0 5px 7px rgba(20,48,78,.28))}
.dsd-pet[data-ap-theme="blue-whale"] .ap-tail{transform-box:fill-box;transform-origin:12% 58%;animation:ap-whale-tail 1.8s ease-in-out infinite}
@keyframes ap-whale-tail{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(9deg)}}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="stream"] .ap-tail{animation-duration:.42s}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="done"] .ap-tail{animation-duration:.55s}
.dsd-pet[data-ap-theme="blue-whale"] .ap-fin{transform-box:fill-box;transform-origin:18% 12%;animation:ap-whale-fin 1.7s ease-in-out infinite}
@keyframes ap-whale-fin{0%,100%{transform:rotate(0)}50%{transform:rotate(8deg)}}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="tool"] .ap-fin,.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="stream"] .ap-fin{animation-duration:.55s}
.dsd-pet[data-ap-theme="blue-whale"] .ap-spout{transform-box:fill-box;transform-origin:50% 100%;animation:ap-whale-spout 2.2s ease-in-out infinite}
@keyframes ap-whale-spout{0%,100%{transform:translateY(0) scaleY(.96);opacity:.8}50%{transform:translateY(-3px) scaleY(1.08);opacity:1}}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="stream"] .ap-spout,.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="think"] .ap-spout{animation-duration:.75s}
.dsd-pet[data-ap-theme="blue-whale"] .ap-eye{transform-box:fill-box;transform-origin:center;animation:ap-whale-blink 4.8s infinite}
.dsd-pet[data-ap-theme="blue-whale"] .ap-pupil{transform-box:fill-box;transform-origin:center;transition:transform .18s ease}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="think"] .ap-pupil,.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="turn"] .ap-pupil{transform:translateY(-4px)}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="stream"] .ap-pupil,.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="tool"] .ap-pupil{transform:translateX(3px) translateY(2px)}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="error"] .ap-pupil{transform:translateY(4px)}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="stream"] .ap-eye,.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="done"] .ap-eye{animation:none}
@keyframes ap-whale-blink{0%,90%,100%{transform:scaleY(1)}93%,97%{transform:scaleY(.08)}}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-click-blink] .ap-eye{animation:ap-whale-click-blink .24s ease-in-out 1!important}
@keyframes ap-whale-click-blink{0%,100%{transform:scaleY(1)}45%,65%{transform:scaleY(.06)}}
.dsd-pet[data-ap-theme="blue-whale"] .ap-eye-happy{display:none}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="done"] .ap-eye{opacity:0}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="done"] .ap-eye-happy{display:block}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-click-blink] .ap-eye{opacity:1!important}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-click-blink] .ap-eye-happy{display:none!important}
.dsd-pet[data-ap-theme="blue-whale"][data-ap-phase="stream"] .ap-mouth{transform-box:fill-box;transform-origin:50% 50%;animation:ap-whale-talk .38s ease-in-out infinite}
@keyframes ap-whale-talk{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.72)}}
@media(prefers-reduced-motion:reduce){.dsd-pet[data-ap-theme="blue-whale"] .ap-tail,.dsd-pet[data-ap-theme="blue-whale"] .ap-fin,.dsd-pet[data-ap-theme="blue-whale"] .ap-spout,.dsd-pet[data-ap-theme="blue-whale"] .ap-eye,.dsd-pet[data-ap-theme="blue-whale"] .ap-mouth{animation:none!important}}
`,
  phases: {
    idle: { animation: 'idle', bubble: '我在这儿等你～' },
    turn: { animation: 'think', bubble: '收到！开始处理…' },
    think: { animation: 'think', bubble: '思考中…' },
    stream: { animation: 'stream', bubble: null },
    tool: { animation: 'tool', bubble: null },
    done: { animation: 'done', bubble: '回答完成！' },
    error: { animation: 'error', bubble: '出错了…' },
  },
}

const ORANGE_CAT: ApThemeModel = {
  id: 'orange-cat',
  name: '橘猫',
  aspect: 150 / 120,
  markup: `
<svg class="ap-pet-svg ap-cat-svg" viewBox="0 0 150 120" aria-hidden="true">
  <defs><linearGradient id="apCatBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6A64B"/><stop offset="1" stop-color="#D97828"/></linearGradient></defs>
  <path class="ap-cat-tail" d="M119 82 C145 91 150 67 139 58 C129 51 122 58 130 65 C137 72 132 79 121 74" fill="none" stroke="#D97828" stroke-width="13" stroke-linecap="round"/>
  <path d="M36 40 L31 15 L55 31 C66 25 88 25 96 31 L118 15 L114 43 C124 55 128 79 118 96 C98 105 44 115 32 96 C20 81 22 55 36 40 Z" fill="url(#apCatBody)" stroke="#85471F" stroke-width="4" stroke-linejoin="round"/>
  <path d="M35 30 L36 21 L46 32" fill="#F6C18B"/><path d="M105 32 L116 21 L115 35" fill="#F6C18B"/>
  <path d="M54 32 L59 49 M71 29 L71 48 M89 32 L87 49" fill="none" stroke="#A75525" stroke-width="4" stroke-linecap="round"/>
  <g class="ap-cat-eyes"><ellipse cx="52" cy="63" rx="9" ry="11" fill="#FFF8E9"/><ellipse cx="96" cy="63" rx="9" ry="11" fill="#FFF8E9"/><ellipse class="ap-cat-pupil" cx="54" cy="65" rx="4" ry="6" fill="#29342F"/><ellipse class="ap-cat-pupil" cx="98" cy="65" rx="4" ry="6" fill="#29342F"/></g>
  <g class="ap-cat-happy"><path d="M44 64 Q52 55 61 64 M87 64 Q95 55 104 64" fill="none" stroke="#29342F" stroke-width="4" stroke-linecap="round"/></g>
  <path d="M71 64 L72 68 L73 70 Z" fill="#9E4F47"/><path class="ap-cat-mouth" d="M73 71 Q67 85 61 79 M73 71 Q79 85 84 79" fill="none" stroke="#6D3C2C" stroke-width="3" stroke-linecap="round"/>
  <path d="M42 85 L15 80 M45 92 L13 94 M101 91 L133 82 M104 99 L140 104" fill="none" stroke="#85471F" stroke-width="2.5" stroke-linecap="round"/>
  <path class="ap-cat-paw" d="M42 92 Q48 84 56 91" fill="#F6B567" stroke="#85471F" stroke-width="3"/><path d="M92 92 Q98 84 106 91" fill="#F6B567" stroke="#85471F" stroke-width="3"/>
</svg>`,
  css: `
.dsd-pet[data-ap-theme="orange-cat"] .ap-pet-svg{filter:drop-shadow(0 5px 7px rgba(74,39,19,.3))}
.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-tail{transform-box:fill-box;transform-origin:8% 55%;animation:ap-cat-tail 1.35s ease-in-out infinite}
@keyframes ap-cat-tail{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(12deg)}}
.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-eyes{transform-box:fill-box;transform-origin:center;animation:ap-cat-blink 4.2s infinite}
@keyframes ap-cat-blink{0%,88%,100%{transform:scaleY(1)}91%,96%{transform:scaleY(.08)}}
.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-happy{display:none}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="done"] .ap-cat-eyes{display:none}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="done"] .ap-cat-happy{display:block}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-click-blink] .ap-cat-eyes{display:block;animation:ap-cat-click-blink .24s ease-in-out 1!important}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-click-blink] .ap-cat-happy{display:none!important}
@keyframes ap-cat-click-blink{0%,100%{transform:scaleY(1)}45%,65%{transform:scaleY(.06)}}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="think"] .ap-cat-pupil,.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="turn"] .ap-cat-pupil{transform:translateY(-3px)}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="stream"] .ap-cat-mouth{transform-box:fill-box;transform-origin:center;animation:ap-cat-talk .36s ease-in-out infinite}
@keyframes ap-cat-talk{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.55)}}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="tool"] .ap-cat-paw{transform-box:fill-box;transform-origin:80% 100%;animation:ap-cat-paw .42s ease-in-out infinite}
@keyframes ap-cat-paw{0%,100%{transform:rotate(0)}50%{transform:rotate(-15deg) translateY(-3px)}}
.dsd-pet[data-ap-theme="orange-cat"][data-ap-phase="stream"] .ap-cat-tail{animation-duration:.45s}
@media(prefers-reduced-motion:reduce){.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-tail,.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-eyes,.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-mouth,.dsd-pet[data-ap-theme="orange-cat"] .ap-cat-paw{animation:none!important}}
`,
  phases: {
    idle: { animation: 'idle', bubble: '喵，我在这里～' },
    turn: { animation: 'think', bubble: '收到，看看是什么…' },
    think: { animation: 'think', bubble: '认真思考中…' },
    stream: { animation: 'stream', bubble: null },
    tool: { animation: 'tool', bubble: null },
    done: { animation: 'done', bubble: '做好啦，喵！' },
    error: { animation: 'error', bubble: '好像遇到问题了…' },
  },
}

const SILVER_SHADED_CAT: ApThemeModel = {
  id: 'silver-shaded-cat',
  name: '银渐层猫',
  aspect: 1201 / 1229,
  markup: `
<svg class="ap-pet-svg ap-silver-cat-svg" viewBox="0 0 1201 1229" aria-hidden="true">
  <defs><clipPath id="apSilverCatLeftEyeClip"><ellipse cx="378" cy="418" rx="82" ry="89"/></clipPath><clipPath id="apSilverCatRightEyeClip"><ellipse cx="695" cy="418" rx="82" ry="89"/></clipPath></defs>
  <g class="ap-silver-cat-character">
    <image class="ap-silver-cat-art" width="1201" height="1229" preserveAspectRatio="xMidYMid meet" href="${SILVER_CAT_ASSET}"/>
    <g class="ap-silver-cat-overlay">
      <g class="ap-silver-cat-moving-eyes">
        <g clip-path="url(#apSilverCatLeftEyeClip)"><g class="ap-silver-cat-left-pupil"><ellipse cx="378" cy="425" rx="58" ry="66" fill="#080B09" opacity=".95"/><ellipse cx="354" cy="390" rx="19" ry="24" fill="#FFF" opacity=".96"/><circle cx="399" cy="446" r="9" fill="#66705E" opacity=".48"/></g></g>
        <g clip-path="url(#apSilverCatRightEyeClip)"><g class="ap-silver-cat-right-pupil"><ellipse cx="695" cy="425" rx="58" ry="66" fill="#080B09" opacity=".95"/><ellipse cx="671" cy="390" rx="19" ry="24" fill="#FFF" opacity=".96"/><circle cx="716" cy="446" r="9" fill="#66705E" opacity=".48"/></g></g>
      </g>
      <g class="ap-silver-cat-blink"><ellipse cx="378" cy="418" rx="91" ry="18" fill="#4B3827" opacity=".96"/><ellipse cx="695" cy="418" rx="91" ry="18" fill="#4B3827" opacity=".96"/></g>
      <path class="ap-silver-cat-mouth" d="M520 683 Q511 613 463 696 M520 683 Q548 617 577 690" fill="#A85D55" fill-opacity=".58" stroke="#65433A" stroke-width="10" stroke-linecap="round"/>
      <path class="ap-silver-cat-paw" d="M337 1020 Q370 951 440 1017 Q451 1092 397 1112 Q211 1040 337 1020 Z" fill="#FFEBC7" stroke="#9A7048" stroke-width="10" opacity=".98"/>
      <g class="ap-silver-cat-done-sparkles" fill="#FFC13C"><path d="M87 120 C102 77 110 48 121 18 C133 54 139 82 155 120 C194 134 219 143 247 157 C208 170 184 181 155 195 C140 235 132 263 121 294 C110 256 102 228 87 195 C50 181 27 171 0 157 C37 143 59 134 87 120 Z"/><path d="M1080 215 C1092 181 1098 158 1108 134 C1118 162 1123 185 1132 215 C1158 231 1184 243 1201 257 C1176 174 1128 143 1080 215 Z"/></g>
    </g>
  </g>
</svg>`,
  css: `
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-pet-svg{overflow:visible;filter:drop-shadow(0 7px 9px rgba(78,56,35,.3))}
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-character{transform-box:fill-box;transform-origin:center bottom;animation:ap-silver-cat-idle 2.4s ease-in-out infinite}
@keyframes ap-silver-cat-idle{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-13px) scale(1.018,.985)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-left-pupil,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-right-pupil{transform-box:view-box;transform-origin:center;animation:ap-silver-cat-eye-roam 5.2s ease-in-out infinite}
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-right-pupil{animation-delay:.08s}
@keyframes ap-silver-cat-eye-roam{0%,12%,100%{transform:translate(0,0)}30%,42%{transform:translate(-15px,-6px)}58%,70%{transform:translate(15px,-3px)}84%,92%{transform:translate(3px,11px)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-blink,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-mouth,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-paw,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-done-sparkles{opacity:0}
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-blink{animation:ap-silver-cat-auto-blink 4.2s infinite}
@keyframes ap-silver-cat-auto-blink{0%,84%,97%,100%{opacity:0}87%,94%{opacity:1}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-click-blink] .ap-silver-cat-blink{animation:ap-silver-cat-click-blink .34s ease-in-out 1!important}
@keyframes ap-silver-cat-click-blink{0%,100%{opacity:0}32%,76%{opacity:1}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="turn"] .ap-silver-cat-character,.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="think"] .ap-silver-cat-character{animation:ap-silver-cat-think 1.25s ease-in-out infinite}
@keyframes ap-silver-cat-think{0%,100%{transform:translate(-9px,-5px) rotate(-1.5deg)}50%{transform:translate(9px,-15px) rotate(1.5deg)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-art{transform-box:fill-box;transform-origin:center bottom}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="stream"] .ap-silver-cat-character{animation:ap-silver-cat-stream .62s ease-in-out infinite}
@keyframes ap-silver-cat-stream{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-8px) scale(1.012)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="stream"] .ap-silver-cat-mouth{transform-box:fill-box;transform-origin:center;animation:ap-silver-cat-talk .38s ease-in-out infinite}
@keyframes ap-silver-cat-talk{0%,100%{opacity:0;transform:scaleY(.4)}50%{opacity:.98;transform:scaleY(1.15)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="tool"] .ap-silver-cat-character{animation:ap-silver-cat-tool-body .7s ease-in-out infinite}
@keyframes ap-silver-cat-tool-body{0%,100%{transform:rotate(0)}50%{transform:rotate(1.8deg) translateY(-7px)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="tool"] .ap-silver-cat-paw{transform-box:fill-box;transform-origin:90% 100%;animation:ap-silver-cat-paw .55s ease-in-out infinite}
@keyframes ap-silver-cat-paw{0%,100%{opacity:0;transform:rotate(0) translateY(0)}32%,72%{opacity:.98;transform:rotate(-13deg) translateY(-72px)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="done"] .ap-silver-cat-character{animation:ap-silver-cat-jump .8s cubic-bezier(.25,.8,.35,1.2) 2}
@keyframes ap-silver-cat-jump{0%,100%{transform:translateY(0) scale(1)}45%{transform:translateY(-52px) scale(.96,1.06)}72%{transform:translateY(5px) scale(1.05,.94)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="done"] .ap-silver-cat-done-sparkles{animation:ap-silver-cat-done .65s ease-in-out infinite}
@keyframes ap-silver-cat-done{0%,100%{opacity:.3;transform:scale(.82)}50%{opacity:1;transform:scale(1.12)}}
.dsd-pet[data-ap-theme="silver-shaded-cat"][data-ap-phase="error"] .ap-silver-cat-character{animation:ap-silver-cat-error .34s ease-in-out 3}
@keyframes ap-silver-cat-error{0%,100%{transform:translateX(0)}35%{transform:translateX(-16px) rotate(-1deg)}70%{transform:translateX(16px) rotate(1deg)}}
@media(prefers-reduced-motion:reduce){.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-character,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-art,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-mouth,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-paw,.dsd-pet[data-ap-theme="silver-shaded-cat"] .ap-silver-cat-done-sparkles{animation:none!important}}
`,
  phases: {
    idle: { animation: 'idle', bubble: '我在这里呀～' },
    turn: { animation: 'think', bubble: '让我看看…' },
    think: { animation: 'think', bubble: '认真想一想…' },
    stream: { animation: 'stream', bubble: null },
    tool: { animation: 'tool', bubble: null },
    done: { animation: 'done', bubble: '完成啦！' },
    error: { animation: 'error', bubble: '好像遇到问题了…' },
  },
}

/** All ported answer-pet themes, keyed by id. */
export const AP_THEMES: Record<string, ApThemeModel> = Object.freeze({
  'blue-whale': BLUE_WHALE,
  'orange-cat': ORANGE_CAT,
  'silver-shaded-cat': SILVER_SHADED_CAT,
})

export const AP_THEME_IDS: readonly string[] = Object.freeze(Object.keys(AP_THEMES))

/** Resolve a theme by id; falls back to blue-whale. */
export function resolveApTheme(id: string | undefined): ApThemeModel {
  const theme = typeof id === 'string' ? AP_THEMES[id] : undefined
  return theme ?? BLUE_WHALE
}

/** Map a PetKind to the answer-pet phase that drives the animation + text. */
export function apPhaseOf(kind: PetKind): ApPhase {
  switch (kind) {
    case 'running':
    case 'subagent':
      return AP_PHASES.STREAM
    case 'error':
      return AP_PHASES.ERROR
    case 'awaiting':
      return AP_PHASES.TOOL
    default:
      return AP_PHASES.IDLE
  }
}

/** Concatenated theme CSS for injection into the pet stylesheet. */
export function apThemesCss(): string {
  return AP_THEME_IDS.map((id) => AP_THEMES[id]!.css).join('\n')
}