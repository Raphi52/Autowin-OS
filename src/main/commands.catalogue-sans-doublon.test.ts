import { describe, expect, it } from 'vitest'
import { CATALOG } from './commands'
import { REGLES_ECRAN_UTILISATEUR } from './chat-pilotage-prompt'

/**
 * MESURE (conv-614, 2026-09-16) : le catalogue de commandes pese 12 390 caracteres dans le prompt
 * systeme, et `desktop_observe` en occupait a lui seul 1 263 — dont un preambule qui REPETAIT mot
 * pour mot la regle du bureau cache deja portee par REGLES_VISUELLES (lanceur, script de capture,
 * defaut vecu conv-586). Deux fois la meme regle dans le MEME prompt.
 *
 * Ce test tient la deduplication : la regle vit a UN endroit, la description garde le contrat de
 * l'argument (`ecran_utilisateur: true`) et y renvoie.
 */
describe('catalogue de commandes sans doublon du prompt', () => {
  const desktopObserve = CATALOG.find((c) => c.name === 'desktop_observe')

  it('expose bien la commande mesuree', () => {
    expect(desktopObserve).toBeDefined()
  })

  // Depuis kaizen conv-835, la regle vit dans REGLES_ECRAN_UTILISATEUR, servi a CHAQUE tour.
  it('ne repete pas la procedure du bureau cache, qui vit dans les regles de l ecran', () => {
    const description = desktopObserve?.description ?? ''
    expect(REGLES_ECRAN_UTILISATEUR).toContain('hdesk-lancer.ps1')
    expect(description).toContain("ECRAN DE L'UTILISATEUR = SON ESPACE")
    expect(description).not.toContain('REGLES_VISUELLES')
    expect(description).not.toContain('hdesk-lancer.ps1')
    expect(description).not.toContain('hdesk-observe.ps1')
    expect(description).not.toContain('ui-capture.mjs')
  })

  it('garde le contrat que la commande est seule a porter', () => {
    const description = desktopObserve?.description ?? ''
    expect(description).toContain('ecran_utilisateur: true')
    expect(description).toContain('display: 0')
    expect(description).toContain('display: 1')
  })

  /**
   * Garde-fou de poids : aucune description ne doit redevenir un paragraphe. Mesure du 2026-09-16
   * apres deduplication : `desktop_observe` = la plus longue du catalogue, sous 1 000 caracteres.
   */
  it('garde chaque description sous un plafond de paragraphe', () => {
    for (const commande of CATALOG) {
      expect(
        commande.description.length,
        `${commande.name} est redevenue un paragraphe`
      ).toBeLessThan(1000)
    }
  })
})
