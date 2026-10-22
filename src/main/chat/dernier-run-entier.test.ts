import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from '../agent-pilot'
import type { Message, SendOptions, SendResult } from '../providers/types'
import { appendTurnEvent } from '../runs/turn-journal'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../../shared/chat-turn'
import { formatOrchestrationOutcome } from '../../shared/orchestration-outcome'
import { contenuAssistantPourLeModele, rangDuDernierRun } from './dernier-run-entier'

/**
 * SESSION NON REPRISE : le modele relit l'historique du fil, et le fil COUPE le resultat d'un run.
 *
 * Mesure sur conv-914 (2026-10-16) : le scout a rendu 23 192 caracteres. Le fil en garde deux copies
 * coupees — la bulle a 4 000 caracteres, et l'action `orchestrate` a 12 000 (plafond d'enregistrement
 * des donnees d'action) — que l'historique du modele reduisait encore a 1 200. Seul le JOURNAL du
 * tour porte l'issue entiere. Une session non reprise (session neuve, modele qui ne reprend pas ses
 * sessions, comme Codex) relisait donc la bulle coupee : la 6e piste n'existait pas pour lui.
 *
 * Les donnees du fil sont fabriquees par le VRAI reducteur (`reduceChatTurn`), le journal par le VRAI
 * `appendTurnEvent` : ce sont les formes que l'app enregistre, pas des formes supposees.
 */
const piste = (n: number): string => `| ${n} | PISTE-${n} ${'détail '.repeat(480)}|`
const RESULTAT = ['| # | Piste |', '|---|---|', ...[1, 2, 3, 4, 5, 6].map(piste)].join('\n')
const ISSUE = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  costUsd: 7.97,
  runPath: 'C:/runs/conv/vitesse-livraison-workspace/RUN.md',
  result: RESULTAT
}
const CONV = 'conv-dernier-run'
const TOUR = 'tour-scout-1'

let racines: string[] = []
afterEach(() => {
  for (const racine of racines) rmSync(racine, { recursive: true, force: true })
  racines = []
})

/** Le tour `/scout` tel que l'app l'enregistre : l'action, son issue, puis la bulle de l'app. */
function tourEnregistre(): {
  journalRoot: string
  parts: ReturnType<typeof createChatTurn>['parts']
} {
  const journalRoot = mkdtempSync(join(tmpdir(), 'dernier-run-'))
  racines.push(journalRoot)
  const evenements: ChatTurnEvent[] = [
    { kind: 'command', actionId: 'route:0', name: 'orchestrate', args: { task: 'scout' } },
    { kind: 'result', actionId: 'route:0', name: 'orchestrate', ok: true, data: ISSUE },
    { kind: 'delta', streamId: 'closing', text: formatOrchestrationOutcome(true, ISSUE) },
    { kind: 'done' }
  ]
  let etat = createChatTurn(TOUR)
  for (const evenement of evenements) {
    etat = reduceChatTurn(etat, evenement)
    appendTurnEvent(journalRoot, CONV, TOUR, evenement as never)
  }
  return { journalRoot, parts: etat.parts }
}

