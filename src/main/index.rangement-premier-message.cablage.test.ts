import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LE SEUL POINT que l'execution ne peut pas atteindre : l'ORDRE d'appel dans `runPilotChat`, une
 * closure locale de index.ts. L'EFFET du rangement, lui, est joue pour de vrai dans
 * rangement-premier-message.effet.test.ts — ce fichier ne porte plus que le cablage.
 *
 * CONTRAT DEPUIS LE 2026-09-26 (conv-867) : la reponse part TOUT DE SUITE, le rangement se fait a
 * cote. Le tour attendait avant l'appel au modele qui range la conversation (~5 s au premier
 * message), et ce trou affichait un faux « Reponse interrompue avant la fin » (conv-809, conv-862).
 * Si quelqu'un remet un `await` devant le rangement, l'attente revient : ce test doit tomber.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const pilote = source.slice(source.indexOf('const runPilotChat: typeof lancerTour'))
const corps = pilote.slice(0, pilote.indexOf('startupRecoverableChatCalls'))

describe('rangement automatique au premier message', () => {
  it('n est JAMAIS attendu avant de lancer la reponse', () => {
    expect(corps).toContain('rangerSurLePremierMessage(conversationId, args[1], finDuTour)')
    expect(corps).not.toMatch(/await\s+rangerSurLePremierMessage/)
    expect(corps).toMatch(/void\s+rangerSurLePremierMessage/)
    expect(corps.indexOf('rangerSurLePremierMessage(')).toBeLessThan(
      corps.indexOf('await lancerTour(...args)')
    )
  })

  it('demarre apres la bascule par chemin cite, qui prime sur lui', () => {
    expect(corps.indexOf('alignerDossierSurLaDemande(conversationId')).toBeGreaterThan(-1)
    expect(corps.indexOf('alignerDossierSurLaDemande(conversationId')).toBeLessThan(
      corps.indexOf('rangerSurLePremierMessage(')
    )
  })

  it('apprend la vraie fin du tour, meme quand le tour echoue', () => {
    const essai = corps.slice(corps.indexOf('try {'))
    expect(essai).toMatch(
      /try \{\s*return await lancerTour\(\.\.\.args\)\s*\} finally \{\s*finirTour\(\)/
    )
  })

  it('relit l etat courant et place son annonce au-dessus de la reponse en cours', () => {
    const rangement = source.slice(source.indexOf('const rangerSurLePremierMessage = async ('))
    const bloc = rangement.slice(0, rangement.indexOf('const runPilotChat'))
    expect(bloc).toContain('toujoursNonRangee: () =>')
    expect(bloc).toContain('avantLaReponseEnCours: true')
  })
})
