import { describe, expect, it } from 'vitest'
import {
  PET_SIZE_DEFAULT,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  cachedThemeOrNull,
  clampPetSize,
} from '../src/shared.ts'

describe('clampPetSize', () => {
  it('keeps values inside [MIN, MAX]', () => {
    expect(clampPetSize(462)).toBe(462)
    expect(clampPetSize(PET_SIZE_MIN)).toBe(PET_SIZE_MIN)
    expect(clampPetSize(PET_SIZE_MAX)).toBe(PET_SIZE_MAX)
  })

  it('clamps below MIN and above MAX', () => {
    expect(clampPetSize(0)).toBe(PET_SIZE_MIN)
    expect(clampPetSize(PET_SIZE_MIN - 1)).toBe(PET_SIZE_MIN)
    expect(clampPetSize(PET_SIZE_MAX + 1)).toBe(PET_SIZE_MAX)
    expect(clampPetSize(9999)).toBe(PET_SIZE_MAX)
  })

  it('rounds fractions', () => {
    expect(clampPetSize(462.6)).toBe(463)
    expect(clampPetSize(462.4)).toBe(462)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampPetSize(Number.NaN)).toBe(PET_SIZE_DEFAULT)
    expect(clampPetSize(Number.POSITIVE_INFINITY)).toBe(PET_SIZE_DEFAULT)
  })

  it('defaults to a wide 16:9 pet width', () => {
    expect(PET_SIZE_DEFAULT).toBe(462)
  })
})

describe('cachedThemeOrNull', () => {
  it('returns a valid theme id', () => {
    expect(cachedThemeOrNull('whale')).toBe('whale')
    expect(cachedThemeOrNull('dshpet')).toBe('dshpet')
    expect(cachedThemeOrNull('custom')).toBe('custom')
  })

  it('returns null for invalid or missing values', () => {
    expect(cachedThemeOrNull('invalid')).toBeNull()
    expect(cachedThemeOrNull('')).toBeNull()
    expect(cachedThemeOrNull(null)).toBeNull()
    expect(cachedThemeOrNull(undefined)).toBeNull()
  })
})
