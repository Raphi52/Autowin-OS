import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Lisibilité du fil : le corps d'un message se lisait à 13px (hérité du body) avec une
 * interligne d'interface (1.55). Claude web lit à ~16px / 1.65 sur une mesure d'environ
 * 46rem. Ce test fige la typographie de LECTURE de la colonne de conversation.
 * Entrée qui ferait échouer ce test si la correction était fausse : remettre
 * `font-size: 13px` (ou aucune règle) sur `.msg-body`, ou une interligne < 1.65.
 */
const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

const rule = (selector: string): string | undefined => {
  const marker = '\n' + selector + ' {'
  const start = css.indexOf(marker)
  if (start === -1) return undefined
  const from = start + marker.length
  const end = css.indexOf('}', from)
  return css.slice(from, end)
}

const px = (block: string | undefined, prop: string): number => {
  const after = block?.split(prop + ':')[1]
  return after ? Number.parseFloat(after.trim()) : Number.NaN
}

describe('typographie de lecture du fil de conversation', () => {
  it('donne au corps de message une taille de lecture, pas une taille d interface', () => {
    const body = rule('.msg-body')
    expect(body).toBeDefined()
    expect(px(body, 'font-size')).toBeGreaterThanOrEqual(15)
  })

  it('aere l interligne du corps de message au niveau prose', () => {
    const lh = rule('.msg-body')?.match(/line-height:\s*([0-9.]+)/)?.[1]
    expect(Number(lh)).toBeGreaterThanOrEqual(1.65)
  })

  it('borne la mesure du texte pour rester confortable a l oeil', () => {
    const maxWidth = px(rule('.msg'), 'max-width')
    expect(maxWidth).toBeGreaterThanOrEqual(680)
    expect(maxWidth).toBeLessThanOrEqual(820)
  })

  it('respire entre les messages plutot que de les tasser', () => {
    const scroll = rule('.chat-scroll')
    expect(scroll).toMatch(/row-gap:\s*(2[0-9]|3[0-9])px/)
  })
})
