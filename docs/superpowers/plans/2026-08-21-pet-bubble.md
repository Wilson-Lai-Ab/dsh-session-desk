# Pet Rich Bubble Implementation Plan

> **For agentic workers:** Pick the execution skill from using-superpowers
> Execution Routing (S = this session, no SDD; M = executing-plans;
> L = subagent-driven-development). Do not default to SDD. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Class:** M — one feature threaded through 4 existing modules (status, overlay, locales, styles).

**Goal:** Replace the pet's single-line callout + separate session popup with a rich, per-status speech bubble whose list items navigate to sessions; clicking the pet only plays a reaction; idle rotates fun copy; a transient "task complete" celebration fires on running→idle.

**Architecture:** Keep the existing `PetKind` model (`running/awaiting/subagent/idle/error`) and add two optional fields to `FoldedPetRow` (`activity`, `tool`) so the bubble can render richer rows. The bubble becomes a column of clickable items rendered inside the existing `.dsd-pet__callout`. A transient "completed" celebration is UI state (not a `PetKind`), driven by a pure `shouldCelebrateCompletion` predicate.

**Tech Stack:** TypeScript + React (client bundle via esbuild). Vitest for pure-logic unit tests. No new dependencies.

**Spec:** Approved design in chat (2026-08-21): 5 states keep current kinds (subagent retained, no new "completed" kind); transient "任务完成啦🎉" on running/subagent→idle for ~4.5s; awaiting keeps its orange `drop-shadow` glow; idle rotates mixed 吐槽+卖萌 copy.

## Global Constraints

- Do NOT change `PetKind` union: keep `'running' | 'idle' | 'error' | 'awaiting' | 'subagent'`.
- Preserve `.dsd-pet[data-kind="awaiting"] .dsd-pet__art { filter: drop-shadow(0 0 6px #f59e0b) }` (the orange glow) and the error red glow.
- `lib/` is gitignored; build with `node build.mjs`. Client changes need a browser hard-refresh, no host restart.
- Locale keys live in `src/client/locales.ts` (`zh` + `en`); `t(key, vars)` interpolates `{n}`/`{error}`/`{tool}`.
- Pure logic must stay in `src/client/pet/status.ts` (or a sibling pure module), unit-tested in `tests/*.spec.ts`.
- Keep typecheck clean (`npx tsc --noEmit`) and all 194 tests passing; do not add type errors.

---

### Task 1: Remove the session popup; click = reaction only

**Files:**
- Modify: `src/client/pet/PetOverlay.tsx`
- Modify: `src/client/pet/pet-styles.ts`

**Interfaces:**
- Consumes: none (existing code).
- Produces: `onPointerUp` no longer toggles any panel; `openSession(id)` still calls `props.sessions.open(id)` but no longer closes a popup; `dsd-pet-pop*` CSS removed.

- [ ] **Step 1: Delete the popup state and its render**

In `PetOverlay.tsx`, remove the `const [open, setOpen] = useState(false)` line (near the other `useState` calls).

- [ ] **Step 2: Strip `open` from `onPointerUp`**

Replace the `else` branch of `onPointerUp` so a clean tap only fires a reaction:

```tsx
const onPointerUp = (): void => {
  if (!dragging.current) return
  dragging.current = false
  const next = livePos.current
  if (moved.current) persistPosition(next.x, next.y)
  else {
    const picked = pickReaction(theme)
    if (picked !== null && picked.type === 'video') setReaction(picked)
  }
  setDragPos(moved.current ? next : null)
}
```

- [ ] **Step 3: Delete the popup JSX**

Remove the whole `{open && ( <div className="dsd-pet-pop" ...> ... </div> )}` block (the `.dsd-pet-pop` panel) and its `popStyle` const.

- [ ] **Step 4: Delete the outside-click / Escape / blur effect**

Remove the `useEffect(() => { if (!open) return ... }, [open])` block that closed the popup on outside pointerdown / Escape / blur.

- [ ] **Step 5: Simplify `openSession`**

Keep navigation but drop the popup close:

```tsx
const openSession = (id: string): void => {
  try {
    void props.sessions?.open?.(id)
  } catch {
    setHidden(true)
  }
}
```

- [ ] **Step 6: Remove `.dsd-pet-pop*` styles**

In `pet-styles.ts`, delete the rules for `.dsd-pet-pop`, `.dsd-pet-pop__empty`, `.dsd-pet-pop__row`, `.dsd-pet-pop__kind`, `.dsd-pet-pop__title` (the block starting at `.dsd-pet-pop {` through `.dsd-pet-pop__title { ... }`).

- [ ] **Step 7: Build + typecheck**

