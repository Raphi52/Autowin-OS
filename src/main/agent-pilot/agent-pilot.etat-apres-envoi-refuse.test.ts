import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import { attendreFichier } from '../gel/ecriture-hors-fil'
import type { Message, SendOptions, SendResult } from '../providers/types'

/**
 * LA BASE DE COMPARAISON N'AVANCE QU'APRÈS UN ENVOI ACCEPTÉ.
 *
 * Le bloc ÉTAT DE L'APP part en diff contre le dernier état que le modèle a REÇU. La base avançait dès
 * que le message était construit : un envoi en échec (réseau, quota, arrêt) laissait une base que le
 * modèle n'avait jamais vue, et le tour suivant taisait le changement comme s'il était déjà connu.
 */
function pilote(etat: Record<string, unknown>): {
  pilot: AgentPilot
  envoyes: string[]
  refuser: { actif: boolean }
} {
  const envoyes: string[] = []
  const refuser = { actif: false }
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      if (refuser.actif) throw new Error('envoi refusé par le banc')
      envoyes.push(messages.map((m) => m.content).join('\n'))
      return { text: 'réponse du modèle', sessionId: 'sess-envoi-refuse' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ ...etat })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), envoyes, refuser }
}

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'aos-etat-envoi-refuse-'))
  configureAutowinAppDataBase(racine)
})
afterEach(async () => {
  // Une écriture de la base peut encore être en vol à la fin du test : sans l'attendre, rmSync
  // (récursif) se heurte à un dossier qui se remplit (ENOTEMPTY).
  await attendreFichier()
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

describe('un envoi en échec ne fait pas avancer la base de comparaison de l’état', () => {
  it('le tour suivant redit le changement que le modèle n’a jamais reçu', async () => {
    const CONV = 'conv-envoi-refuse-1'
    const etat: Record<string, unknown> = { tab: 'chat', skillsDisponibles: ['build — …'] }
    const { pilot, envoyes, refuser } = pilote(etat)
    const fil: Message[] = [{ role: 'user', content: 'bonjour' }]

    await pilot.chat(fil, () => {}, undefined, 12, CONV)
    expect(envoyes[0]).toContain('skillsDisponibles')

    // L'onglet change, puis l'envoi du tour suivant échoue : le modèle ne voit pas « accueil ».
    etat.tab = 'accueil'
    fil.push(
      { role: 'assistant', content: 'réponse du modèle' },
      { role: 'user', content: 'et là ?' }
    )
    refuser.actif = true
    await pilot.chat(fil, () => {}, undefined, 12, CONV).catch(() => undefined)
    expect(envoyes).toHaveLength(1)

    // Nouvel essai, état inchangé depuis l'échec : le changement doit partir cette fois.
    refuser.actif = false
    await pilot.chat(fil, () => {}, undefined, 12, CONV)
    const dernier = envoyes.at(-1) ?? ''
    expect(dernier).toContain('"tab":"accueil"')
  })
})
