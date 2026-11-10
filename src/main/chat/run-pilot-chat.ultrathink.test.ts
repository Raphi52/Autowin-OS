import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ImportedModel } from '../modeles/models'
import type { RoleBinding } from '../profil/roles'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'
import { declarerUltrathinkTape, ultrathinkEnPleinTour } from './ultrathink-du-tour'

/**
 * « ULTRATHINK » TAPÉ DANS LE MESSAGE MONTE LA RÉFLEXION DE CE TOUR SEUL.
 *
 * Le vrai tour de chat tourne sur le vrai stockage, avec un faux modèle qui note le réglage reçu :
 * c'est ce réglage qui part au moteur, et celui que le fil enregistre pour le tour.
 * Entrée qui doit faire échouer ce test : un tour qui ignore le mot tapé, qui monte sur un mot que
 * personne n'a tapé (suite proposée, autre fil, tâche planifiée), qui garde la réflexion montée au
 * message suivant, qui envoie une question « ultrathink » au modèle des petites tâches, ou qui
 * ignore le mot envoyé pendant que le tour travaille, ou qui renvoie au niveau habituel un message
 * tapé que le tour n'a pas eu le temps de lire.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../app/renderer-emit', () => ({ emitToLiveWindows: () => undefined }))

/** Accepte tout appel : les dépendances que ce test n'observe pas (traces, coûts, tâches). */
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

const FENETRE = {} as WebContents
const CHAT: RoleBinding = { provider: 'claude', model: 'opus-test', reasoningEffort: 'medium' }
const PETITES_TACHES: RoleBinding = { provider: 'claude', model: 'claude-haiku-5-5' }
const CATALOGUE = [
  {
    id: 'claude/opus-test',
    provider: 'claude',
    model: 'opus-test',
    label: 'Opus test',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium'
  }
] as unknown as ImportedModel[]

/** Position du réglage du tour dans l'appel au pilote (`turnPilot.chat`, run-pilot-chat.ts). */
const RANG_DU_REGLAGE = 9

function banc(pendantLAppel?: (filId: string, enAttente: Map<string, string[]>) => void): {
  store: ConversationStore
  filId: string
  lancer: ReturnType<typeof createRunPilotChat>
  /** Le réglage de chaque appel, tel qu'il était à son ENTRÉE. */
  reglagesRecus: () => RoleBinding[]
  /** Le réglage que la boucle du tour relit à chaque appel au modèle (le même objet, vivant). */
  reglageDuTour: () => RoleBinding
  /** Ce que l'app annonce à l'écran (dont les messages non lus, rendus en fin de tour). */
  annonces: () => unknown[]
} {
  const store = new ConversationStore(() => Date.parse('2026-11-10T10:00:00+01:00'))
  const fil = store.create({ title: 'U', provider: 'claude' })
  const aLEntree: RoleBinding[] = []
  const enAttente = new Map<string, string[]>()
  const broadcast = vi.fn()
  const chat = vi.fn(async (...args: unknown[]) => {
    aLEntree.push({ ...(args[RANG_DU_REGLAGE] as RoleBinding) })
    pendantLAppel?.(fil.id, enAttente)
    return { text: 'fait' }
  })
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: {
      bindingDesPetitesTaches: () => PETITES_TACHES,
      // Routage des questions ALLUMÉ : sans mot tapé, une question part sur les petites tâches.
      routageChatLectureSeuleActif: () => true,
      getBinding: () => CHAT,
      getCatalog: () => CATALOGUE
    },
    conversations: store,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot: { chat },
    pendingDirectives: enAttente,
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-ultrathink-')),
    isolatedTestInstance: false,
    broadcast,
    drainPendingDirectives: () => [],
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  return {
    store,
    filId: fil.id,
    lancer: createRunPilotChat(deps),
    reglagesRecus: () => aLEntree,
    reglageDuTour: () => chat.mock.calls.at(-1)?.[RANG_DU_REGLAGE] as RoleBinding,
    annonces: () => broadcast.mock.calls.map((appel) => appel[0])
  }
}

const message = (content: string): [{ role: 'user'; content: string }] => [
  { role: 'user', content }
]
/** Ce que fait le champ de saisie avant l'envoi d'un message dont le mot a été tapé à la main. */
const tape = (content: string): [{ role: 'user'; content: string }] => {
  declarerUltrathinkTape(content)
  return message(content)
}

