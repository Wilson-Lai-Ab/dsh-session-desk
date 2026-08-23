import { describe, expect, it } from 'vitest'
import {
  PET_ALPHA_HIT_THRESHOLD,
  isDenseOpaquePetPixel,
  isOpaquePetPixel,
  mapClientToBitmap,
} from '../src/client/pet/hit-test.ts'

function bitmap(width: number, height: number, pixels: number[]): { data: Uint8ClampedArray; width: number; height: number } {
  return { data: Uint8ClampedArray.from(pixels), width, height }
}

describe('isOpaquePetPixel', () => {
  it('misses when there is no bitmap', () => {
    expect(isOpaquePetPixel(null, 0, 0)).toBe(false)
  })

  it('misses transparent and out-of-bounds pixels', () => {
    const image = bitmap(2, 1, [
      255, 0, 0, 0,
      255, 0, 0, 255,
    ])
    expect(isOpaquePetPixel(image, 0, 0)).toBe(false)
    expect(isOpaquePetPixel(image, -1, 0)).toBe(false)
    expect(isOpaquePetPixel(image, 2, 0)).toBe(false)
  })

  it('hits only pixels at or above the alpha threshold', () => {
    const image = bitmap(3, 1, [
      10, 10, 10, PET_ALPHA_HIT_THRESHOLD - 1,
      10, 10, 10, PET_ALPHA_HIT_THRESHOLD,
      10, 10, 10, 255,
    ])
    expect(isOpaquePetPixel(image, 0, 0)).toBe(false)
    expect(isOpaquePetPixel(image, 1, 0)).toBe(true)
    expect(isOpaquePetPixel(image, 2, 0)).toBe(true)
  })
})

describe('isDenseOpaquePetPixel', () => {
  it('ignores an isolated sparkle', () => {
    const pixels = new Array(3 * 3 * 4).fill(0)
    pixels[4 * 4 + 3] = 255
    expect(isDenseOpaquePetPixel(bitmap(3, 3, pixels), 1, 1)).toBe(false)
  })

  it('hits a solid body cluster', () => {
    const pixels = new Array(3 * 3 * 4).fill(0)
    for (let i = 0; i < 9; i++) pixels[i * 4 + 3] = 255
    expect(isDenseOpaquePetPixel(bitmap(3, 3, pixels), 1, 1)).toBe(true)
  })
})

describe('mapClientToBitmap', () => {
  const box = { left: 100, top: 50, width: 200, height: 100 }

  it('returns null outside the element box', () => {
    expect(mapClientToBitmap(99, 50, box, 400, 200)).toBeNull()
    expect(mapClientToBitmap(300, 50, box, 400, 200)).toBeNull()
    expect(mapClientToBitmap(100, 150, box, 400, 200)).toBeNull()
  })

  it('maps the box onto bitmap pixels', () => {
    expect(mapClientToBitmap(100, 50, box, 400, 200)).toEqual({ x: 0, y: 0 })
    expect(mapClientToBitmap(299.9, 149.9, box, 400, 200)).toEqual({ x: 399, y: 199 })
    expect(mapClientToBitmap(200, 100, box, 400, 200)).toEqual({ x: 200, y: 100 })
  })
})
