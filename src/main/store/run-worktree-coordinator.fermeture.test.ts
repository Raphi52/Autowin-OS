import { ESSAIS_MAX } from './delai-de-reprise'
import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import type { FinalizeResult } from './worktree-manager'
import { WorktreeRunStateStore } from './worktree-run-state'

/**
 * LA FERMETURE QUI NE REFERMAIT JAMAIS.
 *
 * Mesure du 2026-08-21 sur le depot reel : 381 fichiers d'etat pour 17 copies vivantes. La cause
 * n'etait pas un cas limite — `save()` est appele a chaque persistance, `remove()` a UNE seule ligne
 * du depot, derriere une porte qui exige `green` + `held` et un clic. Un run qui REUSSIT ne passait
 * donc par aucun chemin de suppression : 219 des 381 etats venaient de runs sans le moindre incident.
 */
const SHA = '1'.repeat(40)
const PUBLIE = 'a'.repeat(40)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function manager(racine: string, over: Record<string, any> = {}): any {
  // `isRecord` exige que la copie soit SOUS la racine du store : un chemin hors racine fait rejeter
  // le manifeste avant meme d'atteindre le comportement teste.
  return {
    acquire: vi.fn((id: string, ctx?: { worktreePath: string }) =>
      ctx?.worktreePath ?? join(racine, `agent__${id}`)),
    listAgentIds: vi.fn(() => []),
    describe: vi.fn((id: string) => ({
      workspacePath: '/repo',
      worktreePath: join(racine, `agent__${id}`),
      baseBranch: 'main',
      baseSha: SHA
    })),
    changedFiles: vi.fn(() => []),
    hasActiveProcesses: vi.fn(() => false),
    markProcess: vi.fn(),
    markSpawnIntent: vi.fn(),
    confirmSpawn: vi.fn(),
    remove: vi.fn(),
    validateRecoveryContext: vi.fn(() => ({ ok: true as const })),
    cleanupPublished: vi.fn(() => ({ outcome: 'nothing', agentId: 'x', committed: false })),
    ...over
  }
}