describe('ultrathink tapé dans le message qui ouvre un tour', () => {
  it('le tour part à xhigh, et le fil l’enregistre', async () => {
    const { store, filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, tape('ultrathink corrige a.ts'), filId)
    expect(reglagesRecus()).toEqual([{ ...CHAT, reasoningEffort: 'xhigh' }])
    expect(store.messagesOf(filId).at(-1)?.runtime?.reasoningEffort).toBe('xhigh')
  })

  it('jumeau : le même message que personne n’a tapé (suite proposée, autre fil, tâche) ne monte rien', async () => {
    const { store, filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('ultrathink corrige a.ts'), filId)
    expect(reglagesRecus()).toEqual([CHAT])
    expect(store.messagesOf(filId).at(-1)?.runtime?.reasoningEffort).toBe('medium')
  })

  it('le message suivant, sans le mot, repart au réglage du chat', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, tape('ultrathink corrige a.ts'), filId)
    await lancer(
      FENETRE,
      [
        ...message('ultrathink corrige a.ts'),
        { role: 'assistant', content: 'fait' },
        { role: 'user', content: 'corrige aussi b.ts' }
      ],
      filId
    )
    expect(reglagesRecus().map((reglage) => reglage.reasoningEffort)).toEqual(['xhigh', 'medium'])
  })

  it('la déclaration ne sert qu’une fois : le même texte renvoyé par l’app ne monte plus', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, tape('ultrathink corrige a.ts'), filId)
    await lancer(FENETRE, message('ultrathink corrige a.ts'), filId)
    expect(reglagesRecus().map((reglage) => reglage.reasoningEffort)).toEqual(['xhigh', 'medium'])
  })

  it('une question « ultrathink » tapée garde le modèle du chat au lieu des petites tâches', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, tape('pourquoi ce test échoue ? ultrathink'), filId)
    expect(reglagesRecus()).toEqual([{ ...CHAT, reasoningEffort: 'xhigh' }])
  })

  it('jumeau : la même question non tapée part sur les petites tâches', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('pourquoi ce test échoue ? ultrathink'), filId)
    expect(reglagesRecus()).toEqual([PETITES_TACHES])
  })

  it('le réglage du rôle n’est jamais modifié', async () => {
    const { filId, lancer } = banc()
    await lancer(FENETRE, tape('ultrathink corrige a.ts'), filId)
    expect(CHAT.reasoningEffort).toBe('medium')
  })
})

describe('ultrathink tapé dans un message envoyé pendant que le tour travaille', () => {
  const ENVOI = 'ultrathink regarde aussi b.ts'

  it('le reste du tour monte : la boucle relit xhigh à son prochain appel', async () => {
    let coupe: boolean | undefined
    const { filId, lancer, reglagesRecus, reglageDuTour } = banc((fil) => {
      declarerUltrathinkTape(ENVOI)
      coupe = ultrathinkEnPleinTour(fil, ENVOI)
    })
    await lancer(FENETRE, message('corrige a.ts'), filId)
    // L'appel en cours était parti au réglage du chat ; il doit être coupé pour repartir plus haut.
    expect(reglagesRecus()).toEqual([CHAT])
    expect(coupe).toBe(true)
    expect(reglageDuTour().reasoningEffort).toBe('xhigh')
    expect(CHAT.reasoningEffort).toBe('medium')
  })

  it('jumeau : le même envoi que personne n’a tapé ne monte rien', async () => {
    let coupe: boolean | undefined
    const { filId, lancer, reglageDuTour } = banc((fil) => {
      coupe = ultrathinkEnPleinTour(fil, ENVOI)
    })
    await lancer(FENETRE, message('corrige a.ts'), filId)
    expect(coupe).toBe(false)
    expect(reglageDuTour().reasoningEffort).toBe('medium')
  })

  it('le tour fini, un envoi tapé ne monte plus rien, et le tour suivant repart au réglage du chat', async () => {
    const { filId, lancer, reglagesRecus } = banc()
    await lancer(FENETRE, message('corrige a.ts'), filId)
    declarerUltrathinkTape(ENVOI)
    expect(ultrathinkEnPleinTour(filId, ENVOI)).toBe(false)
    await lancer(FENETRE, message('corrige c.ts'), filId)
    expect(reglagesRecus()).toEqual([CHAT, CHAT])
  })

  /**
   * Le tour rédige déjà sa réponse finale : il ne relit plus ses messages. L'app rend le message à
   * l'écran, qui le renvoie comme un tour neuf — sans repasser par le champ de saisie.
   */
  it('message tapé que le tour n’a pas lu : rendu à l’écran, puis son tour neuf part à xhigh', async () => {
    let premierAppel = true
    const { filId, lancer, reglagesRecus, annonces } = banc((fil, enAttente) => {
      if (!premierAppel) return
      premierAppel = false
      enAttente.set(fil, [ENVOI])
      declarerUltrathinkTape(ENVOI)
      ultrathinkEnPleinTour(fil, ENVOI)
    })
    await lancer(FENETRE, message('corrige a.ts'), filId)
    expect(annonces()).toContainEqual({
      type: 'directives-orphelines',
      convId: filId,
      textes: [ENVOI]
    })
    await lancer(FENETRE, message(ENVOI), filId)
    expect(reglagesRecus().map((reglage) => reglage.reasoningEffort)).toEqual(['medium', 'xhigh'])
  })

  it('jumeau : message tapé que le tour a lu : le même texte renvoyé ensuite ne monte plus', async () => {
    let premierAppel = true
    const { filId, lancer, reglagesRecus } = banc((fil) => {
      if (!premierAppel) return
      premierAppel = false
      declarerUltrathinkTape(ENVOI)
      ultrathinkEnPleinTour(fil, ENVOI)
    })
    await lancer(FENETRE, message('corrige a.ts'), filId)
    await lancer(FENETRE, message(ENVOI), filId)
    expect(reglagesRecus().map((reglage) => reglage.reasoningEffort)).toEqual(['medium', 'medium'])
  })
})
