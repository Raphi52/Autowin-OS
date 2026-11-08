// Reprise de session CLI d'un tour de chat : clé de session (modèle, compte, dossier, compactions,
// poids du fil), session connue, session périmée oubliée. Sortie telle quelle de AgentPilot.chat()
// (lot 2).
import { resolve } from 'node:path'
import { loadConvActivity } from '../activity/conv-activity'
import { coupesParPoids } from '../chat/chat-session-poids'
import { compactionsAbouties } from '../chat/chat-turn-messages'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import {
  claudeAccountEnv,
  claudeActiveAccountId,
  claudeCompteDuFil
} from '../providers/claude-accounts'
import type { ProviderRegistry } from '../providers/registry'
import type { Message } from '../providers/types'
import type { RoleBinding } from '../profil/roles'
import { suivreSessionEntreDossiers } from '../store/historique-cli-copie'

export type SessionDuTour = {
  /** Clé de session pour un compte donné. */
  cleDeSession: (compte: string | undefined) => string
  /** Compte du fil, sinon compte actif de l'application, lu à l'appel. */
  compteDuTour: () => string | undefined
  compteAuDepart: string | undefined
  providerResumes: boolean
  /** Session reprise au DÉBUT du tour, figée : elle décide de l'amputation du prompt. */
  resumeSessionId: string | undefined
}

/**
 * La copie notée du fil et le dossier d'où elle vient (voir `bascule-dossier`). Notée même quand le fil
 * n'y travaille plus : après un retour au dossier d'avant, c'est là que sa session attend.
 */
export type CopieDuFilDuChat = { chemin: string; depot: string; dossierAvant?: string }

/**
 * LA COPIE DU FIL, pour le tour. Branché au démarrage (`index.ts`), comme le compte du fil : sans ce
 * branchement, aucun passage ni retour n'est reconnu et la session ne suit pas le fil. Par défaut il ne
 * rend RIEN : un module non configuré garde le comportement d'avant.
 */
let copieDuFilDuChat: (conversationId: string) => CopieDuFilDuChat | null = () => null

export function configureCopieDuFilDuChat(
  provider: (conversationId: string) => CopieDuFilDuChat | null
): void {
  copieDuFilDuChat = provider
}

/** La copie du fil, ou `null` : un fournisseur en panne ne doit jamais casser un tour. */
function copieDuFil(conversationId: string | undefined): CopieDuFilDuChat | null {
  if (!conversationId) return null
  try {
    return copieDuFilDuChat(conversationId)
  } catch {
    return null
  }
}

