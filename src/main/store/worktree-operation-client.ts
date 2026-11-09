import { Worker } from 'node:worker_threads'
import type {
  WorktreeOperationRequest,
  WorktreeOperationResponse
} from './worktree-operation-protocol'

export interface WorktreeOperationWorkerLike {
  on(event: 'message', listener: (message: WorktreeOperationResponse) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(message: WorktreeOperationRequest): void
  terminate(): Promise<number>
}
/**
 * Ce que fait chaque opération, en mots courants : le message de délai remonte au constat du run et
 * au journal. Un nom interne seul ne dit pas ce qui attendait. `Record` sur le type de la requête :
 * une opération ajoutée au protocole ne compile pas sans son libellé.
 */
const LIBELLES_OPERATION: Record<WorktreeOperationRequest['operation'], string> = {
  prepare: 'création de la copie de travail',
  changedFiles: 'lecture des fichiers modifiés',
  fichiersDuTravail: 'lecture des fichiers de travail',
  finalize: 'intégration de la copie',
  cleanupPublished: 'nettoyage après publication',
  acknowledgePublication: 'accusé de publication',
  recoveryInventory: 'inventaire des copies à récupérer',
  recensementNonPublies: 'recensement des travaux non publiés',
  verdictsRetention: 'conservation des verdicts',
  commitsDejaReferences: 'vérification des commits déjà référencés',
  describe: 'lecture du contexte de la copie',
  hasActiveProcesses: 'vérification des processus actifs',
  discard: 'suppression de la copie',
  validateRecoveryContext: 'validation du point de reprise',
  readConflictDiff: 'lecture du conflit'
}

// fix-ok: cause mesurée — le délai ne portait pas le nom de l'opération (test rouge : « Opération worktree interrompue après 20 ms », sans libellé) ; la requête est connue dans run() mais n'était pas passée à l'erreur.
class WorktreeOperationTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly operation: WorktreeOperationRequest['operation'],
    etape: string,
    chronologie: string
  ) {
    // fix-ok: cause mesurée — le message ne datait ni le départ de l'opération ni le verdict : un refus ne se datait que par déduction (heure du refus moins le budget). Rejeu réel : « depuis 0,8 s » mesuré au verdict, aucune heure de départ (rejeu-base.txt).
    super(
      `Opération worktree interrompue après ${timeoutMs} ms (${LIBELLES_OPERATION[operation]}) — ${etape} ; ${chronologie}`
    )
    this.name = 'WorktreeOperationTimeoutError'
  }
}

// fix-ok: cause mesurée — le client prenait le signal d'étape du worker pour un résultat et résolvait l'opération à undefined (test rouge : « promise resolved "undefined" instead of rejecting », « expected undefined to be 42 ») ; le délai ne nommait donc aucune commande git.
/**
 * Dit ce que le worker attendait au moment du délai. Une commande démarrée et jamais finie est
 * l'étape bloquée — la plus ancienne si plusieurs tournent à la fois ; sinon, on dit la dernière
 * terminée, ou qu'aucune commande n'a encore tourné.
 */
function decrireEtapeGit(
  enCours: Map<number, { commande: string; ms: number }>,
  derniere: { commande: string; code: number } | undefined,
  maintenant: number
): string {
  if (enCours.size > 0) {
    const plusAncienne = [...enCours.values()].reduce((a, b) => (b.ms < a.ms ? b : a))
    const secondes = ((maintenant - plusAncienne.ms) / 1000).toFixed(1).replace('.', ',')
    const autres = enCours.size > 1 ? ` (et ${enCours.size - 1} autre(s) en cours)` : ''
    return `commande git en cours : « ${plusAncienne.commande} » depuis ${secondes} s${autres}`
  }
  if (derniere) {
    return `aucune commande git en cours ; dernière terminée : « ${derniere.commande} » (code ${derniere.code})`
  }
  return 'aucune commande git lancée'
}

export class WorktreeOperationClient {
  private active = 0
  private readonly timeoutMs: number
  private readonly workerFactory: () => WorktreeOperationWorkerLike

  constructor(
    workerPath: string,
    options: {
      timeoutMs?: number
      workerFactory?: () => WorktreeOperationWorkerLike
    } = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? Number(process.env.AUTOWIN_WORKTREE_TIMEOUT_MS ?? 180_000)
    this.workerFactory = options.workerFactory ?? (() => new Worker(workerPath))
  }

  get pendingCount(): number {
    return this.active
  }