Run: `node build.mjs && npx tsc --noEmit`
Expected: build exit 0, typecheck exit 0. No `open`/`popStyle`/`dsd-pet-pop` references remain (grep `dsd-pet-pop` in `lib/client.js` → 0).

- [ ] **Step 8: Commit**

```bash
git add src/client/pet/PetOverlay.tsx src/client/pet/pet-styles.ts
git commit -m "feat(pet): remove session popup, click plays reaction only"
```

---

### Task 2: Rich bubble for running / awaiting / subagent with clickable rows

**Files:**
- Modify: `src/client/pet/status.ts`
- Modify: `src/client/pet/PetOverlay.tsx`
- Modify: `src/client/pet/pet-styles.ts`
- Modify: `src/client/locales.ts`
- Test: `tests/pet-status.spec.ts`

**Interfaces:**
- Consumes: `FoldedPetRow`, `foldPetRows`, `foldPetList`, `PetSessionRow` (existing).
- Produces:
  - `export type PetActivity = 'streaming' | 'generating' | 'running' | 'working'`
  - `export function activityOf(row: PetSessionRow | undefined): PetActivity`
  - `export function toolOf(row: PetSessionRow | undefined): string | undefined`
  - `FoldedPetRow` gains `activity?: PetActivity` and `tool?: string`.
  - Locale keys: `pet.activity.streaming/generating/running/working`, `pet.awaiting.request` (`请求使用 {tool}`), updated `pet.bubble.running/awaiting/subagent`.

- [ ] **Step 1: Write the failing tests for `activityOf` and `toolOf`**

Append to `tests/pet-status.spec.ts`:

```ts
import {
  activityOf,
  toolOf,
  // ... existing imports
} from '../src/client/pet/status.ts'

describe('activityOf', () => {
  it('maps openState streaming / generating / running to a short activity', () => {
    expect(activityOf({ openState: 'streaming' })).toBe('streaming')
    expect(activityOf({ openState: 'generating' })).toBe('generating')
    expect(activityOf({ openState: 'running' })).toBe('running')
  })

  it('falls back to working for running-without-openState and unknown values', () => {
    expect(activityOf(undefined)).toBe('working')
    expect(activityOf({ running: true })).toBe('working')
    expect(activityOf({ openState: 'thinking' })).toBe('working')
  })
})

describe('toolOf', () => {
  it('returns the trimmed pendingInteraction', () => {
    expect(toolOf({ pendingInteraction: 'bash' })).toBe('bash')
    expect(toolOf({ pendingInteraction: '  write  ' })).toBe('write')
  })

  it('returns undefined when there is no pendingInteraction', () => {
    expect(toolOf({})).toBeUndefined()
    expect(toolOf({ pendingInteraction: '   ' })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `./node_modules/.bin/vitest run tests/pet-status.spec.ts`
Expected: FAIL — `activityOf` / `toolOf` are not exported.

- [ ] **Step 3: Implement `activityOf`, `toolOf`, and enrich `FoldedPetRow`**

In `status.ts`, add the type and helpers near `FoldedPetRow`:

```ts
export type PetActivity = 'streaming' | 'generating' | 'running' | 'working'

export function activityOf(row: PetSessionRow | undefined): PetActivity {
  if (!row) return 'working'
  const key = (row.openState ?? '').trim().toLowerCase()
  if (key === 'streaming') return 'streaming'
  if (key === 'generating') return 'generating'
  if (key === 'running') return 'running'
  return 'working'
}

