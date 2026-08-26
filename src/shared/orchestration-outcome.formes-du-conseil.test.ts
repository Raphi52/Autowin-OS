import { describe, expect, it } from 'vitest'
import { demoteUnvalidatedSuccessClaims } from './orchestration-outcome'

/**
 * LE DÉFAUT, trouvé par l'audit du 2026-08-26 et reproduit à l'exécution.
 *
 * `structuredClosingMarker` ne dépouille que les dièses de titre et le gras. Deux formes que les
 * workers écrivent réellement passaient donc à travers :
 *
 *   `- 👉 Recommandé : lancer l'app`    → ressortait INTACT (puce non dépouillée, marqueur non
 *                                          reconnu, aucune annotation malgré un run non validé)
 *   `### 👉 Recommandé: lancer l'app`   → ressortait DUPLIQUÉ : « 👉 Recommandé — AUTO-DÉCLARÉ …
 *                                          : ### 👉 Recommandé: lancer l'app »
 *
 * Cause commune : la DÉTECTION dépouillait le préfixe, l'EXTRACTION du conseil ne le dépouillait
 * pas. Deux normalisations divergentes pour une seule question. Le fichier documentait pourtant
 * déjà avoir corrigé ce défaut pour `#` et `**` — rouvert pour la puce, et jamais refermé côté
 * extraction.
 */

const nonValide = { gateBlocked: true, status: 'failed', workRetained: true }
const annote = /^👉 Recommandé — AUTO-DÉCLARÉ[^\n]*: lancer l’app$/u

describe('toutes les formes d’écriture du conseil sont traitées pareil', () => {
  it.each([
    ['nue', '👉 Recommandé — lancer l’app'],
    ['en gras', '**👉 Recommandé** — lancer l’app'],
    ['en puce', '- 👉 Recommandé : lancer l’app'],
    ['en puce étoile', '* 👉 Recommandé — lancer l’app'],
    ['en puce numérotée', '1. 👉 Recommandé : lancer l’app'],
    ['en titre', '### 👉 Recommandé: lancer l’app'],
    ['en titre gras', '## **👉 Recommandé** — lancer l’app']
  ])('forme %s : annotée une seule fois, conseil intact', (_nom, ligne) => {
    const sortie = demoteUnvalidatedSuccessClaims(ligne, nonValide)

    expect(sortie).toMatch(annote)
    // Le marqueur ne doit apparaître qu'UNE fois : la duplication était le symptôme du titre.
    expect(sortie.match(/👉 Recommandé/gu)).toHaveLength(1)
    expect(sortie).not.toContain('#')
  })

  it('une ligne qui n’est pas un conseil reste intacte', () => {
    // Garde d'anti-sur-détection : le dépouillement des puces ne doit pas avaler autre chose.
    const ligne = '- lancer l’app et regarder l’accueil'
    expect(demoteUnvalidatedSuccessClaims(ligne, nonValide)).toBe(ligne)
  })
})
