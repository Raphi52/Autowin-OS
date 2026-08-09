import { describe, expect, it, vi } from 'vitest'
import { WindowsDesktopController, parseDesktopActions } from './desktop-control'

describe('desktop control validation', () => {
  it('accepte les deux bornes normalisees inclusives', () => {
    expect(
      parseDesktopActions([
        { type: 'move', x: 0, y: 1000 },
        { type: 'click', x: 1000, y: 0 }
      ])
    ).toEqual([
      { type: 'move', x: 0, y: 1000 },
      { type: 'click', x: 1000, y: 0, button: 'left', clicks: 1 }
    ])
  })

  it('normalise une sequence complete avant execution', () => {
    expect(
      parseDesktopActions([
        { type: 'move', x: 120, y: 42 },
        { type: 'click', x: 10, y: 20, button: 'right', clicks: 2 },
        { type: 'scroll', delta: -480 },
        { type: 'type', text: 'Bonjour é' },
        { type: 'key', keys: ['ctrl', 'shift', 's'] },
        { type: 'open', target: 'notepad.exe', args: ['C:\\Temp\\note.txt'] },
        { type: 'wait', ms: 250 }
      ])
    ).toEqual([
      { type: 'move', x: 120, y: 42 },
      { type: 'click', x: 10, y: 20, button: 'right', clicks: 2 },
      { type: 'scroll', delta: -480 },
      { type: 'type', text: 'Bonjour é' },
      { type: 'key', keys: ['CTRL', 'SHIFT', 'S'] },
      { type: 'open', target: 'notepad.exe', args: ['C:\\Temp\\note.txt'] },
      { type: 'wait', ms: 250 }
    ])
  })

  it.each([
    null,
    [],
    Array.from({ length: 21 }, () => ({ type: 'wait', ms: 1 })),
    [{ type: 'click', x: Number.NaN, y: 2 }],
    [{ type: 'type', text: 'x'.repeat(20_001) }],
    [{ type: 'key', keys: ['CTRL', 'NOPE'] }],
    [{ type: 'open', target: '' }],
    [{ type: 'wait', ms: 5_001 }]
  ])('refuse toute la sequence malformee avant un effet: %j', (input) => {
    expect(() => parseDesktopActions(input)).toThrow()
  })
})

describe('WindowsDesktopController', () => {
  it('rend une capture comme attachement ephemere et metadonnees sans base64', async () => {
    const capture = vi.fn().mockResolvedValue({
      data: {
        width: 1600,
        height: 900,
        sourceWidth: 3840,
        sourceHeight: 2160,
        originX: -1920,
        originY: 0,
        mimeType: 'image/jpeg',
        scope: 'desktop'
      },
      attachment: {
        name: 'source.jpg',
        mimeType: 'image/jpeg',
        size: 3,
        kind: 'image',
        content: 'YWJj'
      }
    })
    const controller = new WindowsDesktopController({ platform: 'win32', capture })

    const observed = await controller.observe()

    expect(observed.data).toEqual({
      width: 1600,
      height: 900,
      sourceWidth: 3840,
      sourceHeight: 2160,
      originX: -1920,
      originY: 0,
      mimeType: 'image/jpeg',
      scope: 'desktop'
    })
    expect(observed.attachment).toEqual({
      name: 'desktop-current.jpg',
      mimeType: 'image/jpeg',
      size: 3,
      kind: 'image',
      content: 'YWJj'
    })
    expect(JSON.stringify(observed.data)).not.toContain('YWJj')
  })

  it('valide le batch entier avant de lancer PowerShell', async () => {
    const run = vi.fn()
    const controller = new WindowsDesktopController({ platform: 'win32', run })

    await expect(
      controller.act([
        { type: 'click', x: 1, y: 2 },
        { type: 'key', keys: ['CTRL', 'NOPE'] }
      ])
    ).rejects.toThrow(/touche/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('execute un batch prepare et exige le compte exact', async () => {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify({ executed: 2 }))
    const capture = vi.fn().mockResolvedValue({
      data: {
        width: 1000,
        height: 500,
        sourceWidth: 2000,
        sourceHeight: 1000,
        originX: -1000,
        originY: 0,
        mimeType: 'image/jpeg',
        scope: 'desktop'
      },
      attachment: {
        name: 'source.jpg',
        mimeType: 'image/jpeg',
        size: 3,
        kind: 'image',
        content: 'YWJj'
      }
    })
    const controller = new WindowsDesktopController({ platform: 'win32', run, capture })

    await controller.observe()
    await expect(
      controller.act([
        { type: 'click', x: 1000, y: 1000 },
        { type: 'key', keys: ['CTRL', 'A'] }
      ])
    ).resolves.toEqual({ executed: 2 })
    expect(run).toHaveBeenCalledTimes(1)
    const encoded = run.mock.calls[0][0] as string
    const script = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(script).toContain('SendInput')
    expect(script).toContain('SetPhysicalCursorPos')
    expect(script).not.toContain('NOPE')
    const payload = /FromBase64String\('([^']+)'\)/.exec(script)?.[1]
    expect(payload).toBeTruthy()
    expect(JSON.parse(Buffer.from(payload!, 'base64').toString('utf8'))[0]).toMatchObject({
      x: 999,
      y: 999,
      desktopLeft: -1000,
      desktopTop: 0,
      desktopWidth: 2000,
      desktopHeight: 1000
    })
  })

  it('refuse un faux succes partiel et les plateformes non Windows', async () => {
    const partial = new WindowsDesktopController({
      platform: 'win32',
      run: vi.fn().mockResolvedValue(JSON.stringify({ executed: 1 }))
    })
    await expect(
      partial.act([
        { type: 'key', keys: ['CTRL', 'A'] },
        { type: 'wait', ms: 1 }
      ])
    ).rejects.toThrow(/1\/2/)

    const unsupported = new WindowsDesktopController({ platform: 'linux', run: vi.fn() })
    await expect(unsupported.observe()).rejects.toThrow(/Windows/i)
  })
})
