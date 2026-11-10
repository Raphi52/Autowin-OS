import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import { attendreFichier } from '../gel/ecriture-hors-fil'
import type { Message, SendOptions, SendResult } from '../providers/types'

/**
 * LE REDÉMARRAGE NE REMET PAS L'ÉTAT ENTIER.
 *
 * La base de comparaison de l'état (`dernierEtatPousse`) vivait dans une `Map` en mémoire. Or la
 * session du modèle, elle, est rétablie depuis le disque après un redémarrage : le tour repris
 * retrouvait donc son historique, mais plus la base à laquelle son état doit être comparé. Il
 * recevait alors le bloc ÉTAT DE L'APP entier (catalogue des skills compris) alors qu'il n'avait
 * besoin que de ce qui a changé.
 *
 * Le test joue le redémarrage : deux pilotes successifs sur la MÊME racine de données, le second sans
 * aucune mémoire du premier. Le premier message du second doit porter le diff, pas l'état entier.
 */
function pilote(etat: Record<string, unknown>): {
  pilot: AgentPilot
  envoyes: string[]
} {
  const envoyes: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      envoyes.push(messages.map((m) => m.content).join('\n'))
      return { text: 'réponse du modèle', sessionId: 'sess-redemarrage' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    // Sans cela, la reprise de session n'est PAS armée et le diff ne peut pas être testé.
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ ...etat })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), envoyes }
}

/*
 * UNE RACINE PAR TEST. Les données de test sont stables d'un run à l'autre : une session ou une base
 * laissée par un run précédent rendrait le test vert ou rouge sans rapport avec le code.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'aos-etat-redemarrage-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

describe('après un redémarrage, le tour repris reçoit le changement et non l’état entier', () => {
  it('la base de comparaison survit à la fermeture de l’app', async () => {
    const CONV = 'conv-redemarrage-1'
    const etat: Record<string, unknown> = {
      tab: 'chat',
      skillsDisponibles: ['build — …', 'scout — …']
    }

    // Avant le redémarrage : le premier tour porte l'état entier, puis la session est ouverte.
    const avant = pilote(etat)
    await avant.pilot.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    expect(avant.envoyes[0]).toContain('skillsDisponibles')
    // Le disque a reçu la base avant la fermeture : un redémarrage ne rattrape pas une écriture en vol.
    await attendreFichier()

    // Redémarrage : une nouvelle instance, sans mémoire de l'ancienne. Seul l'onglet a changé.
    etat.tab = 'accueil'
    const apres = pilote(etat)
    await apres.pilot.chat(
      [
        { role: 'user', content: 'bonjour' },
        { role: 'assistant', content: 'réponse du modèle' },
        { role: 'user', content: 'et maintenant ?' }
      ],
      () => {},
      undefined,
      12,
      CONV
    )

    const premier = apres.envoyes[0] ?? ''
    // La session est reprise, donc le bloc d'état part en diff...
    expect(premier).toContain('CHANGÉ DEPUIS LE DERNIER ÉTAT')
    expect(premier).toContain('"tab":"accueil"')
    // ...et le catalogue des skills, inchangé, ne repart pas.
    expect(premier).not.toContain('skillsDisponibles')
  })
})