describe('session non reprise : le modèle relit le DERNIER run en entier', () => {
  it('prémisses : la 6e piste est au-delà des 12 000 caractères que le fil garde', () => {
    expect(RESULTAT.indexOf('PISTE-6')).toBeGreaterThan(12_000)
    const { parts } = tourEnregistre()
    const action = parts.find((part) => part.kind === 'action') as { data?: { result?: string } }
    expect(action.data?.result).not.toContain('PISTE-6')
    const bulle = parts.find((part) => part.kind === 'text') as { text: string }
    expect(bulle.text).toContain('[tronqué')
  })

  it('le prompt d’une session neuve porte toutes les pistes, sans la bulle coupée', async () => {
    const { journalRoot, parts } = tourEnregistre()
    const contenu = contenuAssistantPourLeModele(parts, {
      journalRoot,
      conversationId: CONV,
      turnId: TOUR
    })

    // Pas de `honoursSessionResume` : la reprise n'est pas armee, l'historique part en entier.
    const envoyes: string[] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
        envoyes.push(messages.map((message) => message.content).join('\n'))
        return { text: 'réponse du modèle' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async () => ({ ok: true, data: {} }))
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AgentPilot(registry as any, roles as any, bus as any).chat(
      [
        { role: 'user', content: '/scout comment livrer plus vite ?' },
        { role: 'assistant', content: contenu },
        { role: 'user', content: 't’as trouvé que ce candidat ?' }
      ],
      () => {},
      undefined,
      12,
      CONV
    )

    const prompt = envoyes[0] ?? ''
    expect(prompt).toContain('t’as trouvé que ce candidat ?')
    expect(prompt).toContain('PISTE-6')
    expect(prompt).not.toContain('[tronqué')
  })

  it('sans journal (expiré après 7 jours) : la copie du fil, et l’avis qu’elle est coupée', () => {
    const { parts } = tourEnregistre()
    const contenu = contenuAssistantPourLeModele(parts, {
      journalRoot: join(tmpdir(), 'journal-absent-dernier-run'),
      conversationId: CONV,
      turnId: TOUR
    })
    expect(contenu).toContain('PISTE-3')
    expect(contenu).not.toContain('PISTE-6')
    expect(contenu).toMatch(/coupé à 12 000 caractères/)
  })

  it('un message qui n’est pas le dernier run garde la relecture habituelle', () => {
    const { parts } = tourEnregistre()
    expect(contenuAssistantPourLeModele(parts)).not.toContain('PISTE-6')
  })

  it('seul le DERNIER message porteur d’un run est relu en entier', () => {
    const { parts } = tourEnregistre()
    const fenetre = [
      { role: 'user', parts: undefined },
      { role: 'assistant', parts },
      { role: 'user', parts: undefined },
      { role: 'assistant', parts },
      { role: 'user', parts: undefined },
      { role: 'assistant', parts: [{ kind: 'text' as const, text: 'sans run' }] }
    ]
    expect(rangDuDernierRun(fenetre, (message) => message.parts)).toBe(3)
    expect(rangDuDernierRun([{ parts: undefined }], (message) => message.parts)).toBe(-1)
  })
})

/**
 * conv-1074 (2026-10-22) : le dernier run relu EN ENTIER portait le code de ses pages `html-render`.
 * Le filtre passe AVANT la borne de tout resultat injecte (120 000 caracteres) : applique apres, il
 * laisserait la borne couper ce qui SUIT une page longue. Entree qui ferait echouer une mauvaise
 * correction : une page de plus de 120 000 caracteres suivie de `APRES-LA-PAGE`.
 */
describe('dernier run relu en entier : ses pages html-render en texte visible', () => {
  it('le texte qui suit une page plus longue que la borne n’est plus coupé', () => {
    const page =
      '```html-render\n<style>.c{color:#d4a94f}</style>\n' +
      '<p class="c">PAGE-VUE</p>\n'.repeat(6_000) +
      '```\nAPRES-LA-PAGE'
    expect(page.length).toBeGreaterThan(120_000)
    const issue = { ...ISSUE, result: page }
    const journalRoot = mkdtempSync(join(tmpdir(), 'dernier-run-page-'))
    racines.push(journalRoot)
    const evenements: ChatTurnEvent[] = [
      { kind: 'command', actionId: 'route:0', name: 'orchestrate', args: { task: 'scout' } },
      { kind: 'result', actionId: 'route:0', name: 'orchestrate', ok: true, data: issue },
      { kind: 'done' }
    ]
    let etat = createChatTurn('tour-page')
    for (const evenement of evenements) {
      etat = reduceChatTurn(etat, evenement)
      appendTurnEvent(journalRoot, CONV, 'tour-page', evenement as never)
    }
    const contenu = contenuAssistantPourLeModele(etat.parts, {
      journalRoot,
      conversationId: CONV,
      turnId: 'tour-page'
    })
    expect(contenu).toContain('PAGE-VUE')
    expect(contenu).toContain('APRES-LA-PAGE')
    expect(contenu).not.toContain('#d4a94f')
  })
})
