import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * LE TOUR DE CHAT NE REDEMARRE PLUS L'APP POUR CHANGER DE DOSSIER.
 *
 * Le dossier de travail est resolu A CHAQUE TOUR depuis la conversation (`dossierDuTour`) et passe
 * en argument. Le court-circuit historique — basculer la preference puis relancer l'app AVANT de
 * lancer le tour — court-circuitait cette resolution : dans l'app reelle, le nouveau code n'etait
 * jamais atteint. Ce test epingle le site d'appel reel du chat (`os:pilotChat`).
 */
const source = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')

const handler = (() => {
  const debut = source.indexOf("ipcMain.handle('os:pilotChat'")
  expect(debut, 'handler os:pilotChat introuvable').toBeGreaterThan(0)
  return source.slice(debut, debut + 1500)
})()

describe('os:pilotChat : dossier resolu par tour, jamais par redemarrage', () => {
  it('ne declenche aucune bascule-redemarrage avant de lancer le tour', () => {
    expect(handler).not.toContain('basculerVersLeDossierDeLaConversation')
    expect(handler).not.toMatch(/redemarrerApp|writeExecutionWorkspacePreference|poserReprise/)
  })

  it('lance directement le tour, qui resout le dossier depuis la conversation', () => {
    expect(handler).toContain('runPilotChat(')
    expect(source).toContain('const dossierDuTour = (conversationId?: string): string =>')
  })

  it('la fonction de bascule-redemarrage n existe plus dans le module', () => {
    expect(source).not.toContain('basculerVersLeDossierDeLaConversation')
  })
})
