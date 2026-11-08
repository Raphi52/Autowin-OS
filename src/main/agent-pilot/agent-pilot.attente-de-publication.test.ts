import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAutowinAppDataBase } from '../app/app-data'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from '../providers/types'
import { orchestrationEnEchec } from '../../shared/orchestration-outcome'

/**
 * UN RUN VERT QUI ATTEND QUE LA BASE SE LIBÈRE N'EST PAS UNE ACTION RATÉE.
 *
 * L'issue ci-dessous est celle qu'un tour réel a reçue : run validé par le juge, puis publication
 * différée parce qu'une opération git occupait l'arbre principal, reprise automatique armée.
 * Comptée en échec, elle relançait le tour par « ta dernière action a ÉCHOUÉ … corrige la cause »
 * à chaque clôture, alors que l'issue elle-même dit « aucun geste de plus ».
 *
 * Le témoin (un conflit de contenu, que personne ne lève à la place de l'utilisateur) garde la
 * relance : il prouve que ce harnais voit bien la relance quand elle doit partir.
 */
const issueEnAttente = (code: string, raisonsEnPlus: string[] = []): Record<string, unknown> => ({
  valid: false,
  gateBlocked: true,
  status: 'failed',
  reused: false,
  workRetained: false,
  result: '[phase build]\nRegroupement fait, tests verts.',
  gateReasons: [
    'intégration locale non terminée',
    ...raisonsEnPlus,
    `blocage d’intégration: ${code} — cause: L’index utilisateur a changé pendant la publication. — fichiers en cause: src/a.ts, src/b.ts`
  ]
})

describe('le prédicat d’échec et l’attente de publication', () => {
  it('une base occupée (opération git en cours, ou fichiers d’un autre fil) n’est pas un échec', () => {
    expect(orchestrationEnEchec(issueEnAttente('base-in-progress'))).toBe(false)
    expect(orchestrationEnEchec(issueEnAttente('base-dirty'))).toBe(false)
  })

  it('un blocage que rien ne lève seul reste un échec', () => {
    expect(orchestrationEnEchec(issueEnAttente('conflict'))).toBe(true)
    expect(orchestrationEnEchec(issueEnAttente('merge-failed'))).toBe(true)
  })

  it('une autre raison à côté de l’attente garde l’échec', () => {
    const vide = 'intégration vide : 3 fichier(s) modifié(s) dans la copie isolée, rien publié'
    expect(orchestrationEnEchec(issueEnAttente('base-in-progress', [vide]))).toBe(true)
  })

  it('sans diagnostic de base, un contrôle final bloqué reste un échec', () => {
    expect(
      orchestrationEnEchec({
        gateBlocked: true,
        status: 'failed',
        gateReasons: ['intégration locale non terminée']
      })
    ).toBe(true)
  })
})

function pilot(issue: Record<string, unknown>, responses: string[]) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'orchestrate', args: {}, description: 'lancer un run' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true, data: issue }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const MARQUEUR = 'ta dernière action a ÉCHOUÉ'
const history: Message[] = [{ role: 'user', content: 'regroupe les doublons' }]
const CLOTURE =
  '✅ Fait\n1. Regroupement validé par la relecture.\n📍 Maintenant : publication en attente.\n' +
  '⏳ Reste à faire : laisser la reprise automatique publier.\n👉 Recommandé : relire le commit publié.'

let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'attente-pub-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

type Evenement = { kind: string; name?: string; ok?: boolean }

async function tourAvec(
  issue: Record<string, unknown>,
  evenements: Evenement[] = []
): Promise<string[]> {
  const { pilot: p, sent } = pilot(issue, [
    'Je lance le run.<cmd>{"name":"orchestrate","args":{"task":"regroupe les doublons"}}</cmd>',
    CLOTURE,
    CLOTURE,
    CLOTURE
  ])
  await p.chat(
    history,
    (evenement) => evenements.push(evenement as Evenement),
    undefined,
    8,
    'conv-A',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  )
  return sent
}

describe('le tour ne relance pas une publication qui attend la base', () => {
  it('aucune relance « ta dernière action a ÉCHOUÉ » sur une opération git en cours', async () => {
    const sent = await tourAvec(issueEnAttente('base-in-progress'))
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(false)
  })

  it('témoin : un conflit de contenu relance toujours', async () => {
    const sent = await tourAvec(issueEnAttente('conflict'))
    expect(sent.some((c) => c.includes(MARQUEUR))).toBe(true)
  })
})

/**
 * LA PASTILLE DE L'ACTION DIT LA MÊME CHOSE QUE LA RELANCE. Le fil affichait
 * « [a exécuté orchestrate (échec)] » sur ce run vert, parce que la pastille lisait sa propre règle
 * (`gateBlocked: true` ⇒ échec) au lieu du prédicat d'échec partagé.
 */
describe('la pastille d’un run vert qui attend la base', () => {
  const pastille = (evenements: Evenement[]): boolean | undefined =>
    evenements.find((e) => e.kind === 'result' && e.name === 'orchestrate')?.ok

  it('ne dit pas « échec » sur une opération git en cours', async () => {
    const evenements: Evenement[] = []
    await tourAvec(issueEnAttente('base-in-progress'), evenements)
    expect(pastille(evenements)).toBe(true)
  })

  it('témoin : dit « échec » sur un conflit de contenu', async () => {
    const evenements: Evenement[] = []
    await tourAvec(issueEnAttente('conflict'), evenements)
    expect(pastille(evenements)).toBe(false)
  })
})
