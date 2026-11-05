// Ce que la boucle d'un tour de chat fait d'une réponse du modèle AVANT ses relances et ses
// commandes : directive arrivée pendant l'appel, artefacts et vidéos livrés, jetons et texte
// parlé, refus d'une commande dans un tour en lecture seule, affichage d'une réponse sans commande
// et signalement de ses blocs `<cmd>` illisibles. Sorti tel quel de AgentPilot.chat()
// (conv-1580, lot 4).
import { motsUtilisateur } from '../chat-turn-messages'
import type { SendResult } from '../providers/types'
import { cleDeVideo, videosLivreesDuTour } from '../videos-livrees'
import { consumeStreamedPrefix, retirerConclusionBloquantePrematuree } from './collage-des-deltas'
import type { ContexteDuTour } from './contexte-du-tour'
import type { IterationDuTour } from './iteration-du-tour'
import { parseOrderedPilotTokens, type OrderedPilotToken } from './jetons-de-commande'

/**
 * Réinjecte les directives arrivées pendant l'appel. Vrai : l'itération est rejouée (la réponse ne
 * portait aucune commande). Faux : ses commandes s'exécutent, la directive entre ensuite.
 */
export function reinjecterLesDirectivesTardives(tour: ContexteDuTour, res: SendResult): boolean {
  const { etat, convo, drainDirectives, grantRecoveryIteration } = tour
  // Dernière barrière avant d'interpréter/clore la réponse : une directive arrivée pendant
  // l'appel provider invalide cette réponse devenue obsolète. On la réinjecte dans un nouvel
  // appel du MÊME tour. Entre ce drain vide et les branches synchrones ci-dessous, aucun IPC ne
  // peut s'intercaler : l'ACK immédiat reste donc sans fenêtre de perte en fin de tour.
  const lateDirectives = drainDirectives?.() ?? []
  /**
   * UNE DIRECTIVE TARDIVE NE JETTE RIEN : NI LE TEXTE, NI LES ACTIONS.
   *
   * Mesure (conv-65) : l'utilisateur repond pendant que le tour finit, et sa
   * reponse jetait la reponse ENTIERE du modele — y compris les `<cmd>` qu'elle portait. Le tour
   * contenait un `ask` : la question n'a donc JAMAIS ete posee, aucun bouton n'est apparu, et
   * l'utilisateur a vecu « quand je reponds ca marche pas ». Un `remember` du meme souffle a
   * disparu pareil. Trace : aucun `tool-call` pour ces deux commandes dans conv-65.jsonl.
   *
   * Regle : une ACTION deja decidee s'execute, la directive entrant au point d'iteration suivant.
   * Le TEXTE deja ecrit n'est pas efface non plus (conv-99, tour
   * 5ef60fbb-1b39-45c9-a173-418feb595345) : il reste affiche et il est rendu au modele ; la
   * reponse a la directive s'y AJOUTE, elle ne le remplace pas.
   *
   * Et si l'iteration portait un `ask`, cette directive EST la reponse : on ne repose pas la
   * question (elle attendrait un clic deja donne) et on ne clot pas le tour dessus.
   */
  const directivePorteLaReponse =
    lateDirectives.length > 0 &&
    parseOrderedPilotTokens(res.text ?? '').some((token) => token.kind === 'command')
  if (lateDirectives.length) {
    /*
     * LE BLOC DÉJÀ ÉCRIT N'EST PAS EFFACÉ (conv-99, tour 5ef60fbb-1b39-45c9-a173-418feb595345,
     * saisie ts 1791186255017) : une réponse complète et vérifiée était retirée de l'écran
     * (`stream-reset`) dès qu'une consigne arrivait, et le modèle ne la revoyait pas non plus.
     * Si la consigne rate, ce qu'elle a remplacé est perdu. Le texte reste affiché, il est rendu
     * au modèle comme SA réponse, et la réponse à la consigne s'ajoute après.
     */
    if (!directivePorteLaReponse) {
      const dejaEcrit = (res.text ?? '').trim()
      if (dejaEcrit) convo.push(`TOI (écrit avant la consigne ci-dessous): ${dejaEcrit}`)
    }
    for (const directive of lateDirectives) {
      convo.push(
        `UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${motsUtilisateur(directive)}`
      )
    }
    if (etat.rallongesDirectiveTardiveRestantes > 0) {
      etat.rallongesDirectiveTardiveRestantes -= 1
      grantRecoveryIteration('late-directive')
    }
    if (!directivePorteLaReponse) return true
    etat.reponseTardiveAUneQuestion = lateDirectives.join(' / ')
  }
  return false
}

