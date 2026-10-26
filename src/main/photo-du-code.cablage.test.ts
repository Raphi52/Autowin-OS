import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * CÂBLAGE DE LA PHOTO DU CODE (conv-1038, 2026-10-21). Le module est testé sur un vrai dépôt
 * (`photo-du-code.test.ts`) ; ce test tient les trois conditions qui font qu'une photo sert à
 * « revenir à ce tour » :
 *  - elle est prise dans le runner du tour de chat (`runPilotChat`), le seul passage de TOUS les
 *    tours (saisie, mode auto, tâche planifiée) ;
 *  - AVANT que le modèle écrive (`await lancerTour`) — après, elle montrerait la fin du tour ;
 *  - jamais pour un tour REPRIS après un redémarrage (`args[4]`, la reprise) : il a commencé avant.
 */
const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function corpsDuRunner(): string {
  const debut = index.indexOf('const tourCompteDesReception: typeof lancerTour = (...args) =>')
  const fin = index.indexOf('const resultat = await lancerTour(...args)', debut)
  expect(debut).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return index.slice(debut, fin)
}

describe('photo du code — câblée au début de chaque tour', () => {
  it('prise dans runPilotChat, avant que le tour parte', () => {
    expect(corpsDuRunner()).toMatch(
      /await photographierLeCode\(\{ dossier: dossierDuTour\(conversationId\), conversationId \}\)/
    )
  })

  it('jamais pour un tour repris après un redémarrage', () => {
    expect(corpsDuRunner()).toMatch(/if \(args\[4\] === undefined\)\s*await photographierLeCode\(/)
  })

  it('le canal « revenir à ce tour » ouvre ses copies hors du dossier partagé', () => {
    expect(index).toMatch(
      /dossierDesRetours: \(\) => join\(ensureAutowinAppData\(appDataRoot\), 'retours-de-tour'\)/
    )
  })
})
