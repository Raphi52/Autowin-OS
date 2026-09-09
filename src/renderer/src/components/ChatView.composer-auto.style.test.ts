import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

/**
 * LE ROND DU MODE AUTO — geometrie et couleur figees par l'oeil de l'utilisateur, donc verifiees
 * ici : une retouche qui le rend OVALE ou plus gros que le micro repasse inapercue autrement.
 *
 * Deux defauts vecus le 2026-09-07 : (1) `align-self: stretch` etirait le bouton sur la hauteur
 * de la rangee, la largeur restait a 34 px et le cercle rendait un ovale ; (2) l'etat allume
 * etait rose (accent du theme) alors que la demande etait DOREE.
 */
describe('bouton mode auto du composer — rond, petit, dore', () => {
  const base = /\.composer-auto\s*{([^}]*)}/s.exec(styles)?.[1] ?? ''
  const actif = /\.composer-auto\.actif\s*{([^}]*)}/s.exec(styles)?.[1] ?? ''

  it('est un vrai ROND : largeur = hauteur, jamais etire sur la rangee', () => {
    expect(base).not.toBe('')
    const largeur = Number(/(?:^|\s)width:\s*(\d+)px/.exec(base)?.[1])
    const hauteur = Number(/(?:^|\s)height:\s*(\d+)px/.exec(base)?.[1])
    expect(largeur).toBe(hauteur)
    expect(base).toMatch(/border-radius:\s*50%/)
    // `stretch` reintroduirait l'ovale : la hauteur suivrait la rangee, la largeur non.
    expect(base).not.toMatch(/align-self:\s*stretch/)
  })

  it('reste PLUS PETIT que le micro voisin (34 px)', () => {
    const micro = Number(
      /^\.composer-dictee\s*\{[\s\S]*?width:\s*(\d+)px/m.exec(styles)?.[1]
    )
    const largeur = Number(/(?:^|\s)width:\s*(\d+)px/.exec(base)?.[1])
    expect(micro).toBeGreaterThan(0)
    expect(largeur).toBeLessThan(micro)
  })

  it('allume, il est DORE et non rose', () => {
    expect(actif).not.toBe('')
    // La teinte est DOREE, mais plus jamais ecrite en dur : le jeton or suit les huit themes,
    // alors que `#e3ba55` restait fige en clair sur un fond clair. Le test verrouille donc le
    // JETON — sans lui, un retour au rose passerait a nouveau inapercu.
    expect(actif).toMatch(/color:\s*var\(--gold-clair\)/)
    expect(actif).not.toMatch(/#e3ba55/i)
    expect(actif).toMatch(/rgba\(212, 169, 79/)
    expect(actif).not.toMatch(/239, 63, 145/)
  })
})
