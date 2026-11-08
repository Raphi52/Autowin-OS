import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appelsDeLOutil,
  chargesAvecLeurEvenement
} from '../../renderer/src/components/appels-outil-detail'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTraceEvent
} from '../../renderer/src/components/harness-timeline-model'
import { projectLatestRequestExecution } from '../../renderer/src/components/request-execution-tree-model'
import { allegerTracePourGraphe, chargesDesEvenements } from '../activity/trace-allegee'
import { TraceStore } from '../activity/trace-store'
import type { TraceEventV1 } from '../activity/trace-event'
import { AgentPilot, type PilotEvent } from '../agent-pilot/agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import type { CommandSpec } from '../commands/commands'
import type { Message, SendOptions, SendResult } from '../providers/types'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * LES LECTURES D'UN MÊME MESSAGE, EN MÊME TEMPS (lot 8, 2026-10-31).
 *
 * `readOnlyHint` fait arriver les lectures ensemble, et la trace causale du tour les écrit dans
 * l'ordre où elles passent : command, command, result, result. Rattachée à l'événement PRÉCÉDENT, la
 * seconde réponse se retrouvait sous la première : a.md sans résultat, b.md avec les deux notes.
 *
 * Ici, le VRAI tour de chat tourne avec une vraie trace sur disque. Ce qui ferait échouer une
 * version fausse : un `result` rattaché à un autre appel, un ordre ou un identifiant changé, ou un
 * chaînage déplacé pour le reste du tour.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => {} }))

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