export function toolOf(row: PetSessionRow | undefined): string | undefined {
  if (!row) return undefined
  const tool = typeof row.pendingInteraction === 'string' ? row.pendingInteraction.trim() : ''
  return tool === '' ? undefined : tool
}
```

Extend the interface:

```ts
export interface FoldedPetRow {
  id: string
  title: string
  kind: PetKind
  activity?: PetActivity
  tool?: string
}
```

In `foldPetRows`, compute `kind` into a local before pushing:

```ts
const kind = parentKindWithChildren(self, children)
out.push({
  id,
  title: row.displayTitle || row.title || id,
  kind,
  activity: kind === 'running' || kind === 'subagent' ? activityOf(row) : undefined,
  tool: kind === 'awaiting' ? toolOf(row) : undefined,
})
```

(Replace the current inline `kind: parentKindWithChildren(self, children)` push with the block above. Do not change `foldPetList`.)

- [ ] **Step 4: Run tests to confirm they pass**

Run: `./node_modules/.bin/vitest run tests/pet-status.spec.ts`
Expected: PASS (new cases green; existing 194 still green in full run).

- [ ] **Step 5: Add locale copy**

In `src/client/locales.ts`, replace `pet.bubble.running/awaiting/subagent` and add activity + request keys.

`zh`:
```ts
'pet.bubble.running': '正在干活…（{n} 个会话）',
'pet.bubble.awaiting': '需要你确认 · {n} 项',
'pet.bubble.subagent': '子代理执行中 · {n} 个',
'pet.activity.streaming': '输出中',
'pet.activity.generating': '生成中',
'pet.activity.running': '执行中',
'pet.activity.working': '工作中',
'pet.awaiting.request': '请求使用 {tool}',
```

`en`:
```ts
'pet.bubble.running': 'Working… ({n} sessions)',
'pet.bubble.awaiting': 'Needs confirmation · {n}',
'pet.bubble.subagent': 'Subagents running · {n}',
'pet.activity.streaming': 'streaming',
'pet.activity.generating': 'generating',
'pet.activity.running': 'executing',
'pet.activity.working': 'working',
'pet.awaiting.request': 'requests {tool}',
```

- [ ] **Step 6: Render the rich bubble in `PetOverlay.tsx`**

Replace the single-line callout (the `{kind !== 'idle' && (<span className="dsd-pet__callout" ...>{bubbleText(...)}</span>)}` block) with a column callout. First add a helper above `PetOverlay` for the list rows:

```tsx
interface BubbleRow { id: string; text: string }

function bubbleRows(kind: PetKind, entries: FoldedPetRow[], t: PetOverlayProps['t']): BubbleRow[] {
  if (kind === 'running' || kind === 'subagent') {
    return entries
      .filter(e => e.kind === kind)
      .map(e => ({
        id: e.id,
        text: `${e.title} · ${t?.(`pet.activity.${e.activity ?? 'working'}`) ?? ''}`,
      }))
  }
  if (kind === 'awaiting') {
    return entries
      .filter(e => e.kind === kind)
      .map(e => ({
        id: e.id,
        text: `${e.title} ${t?.('pet.awaiting.request', { tool: e.tool ?? '' }) ?? ''}`,
      }))
  }
  return []
}
```

Then in the button render, replace the callout:

```tsx
{kind !== 'idle' && (
  <span className="dsd-pet__callout" data-kind={kind}>
    <span className="dsd-pet__callout__head">{bubbleText(kind, statusCount, props.t)}</span>
    {bubbleRows(kind, entries, props.t).map(row => (
      <button
        key={row.id}
        type="button"
        className="dsd-pet__callout__item"
        onClick={() => openSession(row.id)}
      >
        {row.text}
      </button>
    ))}
  </span>
)}
```

Note: `FoldedPetRow` must be imported in `PetOverlay.tsx` (add `type FoldedPetRow` to the import from `./status.ts`).

- [ ] **Step 7: Style the rich bubble**

In `pet-styles.ts`, change `.dsd-pet__callout` from `white-space: nowrap` single-line to a column, and add head + item rules. Replace the current `.dsd-pet__callout { ... }` body:

```css
.dsd-pet__callout {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 12px);
  translate: -50% 0;
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
```

Keep the existing `.dsd-pet__callout::after` arrow and the per-kind color rules (awaiting `#b45309`, error `#b91c1c`, running/subagent `#1e3a8a`) unchanged. Do NOT touch the `.dsd-pet[data-kind="awaiting"] .dsd-pet__art` orange glow.

- [ ] **Step 8: Build + typecheck + full tests**

Run: `node build.mjs && npx tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/client/pet/status.ts src/client/pet/PetOverlay.tsx src/client/pet/pet-styles.ts src/client/locales.ts tests/pet-status.spec.ts
git commit -m "feat(pet): rich clickable status bubble for running/awaiting/subagent"
```

---

### Task 3: Idle / error bubble copy + rotating fun idle phrases

**Files:**
- Modify: `src/client/pet/status.ts`
- Modify: `src/client/pet/PetOverlay.tsx`
- Modify: `src/client/locales.ts`
- Test: `tests/pet-status.spec.ts`

**Interfaces:**
- Consumes: `idleTick` (already in PetOverlay), `t`.
- Produces: `export function idlePhraseIndex(tick: number, count: number): number`; locale keys `pet.bubble.idle`, `pet.idle.sub`, `pet.idle.copy.1`…`pet.idle.copy.8`, updated `pet.bubble.error` + `pet.error.hint`.

- [ ] **Step 1: Write the failing test for `idlePhraseIndex`**

Append to `tests/pet-status.spec.ts`:

