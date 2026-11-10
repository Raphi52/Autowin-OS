// Ce que l'envoi d'une itération au modèle fait d'une erreur : annulation, session abandonnée
// (prompt trop long, crash du CLI sans coût), repli après un refus du filtre de sécurité, rejeu
// d'une panne serveur temporaire. Sorti tel quel du `catch` de
// l'envoi dans AgentPilot.chat() (lot 4) : rend la tentative suivante — là où le `catch`
// faisait `continue` —, ou jette comme avant.
import {
  deciderRejeuDeChat,
  deciderRepliApresRefus,
  dormirAnnulable,
  estCrashDExecutionDuCli
} from '../chat/chat-rejeu-surcharge'
import { ProviderCallError, type PromptEnvelope, type SendOptions } from '../providers/types'
import type { ContexteDuTour } from './contexte-du-tour'

export async function reprendreApresErreur(
  tour: ContexteDuTour,
  envoi: {
    error: unknown
    i: number
    attempt: number
    /** Flux de la tentative qui vient d'échouer. */
    streamId: string
    /** Texte déjà diffusé par cette tentative : il est effacé avant le rejeu. */
    attemptStreamedPrefix: string
    /** Options de l'envoi, modifiées sur place par le repli de modèle. */
    options: SendOptions
    prompt: PromptEnvelope
    callStartedAt: number
    repartirSansSession: () => void
  }
): Promise<number> {
  const { etat, emit, provider, signal, resumeSessionId } = tour
  const {
    error,
    i,
    streamId,
    attemptStreamedPrefix,
    options,
    prompt,
    callStartedAt,
    repartirSansSession
  } = envoi
  let { attempt } = envoi
  const message = error instanceof Error ? error.message : String(error)
  if (signal?.aborted) {
    emit({
      kind: 'cancellation',
      iteration: i,
      name: provider,
      text: 'Annulation demandée par utilisateur',
      data: { reason: signal.reason ?? 'user' }
    })
    throw error
  }
  emit({
    kind: 'prompt-call',
    iteration: i,
    prompt,
    response: '',
    status: 'failed',
    error: message,
    ...(error instanceof ProviderCallError && error.usage ? { callUsage: error.usage } : {}),
    ...(error instanceof ProviderCallError && error.resolvedModel
      ? { resolvedModel: error.resolvedModel }
      : {}),
    callDurationMs: performance.now() - callStartedAt
  })
  /*
   * SESSION EMPOISONNEE PAR UN PROMPT TROP LONG — on l'ABANDONNE au lieu de la rejouer.
   *
   * Mesure : une injection de 2,86 Mo a fait exploser un tour en
   * « Prompt is too long ». Le tour SUIVANT ne pesait que 65 k caracteres et echouait
   * pourtant a l'identique — parce qu'il reprenait la meme session (`--resume`), qui porte
   * encore le prompt geant cote fournisseur. La conversation devenait un CUL-DE-SAC :
   * chaque relance rejouait l'echec, aucun message ne pouvait plus y passer.
   *
   * Reprendre une session dont le contenu ne tient plus dans la fenetre est sans issue :
   * on l'oublie, et on repart a blanc avec le fil ENTIER, reconstruit par
   * `repartirSansSession` (le message ampute d'une reprise). Le cout
   * est une perte de contexte cote fournisseur, DIT au modele par le fil lui-meme —
   * infiniment moins cher qu'un fil definitivement mort.
   */
  const promptTropLong = /prompt is too long|prompt too long/i.test(message)
  if (promptTropLong && etat.sessionEnCours) {
    repartirSansSession()
    if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
    emit({
      kind: 'retry',
      iteration: i,
      name: provider,
      text: `${message} — session du fournisseur abandonnee, nouvel essai sans reprise`,
      data: { attempt, maxAttempts: 2 }
    })
    return attempt
  }
  /*
   * REFUS DU FILTRE DE SECURITE (tour d9a2ca62) : l'adaptateur le marque NON
   * rejouable — il est facture — et la ligne suivante abandonnait le tour. Le rejouer a
   * l'identique echouerait pareil : on suit le conseil du CLI (« in a new session or change
   * your model »), UNE fois par tour. Politique et mesure : `deciderRepliApresRefus`.
   */
  const modeleRefuse =
    options.model ?? (error instanceof ProviderCallError ? error.resolvedModel : undefined)
  const repliRefus = deciderRepliApresRefus({
    message,
    ...(modeleRefuse ? { modele: modeleRefuse } : {}),
    // Seulement au 1er appel du tour : apres, la session porte deja le travail de ce tour
    // (lectures natives comprises), et la lacher le perdrait.
    sessionHeriteeLachable:
      i === 0 && Boolean(etat.sessionEnCours) && etat.sessionEnCours === resumeSessionId,
    dejaTente: etat.repliApresRefusTente
  })
  if (repliRefus) {
    etat.repliApresRefusTente = true
    if (repliRefus.mode === 'modele') {
      etat.modeleApresRefus = repliRefus.modele
      options.model = repliRefus.modele
    } else {
      // Le message d'une reprise est AMPUTE de l'historique (il vivait dans la session) :
      // une session neuve doit recevoir le fil entier, et l'etat entier au lieu d'un diff.
      repartirSansSession()
    }
    if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
    attempt += 1
    emit({
      kind: 'retry',
      iteration: i,
      name: provider,
      text:
        `${message.split('\n')[0]} — refus du filtre de sécurité` +
        (modeleRefuse ? ` de ${modeleRefuse}` : '') +
        (repliRefus.mode === 'modele'
          ? `, nouvel essai sur ${repliRefus.modele}`
          : ', nouvel essai dans une session neuve avec tout le fil'),
      data: {
        attempt,
        maxAttempts: attempt + 1,
        repliApresRefus: repliRefus.mode,
        ...(repliRefus.mode === 'modele' ? { modele: repliRefus.modele } : {})
      }
    })
    return attempt
  }
  if (error instanceof ProviderCallError && !error.retryable) throw error
  /*
   * UNE PANNE SERVEUR TEMPORAIRE NE DOIT PAS TUER LE TOUR (mesure du 2026-09-12).
   *
   * Sur 2 577 messages utilisateur, « reprend » est retape 61 fois ; le message qui le
   * precede est 11 fois « API Error: 529 Overloaded » et 13 fois « API Error: 500 Internal
   * server error. This is a server-side issue, usually temporary ». L'ancien plafond nu
   * (`attempt >= 1`) rejouait UNE fois, IMMEDIATEMENT : le second appel partait dans la
   * seconde, retombait sur la meme surcharge, et le backoff etait fait a la main par
   * l'utilisateur. La politique vit desormais dans un module pur teste — l'orchestrateur
   * avait deja la sienne (`transient-overload.ts`), le chat n'en avait aucune.
   *
   * Toute erreur qui n'est PAS une surcharge garde EXACTEMENT l'ancien comportement.
   */
  /*
   * fix-ok: un crash d'execution a 0 token rejoue AVEC la meme session refait le meme
   * appel — la session reprise est justement ce qui casse.
   *
   * CRASH DU CLI A 0 TOKEN SUR UNE SESSION HERITEE — on LACHE la session avant de rejouer.
   *
   * Capture fournie par l'utilisateur (tour `2fbc8f95-6a5d-4fd4-821c-7af5a197303a`,
   * 2026-09-16) : un tour meurt sur « You've hit your session limit · resets 10:30pm », le
   * meme prompt renvoye ensuite meurt en « error_during_execution · 0.0000 USD », et la
   * barre de quotas affiche 94 % de restant sur le compte actif. Rien n'a ete consomme :
   * ce n'est donc pas un refus de quota, c'est la session reclamee par `--resume` qui n'est
   * plus ouvrable (laissee ouverte par le mur, ou rangee sous un autre dossier/compte).
   * Le rejeu repartait avec le MEME `resumeSessionId` et remourait a l'identique.
   *
   * On ne lache que la session HERITEE d'un tour precedent (`sessionEnCours ===
   * resumeSessionId`) : une session ouverte PAR ce tour porte les iterations deja payees,
   * l'abandonner les perdrait. Meme mecanique que « Prompt is too long » ci-dessus : le fil
   * ENTIER est reconstruit par `repartirSansSession` pour le nouvel appel.
   */
  const crashSansCout =
    error instanceof ProviderCallError && error.retryable && estCrashDExecutionDuCli(message)
  if (crashSansCout && etat.sessionEnCours && etat.sessionEnCours === resumeSessionId) {
    repartirSansSession()
  }
  const rejeu = deciderRejeuDeChat(message, attempt)
  if (!rejeu.rejouer) throw error
  if (attemptStreamedPrefix) emit({ kind: 'stream-reset', streamId, iteration: i })
  attempt += 1
  emit({
    kind: 'retry',
    iteration: i,
    name: provider,
    text: rejeu.delaiMs
      ? `${message} — panne serveur temporaire, nouvel essai dans ${Math.round(rejeu.delaiMs / 1000)} s`
      : message,
    data: { attempt, maxAttempts: rejeu.maxAttempts }
  })
  // Attente ANNULABLE : un Stop pendant le backoff rend la main tout de suite.
  await dormirAnnulable(rejeu.delaiMs, signal)
  signal?.throwIfAborted()
  return attempt
}
