import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPetAssetHandler, type DeskHttpRequest, type DeskHttpResponse } from '../src/http.ts'

interface Captured {
  status: number
  headers?: Record<string, string>
  body?: string | Uint8Array
}

function mockRes(): { res: DeskHttpResponse; captured: Captured } {
  const captured: Captured = { status: 0 }
  const res: DeskHttpResponse = {
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers
    },
    end(body) {
      captured.body = body
    },
  }
  return { res, captured }
}

function req(url: string, method = 'GET'): DeskHttpRequest {
  const iterable = {
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      // empty body
    },
  }
  return { url, method, ...iterable }
}

describe('createPetAssetHandler', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-pet-assets-'))
    writeFileSync(join(dir, 'ok.gif'), Buffer.from([0x47, 0x49, 0x46, 0x00]))
    writeFileSync(join(dir, 'ok.webm'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    writeFileSync(join(dir, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves an existing gif with image/gif content type', async () => {
    const { res, captured } = mockRes()
    await createPetAssetHandler(dir)(req('/session-desk/assets/pet/ok.gif'), res)
    expect(captured.status).toBe(200)
    expect(captured.headers?.['content-type']).toBe('image/gif')
    expect(captured.body).toEqual(Buffer.from([0x47, 0x49, 0x46, 0x00]))
  })

  it('serves an existing webm with video/webm content type', async () => {
    const { res, captured } = mockRes()
    await createPetAssetHandler(dir)(req('/session-desk/assets/pet/ok.webm'), res)
    expect(captured.status).toBe(200)
    expect(captured.headers?.['content-type']).toBe('video/webm')
    expect(captured.body).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  })

  it('serves an existing png with image/png content type', async () => {
    const { res, captured } = mockRes()
    await createPetAssetHandler(dir)(req('/session-desk/assets/pet/ok.png'), res)
    expect(captured.status).toBe(200)
    expect(captured.headers?.['content-type']).toBe('image/png')
    expect(captured.body).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('returns 404 for a missing file', async () => {
    const { res, captured } = mockRes()
    await createPetAssetHandler(dir)(req('/session-desk/assets/pet/nope.gif'), res)
    expect(captured.status).toBe(404)
  })

  it('rejects path traversal', async () => {
    const { res, captured } = mockRes()
    await createPetAssetHandler(dir)(req('/session-desk/assets/pet/../ok.gif'), res)
    expect(captured.status).toBe(404)
  })

  it('rejects non-GET methods', async () => {
    const { res, captured } = mockRes()
    await createPetAssetHandler(dir)(req('/session-desk/assets/pet/ok.gif', 'POST'), res)
    expect(captured.status).toBe(405)
  })
})