```ts
import { idlePhraseIndex } from '../src/client/pet/status.ts'

describe('idlePhraseIndex', () => {
  it('wraps tick around the phrase count', () => {
    expect(idlePhraseIndex(0, 8)).toBe(0)
    expect(idlePhraseIndex(8, 8)).toBe(0)
    expect(idlePhraseIndex(15, 8)).toBe(7)
  })

  it('returns 0 for an empty phrase list', () => {
    expect(idlePhraseIndex(3, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `./node_modules/.bin/vitest run tests/pet-status.spec.ts`
Expected: FAIL — `idlePhraseIndex` not exported.

- [ ] **Step 3: Implement `idlePhraseIndex`**

In `status.ts`:

```ts
export function idlePhraseIndex(tick: number, count: number): number {
  if (count <= 0) return 0
  return ((tick % count) + count) % count
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `./node_modules/.bin/vitest run tests/pet-status.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add locale copy**

In `src/client/locales.ts`:

`zh`:
```ts
'pet.bubble.idle': '休息中 zᶻZ',
'pet.idle.sub': '没有运行中的任务',
'pet.bubble.error': '连不上 DSH 😢',
'pet.error.hint': 'GUI 无响应，我会自动重试',
'pet.idle.copy.1': '摸鱼中…',
'pet.idle.copy.2': '休息一下下~',
'pet.idle.copy.3': '等你召唤我哦',
'pet.idle.copy.4': '老板别看我',
'pet.idle.copy.5': '正在思考鱼生',
'pet.idle.copy.6': '好耶，没活了！',
'pet.idle.copy.7': '喝口水休息下',
'pet.idle.copy.8': '蓄力中，随时开干',
```

`en`:
```ts
'pet.bubble.idle': 'Resting zᶻZ',
'pet.idle.sub': 'No running tasks',
'pet.bubble.error': "Can't reach DSH 😢",
'pet.error.hint': 'GUI not responding, retrying',
'pet.idle.copy.1': 'Slacking off…',
'pet.idle.copy.2': 'Taking a tiny break~',
'pet.idle.copy.3': 'Call me when you need me',
'pet.idle.copy.4': 'Nothing to see here',
'pet.idle.copy.5': 'Contemplating life',
'pet.idle.copy.6': 'All done!',
'pet.idle.copy.7': 'Hydration break',
'pet.idle.copy.8': 'Charging up…',
```

Also add a constant for the phrase count in `PetOverlay.tsx` (module scope):

```ts
const IDLE_PHRASE_COUNT = 8
```

- [ ] **Step 6: Render idle + error bubbles**

In `PetOverlay.tsx`, replace the `{kind !== 'idle' && ( ...callout... )}` guard so idle and error also render a callout. Change the guard to always render the callout, and branch its body:

```tsx
<span className="dsd-pet__callout" data-kind={kind}>
  {kind === 'idle' ? (
    <>
      <span className="dsd-pet__callout__head">{props.t?.('pet.bubble.idle') ?? '休息中'}</span>
      <span className="dsd-pet__callout__sub">
        {props.t?.(`pet.idle.copy.${idlePhraseIndex(idleTick, IDLE_PHRASE_COUNT) + 1}`) ?? props.t?.('pet.idle.sub') ?? ''}
      </span>
    </>
  ) : kind === 'error' ? (
    <>
      <span className="dsd-pet__callout__head">{props.t?.('pet.bubble.error') ?? '连不上 DSH'}</span>
      <span className="dsd-pet__callout__sub">{props.t?.('pet.error.hint') ?? ''}</span>
    </>
  ) : (
    <>
      <span className="dsd-pet__callout__head">{bubbleText(kind, statusCount, props.t)}</span>
      {bubbleRows(kind, entries, props.t).map(row => (
        <button key={row.id} type="button" className="dsd-pet__callout__item" onClick={() => openSession(row.id)}>
          {row.text}
        </button>
      ))}
    </>
  )}
</span>
```

(Import `idlePhraseIndex` from `./status.ts`.)

- [ ] **Step 7: Add `.dsd-pet__callout__sub` style**

In `pet-styles.ts`, after `.dsd-pet__callout__head`:

```css
.dsd-pet__callout__sub {
  font-weight: 500;
  opacity: 0.92;
  white-space: nowrap;
}
```

- [ ] **Step 8: Build + typecheck + full tests**

Run: `node build.mjs && npx tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/client/pet/status.ts src/client/pet/PetOverlay.tsx src/client/locales.ts tests/pet-status.spec.ts
git commit -m "feat(pet): idle/error bubble copy and rotating fun idle phrases"
```

---

### Task 4: Transient "task complete" celebration

**Files:**
- Modify: `src/client/pet/status.ts`
- Modify: `src/client/pet/PetOverlay.tsx`
- Modify: `src/client/locales.ts`
- Test: `tests/pet-status.spec.ts`

**Interfaces:**
- Consumes: `kind` (aggregate), `entries`, `PetKind`.
- Produces: `export function shouldCelebrateCompletion(prev: PetKind, next: PetKind): boolean`; locale keys `pet.bubble.completed`, `pet.completed.sub`.

- [ ] **Step 1: Write the failing test for `shouldCelebrateCompletion`**

Append to `tests/pet-status.spec.ts`:

```ts
import { shouldCelebrateCompletion } from '../src/client/pet/status.ts'

describe('shouldCelebrateCompletion', () => {
  it('celebrates only on running/subagent → idle', () => {
    expect(shouldCelebrateCompletion('running', 'idle')).toBe(true)
    expect(shouldCelebrateCompletion('subagent', 'idle')).toBe(true)
    expect(shouldCelebrateCompletion('idle', 'idle')).toBe(false)
    expect(shouldCelebrateCompletion('running', 'running')).toBe(false)
    expect(shouldCelebrateCompletion('idle', 'running')).toBe(false)
    expect(shouldCelebrateCompletion('awaiting', 'idle')).toBe(false)
    expect(shouldCelebrateCompletion('error', 'idle')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `./node_modules/.bin/vitest run tests/pet-status.spec.ts`
Expected: FAIL — `shouldCelebrateCompletion` not exported.

- [ ] **Step 3: Implement `shouldCelebrateCompletion`**

In `status.ts`:

```ts
export function shouldCelebrateCompletion(prev: PetKind, next: PetKind): boolean {
  return (prev === 'running' || prev === 'subagent') && next === 'idle'
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `./node_modules/.bin/vitest run tests/pet-status.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add locale copy**

In `src/client/locales.ts`:

`zh`:
```ts
'pet.bubble.completed': '任务完成啦🎉',
'pet.completed.sub': '干得漂亮！',
```

`en`:
```ts
'pet.bubble.completed': 'Task complete 🎉',
'pet.completed.sub': 'Nice work!',
```

- [ ] **Step 6: Wire the celebration in `PetOverlay.tsx`**

Add state and a prev-kind ref near the other pet state:

```tsx
const [celebrating, setCelebrating] = useState(false)
const prevKindRef = useRef<PetKind>(kind)
```

Add an effect (after `kind` is computed) that detects the transition and arms a 4.5s timer:

```tsx
useEffect(() => {
  const prev = prevKindRef.current
  if (shouldCelebrateCompletion(prev, kind)) {
    setCelebrating(true)
    const id = window.setTimeout(() => setCelebrating(false), 4500)
    prevKindRef.current = kind
    return () => window.clearTimeout(id)
  }
  prevKindRef.current = kind
  return undefined
}, [kind])
```

In the callout render, when `celebrating && kind === 'idle'`, show the completed bubble instead of the idle branch. Insert a new branch before the idle branch:

```tsx
{celebrating && kind === 'idle' ? (
  <>
    <span className="dsd-pet__callout__head">{props.t?.('pet.bubble.completed') ?? '任务完成啦🎉'}</span>
    <span className="dsd-pet__callout__sub">{props.t?.('pet.completed.sub') ?? ''}</span>
  </>
) : kind === 'idle' ? (
  ... existing idle branch ...
) : ...}
```

- [ ] **Step 7: Build + typecheck + full tests**

Run: `node build.mjs && npx tsc --noEmit && ./node_modules/.bin/vitest run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/client/pet/status.ts src/client/pet/PetOverlay.tsx src/client/locales.ts tests/pet-status.spec.ts
git commit -m "feat(pet): transient task-complete celebration on running to idle"
```

---

## Self-Review

- **Spec coverage:** (1) no popup + click→reaction → Task 1; (2) five-status rich bubble with clickable navigation → Task 2 (running/awaiting/subagent) + Task 3 (idle/error); (3) fun idle copy → Task 3; (4) transient 完成 celebration → Task 4; (5) keep awaiting orange glow → preserved by Task 2's "do not touch" note. ✅
- **Placeholder scan:** no TBD/TODO; each code step has concrete content. ✅
- **Type consistency:** `FoldedPetRow.activity?: PetActivity`, `tool?: string` defined in Task 2 and consumed in Task 2's `bubbleRows`; `idlePhraseIndex` defined in Task 3 and used in Task 3's render; `shouldCelebrateCompletion` defined in Task 4 and used in Task 4's effect. `bubbleRows` returns `BubbleRow {id,text}` used only within Task 2/3 render. ✅