describe('A — un run qui REUSSIT ne laisse plus son etat derriere lui', () => {
  it('une publication fusionnee CONSERVE son manifeste dans la session, avec la preuve de livraison', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      const finalize = vi.fn(
        (): FinalizeResult => ({ outcome: 'merged', agentId: 'run-ok', committed: true, publishedSha: PUBLIE, baseSha: SHA }) as unknown as FinalizeResult
      )
      const coordinator = new RunWorktreeCoordinator({
        manager: manager(root, { finalize }),
        stateStore: store,
        nowFn: () => 10
      })
      coordinator.begin('run-ok', 'Builder', true, { task: 'edit', role: 'build' })
      expect(store.get('run-ok')).toBeTruthy() // l'etat existe pendant le run
      // Le callback causal DOIT etre acquitte : sans lui le manifeste reste, et c'est voulu — il
      // est le seul moyen de rejouer la publication si l'app meurt entre le merge et l'acquittement.
      coordinator.end('run-ok', { merge: true, onPublished: () => {} })
      // L'acquittement part en tache de fond (`void finishPublicationCallbacks`) : on attend la
      // CONDITION, borne, plutot qu'une duree devinee.
      for (let i = 0; i < 100 && store.get('run-ok'); i++) {
        await new Promise((r) => setTimeout(r, 5))
      }
      /*
       * Contrat du depot, verifie par des tests anterieurs : le manifeste SURVIT a l'acquittement et
       * porte son horodatage de livraison. Une premiere version de ce correctif le supprimait ici et
       * cassait quatre tests de rejeu — la fermeture appartient au redemarrage, pas a la session.
       */
      const apres = store.get('run-ok')
      expect(apres).toBeTruthy()
      expect(apres?.causalPublicationDeliveredAtMs).toBeDefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('une publication BLOQUEE conserve son etat — il porte encore de l’information', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      const finalize = vi.fn(
        (): FinalizeResult =>
          ({ outcome: 'blocked', agentId: 'run-ko', reason: 'merge-failed', files: ['a.ts'] }) as unknown as FinalizeResult
      )
      const coordinator = new RunWorktreeCoordinator({
        manager: manager(root, { finalize }),
        stateStore: store,
        nowFn: () => 10
      })
      coordinator.begin('run-ko', 'Builder', true, { task: 'edit', role: 'build' })
      coordinator.end("run-ko", { merge: true })
      expect(store.get('run-ko')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('A — au demarrage, un manifeste qui a fini son office est referme', () => {
  const manifeste = (over: Record<string, unknown> = {}) => ({
    version: 1 as const,
    repoId: 'repo-a',
    runId: 'run-fini',
    agentName: 'Builder',
    baseBranch: 'main',
    baseSha: SHA,
    worktreePath: '',
    verdict: 'green' as const,
    publication: 'complete' as const,
    files: [],
    createdAtMs: 10,
    updatedAtMs: 20,
    ...over
  })

  it('supprime un manifeste `complete` DONT la publication a ete acquittee', () => {
    /*
     * Le contrat de rejeu impose que le manifeste SURVIVE a l'acquittement pendant la session (des
     * tests existants le verifient, et une premiere version de ce correctif s'y est cassee). Mais au
     * REDEMARRAGE suivant, la livraison est prouvee et plus personne n'attend d'etre prevenu :
     * garder le manifeste ne protege plus rien, il ne fait que grossir un signal illisible.
     */
    const root = mkdtempSync(join(tmpdir(), 'fermeture-reconcile-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save(
        manifeste({
          worktreePath: join(root, 'agent__run-fini'),
          causalPublicationDeliveredAtMs: 99
        })
      )
      expect(store.list()).toHaveLength(1)
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [] }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-fini')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CONSERVE un manifeste `complete` dont la publication n’a PAS ete acquittee', () => {
    // Le discriminant : c'est ce manifeste-la qui permet de rejouer un callback perdu.
    const root = mkdtempSync(join(tmpdir(), 'fermeture-reconcile-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save(manifeste({ worktreePath: join(root, 'agent__run-fini') }))
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [] }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-fini')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CONSERVE un manifeste acquitte si un processus est encore VIVANT', () => {
    // Seconde garde dure : ne jamais arracher le sol sous un run actif.
    const root = mkdtempSync(join(tmpdir(), 'fermeture-reconcile-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save(
        manifeste({
          worktreePath: join(root, 'agent__run-fini'),
          causalPublicationDeliveredAtMs: 99
        })
      )
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [], hasActiveProcesses: () => true }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-fini')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('B — un run a bout de reprises cesse d’etre suspendu', () => {
  it('un manifeste `retry-exhausted` devient TERMINAL au demarrage, sans perdre son motif', () => {
    /*
     * Avant : apres six reprises, le code posait `attentionReason = 'retry-exhausted'` mais laissait
     * `publication` sur `cleanup-pending`. Le run n'etait ni repris (la reconciliation le saute) ni
     * abandonne — SUSPENDU pour toujours, et hors de portee des deux filets existants.
     *
     * Terminal ne veut pas dire silencieux : le motif reste, sinon on aurait juste rendu le probleme
     * invisible au lieu de le fermer.
     */
    const root = mkdtempSync(join(tmpdir(), 'fermeture-abandon-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save({
        version: 1,
        repoId: 'repo-a',
        runId: 'run-epuise',
        agentName: 'Builder',
        worktreePath: join(root, 'agent__run-epuise'),
        baseBranch: 'main',
        baseSha: SHA,
        verdict: 'green',
        publication: 'cleanup-pending',
        publishedSha: PUBLIE,
        attentionReason: 'retry-exhausted',
        retryCount: ESSAIS_MAX,
        files: [],
        createdAtMs: 10,
        updatedAtMs: 20
      })
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [] }),
        stateStore: store,
        nowFn: () => 30
      })
      const apres = store.get('run-epuise')
      expect(apres?.abandoned).toBe(true)
      expect(apres?.attentionReason).toBe('retry-exhausted')
      // Le ROUTAGE de reprise est intact : nommer une fin ne doit pas confisquer le bouton humain.
      expect(apres?.publication).toBe('cleanup-pending')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('un manifeste encore DANS son budget de reprises n’est pas abandonne', () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-abandon-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save({
        version: 1,
        repoId: 'repo-a',
        runId: 'run-en-cours',
        agentName: 'Builder',
        worktreePath: join(root, 'agent__run-en-cours'),
        baseBranch: 'main',
        baseSha: SHA,
        verdict: 'green',
        publication: 'cleanup-pending',
        publishedSha: PUBLIE,
        retryCount: 2,
        files: [],
        createdAtMs: 10,
        updatedAtMs: 20
      })
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [] }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-en-cours')?.abandoned).toBeFalsy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('C — quand le balayage emporte une copie, l’etat part avec elle', () => {
  it('supprime le manifeste des copies BALAYEES', () => {
    /*
     * Le balayage sait deja decider qu'une copie est abandonnee, et ses quatre conditions cumulees
     * SONT les deux gardes dures de ce chantier : aucun processus vivant, arbre de travail vide,
     * HEAD deja contenu dans une reference (donc le travail est dans l'historique), copie plus
     * vieille que la fenetre de spawn. Il ne lui manquait que le droit d'emporter le manifeste — le
     * manager ignore le store (zero occurrence), et sa liste `swept` n'etait simplement pas lue.
     */
    const root = mkdtempSync(join(tmpdir(), 'fermeture-balayage-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save({
        version: 1,
        repoId: 'repo-a',
        runId: 'run-balaye',
        agentName: 'Builder',
        worktreePath: join(root, 'agent__run-balaye'),
        baseBranch: 'main',
        baseSha: SHA,
        verdict: 'green',
        publication: 'blocked',
        files: [],
        createdAtMs: 10,
        updatedAtMs: 20
      })
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, {
          listAgentIds: () => [],
          reconcileResidues: () => ({
            cleaned: 1,
            recovered: [],
            blocked: [],
            swept: [join(root, 'agent__run-balaye')]
          })
        }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-balaye')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ne touche PAS le manifeste d’une copie que le balayage a laissee', () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-balayage-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      // La copie EXISTE : sans elle, la passe des manifestes orphelins emporterait ce manifeste pour
      // une raison etrangere a ce test, qui n'isolerait plus le comportement du balayage.
      mkdirSync(join(root, 'agent__run-garde'), { recursive: true })
      store.save({
        version: 1,
        repoId: 'repo-a',
        runId: 'run-garde',
        agentName: 'Builder',
        worktreePath: join(root, 'agent__run-garde'),
        baseBranch: 'main',
        baseSha: SHA,
        verdict: 'green',
        publication: 'blocked',
        files: [],
        createdAtMs: 10,
        updatedAtMs: 20
      })
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, {
          listAgentIds: () => [],
          reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] })
        }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-garde')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('D — un etat dont la COPIE a disparu ne survit plus tout seul', () => {
  const etat = (over: Record<string, unknown> = {}) => ({
    version: 1 as const,
    repoId: 'repo-a',
    runId: 'run-sans-copie',
    agentName: 'Builder',
    baseBranch: 'main',
    baseSha: SHA,
    verdict: 'green' as const,
    publication: 'blocked' as const,
    worktreePath: '',
    files: [],
    createdAtMs: 10,
    updatedAtMs: 20,
    ...over
  })

  it('supprime un etat orphelin dont le travail est DEJA dans l’historique', () => {
    /*
     * Variante residuelle trouvee le 2026-08-22 en verifiant la derniere case de DoD : 22 manifestes
     * subsistaient pour ZERO dossier de copie. Le balayage ne peut emporter un manifeste que quand il
     * emporte SA COPIE ; une copie disparue par un autre chemin (nettoyage manuel, suppression
     * externe) laissait donc son manifeste orphelin pour toujours.
     */
    const root = mkdtempSync(join(tmpdir(), 'fermeture-orphelin-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save(etat({ worktreePath: join(root, 'agent__run-sans-copie'), sourceSha: PUBLIE }))
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [], commitDejaReference: () => true }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-sans-copie')).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CONSERVE un etat orphelin dont le commit n’est atteignable par AUCUNE reference', () => {
    // La garde dure : ce manifeste est alors la seule adresse vers un travail. On ne le touche pas.
    const root = mkdtempSync(join(tmpdir(), 'fermeture-orphelin-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save(etat({ worktreePath: join(root, 'agent__run-sans-copie'), sourceSha: PUBLIE }))
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [], commitDejaReference: () => false }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-sans-copie')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CONSERVE un etat dont la copie EXISTE encore', () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-orphelin-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      const copie = join(root, 'agent__run-sans-copie')
      mkdirSync(copie, { recursive: true })
      store.save(etat({ worktreePath: copie, sourceSha: PUBLIE }))
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, { listAgentIds: () => [], commitDejaReference: () => true }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-sans-copie')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CONSERVE un etat orphelin si un processus est encore VIVANT', () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-orphelin-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      store.save(etat({ worktreePath: join(root, 'agent__run-sans-copie'), sourceSha: PUBLIE }))
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, {
          listAgentIds: () => [],
          commitDejaReference: () => true,
          hasActiveProcesses: () => true
        }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(store.get('run-sans-copie')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * LE COUT DE LA FERMETURE — mesure du 2026-09-03 (`gels.jsonl`, gel de demarrage).
 *
 * `for-each-ref --contains` reparcourt toutes les references du depot A CHAQUE APPEL, et il etait
 * pose une fois par manifeste : 27 appels, 2 252 ms de fenetre morte pendant la construction de la
 * fenetre. Le test verrouille la FORME de l'interrogation, pas une duree : une seule pour tout le lot.
 */
describe('fermeture des manifestes orphelins — une seule interrogation git', () => {
  it('interroge git UNE fois pour N manifestes, et respecte sa reponse par commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'fermeture-lot-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-a')
      const dansHistorique = 'a'.repeat(40)
      const orphelin = 'b'.repeat(40)
      for (const [runId, sha] of [
        ['run-publie-1', dansHistorique],
        ['run-publie-2', dansHistorique],
        ['run-orphelin', orphelin]
      ] as const) {
        store.save({
          version: 1,
          repoId: 'repo-a',
          runId,
          agentName: 'Builder',
          baseBranch: 'main',
          baseSha: SHA,
          verdict: 'green',
          publication: 'blocked',
          worktreePath: join(root, 'agent__' + runId),
          files: [],
          createdAtMs: 10,
          updatedAtMs: 20,
          sourceSha: sha
        })
      }
      const lots: string[][] = []
      // eslint-disable-next-line no-new
      new RunWorktreeCoordinator({
        manager: manager(root, {
          listAgentIds: () => [],
          commitDejaReference: () => {
            throw new Error('la voie unitaire ne doit plus etre empruntee pour le lot')
          },
          commitsDejaReferences: (shas: readonly string[]) => {
            lots.push([...shas])
            return new Map(shas.map((sha) => [sha, sha === dansHistorique]))
          }
        }),
        stateStore: store,
        nowFn: () => 30
      })
      expect(lots).toHaveLength(1)
      expect(store.get('run-publie-1')).toBeUndefined()
      expect(store.get('run-publie-2')).toBeUndefined()
      expect(store.get('run-orphelin')).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
