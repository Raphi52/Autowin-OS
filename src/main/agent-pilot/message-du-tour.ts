// Le MESSAGE d'ouverture d'un tour de chat : écho de mémoire, skill invoquée, grow, compte-rendu
// non vu, rappel de conversations, messages des autres fils, blocs nommés. Sorti tel quel de
// AgentPilot.chat() (lot 2).
import { blocGrowDuTour } from '../chat/grow-au-debut'
import {
  buildTurnMessageBlocks,
  type TurnMessageBlock,
  type TurnMessageParts
} from '../chat/chat-turn-messages'
import type { AppCommandBus } from '../commands/commands'
import { consigneDeLectureRetenue } from '../chat/deux-lectures'
import { boucleDraftEnCours } from '../skills/draft-choix-par-boutons'
import { noteSkillDesactivee } from '../orchestration/etapes-desactivees'
import { nativeSkills } from '../app/native-registry'
import type { Message } from '../providers/types'
import { rappelSansDejaEnvoye } from '../consignes/rappel-conversations'
import { evictedCount, rememberedFacts, sessionMemoryBlock } from '../brain/session-memory-echo'
import {
  invokedSkillId,
  noteSkillInconnue,
  skillInstruction,
  skillNommeeSansBarre
} from '../skills/skill-pipeline'
import type { LectureRetenue } from './lectures-du-tour'
import { blocRelanceSansCible } from './relance-sans-cible'

export type MessageDuTour = {
  /** /draft en cours : le choix passe par les boutons du bloc, jamais par `ask`. */
  draftChoixParBoutons: boolean
  /** Parties du message, relues pour reconstruire les blocs d'ouverture sans reprise. */
  partiesDuMessage: TurnMessageParts
  blocsDuTour: TurnMessageBlock[]
  /** Nom de chaque bloc, par texte ; complété quand les blocs sont reconstruits. */
  nomsDuTour: Map<string, string>
  /** Le fil du tour, mutable : la boucle d'itérations y ajoute les échanges suivants. */
  convo: string[]
  contextBlocksDuTour: () => Array<{ name: string; chars: number }>
}

