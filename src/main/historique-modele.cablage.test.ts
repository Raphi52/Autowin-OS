import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flattenChatParts, flattenChatPartsForModel } from '../shared/chat-turn'

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
const INDEX = readFileSync(join(__dirname, 'index.ts'), 'utf8').replace(/\s+/g, ' ')

describe('câblage — l’entrée du modèle est reconstruite depuis les parts', () => {
  it('runPilotChat consulte les parts stockées de la conversation', () => {
    expect(INDEX).toContain('const partsParContenu = new Map<string, PersistedChatPart[]>()')
  })

  it('le résultat ALIMENTE le contenu envoyé, il ne reste pas inutilisé', () => {
    // L'entrée qui doit faire échouer un débranchement : sans cette ligne, la map serait remplie
    // puis ignorée, et le modèle continuerait de recevoir l'étiquette nue.
    expect(
      INDEX,
      'le contenu envoyé au modèle doit venir de flattenChatPartsForModel'
    ).toContain('const pourLeModele = parts ? flattenChatPartsForModel(parts) || m.content : m.content')
    expect(INDEX).toContain("content: guardString(pourLeModele, 'content')")
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
