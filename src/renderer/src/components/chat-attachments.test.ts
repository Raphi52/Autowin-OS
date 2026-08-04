// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { bytesToBase64, encodeAttachment, fileKind, formatFileSize } from './chat-attachments'

describe('formatFileSize', () => {
  it('affiche les octets en dessous de 1024', () => {
    expect(formatFileSize(0)).toBe('0 o')
    expect(formatFileSize(512)).toBe('512 o')
    expect(formatFileSize(1023)).toBe('1023 o')
  })

  it('affiche les Ko arrondis en dessous de 1 Mo', () => {
    expect(formatFileSize(1024)).toBe('1 Ko')
    expect(formatFileSize(1536)).toBe('2 Ko')
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024 Ko')
  })

  it('affiche les Mo avec une décimale au-delà de 1 Mo', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 Mo')
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 Mo')
  })
})

describe('fileKind', () => {
  it("classe un fichier de type MIME image/* en 'image'", () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    expect(fileKind(file)).toBe('image')
  })

  it("classe un petit fichier texte/* en 'text'", () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    expect(fileKind(file)).toBe('text')
  })

  it("classe une extension connue sans MIME text/* en 'text' (sous la limite de taille)", () => {
    const file = new File(['{}'], 'data.json', { type: '' })
    expect(fileKind(file)).toBe('text')
  })

  it("classe un fichier texte trop volumineux en 'file' (dépasse MAX_INLINE_TEXT_BYTES)", () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1)
    const file = new File([big], 'huge.txt', { type: 'text/plain' })
    expect(fileKind(file)).toBe('file')
  })

  it("classe un binaire non reconnu en 'file'", () => {
    const file = new File(['data'], 'archive.bin', { type: 'application/octet-stream' })
    expect(fileKind(file)).toBe('file')
  })
})

describe('bytesToBase64', () => {
  it('encode un petit tableau d’octets', () => {
    const bytes = new TextEncoder().encode('hello')
    expect(bytesToBase64(bytes)).toBe(btoa('hello'))
  })

  it('encode un tableau vide', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })

  it('encode un tableau plus grand qu’un chunk (32768 octets) sans corruption', () => {
    const bytes = new Uint8Array(40_000).map((_, i) => i % 256)
    const encoded = bytesToBase64(bytes)
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })
})

describe('encodeAttachment', () => {
  it('encode un fichier texte en conservant son contenu littéral', async () => {
    const file = new File(['contenu de test'], 'a.txt', { type: 'text/plain' })
    const encoded = await encodeAttachment(file)
    expect(encoded).toMatchObject({
      name: 'a.txt',
      mimeType: 'text/plain',
      kind: 'text',
      content: 'contenu de test'
    })
    expect(encoded.thumbnail).toBeUndefined()
  })

  it('encode un fichier binaire non-image en base64, sans miniature', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.bin', {
      type: 'application/octet-stream'
    })
    const encoded = await encodeAttachment(file)
    expect(encoded.kind).toBe('file')
    expect(encoded.thumbnail).toBeUndefined()
    const decoded = Uint8Array.from(atob(encoded.content), (c) => c.charCodeAt(0))
    expect(decoded).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('applique application/octet-stream par défaut quand le fichier n’a pas de type MIME', async () => {
    const file = new File(['x'], 'noext', { type: '' })
    const encoded = await encodeAttachment(file)
    expect(encoded.mimeType).toBe('application/octet-stream')
  })
})