const CATALOGUE: CommandSpec[] = [
  {
    name: 'brain_read',
    description: 'lire une note',
    args: { path: 'chemin' },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
]

/** Un tour de chat complet, branché sur le pilote qu'on lui donne ; rend sa trace relue du disque. */
async function jouerLeTour(
  pilot: unknown,
  bus: unknown
): Promise<{ trace: TraceEventV1[]; turnId: string }> {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const fil = store.create({ title: 'Lectures', provider: 'claude' })
  const causalTrace = new TraceStore(mkdtempSync(join(tmpdir(), 'autowin-trace-simultanee-')))
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: { bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku-5-5' }), routageChatLectureSeuleActif: () => false, getBinding: () => ({ provider: 'claude', model: 'opus-5' }) },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined, currentSnapshot: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot,
    bus,
    causalTrace,
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-tour-simultane-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  const { turnId } = await createRunPilotChat(deps)(
    undefined,
    [{ role: 'user', content: 'lis ces notes' }],
    fil.id
  )
  return { trace: causalTrace.readConversation(fil.id), turnId }
}

/** Un pilote qui rejoue tels quels les événements donnés, dans leur ordre. */
function tourRejoue(evenements: PilotEvent[]): Promise<{ trace: TraceEventV1[]; turnId: string }> {
  const pilot = {
    chat: vi.fn(async (_messages: unknown, emettre: (e: PilotEvent) => void) => {
      for (const evenement of evenements) emettre(evenement)
      emettre({ kind: 'done', text: 'Lu.' })
      return { text: 'Lu.' }
    })
  }
  return jouerLeTour(pilot, { catalog: () => CATALOGUE })
}

const commande = (rang: number, path: string): PilotEvent => ({
  kind: 'command',
  actionId: `natif:0:${rang}`,
  name: 'brain_read',
  args: { path }
})
const resultat = (rang: number, path: string): PilotEvent => ({
  kind: 'result',
  actionId: `natif:0:${rang}`,
  name: 'brain_read',
  ok: true,
  data: `note de ${path}`
})

/** Les événements d'action de la trace, sans les reçus d'autorité. */
const actionsDe = (trace: TraceEventV1[]): TraceEventV1[] =>
  trace.filter((e) => e.id.includes(':action:') && !e.id.endsWith(':authority'))
const idCommande = (turnId: string, rang: number): string =>
  `${turnId}:action:natif-0-${rang}:command`
const idResultat = (turnId: string, rang: number): string =>
  `${turnId}:action:natif-0-${rang}:result`

describe('trace du tour : chaque result se rattache à SA command', () => {
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-simultanes-'))))
  afterEach(() => configureAutowinAppDataBase(undefined))

  it('quatre appels croisés : chaque result désigne sa command, quel que soit l’ordre des fins', async () => {
    const { trace, turnId } = await tourRejoue([
      commande(0, 'a.md'),
      commande(1, 'b.md'),
      commande(2, 'c.md'),
      commande(3, 'd.md'),
      resultat(2, 'c.md'),
      resultat(0, 'a.md'),
      resultat(3, 'd.md'),
      resultat(1, 'b.md')
    ])
    const parentDe = new Map(actionsDe(trace).map((e) => [e.id, e.parentId]))
    for (const rang of [0, 1, 2, 3])
      expect(parentDe.get(idResultat(turnId, rang)), `result ${rang}`).toBe(
        idCommande(turnId, rang)
      )
  })

  it('ne change ni l’ordre, ni les identifiants, ni le chaînage des autres événements', async () => {
    const { trace, turnId } = await tourRejoue([
      commande(0, 'a.md'),
      commande(1, 'b.md'),
      resultat(1, 'b.md'),
      resultat(0, 'a.md'),
      commande(2, 'c.md'),
      resultat(2, 'c.md')
    ])
    const actions = actionsDe(trace)
    expect(actions.map((e) => e.id)).toEqual([
      idCommande(turnId, 0),
      idCommande(turnId, 1),
      idResultat(turnId, 1),
      idResultat(turnId, 0),
      idCommande(turnId, 2),
      idResultat(turnId, 2)
    ])
    const sequences = actions.map((e) => e.sequence)
    expect(sequences).toEqual([...sequences].sort((x, y) => x - y))
    expect(new Set(sequences).size).toBe(sequences.length)

    const parentDe = new Map(actions.map((e) => [e.id, e.parentId]))
    // Une command suit encore l'événement précédent, même si c'est une autre command…
    expect(parentDe.get(idCommande(turnId, 1))).toBe(idCommande(turnId, 0))
    // … et ce qui vient après un result reste chaîné sur lui, comme avant.
    expect(parentDe.get(idCommande(turnId, 2))).toBe(idResultat(turnId, 0))
  })

  it('en file, la trace reste exactement celle d’avant', async () => {
    const { trace, turnId } = await tourRejoue([
      commande(0, 'a.md'),
      resultat(0, 'a.md'),
      commande(1, 'b.md'),
      resultat(1, 'b.md')
    ])
    expect(actionsDe(trace).map((e) => [e.id, e.parentId])).toEqual([
      [idCommande(turnId, 0), undefined],
      [idResultat(turnId, 0), idCommande(turnId, 0)],
      [idCommande(turnId, 1), idResultat(turnId, 0)],
      [idResultat(turnId, 1), idCommande(turnId, 1)]
    ])
  })

  it('un result dont la command n’est pas connue de ce tour reste chaîné, sans casser le tour', async () => {
    const { trace, turnId } = await tourRejoue([commande(0, 'a.md'), resultat(7, 'orphelin.md')])
    expect(actionsDe(trace).at(-1)).toMatchObject({
      id: idResultat(turnId, 7),
      parentId: idCommande(turnId, 0)
    })
  })

  it('le reçu d’autorité suit SA command : il ne suppose pas l’ordre des résultats', async () => {
    const { trace, turnId } = await tourRejoue([
      commande(0, 'a.md'),
      commande(1, 'b.md'),
      resultat(1, 'b.md'),
      resultat(0, 'a.md')
    ])
    for (const rang of [0, 1]) {
      const appel = trace.find((e) => e.id === idCommande(turnId, rang))
      const recu = trace.find((e) => e.id === `${idCommande(turnId, rang)}:authority`)
      expect(recu?.parentId).toBe(appel?.id)
      // Écrit dans la même passe que son appel : aucun autre événement entre les deux.
      expect(recu?.sequence).toBe((appel?.sequence ?? -1) + 1)
    }
    expect(trace.filter((e) => e.id.endsWith(':authority'))).toHaveLength(2)
    // Le reçu ne prend pas la place de l'appel dans la chaîne.
    expect(trace.find((e) => e.id === idCommande(turnId, 1))?.parentId).toBe(idCommande(turnId, 0))
  })
})

type ResultatBus = { ok: boolean; data?: unknown; error?: string }
type ConfigMcp = { mcpServers: { autowin: { url: string; headers: Record<string, string> } } }
type ReponseRpc = { result?: { content?: Array<{ text?: string }>; isError?: boolean } }

/**
 * Un bus qui mesure ses appels en vol et RETIENT chaque lecture jusqu'à ce que `attendues` soient
 * en vol ; il les rend ensuite une à une, dans l'ordre INVERSE des chemins (d.md d'abord) : les fins
 * se croisent toujours. `quandArrivees(n)` rend la main quand n lectures ont atteint le bus.
 *
 * POURQUOI PAS DES MINUTERIES (2026-10-31). Il y avait ici 40, 30, 20 puis 10 ms données
 * dans l'ordre d'arrivée, et les quatre requêtes partaient en même temps. Sous charge (typage lancé à
 * côté), 2 tests rouges sur 60 : fins dans le mauvais ordre, et b.md arrivé après d.md. Un tour de
 * boucle d'événements sépare chaque reprise : entre la fin de `exec` et l'écriture de son `result`,
 * le pilote n'enchaîne que des promesses, donc chaque résultat est écrit avant que le suivant reprenne.
 * Si la file revient, une seule lecture est en vol à la fois : le bus la relâche au bout de
 * `attenteMaxMs` sans nouvelle arrivée, et le pic dit 1 au lieu de laisser le test pendre.
 */
function busChronometre(
  reponse: (args: Record<string, unknown>) => ResultatBus,
  attendues = 4,
  attenteMaxMs = 500
): {
  exec: (nom: string, args: Record<string, unknown>) => Promise<ResultatBus>
  pic: () => number
  quandArrivees: (n: number) => Promise<void>
} {
  let enVol = 0
  let pic = 0
  let arrivees = 0
  const guetteurs: Array<{ n: number; pret: () => void }> = []
  const retenues: Array<{ chemin: string; reprendre: () => void }> = []
  let minuterie: ReturnType<typeof setTimeout> | undefined
  const relacher = async (): Promise<void> => {
    clearTimeout(minuterie)
    const lot = retenues.splice(0).sort((x, y) => y.chemin.localeCompare(x.chemin))
    for (const retenue of lot) {
      retenue.reprendre()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return {
    exec: async (_nom, args) => {
      enVol += 1
      pic = Math.max(pic, enVol)
      arrivees += 1
      for (const guetteur of guetteurs.filter((g) => g.n <= arrivees)) {
        guetteurs.splice(guetteurs.indexOf(guetteur), 1)
        guetteur.pret()
      }
      await new Promise<void>((reprendre) => {
        retenues.push({ chemin: String(args.path), reprendre })
        clearTimeout(minuterie)
        if (retenues.length >= attendues) void relacher()
        else minuterie = setTimeout(() => void relacher(), attenteMaxMs)
      })
      enVol -= 1
      return reponse(args)
    },
    pic: () => pic,
    quandArrivees: (n) =>
      n <= arrivees ? Promise.resolve() : new Promise((pret) => guetteurs.push({ n, pret }))
  }
}

/** Un appel d'outil posté sur le vrai port, comme le fait le CLI. */
async function posterAppel(options: SendOptions, nom: string, args: unknown): Promise<ReponseRpc> {
  const config = JSON.parse(options.skillNodeTools!.mcpConfig) as ConfigMcp
  const r = await fetch(config.mcpServers.autowin.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...config.mcpServers.autowin.headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: nom, arguments: args }
    })
  })
  return (await r.json()) as ReponseRpc
}

