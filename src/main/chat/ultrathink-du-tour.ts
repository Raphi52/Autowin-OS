import { demandeUltrathink, effortAvecUltrathink } from '../../shared/ultrathink'
import { effortsDeclaresDuModele, type ImportedModel } from '../modeles/models'
import type { ReasoningEffort, RoleBinding } from '../profil/roles'

/**
 * « ULTRATHINK » DANS UN TOUR DE CHAT — même comportement que Claude Code.
 *
 * Lancé par l'app, le CLI Claude ne monte jamais la réflexion pour ce mot : il l'annonce dans sa
 * trame de démarrage (`ultrathink_available: false`). C'est donc l'app qui monte le tour, avec les
 * deux règles du terminal :
 *  - seul un mot TAPÉ par la personne dans le champ de saisie compte. L'écran le déclare
 *    (`declarerUltrathinkTape`) juste avant l'envoi ; un message arrivé autrement (suite proposée,
 *    mode auto, autre fil, tâche planifiée) n'a pas de déclaration et ne monte rien ;
 *  - envoyé pendant un tour, il monte le RESTE de ce tour (`ultrathinkEnPleinTour`) ; si ce tour
 *    finit sans l'avoir lu, le message repart comme un tour neuf et garde sa montée
 *    (`rendreUltrathinkTape`).
 */

/**
 * Sans entrée au catalogue (réglage sans modèle, catalogue pas encore chargé), seul Claude a une
 * réponse sûre : son CLI accepte `--effort xhigh` pour tous ses modèles. Un autre moteur rejette
 * un niveau qu'il ne connaît pas : on ne lui en invente pas.
 */
const EFFORTS_CLAUDE_HORS_CATALOGUE: readonly ReasoningEffort[] = ['xhigh']

/** Le niveau où monte ce réglage, ou `undefined` si rien ne monte (déjà plus haut, modèle sans réglage). */
function effortMonte(
  binding: RoleBinding,
  catalogue: () => ImportedModel[] | undefined
): ReasoningEffort | undefined {
  const proposes =
    effortsDeclaresDuModele(catalogue(), binding.provider, binding.model) ??
    (binding.provider === 'claude' ? EFFORTS_CLAUDE_HORS_CATALOGUE : undefined)
  const effort = effortAvecUltrathink(binding.reasoningEffort, proposes)
  return effort === undefined || effort === binding.reasoningEffort ? undefined : effort
}

/**
 * Le réglage d'UN tour de chat ouvert par un message « ultrathink » tapé : même moteur, même
 * modèle, réflexion montée pour ce tour seul. Le réglage reçu n'est jamais modifié : le tour
 * suivant repart de celui du fil. Sans mot tapé, ou si rien ne monte, l'objet reçu est rendu tel
 * quel, et le catalogue n'est pas lu : un tour ordinaire ne paie rien.
 */
export function bindingAvecUltrathink(
  binding: RoleBinding,
  tape: boolean,
  catalogue: () => ImportedModel[] | undefined
): RoleBinding {
  if (!tape) return binding
  const effort = effortMonte(binding, catalogue)
  return effort === undefined ? binding : { ...binding, reasoningEffort: effort }
}

// --- La déclaration de l'écran : « ce texte porte un ultrathink tapé à la main » ---------------

/**
 * Un message mis en file pendant un tour peut partir bien après sa frappe : la déclaration
 * l'attend, puis s'efface pour ne pas servir à un texte identique envoyé un autre jour.
 */
const DUREE_DECLARATION_MS = 2 * 60 * 60 * 1000
/** Borne de mémoire : au-delà, les plus anciennes déclarations partent. */
const DECLARATIONS_GARDEES = 50

const declarations: Array<{ texte: string; at: number }> = []

/** Le texte entre l'écran et le tour change d'espaces (rognage, pièces jointes ajoutées à la suite). */
const sansEspacesVariables = (texte: string): string => texte.replace(/\s+/g, ' ').trim()

/**
 * L'écran déclare qu'une personne a tapé « ultrathink » dans ce texte, qu'elle s'apprête à envoyer.
 * C'est une parole de l'écran, pas une preuve : le mot doit aussi être dans le texte.
 */
