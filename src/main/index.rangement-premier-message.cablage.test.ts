import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LE SEUL POINT que l'execution ne peut pas atteindre : l'ORDRE d'appel dans `runPilotChat`, une
 * closure locale de index.ts. L'EFFET du rangement, lui, est joue pour de vrai dans
 * rangement-premier-message.effet.test.ts — ce fichier ne porte plus que le cablage : le rangement deduit du premier message doit etre
 * appele AVANT que le tour parte (donc avant que le dossier du tour serve de cwd au CLI). Si
 * l'appel disparait de `runPilotChat`, le module reste vert et le defaut de conv-611 revient.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('rangement automatique au premier message', () => {
  it('est appele dans runPilotChat, avant la bascule par chemin cite', () => {
    const pilote = source.slice(source.indexOf('const runPilotChat: typeof lancerTour'))
    const entete = pilote.slice(0, 600)
    expect(entete).toContain('rangerSurLePremierMessage(conversationId, args[1])')
    expect(entete.indexOf('rangerSurLePremierMessage')).toBeLessThan(
      entete.indexOf('alignerDossierSurLaDemande')
    )
  })
})