/** Artefacts de la réponse et vidéos qu'elle nomme, chacun une seule fois dans le fil. */
export async function publierLesArtefacts(
  tour: ContexteDuTour,
  i: number,
  res: SendResult
): Promise<void> {
  const { etat, emit, conversationId, workspaceDuTour } = tour
  for (const artifact of res.artifacts ?? []) {
    // Deja affiche en direct a sa place chronologique : ne pas le doubler en fin de tour.
    if (etat.artefactsDejaEmis.has(artifact.id)) continue
    etat.artefactsDejaEmis.add(artifact.id)
    if (artifact.kind === 'video' && artifact.path)
      etat.videosDejaMontrees.add(cleDeVideo(artifact.path))
    emit({ kind: 'artifact', artifact, iteration: i })
  }
  // La réponse NOMME une vidéo qu'elle vient d'écrire (ffmpeg dans un shell) : son lecteur suit
  // le texte, comme une image lue. Voir `videos-livrees.ts`.
  for (const artifact of await videosLivreesDuTour(
    res.text ?? '',
    workspaceDuTour,
    etat.debutDuTourMs,
    etat.videosDejaMontrees
  )) {
    if (etat.artefactsDejaEmis.has(artifact.id)) continue
    etat.artefactsDejaEmis.add(artifact.id)
    emit({ kind: 'artifact', artifact, iteration: i })
  }
  if (conversationId && res.tachesDeFondARelancer?.length)
    emit({ kind: 'taches-de-fond', iteration: i, data: res.tachesDeFondARelancer })
}

/** Jetons de la réponse et texte parlé ; le préfixe diffusé est retiré s'il concluait trop tôt. */
export function lireLaReponse(
  tour: ContexteDuTour,
  iter: IterationDuTour,
  texteProvider: string
): {
  ordered: OrderedPilotToken[]
  hasCommand: boolean
  spoken: string
  onlyAuxiliaryRemember: boolean
} {
  const { etat, emit } = tour
  const { i } = iter
  if (texteProvider.includes('<cmd>')) etat.cmdEmisCeTour = true
  const ordered = parseOrderedPilotTokens(texteProvider)
  const hasCommand = ordered.some((token) => token.kind === 'command')
  const spoken = ordered
    .filter((token): token is Extract<OrderedPilotToken, { kind: 'text' }> => token.kind === 'text')
    .map((token) => (hasCommand ? retirerConclusionBloquantePrematuree(token.text) : token.text))
    .filter(Boolean)
    .join('')
    .trim()
  if (spoken) etat.anySpokenText = true
  if (spoken) etat.visibleTextThisTurn = spoken
  const prefixeStreameVisible = hasCommand
    ? retirerConclusionBloquantePrematuree(iter.successfulStreamedPrefix)
    : iter.successfulStreamedPrefix
  if (iter.successfulStreamedPrefix && prefixeStreameVisible !== iter.successfulStreamedPrefix) {
    emit({ kind: 'stream-reset', streamId: `${i}:${iter.successfulAttempt}`, iteration: i })
    iter.successfulStreamedPrefix = ''
  }
  const onlyAuxiliaryRemember =
    hasCommand &&
    Boolean(spoken) &&
    ordered.every(
      (token) => token.kind === 'text' || (token.kind === 'command' && token.name === 'remember')
    )
  return { ordered, hasCommand, spoken, onlyAuxiliaryRemember }
}

/** Commande refusée dans un tour en lecture seule : le tour est clos (vrai), rien n'est exécuté. */
export function fermerSiLectureSeuleEnfreinte(
  tour: ContexteDuTour,
  ordered: OrderedPilotToken[],
  hasCommand: boolean,
  spoken: string
): boolean {
  const { etat, emit, commandFreeReadOnly, watchdogReadOnly, catalogueLectureSeule } = tour
  // Defense en profondeur : le profil provider retire deja les outils d'ecriture, mais une
  // balise de commande peut encore apparaitre comme simple texte genere. Dans un tour declare
  // lecture-seule, seule une commande de LECTURE (readOnlyHint du catalogue) atteint le bus :
  // les commandes mutantes n'y arrivent JAMAIS, meme si le modele ignore son system prompt.
  // (Avant read_file/find_in_files, TOUT etait bloque — une analyse ne pouvait alors rien lire,
  // mesure sur 4 runs reels du scout de veille, conv-1154→1157.)
  const nomsLectureSeule = new Set(catalogueLectureSeule.map((commande) => commande.name))
  const commandeMutante = ordered.some(
    (token) => token.kind === 'command' && !nomsLectureSeule.has(token.name)
  )
  if (commandFreeReadOnly && commandeMutante) {
    emit({
      kind: 'done',
      text:
        spoken ||
        'Reponse bloquee : le modele a tente une commande mutante pendant un tour en lecture seule.',
      usage: etat.usage
    })
    return true
  }
  // Le triage Watchdog reste, lui, INTEGRALEMENT sans commandes : son pilote refuse tout exec.
  if (watchdogReadOnly && hasCommand) {
    emit({
      kind: 'done',
      text:
        spoken ||
        'Reponse bloquee : le modele a tente une commande pendant un tour en lecture seule.',
      usage: etat.usage
    })
    return true
  }
  return false
}

