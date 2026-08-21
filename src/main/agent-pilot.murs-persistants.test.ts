import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase, ensureAutowinAppData } from './app-data'
import type { Message, SendOptions, SendResult } from './providers/types'
import { chargerMurs } from './runs/murs-store'

/**
 * PREUVE DU BRANCHEMENT, pas du module — le store est teste dans `runs/murs-store.test.ts`.
 *
 * La seule question qui compte : un mur rencontre au TOUR 1 est-il encore connu au TOUR 2 ? Sans ce
 * test on aurait un store correct et un import visible, soit exactement le motif « ca a l'air
 * branche, ca ne l'est pas » : l'agent remangerait le meme mur en croyant chaque fois le decouvrir.
 */
const ESCALADE = 'tu as DÉJÀ rencontré exactement cette erreur'
const REPRISE = 'ta dernière action a ÉCHOUÉ et tu t’arrêtes sur ce constat'

function harnais(base: string, reponses: string[], echoueToujours: boolean) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: reponses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  let appels = 0
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => {
      appels += 1
      return echoueToujours || appels === 1
        ? { ok: false, error: 'ENOENT: chemin introuvable' }
        : { ok: true, data: { ok: true } }
    })
  }
  configureAutowinAppDataBase(base)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const history: Message[] = [{ role: 'user', content: 'corrige le fichier de config' }]
const SOIGNEE = true

async function tour(p: AgentPilot, conv: string): Promise<void> {
  await p.chat(history, () => {}, undefined, 8, conv, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, SOIGNEE)
}

describe('un mur du TOUR 1 est encore connu au TOUR 2', () => {
  let base = ''
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
    if (base) rmSync(base, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('le mur survit au tour ET à un AgentPilot neuf (app redémarrée)', async () => {
    base = mkdtempSync(join(tmpdir(), 'murs-pilot-'))
    const t1 = harnais(base, [
      'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
      'La commande a échoué : chemin introuvable.',
      'Je reprends.<cmd>{"name":"get_state","args":{}}</cmd>',
      '✅ Fait.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
    ], false)
    await tour(t1.pilot, 'conv-Z')
    // Le tour 1 a bien rencontre le mur ET l'a persiste.
    // `ensureAutowinAppData` rend un SOUS-DOSSIER de la racine : lire `base` nu pointerait a cote.
    expect(chargerMurs('conv-Z', ensureAutowinAppData()).length).toBe(1)
    // Le tour 1 recoit la consigne ORDINAIRE : c'est sa premiere rencontre.
    expect(t1.sent.some((c) => c.includes(REPRISE))).toBe(true)
    expect(t1.sent.some((c) => c.includes(ESCALADE))).toBe(false)

    // TOUR 2 sur un pilote NEUF — la Map memoire est vide, seul le disque peut savoir.
    const t2 = harnais(base, [
      'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
      'La commande a échoué : chemin introuvable.',
      'Autre approche.<cmd>{"name":"get_state","args":{}}</cmd>',
      '✅ Fait.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
    ], false)
    await tour(t2.pilot, 'conv-Z')
    // LE point : dès la PREMIÈRE rencontre du tour 2, l'escalade tombe — le mur était déjà connu.
    expect(t2.sent.some((c) => c.includes(ESCALADE))).toBe(true)
  })

  it('une AUTRE conversation ne subit pas les murs de la première', async () => {
    base = mkdtempSync(join(tmpdir(), 'murs-pilot-'))
    const t1 = harnais(base, [
      'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
      'La commande a échoué : chemin introuvable.',
      'Je reprends.<cmd>{"name":"get_state","args":{}}</cmd>',
      '✅ Fait.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
    ], false)
    await tour(t1.pilot, 'conv-Z')

    const autre = harnais(base, [
      'Tentative.<cmd>{"name":"get_state","args":{}}</cmd>',
      'La commande a échoué : chemin introuvable.',
      'Je reprends.<cmd>{"name":"get_state","args":{}}</cmd>',
      '✅ Fait.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'
    ], false)
    await tour(autre.pilot, 'conv-AUTRE')
    // L'isolation par conversation : escalader ici serait punir un tour neuf pour un mur étranger.
    expect(autre.sent.some((c) => c.includes(ESCALADE))).toBe(false)
    expect(autre.sent.some((c) => c.includes(REPRISE))).toBe(true)
  })
})
