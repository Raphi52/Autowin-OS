import { describe, expect, it } from 'vitest'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'
import { flattenChatParts, flattenChatPartsForModel } from '../shared/chat-turn'
import { contenuAssistantPourLeModele } from './chat/dernier-run-entier'

/**
 * L'HISTORIQUE DU MODELE EST-IL REELLEMENT RECONSTRUIT ?
 *
 * `flattenChatPartsForModel` est teste a part. Ce test-ci verifie le CABLAGE : sans lui, on aurait
 * une fonction correcte que personne n'appelle — « expose mais pas integre », le defaut le plus
 * couteux de ce depot, et celui-la meme qui a laisse cette correction dormir dix jours dans un
 * bureau abandonne.
 *
 * LECON DU 2026-08-26, apprise a mes depens le meme jour : un garde qui verifie la PRESENCE d'un
 * appel ne detecte pas qu'on a debranche sa CONSOMMATION. Sabotage joue sur un autre garde ce
 * jour-la : retirer l'usage du resultat le laissait VERT. On exige donc les deux.
 */
// La ZONE du process principal, pas un chemin : ce cablage a quitte `index.ts` pour
// `src/main/chat/` (mesure du 2026-09-02) — un demenagement n'est pas une regression.
const INDEX = sourceProcessPrincipal().replace(/\s+/g, ' ')

describe('câblage — l’entrée du modèle est reconstruite depuis les parts', () => {
  it('runPilotChat consulte les parts stockées de la conversation', () => {
    expect(INDEX).toContain('const partsParContenu = new Map<string, PersistedChatPart[]>()')
  })

  it('le résultat ALIMENTE le contenu envoyé, il ne reste pas inutilisé', () => {
    // L'entrée qui doit faire échouer un débranchement : sans cette ligne, la map serait remplie
    // puis ignorée, et le modèle continuerait de recevoir l'étiquette nue.
    //
    // Depuis 1d20dd6c (2026-10-16, conv-989) le DERNIER run est relu en entier dans son journal :
    // l'appel passe par `contenuAssistantPourLeModele`, qui rend `flattenChatPartsForModel` sur
    // toutes ses branches (vérifié par comportement ci-dessous, pas par texte). Aligné le
    // 2026-10-22 (conv-1056).
    expect(INDEX, 'le contenu envoyé au modèle doit venir des parts reconstruites').toMatch(
      /const pourLeModele = parts \? contenuAssistantPourLeModele\( parts,[^;]*?\) \|\| m\.content : m\.content/
    )
    expect(INDEX).toContain("content: guardString(pourLeModele, 'content')")
  })

  it('sans run à relire, l’entrée du modèle EST flattenChatPartsForModel', () => {
    const parts = [
      { kind: 'text' as const, text: 'Je lance la vérification.' },
      { kind: 'action' as const, actionId: 'a1', name: 'verify', ok: true, data: { exitCode: 0 } }
    ]
    expect(contenuAssistantPourLeModele(parts)).toBe(flattenChatPartsForModel(parts))
  })

  it('l’affichage garde l’étiquette courte — les deux besoins restent séparés', () => {
    const parts = [
      { kind: 'action' as const, actionId: 'a1', name: 'verify', ok: true, data: { exitCode: 0 } }
    ]
    // Si quelqu'un « simplifiait » en faisant pointer les deux vers la même fonction, le rendu
    // deverserait la sortie verbeuse dans l'interface.
    expect(flattenChatParts(parts)).toBe('[a exécuté verify]')
    expect(flattenChatPartsForModel(parts)).toContain('exitCode')
  })
})