  /**
   * `timeoutMs` par appel : une opération qui enchaîne plusieurs commandes git (ou qui balaie
   * plusieurs copies) n'a pas le budget d'UNE commande. Le défaut de ce client est 180 s ; le
   * gestionnaire le passe à 182 s (`GIT_COMMAND_TIMEOUT_MS + 2_000`, worktree-manager.ts).
   */
  run<T>(
    request: WorktreeOperationRequest,
    callbacks: {
      onPrepared?: (agentSha: string, baseSha: string) => void
      onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
    } = {},
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs
    const worker = this.workerFactory()
    this.active += 1
    return new Promise<T>((resolve, reject) => {
      let settled = false
      // Ce que le worker a signalé de ses commandes git : au délai, c'est la trace de l'étape bloquée.
      // Plusieurs tournent à la fois (commandes asynchrones) : chacune est suivie par son identifiant.
      // fix-ok: cause mesurée — une seule case « en cours » : la fin de la commande 1 effaçait la commande 2 (test rouge : « Opération worktree interrompue après 50 ms », sans nom de commande).
      const commandesEnCours = new Map<number, { commande: string; ms: number }>()
      let derniereCommande: { commande: string; code: number } | undefined
      const finish = (outcome: { value: T } | { error: Error }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.active -= 1
        void worker.terminate().catch(() => undefined)
        if ('error' in outcome) reject(outcome.error)
        else resolve(outcome.value)
      }
      // fix-ok: cause mesurée — sonde Node 24.19.0 : un délai échu pendant un blocage du fil principal part avant la réponse déjà en file (« délai déclenché à 2502 ms », réponse jamais livrée) ; le verdict attend donc la fin de cette itération de la boucle, où les messages en file sont livrés.
      // Heure limite : le travail doit être FINI avant elle (`termineA` de la réponse), pas seulement
      // reçu avant elle. Un fil principal tenu reçoit la réponse en retard, sans que le travail le soit.
      // Heure d’appel de `run()` : le worker part après, son démarrage n’est pas mesuré ici.
      const heureAppel = Date.now()
      const echeance = heureAppel + timeoutMs
      const verdictDuDelai = (): void => {
        if (settled) return
        const maintenant = Date.now()
        const etape = decrireEtapeGit(commandesEnCours, derniereCommande, maintenant)
        // Un verdict tombé pendant un blocage du fil principal arrive après l'échéance : le retard le dit.
        // Arrondi d'horloge : jamais de retard négatif.
        const retard = Math.max(0, maintenant - echeance)
        // fix-ok: cause mesurée — le libellé « démarrée à » donnait pour départ l'heure d'appel de run(), que le worker ne mesure pas (test rouge : « expected 'Opération worktree interrompue après …' to match /heure d’appel …/ » avant le libellé, vert après).
        const chronologie = `heure d’appel ${new Date(heureAppel).toISOString()} ; verdict à ${new Date(maintenant).toISOString()} (retard du verdict : ${retard} ms)`
        finish({
          error: new WorktreeOperationTimeoutError(timeoutMs, request.operation, etape, chronologie)
        })
      }
      const timer = setTimeout(() => {
        setImmediate(verdictDuDelai)
      }, timeoutMs)
      ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()

      worker.on('message', (message) => {
        // Un signal d'étape n'est PAS un résultat : il ne termine jamais l'opération.
        if (message.type === 'etape') {
          if (message.phase === 'debut') {
            commandesEnCours.set(message.id, { commande: message.commande, ms: message.ms })
          } else {
            commandesEnCours.delete(message.id)
            derniereCommande = { commande: message.commande, code: message.code }
          }
          return
        }
        // fix-ok: cause mesurée — le verdict se prenait à l'heure de LECTURE par le fil principal : une réponse terminée après l'échéance, lue dans la file pendant un blocage, était acceptée (test rouge « une réponse terminée après l’échéance est refusée… » : valeur 42 rendue au lieu d'un rejet, code 1 ; vert après correctif, code 0).
        // Un travail fini APRÈS l'échéance est un délai, même reçu à temps : le verdict ne dépend pas de
        // l'heure à laquelle ce fil lit la file, ce qui le rendrait sensible au blocage du fil principal.
        if (
          (message.type === 'result' || message.type === 'error') &&
          message.termineA > echeance
        ) {
          verdictDuDelai()
          return
        }
        if (message.type === 'prepared') {
          callbacks.onPrepared?.(message.agentSha, message.baseSha)
          return
        }
        if (message.type === 'integrated') {
          callbacks.onIntegrated?.(message.integratedSha, message.agentSha, message.baseSha)
          return
        }
        if (message.type === 'error') finish({ error: new Error(message.error) })
        else finish({ value: message.value as T })
      })
      worker.on('error', (error) => finish({ error }))
      worker.on('exit', (code) => {
        if (!settled) finish({ error: new Error(`Worker worktree arrêté avec le code ${code}`) })
      })
      try {
        worker.postMessage(request)
      } catch (error) {
        finish({ error: error instanceof Error ? error : new Error(String(error)) })
      }
    })
  }
}
