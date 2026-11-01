import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lireMemoireScout, noterPistesScout } from '../scout-memoire'
import { ConversationStore } from '../store/conversations'
import { createRunPilotChat, type RunPilotChatDeps } from './run-pilot-chat'

/**
 * UNE SÉLECTION DE PISTES SE NOTE DÈS QU'ELLE ARRIVE, MÊME SANS RUN (conv-1341, 2026-10-30).
 *
 * `noterChoixScout` n'était appelée que par l'orchestrateur. Une sélection traitée directement dans
 * le fil n'existait donc pas pour le bilan : sur 25 sélections relevées du 12 au 30/10, 4 scouts
 * passaient pour « sans aucune piste prise » et les lots 3 et 4 du plan de conv-1332 pour « laissés ».
 * Ces pistes faussaient aussi le taux de prise qui ajuste les notes du scout suivant.
 *
 * Ici le VRAI tour de chat tourne, avec un faux modèle qui ne lance aucun run. Une version fausse
 * tombe sur l'une de ces trois entrées : un tour sans run, un fil rangé sur un autre dossier que le
 * dossier de départ, une demande libre.
 */
const capture = vi.hoisted(() => ({ chemin: '', refus: undefined as Error | undefined }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '', isPackaged: false, getVersion: () => '0.0.0' }
}))
vi.mock('../renderer-emit', () => ({ emitToLiveWindows: () => undefined }))
// La vraie fonction, sur un fichier jetable : seul le chemin de la mémoire change.
vi.mock('../scout-memoire', async (origine) => {
  const vrai = await origine<typeof import('../scout-memoire')>()
  return {
    ...vrai,
    noterChoixScout: (entree: Parameters<typeof vrai.noterChoixScout>[0]) => {
      if (capture.refus) throw capture.refus
      vrai.noterChoixScout({ ...entree, chemin: capture.chemin })
    }
  }
})

/** Les dépendances que ce test n'observe pas : tout appel rend un objet du même genre. */
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

const TABLEAU =
  '| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n' +
  '| 1 | 70 | 🔧 fix | Compter les runs | p | a.ts:1 |\n' +
  '| 2 | 60 | 🆕 new | Vider la corbeille | p | x |\n' +
  '| 3 | 50 | 🆕 new | Autre piste | p | x |\n'

const SELECTION = [
  "Traite ce candidat issu du scout interne d'Autowin :",
  '',
  '1. **Compter les runs** — pertinence 70/100',
  '   Type : fix',
  '   Quoi : **Compter les runs**',
  '',
  'Lot 3 sur 4 de la sélection : les autres pistes partent dans leurs propres lots.',
  '',
  '---',
  'Lot 3 sur 4 du plan « Sélection du scout », confié par le fil chef conv-1.'
].join('\n')

async function tourSansRun(
  demande: string,
  rangement: { projectPath?: string; repli: string },
  continuation = false
): Promise<void> {
  let t = 1000
  const store = new ConversationStore(() => t++)
  const fil = store.create({ title: 'Lot', provider: 'codex', ...rangement })
  const pilot = {
    chat: vi.fn(async (_messages: unknown, surEvenement: (e: unknown) => void) => {
      surEvenement({ kind: 'done', text: 'fait' })
      return { text: 'fait' }
    })
  }
  const os = avecRepli({
    waitUntilReady: async () => {},
    roles: { getBinding: () => ({ provider: 'codex', model: 'modele-test' }) },
    conversations: store,
    executionWorkspace: rangement.repli,
    executionSupervisor: { currentSignal: () => undefined },
    runChatTurn: async (_contenu: string, _signal: AbortSignal, lancer: () => unknown) => lancer()
  })
  const deps = avecRepli({
    os,
    pilot,
    pendingDirectives: new Map<string, string[]>(),
    turnJournalRoot: mkdtempSync(join(tmpdir(), 'autowin-selection-notee-')),
    isolatedTestInstance: false,
    broadcast: vi.fn(),
    drainPendingDirectives: () => [],
    askModelQuestion: vi.fn(),
    notifyWatchdogWorkflowIncident: vi.fn(),
    watchdogEngine: () => undefined
  }) as unknown as RunPilotChatDeps
  await createRunPilotChat(deps)(
    undefined,
    [{ role: 'user', content: demande }],
    fil.id,
    undefined,
    undefined,
    undefined,
    undefined,
    continuation
  )
  expect(pilot.chat).toHaveBeenCalledTimes(1)
}

const choix = (): Array<[string, string | undefined]> =>
  lireMemoireScout(capture.chemin).entrees.map((e) => [e.titre, e.choix])

describe('tour de chat — la sélection de pistes est notée sans attendre un run', () => {
  beforeEach(() => {
    capture.refus = undefined
    capture.chemin = join(
      mkdtempSync(join(tmpdir(), 'autowin-selection-memoire-')),
      'scout-pistes.json'
    )
  })

  it('un lot traité dans le fil, sans run, marque sa piste « prise » et ne touche pas aux autres', async () => {
    const depot = mkdtempSync(join(tmpdir(), 'autowin-depot-'))
    noterPistesScout({
      depot,
      texte: TABLEAU,
      run: 'scout-1',
      maintenant: '2026-10-30T10:00:00Z',
      chemin: capture.chemin
    })
    await tourSansRun(SELECTION, { repli: depot })
    expect(choix()).toEqual([
      ['Compter les runs', 'prise'],
      ['Vider la corbeille', undefined],
      ['Autre piste', undefined]
    ])
    expect(lireMemoireScout(capture.chemin).entrees[0]?.traitePar).toBeUndefined()
  })

  it('la piste est cherchée dans le dossier du FIL, pas dans le dossier de départ de l’app', async () => {
    const dossierDuFil = mkdtempSync(join(tmpdir(), 'autowin-fil-'))
    noterPistesScout({
      depot: dossierDuFil,
      texte: TABLEAU,
      run: 'scout-1',
      maintenant: '2026-10-30T10:00:00Z',
      chemin: capture.chemin
    })
    await tourSansRun(SELECTION, {
      projectPath: dossierDuFil,
      repli: mkdtempSync(join(tmpdir(), 'autowin-depart-'))
    })
    expect(choix()[0]).toEqual(['Compter les runs', 'prise'])
  })

  it('une demande libre n’écrit rien', async () => {
    await tourSansRun('corrige le bouton', { repli: mkdtempSync(join(tmpdir(), 'autowin-d-')) })
    expect(existsSync(capture.chemin)).toBe(false)
  })

  // Un tour repris rejoue une demande déjà notée : c'est le tour d'origine qui l'a comptée.
  it('un tour repris ne renote pas la sélection', async () => {
    const depot = mkdtempSync(join(tmpdir(), 'autowin-depot-'))
    noterPistesScout({
      depot,
      texte: TABLEAU,
      run: 'scout-1',
      maintenant: '2026-10-30T10:00:00Z',
      chemin: capture.chemin
    })
    await tourSansRun(SELECTION, { repli: depot }, true)
    expect(choix()[0]).toEqual(['Compter les runs', undefined])
  })

  // La mémoire du scout est un bilan : un disque qui refuse ne doit pas coûter le tour.
  it('une écriture refusée se dit dans le journal, et le tour continue', async () => {
    const alerte = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    capture.refus = new Error('disque plein')
    await tourSansRun(SELECTION, { repli: mkdtempSync(join(tmpdir(), 'autowin-d-')) })
    expect(alerte).toHaveBeenCalledWith(expect.stringContaining('sélection non notée'))
    alerte.mockRestore()
  })
})