/** Le vrai pilote et le vrai port : seul le modèle est simulé, il lit toutes les notes d'un coup. */
async function lectureDUnSeulMessage(
  notes: readonly string[],
  exec: (nom: string, args: Record<string, unknown>) => Promise<ResultatBus>,
  quandArrivees: (n: number) => Promise<void>
): Promise<{ trace: TraceEventV1[]; reponses: ReponseRpc[] }> {
  let reponses: ReponseRpc[] = []
  let premierEnvoi = true
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], options: SendOptions): Promise<SendResult> => {
      if (!premierEnvoi) return { text: 'Fin.' } as SendResult
      premierEnvoi = false
      // Une à une sur le port, sans attendre leur fin : les quatre sont en vol ensemble, et leur
      // ordre d'arrivée ne dépend plus de la charge de la machine.
      const envois: Array<Promise<ReponseRpc>> = []
      for (const [rang, path] of notes.entries()) {
        envois.push(posterAppel(options, 'brain_read', { path }))
        await quandArrivees(rang + 1)
      }
      reponses = await Promise.all(envois)
      return { text: 'Lu.' } as SendResult
    }),
    // Comme le vrai registre : l'enveloppe porte les messages reçus, sans quoi la trace la refuse.
    describePrompt: vi.fn((_p: string, messages: Message[]) => ({
      provider: 'claude',
      messages,
      transport: 't',
      options: {},
      limitation: 'test'
    })),
    honoursSessionResume: vi.fn(() => false)
  }
  const bus = {
    catalog: vi.fn(() => CATALOGUE),
    snapshotForPrompt: vi.fn(async () => ({
      tab: 'chat',
      providers: [],
      runsBlocked: [],
      conversationsCount: 0
    })),
    exec: vi.fn(exec)
  }
  // Un dossier vide : le pilote photographie le dossier de travail autour de chaque envoi, et sans
  // lui il retombe sur celui de l'environnement, soit plusieurs secondes de photo du vrai dépôt.
  const dossierDuTour = mkdtempSync(join(tmpdir(), 'autowin-dossier-du-tour-'))
  const pilote = new AgentPilot(
    registry as never,
    { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) } as never,
    bus as never,
    undefined,
    () => '',
    () => dossierDuTour,
    true
  )
  const { trace } = await jouerLeTour(pilote, bus)
  return { trace, reponses }
}

