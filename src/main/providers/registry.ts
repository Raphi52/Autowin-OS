import {
  filDeLAppel,
  ProviderCallError,
  type Message,
  type PromptEnvelope,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk
} from './types'
import { resolveProviderTimeoutMs, withIdleDeadline } from './watchdog'
import { estMurDeQuota, instantDeRetourAnnonce } from '../../shared/reprise-quota'
import type { ExecutionSupervisor } from '../orchestration/execution-supervisor'
import { masquerErreur, masquerSortie } from './sortie-masquee'

/**
 * Plafond DUR de coordination : même si un adaptateur défaille (promesse jamais réglée, event `close`
 * qui ne tire pas après un kill de zombie), `send` REJETTE au bout de ce délai → l'orchestrateur ne
 * pend JAMAIS indéfiniment. Volontairement TRÈS large : c'est un ultime filet, pas le vrai plafond —
 * l'inactivité/le cap total des adaptateurs (watchdog de flux) tranchent bien avant sur un vrai figé.
 * Réglable via AUTOWIN_SUBAGENT_CEILING_MS.
 */
const COORDINATION_CEILING_MS = ((): number => {
  const raw = Number(process.env.AUTOWIN_SUBAGENT_CEILING_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 45 * 60_000
})()

/** Grâce bornée laissée à l'adaptateur pour se régler après l'abort de coordination. */
const COORDINATION_DRAIN_GRACE_MS = ((): number => {
  const raw = Number(process.env.AUTOWIN_SUBAGENT_DRAIN_GRACE_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000
})()

/**
 * Reconnaît un quota d'abonnement ÉPUISÉ — et lui seul.
 *
 * Le discriminant est le VOCABULAIRE du refus, pas le code HTTP : un quota épuisé et un rate-limit
 * passager arrivent tous deux en 429, et les confondre coûte dans les deux sens. Ignorer le premier fait
 * tirer des centaines d'appels dans le vide (mesuré : 852 runs rouges) ; bloquer sur le second
 * transformerait une attente de 20 s en panne de provider pour tout le run.
 *
 * Deux sources acceptées : la signature structurée posée par un adaptateur, et le texte brut — pour
 * qu'un provider qui n'a pas (encore) de signature soit couvert quand même.
 *
 * Le VOCABULAIRE vient de `estMurDeQuota` (src/shared/reprise-quota.ts), source unique partagée avec
 * la liste des conversations. Une copie privée vivait ici jusqu'au 2026-09-11 : elle ignorait
 * « session limit » — le texte que Claude écrit VRAIMENT quand l'abonnement est épuisé — donc le
 * mur de quota ne se posait pas sur le refus le plus fréquent. Deux vocabulaires pour un même
 * mur, c'est un mur qui ne se voit qu'à moitié.
 */
function quotaWallReason(error: unknown): string | undefined {
  const signature = (error as { signature?: unknown } | null)?.signature
  const texte = error instanceof Error ? error.message : String(error ?? '')
  if (/retry after|try again in|rate limit exceeded/i.test(texte)) return undefined
  if (signature === 'usage-limit-reached') return texte
  return estMurDeQuota(texte) ? texte : undefined
}

/**
 * Un mur, c'est le refus ET l'heure à laquelle il expire — quand le fournisseur la donne.
 *
 * Jusqu'au 2026-09-16 on ne gardait que le refus, et le commentaire de `quotaWalls` assumait que
 * seul un redémarrage rouvrait la porte. Mesuré sur `causal-trace/conv-539.jsonl` : deux appels ont
 * été refusés à 15h31 (heure de Paris) sur un mur qui annonçait lui-même « resets 3:20pm » — soit
 * onze minutes après son propre retour. Le geste de levée reste délibéré et gratuit : on ne sonde
 * rien, on relit simplement ce que le refus avait déjà écrit.
 */
interface MurDeQuota {
  /** Le refus LITTÉRAL du provider, tel qu'il sera cité à l'utilisateur. */
  readonly raison: string
  /** Instant de retour annoncé par ce refus, ou rien quand il n'en annonce aucun. */
  readonly retourA?: number
}

function murDepuisRefus(raison: string, maintenant: Date = new Date()): MurDeQuota {
  const retourA = instantDeRetourAnnonce(raison, maintenant)
  return retourA === undefined ? { raison } : { raison, retourA }
}

/**
 * LE MESSAGE D'UN TOUR ARRÊTÉ PARCE QUE LE COMPTE CHOISI EST VIDE (2026-11-01).
 *
 * Il cite le refus d'origine en entier : c'est lui que relisent la reprise automatique
 * (`instantDeRetourAnnonce`) et le tri des fils coupés par le quota (`estMurDeQuota`).
 */
function jusquAuRetour(retourA: number | undefined): string {
  return retourA === undefined
    ? ''
    : ` jusqu'au ${new Date(retourA).toLocaleString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit'
      })}`
}

function messageCompteChoisiVide(nomDuCompte: string, refus: string): string {
  const retour = jusquAuRetour(instantDeRetourAnnonce(refus))
  return (
    `Le compte « ${nomDuCompte} » choisi pour ce fil a son quota épuisé${retour}. ` +
    `Le tour s'arrête sans changer de compte : pour continuer, choisis un autre compte dans ce fil. ` +
    `Refus du fournisseur : ${refus.slice(0, 300)}`
  )
}

/**
 * Le compte ACTIF est épuisé : le tour s'arrête, il ne change jamais de compte tout seul. Le nom dit
 * QUEL compte est vide ; le refus d'origine reste cité en entier, car la reprise y relit l'heure.
 */
function messageCompteActifVide(nomDuCompte: string | undefined, refus: string): string {
  const retour = jusquAuRetour(instantDeRetourAnnonce(refus))
  const compte = nomDuCompte ? `Le compte « ${nomDuCompte} »` : 'Le compte Claude en cours'
  return (
    `${compte} a son quota épuisé${retour}. ` +
    `Le tour s'arrête sans changer de compte : pour continuer, choisis un autre compte ` +
    `avec les puces au-dessus de la saisie. ` +
    `Refus du fournisseur : ${refus.slice(0, 300)}`
  )
}

/**
 * Routeur d'adaptateurs. Le seul point par lequel l'app envoie un tour :
 * choisit l'adaptateur par id, INJECTE le bloc système (kit condensé) de façon
 * uniforme, délègue le streaming à l'adaptateur, et centralise la traçabilité.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  /**
   * Providers dont le quota est épuisé, avec le refus qu'ils ont écrit.
   *
   * AUCUNE SONDE AUTOMATIQUE, à dessein : re-tester périodiquement si le quota est revenu COÛTERAIT du
   * quota, pour une vérification que personne n'a demandée. Le mur tient donc toute la session, et c'est
   * l'utilisateur qui le lève en relançant l'app — un geste délibéré, au moment où il veut travailler.
   *
   * D'où l'état en mémoire : ce n'est pas une limite subie, c'est le mécanisme de levée.
   */
  private readonly quotaWalls = new Map<string, MurDeQuota>()

  /**
   * LE MUR TOMBE TOUT SEUL À L'HEURE QU'IL A LUI-MÊME ANNONCÉE.
   *
   * Lecture unique du disjoncteur : elle rend le refus encore valable, et RETIRE au passage celui
   * dont l'heure de retour est dépassée. Aucun minuteur, aucune sonde — donc toujours aucun quota
   * dépensé pour vérifier : le retour se constate au moment où un appel se présente de toute façon.
   */
  private murEncoreDebout(cle: string, maintenant: number = Date.now()): string | undefined {
    const mur = this.quotaWalls.get(cle)
    if (!mur) return undefined
    if (mur.retourA !== undefined && maintenant >= mur.retourA) {
      this.quotaWalls.delete(cle)
      return undefined
    }
    return mur.raison
  }

  /**
   * TÉMOIN D'APPEL RÉUSSI (2026-10-28) : le main y branche la mise à jour du statut
   * d'authentification affiché (`ProviderStateStore.noterAppelReussi`). Le registre ne connaît pas
   * ce store — même partage des rôles que la rotation : il signale, il ne décide pas.
   */
  private temoinAppelReussi?: (providerId: string) => void

  quandAppelReussi(temoin: (providerId: string) => void): void {
    this.temoinAppelReussi = temoin
  }

  /** Un témoin en panne (disque plein…) ne doit jamais faire échouer le tour : il est DIT, pas avalé. */
  private signalerAppelReussi(providerId: string): void {
    try {
      this.temoinAppelReussi?.(providerId)
    } catch (error) {
      console.warn(
        `[registry] statut de ${providerId} non mis à jour après un appel réussi —`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /** Bloc système par défaut (kit condensé SOUL) injecté sur CHAQUE tour. */
  constructor(
    private readonly systemBlock: string | undefined = undefined,
    private readonly executionSupervisor?: ExecutionSupervisor,
    /**
     * Compte actif d'un provider, quand il en a plusieurs (Claude multi-comptes). Sert à indexer le
     * mur de quota sur le COUPLE (provider, compte) : deux abonnements distincts ne partagent pas
     * leur quota, donc ne doivent pas partager leur mur. Absent → un seul compte, clé = le provider,
     * comportement d'avant strictement inchangé.
     */
    private readonly activeAccountOf?: (providerId: string) => string | undefined,
    /**
     * LE COMPTE DU FIL DE L'APPEL. Présent, il prime sur le compte actif : l'utilisateur l'a nommé pour
     * ce fil, et s'il est vide le tour s'arrête et le dit (`messageCompteChoisiVide`). Le registre ne
     * change JAMAIS de compte tout seul : un fil sans compte choisi reste sur le compte actif, et s'il
     * est vide le tour s'arrête aussi (`messageCompteActifVide`).
     */
    private readonly compteChoisiDuFil?: (
      providerId: string,
      fil: string | undefined
    ) => { id: string; nom: string } | undefined,
    /**
     * LE NOM D'UN COMPTE tel que l'utilisateur le voit (son adresse). Sans lui, un refus de quota
     * après un changement de compte ne disait pas QUEL compte était vide : le compte gmail tombait,
     * le tour repartait sur le compte pro, vide lui aussi, et seul le dernier refus s'affichait, lu
     * comme une erreur de compte. Absent : messages d'avant.
     */
    private readonly nomDuCompte?: (providerId: string, compte: string) => string | undefined
  ) {}

  private nomDe(providerId: string, compte: string): string | undefined {
    try {
      return this.nomDuCompte?.(providerId, compte) || undefined
    } catch {
      return undefined // un store de comptes en panne ne doit jamais casser le message d'erreur
    }
  }

  /**
   * Le message d'un tour dont le compte est épuisé : celui choisi pour le fil, sinon le compte actif.
   * `undefined` pour un provider sans compte : le message d'avant reste alors.
   */
  private messageCompteEpuise(
    providerId: string,
    compteChoisi: { id: string; nom: string } | undefined,
    compteActif: string | undefined,
    refus: string
  ): string | undefined {
    if (compteChoisi) return messageCompteChoisiVide(compteChoisi.nom, refus)
    if (compteActif) return messageCompteActifVide(this.nomDe(providerId, compteActif), refus)
    return undefined
  }

  /**
   * Clé du mur de quota. Le quota est une propriété de l'ABONNEMENT, pas du binaire : murer
   * « claude » entier quand un seul de deux comptes est épuisé annulerait la raison d'avoir payé le
   * second. On sépare donc par compte actif.
   */
  private quotaWallKey(providerId: string, account = this.activeAccountOf?.(providerId)): string {
    return account ? `${providerId}\u0000${account}` : providerId
  }

  register(adapter: ProviderAdapter): this {
    this.adapters.set(adapter.id, adapter)
    return this
  }

  ids(): string[] {
    return [...this.adapters.keys()]
  }

  get(id: string): ProviderAdapter {
    const a = this.adapters.get(id)
    if (!a) throw new Error(`Provider inconnu: ${id} (connus: ${this.ids().join(', ') || 'aucun'})`)
    return a
  }

  /**
   * Cet adaptateur reprend-il VRAIMENT une session ? Un provider inconnu répond non : élider un
   * historique sur une capacité qu'on n'a pas pu vérifier est précisément le défaut à empêcher.
   */
  honoursSessionResume(id: string): boolean {
    return this.adapters.get(id)?.honoursSessionResume === true
  }

  private resolve(id: string, opts: SendOptions): { id: string; opts: SendOptions } {
    this.get(id)
    if (id.startsWith('fabric:') && opts.execution) {
      throw new Error(
        'Une ressource Fabric local-tools ne peut pas recevoir une exécution distante'
      )
    }
    if (opts.execution) {
      const requested = this.get(id)
      if (requested.supportsExecution === true) return { id, opts }

      // Un rôle NON-exécuteur demandant une exécution est délégué à un runner outillé local : le
      // 1er exécuteur déclaré. La préférence explicite pour `codex` a été retirée le 2026-09-04 —
      // son adaptateur n'étant plus enregistré, elle ne pouvait plus élire personne.
      const executors = [...this.adapters.values()].filter((a) => a.supportsExecution === true)
      const localExecutor = executors[0]
      if (localExecutor) {
        return {
          id: localExecutor.id,
          opts: { ...opts, model: undefined, reasoningEffort: undefined }
        }
      }
      return { id, opts }
    }
    // Chat direct : route vers l'adaptateur du provider DEMANDÉ (le binding de rôle) tel quel. Chaque adaptateur streame nativement en mode conversation (send =
    // AsyncGenerator yield delta). Plus d'intermédiaire « transport » : le provider affiché EST
    // celui qui répond (fin de la redirection silencieuse + du throw obligatoire).
    this.get(id)
    return { id, opts }
  }

  describePrompt(
    id: string,
    messages: Message[],
    opts: SendOptions = {},
    model?: string
  ): PromptEnvelope {
    const route = this.resolve(id, opts)
    const adapter = this.get(route.id)
    const resolved = { ...route.opts, system: route.opts.system ?? this.systemBlock }
    return (
      adapter.describePrompt?.(messages, resolved, resolved.model ?? model) ?? {
        provider: route.id,
        model: resolved.model ?? model,
        transport: 'ProviderAdapter.send',
        system: resolved.system,
        systemBlocks: resolved.systemBlocks,
        contextBlocks: resolved.contextBlocks,
        messages,
        options: { resumed: Boolean(resolved.resumeSessionId) },
        limitation:
          'Capture exacte à la frontière Autowin OS ; ajouts internes du provider non observables.'
      }
    )
  }

  /**
   * Envoie un tour via le provider `id`. Le bloc système du registre est injecté
   * sauf si `opts.system` le surcharge explicitement. Streame les chunks au
   * callback `onChunk` et retourne le résultat final consolidé.
   */
  async send(
    id: string,
    messages: Message[],
    opts: SendOptions = {},
    onChunk?: (c: StreamChunk) => void
  ): Promise<SendResult> {
    return this.sendSurLeCompteDuTour(id, messages, opts, onChunk)
  }

  /**
   * Le compte de l'appel ne change jamais tout seul : celui choisi pour le fil, sinon le compte actif.
   * Sur quota épuisé, le tour s'arrête et nomme ce compte (`messageCompteEpuise`).
   */
  private async sendSurLeCompteDuTour(
    id: string,
    messages: Message[],
    opts: SendOptions = {},
    onChunk?: (c: StreamChunk) => void
  ): Promise<SendResult> {
    const route = this.resolve(id, opts)
    const adapter = this.get(route.id)
    // L'appelant a construit ses callbacks avant que le registre ne choisisse un fallback local.
    // Publier la route AVANT tout spawn garantit que pid/journal portent l'exécuteur causal réel.
    route.opts.execution?.onExecutorResolved?.(route.id)
    const compteChoisi = this.compteChoisiDuFil?.(route.id, filDeLAppel(route.opts))
    // Figer le compte au départ : une bascule faite à la main pendant l'attente ne doit pas déplacer
    // le mur vers un autre compte que celui qui a été réellement appelé.
    const accountAtStart = compteChoisi?.id ?? this.activeAccountOf?.(route.id)
    const wallKeyAtStart = this.quotaWallKey(route.id, accountAtStart)
    if (route.opts.execution && adapter.supportsExecution !== true) {
      throw new Error(`Provider ${route.id} sans exécuteur local outillé`)
    }
    // `systemBlock` = la CONSTITUTION (source unique du soul, cf. constitution.ts). Elle sert ici de
    // FALLBACK uniquement quand aucun `opts.system` explicite n'est fourni (os.chat/chat_send).
    // Depuis l'unification chat↔orchestrateur, le chat cockpit ET les phases orchestrées injectent
    // la MÊME CONSTITUTION explicitement via leurs propres `parts` (agent-pilot.ts / orchestrator.ts) :
    // ce fallback ne les concerne donc pas — ce n'est plus une exclusion voulue du soul.
    const system = route.opts.system ?? this.systemBlock
    // DISJONCTEUR DE QUOTA, avant même la réservation : un appel refusé ne doit consommer aucun budget.
    // Même intention que l'admission ci-dessous — ne rien lancer qui soit condamné d'avance — mais pour
    // une cause EXTERNE : un quota d'abonnement épuisé se rétablit des JOURS plus tard, jamais par une
    // relance. Dépouillement du 2026-08-06 : 852 runs rouges (70 % des échecs réels) n'avaient que cette
    // cause, dont 285 APRÈS le correctif qui se contentait de la NOMMER sans fermer la porte.
    const mur = this.murEncoreDebout(wallKeyAtStart)
    if (mur) {
      const nomme = this.messageCompteEpuise(route.id, compteChoisi, accountAtStart, mur)
      if (nomme) throw new Error(nomme)
      // Le message ne promet plus le redémarrage comme SEULE levée : depuis le 2026-09-16, un refus
      // qui annonce son heure de retour rouvre la porte tout seul à cette heure-là.
      const retour = this.quotaWalls.get(wallKeyAtStart)?.retourA
      throw new Error(
        `Provider ${route.id} écarté : quota épuisé, plus aucun appel ne lui est envoyé. ` +
          (retour === undefined
            ? `Relancer l'app remet le compteur à zéro. `
            : `La porte se rouvre d'elle-même à ${new Date(retour).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit'
              })}. `) +
          `Refus du provider : ${mur.slice(0, 300)}`
      )
    }
    // Admission AVANT l'adaptateur : un budget epuise ne doit jamais faire apparaitre une fenetre,
    // ouvrir un stream ou lancer un CLI qui sera seulement tue apres sa reponse.
    // Toute execution outillee est un agent du devis. L'admission appels + agents est atomique et
    // precede adapter.send : fan-out, greedy, juge, synthese et reparation suivent le meme plafond.
    const reservation = this.executionSupervisor?.reserveProviderCall(
      route.opts.signal,
      Boolean(route.opts.execution)
    )
    const coordinationController = new AbortController()
    const providerSignal = reservation?.signal ?? route.opts.signal
    let spawnFailure: Error | undefined
    const spawnedTokens = new Set<string>()
    let terminateProvider: ((reason: string) => void) | undefined
    let reservationSettled = false
    const settleReservation = (failed: boolean, usage?: SendResult['usage']): void => {
      if (!reservation || reservationSettled) return
      reservationSettled = true
      if (failed) reservation.fail(usage)
      else reservation.complete(usage)
      route.opts.execution?.onReservationSettled?.(reservation.id)
    }
    // INSCRIRE L'AGENT DANS LA MÊME SECTION SYNCHRONE QUE SA RÉSERVATION. L'adaptateur attend avant
    // d'annoncer son agent (`claude.ts` : instantané du dépôt, mise à jour du CLI) ; si l'inscription
    // attendait aussi, la sauvegarde obligatoire d'un membre voisin comptait 1 agent pour 2 appels
    // réservés et tuait son lancement (« liens de reservation incoherents »).
    // Aucun `await` entre `reserveProviderCall` et cet appel : aucun autre agent ne peut s'intercaler.
    if (reservation && route.opts.execution?.onReservation) {
      try {
        route.opts.execution.onReservation(reservation.id)
      } catch (error) {
        settleReservation(true)
        throw error
      }
    }
    const execution = route.opts.execution
      ? {
          ...route.opts.execution,
          onSpawnIntent: (token: string, active: boolean) => {
            // Les adaptateurs retirent l'intention juste avant de rejeter lorsqu'un spawn échoue.
            // Régler d'abord la réservation garantit que la persistance déclenchée par le callback
            // ne peut jamais écrire le couple incohérent `agents=[]` + `activeCalls=1`.
            if (!active && !spawnedTokens.has(token)) {
              settleReservation(true)
              spawnFailure ??= new Error(
                `Lancement du sous-agent ${route.id} annulé avant création du processus (${token}).`
              )
            }
            if (active || !spawnedTokens.has(token)) {
              route.opts.execution?.onSpawnIntent?.(token, active, reservation?.id)
            }
          },
          onSpawned: (token: string, pid: number) => {
            // Le registre fournit toujours ce callback. Les adaptateurs n'ont donc plus besoin de
            // traduire un PID réussi en `spawnIntent(false)` lorsque l'appelant ne suivait que les
            // processus. On reproduit ici ce fallback historique sans le confondre avec un échec.
            spawnedTokens.add(token)
            if (route.opts.execution?.onSpawned) {
              route.opts.execution.onSpawned(token, pid)
            } else {
              route.opts.execution?.onProcess?.(pid, true)
              route.opts.execution?.onSpawnIntent?.(token, false, reservation?.id)
            }
          },
          registerTermination: (terminate: (reason: string) => void) => {
            terminateProvider = terminate
            route.opts.execution?.registerTermination?.(terminate)
          }
        }
      : undefined
    const effectiveOptions = {
      ...route.opts,
      system,
      ...(execution ? { execution } : {}),
      signal: providerSignal
        ? AbortSignal.any([providerSignal, coordinationController.signal])
        : coordinationController.signal
    }
    let gen: ReturnType<ProviderAdapter['send']>
    try {
      gen = adapter.send(messages, effectiveOptions)
    } catch (error) {
      settleReservation(true)
      throw error
    }

    // Pompe du stream, enveloppée d'un PLAFOND DUR de coordination : si l'adaptateur ne rend jamais la
    // main (zombie, `close` jamais émis), la course rejette au lieu de pendre à l'infini. Garantie que
    // l'orchestrateur se règle TOUJOURS ; le watchdog de flux des adaptateurs tue le process bien avant.
    let forceDrainReject!: (error: Error) => void
    let unprovenTerminationError: Error | undefined
    const forcedDrain = new Promise<never>((_resolve, reject) => {
      forceDrainReject = reject
    })
    let pendingNext: ReturnType<typeof gen.next> | undefined
    const nextStep = (): ReturnType<typeof gen.next> => {
      pendingNext = gen.next()
      return Promise.race([pendingNext, forcedDrain])
    }
    // Réarme le plafond de coordination : il mesure le SILENCE, plus la durée absolue d'un tour.
    // Défini avant la pompe, assigné après la création de la deadline (même tick, jamais appelé
    // avant puisque la pompe attend d'abord `gen.next()`).
    let battreCoordination: () => void = () => undefined
    const pump = (async (): Promise<SendResult> => {
      let step = await nextStep()
      while (!step.done) {
        // Une fois l'appel annulé, continuer à drainer le générateur pour observer sa vraie fin,
        // mais ne plus livrer de delta à une conversation déjà clôturée.
        if (!effectiveOptions.signal.aborted && !spawnFailure) {
          battreCoordination()
          // Entrée unique de la sortie des moteurs : une valeur du coffre n'atteint ni le fil ni le
          // journal de tour (`sortie-masquee.ts`).
          onChunk?.(masquerSortie(step.value))
        }
        step = await nextStep()
      }
      // `spawnIntent(false)` est terminal par contrat. Même un adaptateur défaillant qui retourne
      // ensuite un résultat ne peut donc faire valider un succès déjà persisté comme échec.
      if (spawnFailure) throw spawnFailure
      // Valeur de retour du generator = SendResult final, masqué comme les morceaux.
      return masquerSortie(step.value)
    })()
    // La réservation suit la vraie fin pendant une grâce bornée. Au-delà, elle est réglée en échec
    // conservateur et la pompe du registre est coupée, même si un provider tiers ignore encore l'abort.
    let drainGraceTimer: ReturnType<typeof setTimeout> | undefined
    const trackedPump = pump
      .then(
        (result) => {
          settleReservation(effectiveOptions.signal.aborted, result.usage)
          if (!effectiveOptions.signal.aborted) this.signalerAppelReussi(route.id)
          return result
        },
        (error) => {
          // L'erreur d'un moteur cite souvent la fin de sa sortie : masquée avant tout lecteur.
          masquerErreur(error)
          // La coupure de la pompe de coordination ne prouve pas que le provider/CLI est mort. Sa
          // réservation reste active jusqu'à ce que le `next()` réel ou `return()` du générateur
          // termine ; le checkpoint continue ainsi de verrouiller toute reprise concurrente.
          if (error !== unprovenTerminationError) {
            settleReservation(true, error instanceof ProviderCallError ? error.usage : undefined)
          }
          // Toute défaillance passe ici : c'est le point unique où armer le disjoncteur. On l'arme sur
          // la PREUVE (le refus du provider), pas sur une supposition — `quotaWallReason` écarte
          // explicitement le rate-limit passager.
          const raison = quotaWallReason(error)
          if (raison) this.quotaWalls.set(wallKeyAtStart, murDepuisRefus(raison))
          throw error
        }
      )
      .finally(() => {
        if (drainGraceTimer) clearTimeout(drainGraceTimer)
      })
    // Le compte ne change jamais tout seul : sur un refus de quota, l'erreur nomme le compte en cours
    // (celui du fil, sinon le compte actif), sa date de retour et le geste à faire. Elle garde sa classe
    // et son coût : seul son message change. Le mur vient d'être posé par le handler ci-dessus.
    const nommerLeCompteEpuise = (error: unknown): never => {
      const raison = quotaWallReason(error)
      if (raison && error instanceof Error) {
        const nomme = this.messageCompteEpuise(route.id, compteChoisi, accountAtStart, raison)
        if (nomme) error.message = nomme
      }
      throw error
    }
    const coordinationCeilingMs = resolveProviderTimeoutMs(
      route.opts.execution?.providerTimeoutMs,
      COORDINATION_CEILING_MS
    )
    const coordination = withIdleDeadline(
      trackedPump.catch(nommerLeCompteEpuise),
      coordinationCeilingMs,
      `Sous-agent ${route.id} sans réponse depuis ${Math.round(coordinationCeilingMs / 1000)}s (watchdog coordination) — abandonné pour ne pas bloquer le run.`,
      () => {
        const reason = `Watchdog coordination expiré pour ${route.id}`
        coordinationController.abort(reason)
        reservation?.abort(reason)
        drainGraceTimer = setTimeout(() => {
          const error = new Error(
            `${reason} : drainage toujours actif après ${COORDINATION_DRAIN_GRACE_MS} ms`
          )
          unprovenTerminationError = error
          try {
            terminateProvider?.(error.message)
          } catch {
            // La fermeture de l'adaptateur reste best-effort ; la pompe est bornée quoi qu'il arrive.
          }
          // Arrête la boucle du registre même si `gen.next()` reste bloqué dans un provider fautif.
          const unfinishedNext = pendingNext
          forceDrainReject(error)
          // La fermeture continue hors de la promesse rendue à l'orchestrateur. Si le provider
          // ignore aussi `return()`, cette promesse reste pendante ET la réservation reste active :
          // c'est une incertitude durable, jamais une autorisation de second appel.
          void (async () => {
            try {
              const step = unfinishedNext ? await unfinishedNext : await gen.next()
              if (step.done) {
                settleReservation(true, step.value.usage)
                return
              }
              let closed = await gen.return(undefined as never)
              // `return()` peut traverser un `finally` qui yield : `done:false` reste une activité,
              // pas une terminaison. On poursuit donc la fermeture sans jamais solder entre deux
              // yields ; une attente infinie conserve naturellement la réservation active.
              // Après le premier `return`, reprendre avec `next` laisse le `finally` exécuter son
              // nettoyage. Répéter `return` pourrait au contraire court-circuiter ce `finally`.
              while (!closed.done) closed = await gen.next()
              settleReservation(true, closed.value.usage)
            } catch {
              settleReservation(true)
            }
          })()
        }, COORDINATION_DRAIN_GRACE_MS)
        drainGraceTimer.unref?.()
      }
    )
    battreCoordination = coordination.beat
    return coordination.promise
  }
}
