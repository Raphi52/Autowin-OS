import { describe, expect, it } from 'vitest'
import { boucleDraftEnCours } from './draft-choix-par-boutons'

/**
 * LE MODE /draft SE PERDAIT APRÈS DEUX MESSAGES LIBRES (scout conv-1332, 2026-10-30).
 *
 * `boucleDraftEnCours` ne lisait que les deux derniers messages, et n'acceptait `/draft` qu'en tête.
 * Les fils ci-dessous sont RELEVÉS sur le poste (messages de l'utilisateur, recopiés tels quels) :
 * conv-802 (« la D »), conv-1284 (« ok balec /draft… »), conv-1113 (« Reprends le /draft… »),
 * conv-1002, conv-903.
 *
 * ENTRÉES QUI FERAIENT TOMBER UNE CORRECTION FAUSSE :
 * - chercher « /draft » n'importe où : conv-1317 cite `skills/draft/SKILL.md` en plein `/git`, et
 *   conv-1306 nomme `scripts/draft-carrousel.mjs` (`/draft` s'y lit comme un mot à une frontière
 *   près) ;
 * - remonter sans limite : `/build` ou « go implémente » doivent couper la remontée, sinon un fil
 *   qui a fait un /draft il y a longtemps garde le refus de `ask` jusqu'à la fin de ses jours.
 */

const fil = (...messages: string[]): Array<{ role: string; content: string }> =>
  messages.flatMap((content) => [
    { role: 'user', content },
    { role: 'assistant', content: 'réponse' }
  ])

const enBoucle = (...messages: string[]): boolean => boucleDraftEnCours(fil(...messages), undefined)

describe('boucleDraftEnCours : le mode tient jusqu’à la sortie de la boucle', () => {
  it('survit à plusieurs réponses libres après /draft (conv-1002, conv-903)', () => {
    expect(enBoucle('/draft des super views', 'régie', '2', 'je vois pas de preview', '6')).toBe(
      true
    )
    expect(
      enBoucle(
        '/draft une barre de login',
        'le A mais plus large',
        '6',
        '6.3 et une animation',
        '3'
      )
    ).toBe(true)
  })

  it('reconnaît /draft au milieu d’une phrase (conv-1284, conv-1113, conv-815)', () => {
    expect(enBoucle('ok balec /draft comment adapter la vue chat', '1 et 3', 'la 2')).toBe(true)
    expect(enBoucle('Reprends le /draft de la Carte du projet : chaque', 'la 4', 'et la 5')).toBe(
      true
    )
    expect(enBoucle('Reprends le /draft.', 'la 4', 'et la 5')).toBe(true)
  })

  it('un clic sur le carrousel relance la remontée (conv-1163)', () => {
    expect(
      enBoucle(
        '/draft',
        'non ca me va pas',
        'Affiner la 1 · Lampe à lave',
        'plus lent',
        'plus gros'
      )
    ).toBe(true)
  })

  it('ne confond pas un chemin de fichier avec /draft (conv-1317, conv-1306)', () => {
    expect(
      enBoucle('écarte scripts/draft-carrousel.mjs et skills/draft/SKILL.md', '1 et 3', 'la 2')
    ).toBe(false)
    expect(enBoucle('regarde D:/tmp/draft-nav/tour3.md', 'la 2', 'la 3')).toBe(false)
    expect(enBoucle('lis /draft-carrousel.mjs', 'la 2', 'la 3')).toBe(false)
  })

  it('ne lit pas une mention entre guillemets de code (scout conv-1332)', () => {
    expect(enBoucle('Le mode `/draft` se perd après deux messages', 'la 2', 'la 3')).toBe(false)
  })

  it('ne prend pas pour une invocation /draft cité loin dans une consigne (conv-1304, conv-1306)', () => {
    const consigne =
      'Fais ces 2 suites proposées, dans cet ordre : 1. Fais remplir ma zone de saisie par les boutons ' +
      'des pages interactives, puis passe le carrousel /draft 3D en page interactive et supprime le reste'
    expect(enBoucle(consigne, 'La chaîne de ce fil est terminée.')).toBe(false)
    expect(
      enBoucle(`${'x'.repeat(120)} pour que /draft n'ait plus à recopier le carrousel`, 'la 2')
    ).toBe(false)
    // Le jumeau : à 68 caractères du début, la plus loin des invocations relevées (conv-815).
    expect(enBoucle(`${'x'.repeat(68)} /draft quelques exemples`, 'la 2', 'la 3')).toBe(true)
  })

  it('tient 8 réponses libres (conv-904, la plus longue relevée), pas toute la vie du fil', () => {
    const libres = (n: number): string[] => Array.from({ length: n }, (_, i) => `réponse ${i}`)
    expect(enBoucle('/draft x', ...libres(8))).toBe(true)
    expect(enBoucle('/draft x', ...libres(10))).toBe(true)
    expect(enBoucle('/draft x', ...libres(11))).toBe(false)
    // Le repère le plus récent compte : un clic remet le compte à zéro.
    expect(enBoucle('/draft x', ...libres(9), 'Affiner la 1 · Y', ...libres(9))).toBe(true)
  })

  it('« Implémenter » ferme la boucle, même précédé d’un mot (conv-1002)', () => {
    expect(
      enBoucle('/draft x', 'la 2', 'Implémenter la 2 · Platine', 'corrige le bouton', 'et le titre')
    ).toBe(false)
    expect(
      enBoucle('/draft x', '6', '2', 'go implémente en fonction du theme', 'ajoute un repère')
    ).toBe(false)
    expect(enBoucle('/draft x', '6', 'ok implémente la 6', 'ajoute un repère', 'et un autre')).toBe(
      false
    )
  })

  it('une autre commande ferme la boucle (conv-386)', () => {
    expect(
      enBoucle('/draft x', 'la 2', '/build corrige le bouton stop', 'et le titre', 'la 3')
    ).toBe(false)
  })

  it('un nouveau /draft après une implémentation rouvre la boucle (conv-1306)', () => {
    expect(
      enBoucle(
        '/draft x',
        'Implémenter la 2 · Y',
        'Reprends le /draft : autre piste',
        'la 3',
        'la 4'
      )
    ).toBe(true)
  })

  it('un libellé de carrousel contenant « implémentation » reste un clic du carrousel', () => {
    expect(enBoucle('/draft x', 'Affiner la 2 · Implémentation légère', 'plus court', 'la 3')).toBe(
      true
    )
  })

  it('un fil sans /draft reste hors boucle', () => {
    expect(enBoucle('regarde src/a.ts', 'corrige le bug', 'la 2')).toBe(false)
    expect(boucleDraftEnCours([], undefined)).toBe(false)
  })
})
