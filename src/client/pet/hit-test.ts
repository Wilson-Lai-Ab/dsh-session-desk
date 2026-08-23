/**
 * Alpha-aware pet hit testing. HTML video/img are rectangular; only pixels
 * above the alpha threshold should capture the pointer.
 */

/** Ignore faint sparkles / motion blur around the sprite. */
export const PET_ALPHA_HIT_THRESHOLD = 32

export interface PetBitmap {
  data: ArrayLike<number>
  width: number
  height: number
}

export interface PetBox {
  left: number
  top: number
  width: number
  height: number
}

export function isOpaquePetPixel(image: PetBitmap | null, x: number, y: number): boolean {
  if (image === null) return false
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false
  const alpha = image.data[(y * image.width + x) * 4 + 3]
  return (typeof alpha === 'number' ? alpha : 0) >= PET_ALPHA_HIT_THRESHOLD
}

export function mapClientToBitmap(
  clientX: number,
  clientY: number,
  box: PetBox,
  bitmapWidth: number,
  bitmapHeight: number,
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) return null
  const nx = (clientX - box.left) / box.width
  const ny = (clientY - box.top) / box.height
  if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) return null
  return {
    x: Math.min(bitmapWidth - 1, Math.floor(nx * bitmapWidth)),
    y: Math.min(bitmapHeight - 1, Math.floor(ny * bitmapHeight)),
  }
}

let scratch: HTMLCanvasElement | null = null

const SAMPLE = 3
const MIN_OPAQUE_NEIGHBORS = 5

function scratchContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (scratch === null) scratch = document.createElement('canvas')
  if (scratch.width !== SAMPLE || scratch.height !== SAMPLE) {
    scratch.width = SAMPLE
    scratch.height = SAMPLE
  }
  return scratch.getContext('2d', { willReadFrequently: true })
}

/** Count opaque pixels in a 3×3 around (x, y). Isolated sparkles stay click-through. */
export function opaqueNeighborCount(image: PetBitmap, x: number, y: number): number {
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isOpaquePetPixel(image, x + dx, y + dy)) count++
    }
  }
  return count
}

export function isDenseOpaquePetPixel(image: PetBitmap | null, x: number, y: number): boolean {
  if (image === null) return false
  return opaqueNeighborCount(image, x, y) >= MIN_OPAQUE_NEIGHBORS
}

/** Sample a 3×3 of a video/image. Returns false when tainted, empty, or a lone sparkle. */
export function sampleMediaAlpha(
  source: CanvasImageSource,
  clientX: number,
  clientY: number,
  box: PetBox,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  const mapped = mapClientToBitmap(clientX, clientY, box, sourceWidth, sourceHeight)
  if (mapped === null) return false
  const ctx = scratchContext()
  if (ctx === null) return false
  try {
    const sx = Math.max(0, mapped.x - 1)
    const sy = Math.max(0, mapped.y - 1)
    const sw = Math.min(SAMPLE, sourceWidth - sx)
    const sh = Math.min(SAMPLE, sourceHeight - sy)
    ctx.clearRect(0, 0, SAMPLE, SAMPLE)
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
    const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] >= PET_ALPHA_HIT_THRESHOLD) count++
    }
    return count >= MIN_OPAQUE_NEIGHBORS
  } catch {
    return false
  }
}

export function mediaSourceSize(el: HTMLVideoElement | HTMLImageElement): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) {
    return { width: el.videoWidth, height: el.videoHeight }
  }
  const image = el as HTMLImageElement
  return { width: image.naturalWidth, height: image.naturalHeight }
}

const SVG_GRAPHICS = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'use', 'text', 'image'])

/** SVG already hit-tests painted geometry when pointer-events is visiblePainted. */
export function isSvgPaintedTarget(target: EventTarget | null, root: Element): boolean {
  if (typeof Element === 'undefined' || typeof SVGElement === 'undefined') return false
  if (!(target instanceof Element) || !root.contains(target)) return false
  let node: Element | null = target
  while (node && node !== root) {
    if (node instanceof SVGElement && SVG_GRAPHICS.has(node.tagName.toLowerCase())) return true
    node = node.parentElement
  }
  return false
}

export function isOpaquePetHit(
  clientX: number,
  clientY: number,
  pet: HTMLElement,
  target: EventTarget | null,
): boolean {
  if (isSvgPaintedTarget(target, pet)) return true
  const media = pet.querySelectorAll('video, img')
  for (let i = 0; i < media.length; i++) {
    const node = media.item(i)
    if (typeof HTMLVideoElement === 'undefined' || typeof HTMLImageElement === 'undefined') break
    if (!(node instanceof HTMLVideoElement || node instanceof HTMLImageElement)) continue
    if (node instanceof HTMLVideoElement && !node.classList.contains('dsd-pet__layer--on') && media.length > 1) {
      continue
    }
    const box = node.getBoundingClientRect()
    const size = mediaSourceSize(node)
    if (sampleMediaAlpha(node, clientX, clientY, box, size.width, size.height)) return true
  }
  return false
}
