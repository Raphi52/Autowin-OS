import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extrairePropositionsSuite } from '../../shared/prompt-suivant'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'
import { PROPOSITION_GROW } from './proposition-grow'

/**
 * GROW EST PROPOSÉE PAR LE CODE DE FIN DE TOUR, PAS PAR UNE PHRASE DE PROMPT (conv-417, 2026-11-02).
 *
 * La skill `grow` ne partait que si le modèle choisissait de la charger, ou si l'utilisateur tapait
 * `/grow`. Ici le VRAI tour de chat tourne (vrai stockage, faux modèle qui clôt sur une issue
 * d'orchestration) et l'on lit le fil ENREGISTRÉ comme le fait le champ de saisie
 * (`ChatView.tsx`, `propositionsDuFil` : toutes les parts texte du dernier message, jointes).
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../renderer-emit', () => ({ emitToLiveWindows: () => {} }))

/** Accepte tout appel et rend un objet du même genre : les dépendances non observées. */
function souple(): never {
  const fn = (): unknown => souple()
  return new Proxy(fn, {
    get: (_cible, cle) => {
      if (cle === 'then') return undefined
      if (cle === Symbol.iterator) return () => [][Symbol.iterator]()
      if (cle === Symbol.toPrimitive) return () => ''
      return souple()
    },
    apply: () => souple()
  }) as never
}

const avecRepli = <T extends object>(propres: T): T =>
  new Proxy(propres, {
    get: (cible, cle) => (cle in cible ? cible[cle as keyof T] : souple())
  })

const TEXTE = 'Fait : le correctif est livré et ses tests passent.'

const LIVRE = { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
const sortie = (phase: string) => ({ phase, text: `sortie ${phase}` })

async function propositionsApres(
  demande: string,
  outcome: Record<string, unknown> | undefined
): Promise<string[]> {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const fil = store.create({ title: 'grow', provider: 'claude' })
  const pilot = {
    chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
      surEvenement({ kind: 'delta', streamId: '0:0', text: TEXTE })
      surEvenement({ kind: 'done', text: TEXTE, ...(outcome ? { outcome } : {}) })
      return { text: TEXTE }
    })
  }
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: { getBinding: () => ({ provider: 'claude', model: 'modele-test' }) },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot,
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-proposition-grow-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    askModelQuestion: vi.fn(),
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  await createRunPilotChat(deps)(undefined, [{ role: 'user', content: demande }], fil.id)
  const dernier = [...(store.get(fil.id)?.messages ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant')
  const texte = (dernier?.parts ?? [])
    .flatMap((p) => (p.kind === 'text' ? [p.text] : []))
    .join('\n')
  return extrairePropositionsSuite(texte, demande).map((p) => p.texte)
}

describe('fin de tour : grow est proposée après une demande d’action livrée', () => {
  it('build livré → le champ de saisie propose /grow', async () => {
    const suites = await propositionsApres('/build corrige le bouton', {
      ...LIVRE,
      phaseOutputs: [sortie('frame'), sortie('build'), sortie('judge')]
    })
    expect(suites).toContain(PROPOSITION_GROW)
    expect(PROPOSITION_GROW.startsWith('/grow ')).toBe(true)
  })

  it('clean livré compte aussi comme action livrée', async () => {
    const suites = await propositionsApres('/clean', { ...LIVRE, phaseOutputs: [sortie('clean')] })
    expect(suites).toContain(PROPOSITION_GROW)
  })

  it('un run d’analyse seule (scout) livré ne propose pas grow', async () => {
    const suites = await propositionsApres('/scout pistes', {
      ...LIVRE,
      phaseOutputs: [sortie('scout')]
    })
    expect(suites).not.toContain(PROPOSITION_GROW)
  })

  it('un build refusé par le contrôle final ne propose pas grow', async () => {
    const suites = await propositionsApres('/build corrige le bouton', {
      ...LIVRE,
      gateBlocked: true,
      phaseOutputs: [sortie('build')]
    })
    expect(suites).not.toContain(PROPOSITION_GROW)
  })

  it('un build resté dans sa copie de travail (non livré) ne propose pas grow', async () => {
    const suites = await propositionsApres('/build corrige le bouton', {
      ...LIVRE,
      workRetained: true,
      phaseOutputs: [sortie('build')]
    })
    expect(suites).not.toContain(PROPOSITION_GROW)
  })

  it('un tour sans orchestration (réponse simple) ne propose pas grow', async () => {
    const suites = await propositionsApres('pourquoi ce bouton ?', undefined)
    expect(suites).not.toContain(PROPOSITION_GROW)
  })

  it('le tour de grow lui-même ne se repropose pas (pas de boucle en mode auto)', async () => {
    const suites = await propositionsApres(PROPOSITION_GROW, {
      ...LIVRE,
      phaseOutputs: [sortie('build')]
    })
    expect(suites).not.toContain(PROPOSITION_GROW)
  })
})