/**
 * Le chemin du dépliage dans l'Observatoire, étape par étape (`WorkflowExecutionGraph.tsx`) : la
 * trace allégée fait l'arbre, le nœud nomme ses événements, leurs charges sont relues puis appariées.
 */
function detailDesLectures(trace: TraceEventV1[]): {
  nombre: number | undefined
  appels: ReturnType<typeof appelsDeLOutil>
} {
  const timeline = buildHarnessTimelineFromTrace(
    allegerTracePourGraphe(trace) as unknown as HarnessTraceEvent[]
  )
  const { events } = projectLatestRequestExecution(timeline, { requestLabel: 'lis ces notes' })
  const noeud = events.find((e) => e.display?.detailOutil === 'appels')
  const ids = noeud?.display?.payloadEventIds ?? []
  const charges = chargesDesEvenements(trace, ids, ['tool-call', 'tool-result', 'error'])
  return {
    nombre: noeud?.display?.count,
    appels: appelsDeLOutil(chargesAvecLeurEvenement(ids, charges))
  }
}

describe('quatre lectures par le vrai port, à travers un vrai tour de chat', () => {
  const NOTES = ['a.md', 'b.md', 'c.md', 'd.md']
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-simultanes-'))))
  afterEach(() => configureAutowinAppDataBase(undefined))

  it('tournent ensemble, et chacune garde son propre résultat dans le détail', async () => {
    const b = busChronometre((args) => ({ ok: true, data: `note de ${String(args.path)}` }))
    const { trace, reponses } = await lectureDUnSeulMessage(NOTES, b.exec, b.quandArrivees)

    expect(b.pic()).toBe(4)
    expect(reponses.map((r) => r.result?.content?.[0]?.text)).toEqual(
      NOTES.map((n) => `note de ${n}`)
    )
    // Les fins se sont bien croisées : sinon ce test ne prouverait rien sur le rattachement.
    expect(
      actionsDe(trace)
        .filter((e) => e.type === 'tool-result')
        .map((e) => e.payloads[0]?.content)
    ).toEqual(NOTES.map((n) => `note de ${n}`).reverse())

    // La trace d'un vrai tour : l'appel au modèle y est, écrit après les outils qu'il a lancés.
    expect(trace.some((e) => e.type === 'model-response')).toBe(true)

    const { nombre, appels } = detailDesLectures(trace)
    expect(nombre).toBe(4)
    expect(appels.map((a) => [JSON.parse(a.envoye ?? '{}'), a.retour, a.erreur])).toEqual(
      NOTES.map((path) => [{ path }, `note de ${path}`, undefined])
    )
  })

  it('une lecture en échec au milieu garde son erreur sur SON appel', async () => {
    const b = busChronometre((args) =>
      args.path === 'b.md' ? { ok: false, error: 'note absente' } : { ok: true, data: 'lu' }
    )
    const { trace } = await lectureDUnSeulMessage(NOTES, b.exec, b.quandArrivees)

    expect(b.pic()).toBe(4)
    const { appels } = detailDesLectures(trace)
    expect(appels.map((a) => [JSON.parse(a.envoye ?? '{}'), a.retour, a.erreur])).toEqual([
      [{ path: 'a.md' }, 'lu', undefined],
      [{ path: 'b.md' }, 'note absente', true],
      [{ path: 'c.md' }, 'lu', undefined],
      [{ path: 'd.md' }, 'lu', undefined]
    ])
  })
})