export function messageDuTour(entree: {
  history: Message[]
  conversationId: string | undefined
  workspaceDuTour: string
  resumeSessionId: string | undefined
  snapshot: TurnMessageParts['snapshot']
  retrievedContext: string
  tourCoupePourCeMessage: boolean | undefined
  /** La lecture annoncée AVANT cet appel, remise au modèle. */
  lectureRetenue: LectureRetenue | undefined
  bus: Pick<AppCommandBus, 'rappelPourDemande' | 'messagesDesFilsPourTour'>
  growDejaEnvoye: Set<string>
  rappelDejaEnvoye: Map<string, Set<string>>
  dernierEtatPousse: Map<string, unknown>
  consommerCompteRendu: (conversationId: string) => string | undefined
}): MessageDuTour {
  const {
    history,
    conversationId,
    workspaceDuTour,
    resumeSessionId,
    snapshot,
    retrievedContext,
    tourCoupePourCeMessage,
    lectureRetenue,
    bus,
    growDejaEnvoye,
    rappelDejaEnvoye,
    dernierEtatPousse,
    consommerCompteRendu
  } = entree
  const lastUserMessage = [...history].reverse().find((m) => m.role === 'user')
  // Le contexte Brain vit ICI (et non dans le system) pour ne pas casser le préfixe cachable.
  const brainContext = retrievedContext ? `CONNAISSANCE RÉCUPÉRÉE:\n${retrievedContext}` : ''
  // ÉCHO DE MÉMOIRE — la moitié manquante de la mécanique de claude.exe : ce que le modèle a retenu
  // dans CE fil lui est remis. Ici et non dans le system, pour la même raison que le contexte Brain :
  // un contenu variable dans le préfixe tue le cache. Plafonné à ~1 500 car. — la lecture automatique
  // des fiches avait été coupée parce qu'elle pesait 552 Ko par appel.
  const executionWorkspace = workspaceDuTour.trim()
  const memoryEcho = sessionMemoryBlock(
    rememberedFacts(conversationId, executionWorkspace || undefined),
    undefined,
    evictedCount(conversationId, executionWorkspace || undefined)
  )
  // L'assemblage vit dans `chat-turn-messages.ts` pour être testable sur sa SORTIE plutôt que grepable
  // dans ce fichier. Le tableau reste mutable : la boucle d'itérations y ajoute les tours suivants.
  /**
   * Skill invoquée en tête du message (`/remake …`) : son corps est CHARGÉ et injecté.
   *
   * Sans ça, `/remake` n'était qu'une entrée d'autocomplétion du renderer — le mot n'existait nulle
   * part dans le main, donc le modèle recevait une commande dont il n'avait jamais lu le contrat.
   * Générique par construction : toute skill du kit devient atteignable, sans nouvelle phase.
   */
  // Le nom NU en tete (« draft … ») charge le meme corps que `/draft` : c'est ce qui
  // rend vraie la bulle de skill que le fil affiche desormais pour cette forme.
  const invoked =
    invokedSkillId(lastUserMessage?.content ?? '') ??
    skillNommeeSansBarre(lastUserMessage?.content ?? '')
  // /draft : le choix entre propositions passe par les boutons du bloc, jamais par `ask`
  // (draft-choix-par-boutons.ts — conv-310/311/312, 2026-10-17).
  const draftChoixParBoutons = boucleDraftEnCours(history, invoked)
  /*
   * UN `/nom` INCONNU NE DOIT PLUS DISPARAITRE EN SILENCE.
   *
   * `skillInstruction` rend '' pour une skill introuvable : le message repartait alors comme du
   * texte ordinaire, sans que personne sache que la commande n'avait pas pris. Mesure du
   * 2026-09-16 sur `conversations.json` : 12 invocations reellement tapees dans ce cas, dont
   * `/design` SIX fois apres son retrait du kit. On injecte donc la note a la place du corps vide.
   */
  /*
   * UNE SKILL DÉSACTIVÉE N'EST PAS INJECTÉE NON PLUS PAR « /nom » : `skill_charger`
   * la refusait déjà, mais l'invocation par l'utilisateur chargeait son corps sans lire
   * l'interrupteur. À la place, une note dit au modèle de ne pas la jouer et de le dire.
   */
  const skillBody = invoked
    ? (noteSkillDesactivee(invoked) ??
      (skillInstruction(invoked) || (noteSkillInconnue(invoked) ?? '')))
    : ''
  /*
   * GROW AU DEBUT DE CHAQUE DEMANDE D'ACTION : decide par le CODE sur les mots de
   * l'utilisateur, pas laisse au choix du modele (`skill_charger`). Entiere une fois par session,
   * un rappel d'une ligne ensuite. Voir `chat/grow-au-debut.ts`.
   */
  const cleGrow = conversationId ?? ''
  if (!resumeSessionId) growDejaEnvoye.delete(cleGrow)
  const grow = blocGrowDuTour({
    demande: lastUserMessage?.content,
    skillInvoquee: invoked,
    dejaDansLaSession: growDejaEnvoye.has(cleGrow),
    procedure: () => skillInstruction('grow'),
    active: () => nativeSkills().find((s) => s.id === 'grow')?.enabled !== false
  })
  if (grow.complet) growDejaEnvoye.add(cleGrow)
  /**
   * Le compte-rendu d'un tour execute sans le modele est CONSOMME ici — une seule fois.
   *
   * Lu puis retire : le laisser en place le re-injecterait a chaque tour suivant, ou il deviendrait
   * un vieux resultat presente comme frais. Il n'est utile qu'au tour qui suit immediatement le trou.
   * Retire meme sans reprise de session : dans ce cas l'historique complet part de toute facon, donc
   * la note est redondante — la garder ne ferait que la faire ressortir plus tard, a contretemps.
   */
  const compteRenduNonVu = conversationId ? consommerCompteRendu(conversationId) : undefined
  /*
   * LE RAPPEL EST INJECTE, PAS ATTENDU.
   *
   * Les outils de recherche existent (`conversation_search`, `conversation_read`), mais rien ne
   * garantit que le modele PENSE a les appeler -- et il n'y pensera pas, parce qu'il ne sait pas
   * qu'il ignore quelque chose : « remake les pastilles de couleurs » se lit comme une demande
   * complete. Attendre qu'il s'en avise, c'est reconduire en esperant mieux.
   *
   * Se declenche sur toute demande non vide (le seuil de brievete a ete retire), et exclut la
   * conversation courante : voir les bornes dans `rappel-conversations.ts`.
   */
  // Dependance OPTIONNELLE, et assumee comme telle : un rappel est un CONFORT. Un tour qui
  // echouerait faute de rappel ferait dependre chaque message d'une commodite -- et les bus
  // factices des tests, qui n'implementent que ce qu'ils exercent, tomberaient avec lui.
  const rappelBrut =
    typeof bus.rappelPourDemande === 'function'
      ? bus.rappelPourDemande(lastUserMessage?.content, conversationId)
      : ''
  // Session neuve = rien d'envoye encore : on repart a zero. Session reprise = on ne renvoie
  // pas un extrait que la session porte deja (Conv-627/conv-624 a chaque tour).
  const cleRappel = conversationId ?? ''
  if (!resumeSessionId || !rappelDejaEnvoye.has(cleRappel)) {
    rappelDejaEnvoye.set(cleRappel, new Set())
  }
  const rappelConversations = rappelSansDejaEnvoye(
    rappelBrut,
    rappelDejaEnvoye.get(cleRappel) as Set<string>
  )
  // MESSAGES D'AUTRES FILS : remis UNE fois, marqués livrés dans le journal commun.
  // Dépendance optionnelle, comme le rappel : les bus factices des tests ne l'implémentent pas.
  const messagesDesFils =
    typeof bus.messagesDesFilsPourTour === 'function'
      ? bus.messagesDesFilsPourTour(conversationId)
      : ''
  /**
   * LE NOM DE CHAQUE INJECTION DU MESSAGE, tenu a part du texte.
   *
   * `convo` est un tableau de chaines qui grossit tout au long du tour (directives arrivees en
   * cours de route, reponses d'outils, corrections). Ses blocs perdaient leur identite des la
   * construction : l'Observatory recevait un message compose ou plus rien ne distinguait ce que
   * l'HUMAIN avait tape de ce qu'Autowin avait pousse — etat de l'app, savoir Brain, echo de
   * memoire, rappel de conversations, corps de skill.
   *
   * Registre PARALLELE plutot qu'un tableau d'objets : `convo` est pousse depuis une quinzaine
   * d'endroits de ce fichier. En changer la forme pour de l'observabilite aurait touche du code
   * de decision. Une entree absente du registre n'est jamais devinee : elle ressort sous le nom
   * generique de l'echange intra-tour, qui est ce qu'elle est.
   */
  const cleEtat = conversationId ?? ''
  const snapshotPrecedent = dernierEtatPousse.get(cleEtat)
  const partiesDuMessage = {
    snapshot,
    ...(snapshotPrecedent !== undefined ? { snapshotPrecedent } : {}),
    brainContext,
    memoryEcho,
    rappelConversations,
    messagesDesFils,
    skillBody,
    growAuDebut: grow.texte,
    history,
    resumeSessionId,
    lastUserMessage: lastUserMessage?.content,
    compteRenduNonVu,
    tourCoupePourCeMessage
  }
  const blocsDuTour = buildTurnMessageBlocks(partiesDuMessage)
  // La lecture annoncée est remise au modèle, qui fait alors le travail selon elle.
  if (lectureRetenue)
    blocsDuTour.push({
      name: 'lectureRetenue',
      text: consigneDeLectureRetenue(lectureRetenue.retenue, lectureRetenue.ecartee)
    })
  // « go », « ok » : la suite désignée est jointe par le code (relance-sans-cible.ts).
  const relanceSansCible = blocRelanceSansCible(history)
  if (relanceSansCible) blocsDuTour.push({ name: 'relanceSansCible', text: relanceSansCible })
  // Ce qui vient detre pousse devient la reference du prochain tour de CETTE conversation.
  dernierEtatPousse.set(cleEtat, snapshot)
  const nomsDuTour = new Map(blocsDuTour.map((bloc) => [bloc.text, bloc.name]))
  const convo: string[] = blocsDuTour.map((bloc) => bloc.text)
  /** Decomposition NOMMEE de ce qui part cote user, relue a l'instant de l'envoi. */
  const contextBlocksDuTour = (): Array<{ name: string; chars: number }> =>
    convo.map((entree) => ({
      name: nomsDuTour.get(entree) ?? 'echangeIntraTour',
      chars: entree.length
    }))
  return {
    draftChoixParBoutons,
    partiesDuMessage,
    blocsDuTour,
    nomsDuTour,
    convo,
    contextBlocksDuTour
  }
}