/**
 * Réponse SANS commande : affiche ce que le flux n'a pas encore montré, puis signale chaque bloc
 * `<cmd>` illisible. Rend ces blocs : la relance « commande illisible » les réinjecte.
 */
export function afficherLaReponseSansCommande(
  tour: ContexteDuTour,
  iter: IterationDuTour,
  ordered: OrderedPilotToken[],
  spoken: string
): Array<Extract<OrderedPilotToken, { kind: 'invalid' }>> {
  const { emit } = tour
  const { i } = iter
  if (!iter.successfulStreamedPrefix && spoken) {
    // L'iteration est portee par l'evenement : le fil en fait le flux `fallback:<i>`, et
    // la relance peut l'effacer sans toucher au texte des iterations precedentes.
    iter.fluxAffichesCetteIteration.add(`fallback:${i}`)
    emit({ kind: 'think', text: spoken, iteration: i })
  } else if (iter.successfulStreamedPrefix) {
    const visible = ordered
      .filter(
        (token): token is Extract<OrderedPilotToken, { kind: 'text' }> => token.kind === 'text'
      )
      .map((token) => token.text)
      .join('')
    const { visible: remainder } = consumeStreamedPrefix(visible, iter.successfulStreamedPrefix)
    if (remainder) iter.fluxAffichesCetteIteration.add(`${i}:${iter.successfulAttempt}:remainder`)
    if (remainder)
      emit({
        kind: 'delta',
        streamId: `${i}:${iter.successfulAttempt}:remainder`,
        text: remainder,
        iteration: i
      })
  }
  /*
   * TOUR PARASITE : un `<cmd>` casse, zero commande valide (voir la declaration de
   * `commandeIllisibleRecoveryAvailable`). On SIGNALE l'echec dans le fil, on le REINJECTE, et
   * on rend la main aux commandes — c'est la seule issue qui evite de faire retaper « go ».
   */
  const blocsIllisibles = ordered.filter(
    (token): token is Extract<OrderedPilotToken, { kind: 'invalid' }> => token.kind === 'invalid'
  )
  if (blocsIllisibles.length) {
    // Le bloc BRUT a deja ete diffuse en direct : sans token `command` survivant,
    // `hasCommand` est faux et rien ne le retirait. Vecu le 2026-09-01 (conv-46) : du JSON
    // entier affiche en plein fil. On efface le diffuse et on republie le SEUL texte parle.
    if (iter.successfulStreamedPrefix) {
      emit({ kind: 'stream-reset', streamId: `${i}:${iter.successfulAttempt}`, iteration: i })
      iter.successfulStreamedPrefix = ''
      const texteParle = ordered
        .filter(
          (token): token is Extract<OrderedPilotToken, { kind: 'text' }> => token.kind === 'text'
        )
        .map((token) => token.text)
        .join('')
        .trim()
      if (texteParle) {
        iter.fluxAffichesCetteIteration.add(`${i}:${iter.successfulAttempt}:sans-bloc`)
        emit({
          kind: 'delta',
          streamId: `${i}:${iter.successfulAttempt}:sans-bloc`,
          text: texteParle,
          iteration: i
        })
        iter.successfulStreamedPrefix = texteParle
      }
    }
    // CHAQUE bloc casse est signale, y compris le deuxieme du meme tour : le credit borne ne
    // doit brider que la RELANCE, jamais l'avertissement. Sinon le second disparait sans un mot.
    let indexSignale = 0
    for (const bloc of blocsIllisibles) {
      const actionId = `${i}:illisible-vu:${indexSignale++}`
      emit({ kind: 'command', actionId, name: 'commande illisible', args: {} })
      emit({
        kind: 'result',
        actionId,
        name: 'commande illisible',
        ok: false,
        data: `${bloc.reason} — aucune action n'a été exécutée`
      })
    }
  }
  return blocsIllisibles
}
