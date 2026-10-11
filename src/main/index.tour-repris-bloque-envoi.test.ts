import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * UN SEUL AGENT PAR FIL APRÈS UN REDÉMARRAGE (conv-260, 2026-10-11).
 *
 * Le câblage vit dans `index.ts`, qu'on ne peut pas démarrer sous test (Electron) : on épingle donc
 * les trois points du site d'appel réel. Le comportement de la réservation elle-même est prouvé par
 * `active-chat-turns.tour-repris.test.ts`, celui de l'écran par `ChatView.tour-repris-adopte.test.tsx`.
 */
const source = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')

function bloc(debut: string, longueur: number): string {
  const i = source.indexOf(debut)
  expect(i, `introuvable : ${debut}`).toBeGreaterThan(0)
  return source.slice(i, i + longueur)
}

describe('index.ts — un tour repris bloque l’envoi d’un second tour', () => {
  it('la reprise réserve le fil comme tour REPRIS, pas comme tour ordinaire', () => {
    const reprise = bloc('const reprendreAppelChat = (call: RecoverableChatProviderCall): void => {', 600)
    expect(reprise).toContain(
      'activeChatTurns.setRecovered(call.conversationId, recoveryController, recoveryCompletion)'
    )
    expect(reprise).not.toContain('activeChatTurns.set(call.conversationId')
  })

  it('l’envoi normal refuse AVANT de lancer un tour quand un tour repris occupe le fil', () => {
    const envoi = bloc("ipcMain.handle('os:pilotChat',", 1200)
    const garde = envoi.indexOf('activeChatTurns.isRecovering(conversationId)')
    const lancement = envoi.indexOf('return runPilotChat(')
    expect(garde).toBeGreaterThan(0)
    expect(lancement).toBeGreaterThan(garde)
    expect(envoi.slice(garde, lancement)).toContain('throw new Error(')
  })

  it('les orientations tapées pendant la reprise sont rendues à l’écran à sa fin, même sans rejeu', () => {
    const reprise = bloc('const reprendreAppelChat = (call: RecoverableChatProviderCall): void => {', 7000)
    const fin = reprise.slice(reprise.indexOf('} finally {'))
    expect(fin).toContain('drainPendingDirectives(call.conversationId)')
    expect(fin).toContain("type: 'directives-orphelines'")
    expect(fin.indexOf('drainPendingDirectives')).toBeLessThan(fin.indexOf('resolveRecovery()'))
  })
})