export function sessionDuTour(entree: {
  provider: string
  binding: RoleBinding
  workspaceDuTour: string
  history: Message[]
  conversationId: string | undefined
  chatSessions: Map<string, { key: string; sessionId: string }>
  hydraterSessions: () => void
  oublierSession: (conversationId: string) => void
  registry: Pick<ProviderRegistry, 'honoursSessionResume'>
}): SessionDuTour {
  const {
    provider,
    binding,
    workspaceDuTour,
    history,
    conversationId,
    chatSessions,
    hydraterSessions,
    oublierSession,
    registry
  } = entree
  // Reconstruit le fil : historique de la conversation + état courant de l'app.
  // Session-resume du CHAT (levier coût) : si la conversation a déjà une session CLI ouverte avec
  // le MÊME binding, on la reprend — l'historique y est déjà, on n'envoie donc que le dernier
  // message + l'état courant de l'app (qui, lui, a pu changer). Sinon : fil complet, inchangé.
  /**
   * LE COMPTE FAIT PARTIE DE L'IDENTITE DE LA SESSION.
   *
   * Une session CLI Claude vit DANS le `CLAUDE_CONFIG_DIR` du compte qui l'a ouverte. Apres une
   * bascule de compte, `--resume <id>` pointe sur une session absente du nouveau dossier : le CLI
   * rend `No conversation found with session ID` et le tour meurt a 0 message — symptome vecu le
   * 2026-08-30 (compte `max` selectionne, chaque prompt sans reponse). Mettre l'id de compte dans
   * la cle fait retomber la conversation sur le chemin deja ecrit pour un changement de binding :
   * la session perimee est oubliee (memoire ET disque) et le fil complet repart a blanc.
   */
  /**
   * LE DOSSIER DE TRAVAIL AUSSI — meme raisonnement, second axe.
   *
   * Le CLI range ses sessions par DOSSIER (`~/.claude/projects/<cwd encode>/`), et le cwd d'un tour
   * de chat EST `process.env[AUTOWIN_WORKSPACE_ENV]` (`providers/claude.ts`, `readOnlyCwd`). Changer
   * de workspace en cours de conversation faisait donc reclamer une session absente du nouveau
   * dossier — meme `No conversation found`, meme mort a 0 message. Vecu le 2026-09-06 :
   * ouverte dans `E:\GIT\Autowin-OS`, poursuivie apres bascule sur `E:\AutoWin-Temp`, tour mort en
   * `error_during_execution` pour 0 token et 0 USD. La session etait INTACTE (355 lignes, 141
   * messages assistant) : elle etait simplement reclamee depuis le mauvais dossier.
   */
  const workspaceDeSession = workspaceDuTour
  /**
   * LA COMPACTION FAIT PARTIE DE L IDENTITE DE LA SESSION — mesure du 2026-09-08.
   *
   * « Compacter » ecrivait bien son resume, et le fil renvoye repartait de ce resume
   * (`depuisDerniereCompaction`)... sauf que sur un provider qui REPREND sa session, Autowin
   * n envoie que le dernier message : l historique vit chez le fournisseur, la coupe cote Autowin
   * ne s applique donc a RIEN et la jauge ne bouge pas d un point. Le bouton promettait un
   * allegement impossible.
   *
   * Compter les compactions ici PERIME la session a chaque nouvelle compaction, par le chemin deja
   * ecrit pour un changement de compte ou de dossier : session oubliee, tour repart a blanc, et
   * cette fois avec le fil coupe au resume. C est le seul geste qui allege reellement.
   */
  const compactions = compactionsAbouties(history)
  /**
   * LE POIDS DU FIL AUSSI — mesure du 2026-09-17.
   *
   * Autowin poussait 4 779 caracteres au CLI et l'appel etait facture 491 636 tokens d'entree :
   * la reinjection reelle est le TRANSCRIPT du CLI (raisonnement + appels d'outils de tous les
   * tours), qu'Autowin ne voit pas et ne borne pas. Mediane relevee sur 8 891 appels : 210 979
   * tokens d'entree. Les bornes d'`chat-turn-messages.ts` (40 messages / 60 k tokens) ne
   * s'appliquaient a RIEN tant que la session etait reprise.
   *
   * Franchir le seuil perime la session par le chemin deja ecrit pour la compaction : le tour
   * suivant repart sur le fil aplati d'Autowin — bulles finales + resultats d'action resumes.
   */
  const coupesPoids = conversationId ? coupesParPoids(loadConvActivity(conversationId)) : 0
  // La clé d'un dossier donné : le passage dans la copie la calcule pour le dossier d'AVANT.
  const cleAvecDossier = (dossier: string, compte: string | undefined): string =>
    `${provider}:${binding.model ?? ''}:${compte ?? ''}:${dossier}:c${compactions}:w${coupesPoids}`
  // Une FONCTION du compte : un tour qui bascule de compte en cours de route range sa
  // nouvelle session sous le compte qui l'a RÉELLEMENT ouverte, pas sous celui du départ.
  const cleDeSession = (compte: string | undefined): string =>
    cleAvecDossier(workspaceDeSession, compte)
  // Le compte choisi pour le fil prime sur celui de l'application : le compte actif peut
  // bouger sous ce fil sans que sa session cesse d'être la bonne.
  const compteDuTour = (): string | undefined =>
    claudeCompteDuFil(conversationId)?.id ?? claudeActiveAccountId()
  const compteAuDepart = compteDuTour()
  const sessionKey = cleDeSession(compteAuDepart)
  // Hydrate depuis le disque au premier tour du process : c'est ce qui fait survivre la reprise a
  // un redemarrage de l'app. Idempotent, et sans effet si le cache memoire est deja chaud.
  hydraterSessions()
  const known = conversationId ? chatSessions.get(conversationId) : undefined
  /**
   * RESUME FANTÔME — la reprise n'est armée que si l'adaptateur la TRANSMET vraiment.
   *
   * `codex` rend un `sessionId` (son `thread_id`) sans jamais l'honorer : on élidait donc le fil
   * en affirmant au modèle qu'il le connaissait « par sa session », alors qu'il démarrait à blanc.
   * Mesuré le 2026-08-04 sur 90 fils : 0 appel réellement repris, 31 prompts amputés.
   */
  const providerResumes = registry.honoursSessionResume?.(provider) ?? false
  /**
   * Le dossier de config du compte qui a ouvert la session, comme le registre le lance : le compte
   * du fil s'il en a un (même si son dossier est celui par défaut), sinon le compte actif.
   */
  const configDuCompte = (): string | undefined => {
    const compteDuFil = claudeCompteDuFil(conversationId)
    return (compteDuFil ? compteDuFil.env : claudeAccountEnv()).CLAUDE_CONFIG_DIR || undefined
  }
  /**
   * LA SESSION SUIT LE FIL ENTRE SON DOSSIER D'AVANT ET SA COPIE, DANS LES DEUX SENS.
   *
   * Le fil passe de son dossier d'avant à SA copie au début de son tour (`bascule-dossier-conversation`).
   * Le dossier fait partie de la clé : sans ce cas, la session est oubliée et l'agent relit tout le fil.
   * Le retour est le même cas à l'envers : le ménage retire la copie propre une fois le fil fini, et le
   * fil revient dans son dossier d'avant. Sa session, posée sous la copie, doit suivre le fil, sinon la
   * question suivante repart à blanc.
   * Dans les deux sens, la source est le dossier que la clé de session désigne : le dernier tour réussi
   * sous cette clé y a écrit la session la plus récente. Elle est recopiée sous le dossier d'arrivée et
   * reprise là. Tout autre changement de dossier garde la règle d'avant. Seuls les fournisseurs qui
   * reprennent leur session sont concernés : les autres renvoient le fil entier de toute façon.
   * fix-ok: cause mesurée — la clé de session contient le dossier (`cleAvecDossier`) et tout changement
   * de clé oublie la session (bloc « known.key !== sessionKey »). Le passage aller perdait la reprise
   * (test rouge mesuré, `resumeSessionId` undefined au lieu de 'sess-1'), et le retour au dossier d'avant
   * la perdait aussi : le fournisseur ne rendait plus la copie, et seul le sens aller était suivi. Le
   * correctif suit la session dans les deux sens, et seulement entre le dossier d'avant et sa copie.
   */
  const sessionSuivieEntreCopieEtDossier = (): boolean => {
    const copie = copieDuFil(conversationId)
    if (!known || !copie) return false
    const dossierAvant = resolve(copie.dossierAvant ?? copie.depot)
    const chemin = resolve(copie.chemin)
    const dansLaCopie = memeCheminSurDisque(chemin, workspaceDeSession)
    const dansLeDossierAvant = memeCheminSurDisque(dossierAvant, workspaceDeSession)
    // Ni dans la copie, ni revenu dans le dossier d'avant : le fil est ailleurs, rien à suivre.
    if (dansLaCopie === dansLeDossierAvant) return false
    // La destination est le cwd exact du tour : le CLI range la session sous ce nom-là.
    const depuis = dansLaCopie ? dossierAvant : chemin
    if (known.key !== cleAvecDossier(depuis, compteAuDepart)) return false
    return (
      suivreSessionEntreDossiers({
        configDir: configDuCompte(),
        depuis,
        vers: workspaceDeSession,
        sessionId: known.sessionId
      }) === 'suivie'
    )
  }
  const suivie = providerResumes && known ? sessionSuivieEntreCopieEtDossier() : false
  const resumeSessionId =
    providerResumes && (known?.key === sessionKey || suivie) ? known?.sessionId : undefined
  // Un détour par un autre provider/modèle ajoute des échanges absents de l'ancienne session.
  // Elle devient donc définitivement périmée, même si l'utilisateur revient ensuite au binding initial.
  // Une session suivie dans la copie n'est PAS périmée : elle n'a fait que changer de dossier.
  if (conversationId && known && known.key !== sessionKey && !suivie) {
    chatSessions.delete(conversationId)
    // Le disque doit oublier AUSSI : une entree perimee y survivrait au redemarrage et ferait
    // reprendre une session ouverte sous un autre binding.
    oublierSession(conversationId)
  }
  return { cleDeSession, compteDuTour, compteAuDepart, providerResumes, resumeSessionId }
}