export function declarerUltrathinkTape(texte: string, maintenant = Date.now()): boolean {
  if (!demandeUltrathink(texte)) return false
  declarations.push({ texte: sansEspacesVariables(texte), at: maintenant })
  if (declarations.length > DECLARATIONS_GARDEES)
    declarations.splice(0, declarations.length - DECLARATIONS_GARDEES)
  return true
}

/**
 * Ce message porte-t-il un « ultrathink » tapé ? Vrai une seule fois par déclaration : le texte
 * déclaré doit se retrouver dans le message, et la déclaration est consommée.
 */
export function consommerUltrathinkTape(
  message: string | undefined,
  maintenant = Date.now()
): boolean {
  return retirerLaDeclaration(message, maintenant) !== undefined
}

/** Retire la déclaration que porte ce message et rend son texte ; `undefined` s'il n'en porte pas. */
function retirerLaDeclaration(message: string | undefined, maintenant: number): string | undefined {
  for (let i = declarations.length - 1; i >= 0; i--)
    if (maintenant - declarations[i].at > DUREE_DECLARATION_MS) declarations.splice(i, 1)
  if (!message) return undefined
  const recu = sansEspacesVariables(message)
  const rang = declarations.findIndex((declaration) => recu.includes(declaration.texte))
  return rang < 0 ? undefined : declarations.splice(rang, 1)[0].texte
}

// --- Le tour en cours : un message « ultrathink » envoyé pendant qu'il travaille ----------------

const toursEnCours = new Map<
  string,
  { binding: RoleBinding; catalogue: () => ImportedModel[] | undefined }
>()

/**
 * Les mots tapés reçus pendant le tour de chaque fil. Un tour qui rédige déjà sa réponse finale ne
 * relit plus ses messages : l'app les renvoie alors comme un tour neuf, qui doit encore savoir que
 * le mot a été tapé — sinon il partirait au niveau habituel.
 */
const tapesEnPleinTour = new Map<string, string[]>()

/**
 * Suit le réglage d'un tour le temps qu'il tourne. `binding` doit être la COPIE du tour, celle que
 * la boucle relit à chaque appel au modèle : `ultrathinkEnPleinTour` la modifie. Rend la fin du suivi.
 */
export function suivreLeTour(
  conversationId: string,
  binding: RoleBinding,
  catalogue: () => ImportedModel[] | undefined
): () => void {
  const suivi = { binding, catalogue }
  toursEnCours.set(conversationId, suivi)
  return () => {
    if (toursEnCours.get(conversationId) === suivi) toursEnCours.delete(conversationId)
  }
}

/**
 * Un message arrive pendant le tour de ce fil. S'il porte un « ultrathink » tapé et que le réglage
 * du tour peut monter, le RESTE du tour monte : les appels suivants au modèle partent plus haut.
 * Vrai = l'appel en cours doit être coupé après son outil pour repartir à ce niveau.
 */
export function ultrathinkEnPleinTour(
  conversationId: string,
  message: string,
  maintenant = Date.now()
): boolean {
  const tape = retirerLaDeclaration(message, maintenant)
  if (tape === undefined) return false
  tapesEnPleinTour.set(conversationId, [...(tapesEnPleinTour.get(conversationId) ?? []), tape])
  const suivi = toursEnCours.get(conversationId)
  if (!suivi) return false
  const effort = effortMonte(suivi.binding, suivi.catalogue)
  if (effort === undefined) return false
  suivi.binding.reasoningEffort = effort
  return true
}

/**
 * Fin du tour de ce fil. `nonLus` : les messages reçus pendant le tour qu'il n'a jamais lus, et que
 * l'app renvoie comme un tour neuf. Ceux dont le mot avait été tapé retrouvent leur déclaration ; les
 * autres mots tapés du tour ont servi et sont oubliés.
 */
export function rendreUltrathinkTape(
  conversationId: string,
  nonLus: readonly string[],
  maintenant = Date.now()
): void {
  const tapes = tapesEnPleinTour.get(conversationId)
  if (!tapes) return
  tapesEnPleinTour.delete(conversationId)
  const restants = nonLus.map(sansEspacesVariables)
  for (const texte of tapes) {
    const rang = restants.findIndex((nonLu) => nonLu.includes(texte))
    if (rang < 0) continue
    // Un message non lu ne rend qu'une déclaration : deux messages identiques en rendent deux.
    restants.splice(rang, 1)
    declarations.push({ texte, at: maintenant })
  }
}
