import { describe, expect, it, vi } from 'vitest'
import { WindowsDesktopController, parseDesktopActions } from './desktop-control'

/**
 * LE GLISSER-DEPOSER ETAIT REFUSE ALORS QUE L'USAGE LE RECLAMAIT.
 *
 * MESURE le 2026-09-11 sur `.autowin-data/autowin-os/causal-trace` : « Type d'action desktop
 * inconnu: drag » revient 13 fois, et « doubleClick » (camelCase) 6 fois. L'agent tente ces gestes
 * de lui-meme — deplacer une fenetre, redimensionner, selectionner — et le refus le renvoie cliquer
 * a l'aveugle, enchainement deja constate et documente pour `double_click`.
 */
describe('drag, le glisser-deposer', () => {
  it('est ACCEPTE au lieu d etre refuse', () => {
    expect(() =>
      parseDesktopActions([{ type: 'drag', x: 100, y: 100, toX: 800, toY: 400 }])
    ).not.toThrow()
  })

  it('porte le depart, l arrivee, le bouton gauche et un nombre de paliers par defaut', () => {
    const [action] = parseDesktopActions([{ type: 'drag', x: 100, y: 100, toX: 800, toY: 400 }])
    expect(action).toMatchObject({
      type: 'drag',
      x: 100,
      y: 100,
      toX: 800,
      toY: 400,
      button: 'left',
      steps: 20
    })
  })

  it('accepte la forme objet `from`/`to`, tout aussi naturelle', () => {
    const [action] = parseDesktopActions([
      { type: 'drag', from: { x: 10, y: 20 }, to: { x: 30, y: 40 } }
    ])
    expect(action).toMatchObject({ type: 'drag', x: 10, y: 20, toX: 30, toY: 40 })
  })

  it('normalise les alias `dragTo` et `drag_and_drop` en `drag`', () => {
    for (const type of ['dragTo', 'drag_and_drop']) {
      const [action] = parseDesktopActions([{ type, x: 1, y: 2, toX: 3, toY: 4 }])
      expect(action.type).toBe('drag')
    }
  })

  it('refuse une arrivee hors du repere 0-1000', () => {
    expect(() =>
      parseDesktopActions([{ type: 'drag', x: 0, y: 0, toX: 1200, toY: 0 }])
    ).toThrow(/toX/)
  })

  it('refuse une arrivee absente plutot que d inventer un point', () => {
    expect(() => parseDesktopActions([{ type: 'drag', x: 0, y: 0 }])).toThrow(/toX/)
  })

  it('borne les paliers : ni un saut direct, ni une rafale sans fin', () => {
    expect(() =>
      parseDesktopActions([{ type: 'drag', x: 0, y: 0, toX: 1, toY: 1, steps: 1 }])
    ).toThrow(/steps/)
    expect(() =>
      parseDesktopActions([{ type: 'drag', x: 0, y: 0, toX: 1, toY: 1, steps: 500 }])
    ).toThrow(/steps/)
  })
})

describe('doubleClick, l alias camelCase', () => {
  it('vaut un clic double, comme `double_click`', () => {
    for (const type of ['doubleClick', 'doubleclick']) {
      const [action] = parseDesktopActions([{ type, x: 500, y: 500 }])
      expect(action).toMatchObject({ type: 'click', clicks: 2 })
    }
  })

  it('ne change RIEN au clic simple', () => {
    const [action] = parseDesktopActions([{ type: 'click', x: 5, y: 5 }])
    expect(action).toMatchObject({ type: 'click', clicks: 1 })
  })

  it('refuse toujours un type reellement inconnu', () => {
    expect(() => parseDesktopActions([{ type: 'tripleClick', x: 5, y: 5 }])).toThrow()
  })
})

describe('drag, du repere 0-1000 aux pixels Windows', () => {
  it('convertit l ARRIVEE avec la meme geometrie que le depart', async () => {
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
    let script = ''
    const run = vi.fn(async (encoded: string) => {
      script = Buffer.from(encoded, 'base64').toString('utf16le')
      return JSON.stringify({ executed: 1 })
    })
    const controller = new WindowsDesktopController({ platform: 'win32', capture, run })
    await controller.observe()
    await controller.act([{ type: 'drag', x: 0, y: 0, toX: 1000, toY: 1000 }])

    const payload = /FromBase64String\('([^']+)'\)/.exec(script)?.[1] ?? ''
    const prepared = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Array<
      Record<string, number | string>
    >
    // Depart en haut a gauche du bureau, arrivee sur son dernier pixel : la meme regle des deux cotes.
    expect(prepared[0]).toMatchObject({
      type: 'drag',
      x: -1920,
      y: 0,
      toX: -1920 + 3839,
      toY: 2159
    })
    // Le geste doit exister dans le script execute, sinon la conversion ne sert a rien.
    expect(script).toContain("'drag'")
    expect(script).toContain('ButtonDown')
    expect(script).toContain('ButtonUp')
  })
})
