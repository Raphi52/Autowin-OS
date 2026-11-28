import { randomUUID } from 'node:crypto'
import type { Message } from '../providers/types'
import { creerAvisAvantTour } from '../chat/avis-avant-tour'
import { ensureAutowinAppData } from '../app/app-data'
import {
  diagnostiqueDossierConversation,
  avertissementDossierConversation,
  copieOuTravailleLeFil,
  type IssueDuPassage,
  dossierDeLectureDuFil,
  preparerLeDossierDuTour,
  lireReglageCopieParFil,
  ouvrirLaCopieDuFilPourLeTour,
  annonceDeCopieOuverteALaPremiereEcriture
} from '../conversations/bascule-dossier-conversation'
import { depotCiteDansLeMessage } from '../git/depot-cite-dans-le-message'
import { rangerConversationSurLePremierMessage } from '../conversations/rangement-premier-message'
import { signalerPanneAppelCourt, noterAppelCourt } from '../orchestration/petites-taches-trace'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import { estUnDepotGit } from '../git/git-apres-fil'
import { ligneDeMiseAJour, mettreLaCopieDuFilAJour } from '../git/copie-du-fil-a-jour'
import {
  demandeSansEcritureDansLeDepot,
  demandeSurLeDepotPartage
} from '../copies/demande-sans-copie'
import { copieALaDemandePossible } from '../copies/copie-a-la-demande-possible'
import type { ReponseDeCopie } from '../../shared/copie-a-la-demande'
import { messageLiaison } from '../store/dependances-copie-agent'
import type { ContexteIpcChat } from '../index'

/**
 * LE DOSSIER OÙ TRAVAILLE UN TOUR : avertissement d’un rangement sans effet, bascule par chemin
 * cité, rangement au premier message, passage du fil dans sa copie, copie ouverte en plein tour.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `creerLeDossierDuTour` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesDossierDuTour {
  avisAvantTour: ReturnType<typeof creerAvisAvantTour>
  reglageCopieParFil: () => string
}

/** Ce que `creerLeDossierDuTour` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface DossierDuTourDuChat {
  alignerDossierSurLaDemande: (conversationId: string, messages: Message[]) => void
  avertirDossierSansEffet: (conversationId: string, projectPath: string | undefined | null) => void
  passerLeFilDansSaCopie: (conversationId: string, messages: Message[]) => Promise<IssueDuPassage>
  rangerSurLePremierMessage: (
    conversationId: string,
    messages: Message[],
    finDuTour: Promise<unknown>
  ) => Promise<void>
  ouvrirLaCopieEnPleinTour: (conversationId: string, depot: string) => Promise<ReponseDeCopie>
}

/** Le dossier du tour de chat : ce que `creerLeTourDuChat` lit avant de lancer le tour. */
export function creerLeDossierDuTour(
  ctx: ContexteIpcChat,
  deps: DependancesDossierDuTour
): DossierDuTourDuChat {
  const { appDataRoot, broadcast, dossierDuTour, os } = ctx
  const { avisAvantTour, reglageCopieParFil } = deps
  /**
   * SILENCE INTERDIT : un rangement qui ne pilote PAS le dossier de travail doit le DIRE.
   *
   * Un libelle de classement (« Clients/Acme ») ou un dossier disparu laissait le modele
   * travailler dans le depot d'Autowin sans un mot — l'utilisateur croyait etre dans son projet,
   * et c'est l'AGENTS.md d'Autowin qui etait lu. On ecrit donc l'avertissement dans le fil, UNE
   * seule fois par conversation et par motif : le repeter a chaque message serait du bruit.
   */
  const dossiersDejaAvertis = new Map<string, string>()
  const avertirDossierSansEffet = (
    conversationId: string,
    projectPath: string | undefined | null
  ): void => {
    const motif = diagnostiqueDossierConversation(projectPath, os.executionWorkspace)
    const texte = avertissementDossierConversation(motif, projectPath, os.executionWorkspace)
    if (!texte) return
    const empreinte = `${motif}|${projectPath?.trim() ?? ''}|${os.executionWorkspace}`
    if (dossiersDejaAvertis.get(conversationId) === empreinte) return
    dossiersDejaAvertis.set(conversationId, empreinte)
    try {
      avisAvantTour.annoncer(conversationId, texte)
    } catch {
      // Un avertissement manque ne doit JAMAIS empecher le tour de partir.
    }
  }

  /**
   * TOUS les tours passent ICI. L avertissement etait accroche au seul IPC de la frappe
   * utilisateur : un tour lance autrement (outil `chat_send`, tache planifiee, reprise) restait
   * muet alors que le dossier range ne pilotait rien. Mesure du 2026-09-08.
   */

  /**
   * BASCULE AUTOMATIQUE quand la demande NOMME un autre depot que celui du tour.
   *
   * L'oubli de ranger la conversation faisait partir le tour dans le depot d'Autowin alors que
   * l'utilisateur avait ecrit noir sur blanc le chemin d'un autre projet. On aligne AVANT que le
   * tour parte (donc avant que `dossierDuTour` soit lu pour le cwd du CLI), et on l'ECRIT dans le
   * fil : une bascule silencieuse serait pire que pas de bascule. Aucun redemarrage — le dossier
   * est resolu a chaque tour depuis la conversation (`dossierDeTravailDuTour`).
   */
  const alignerDossierSurLaDemande = (conversationId: string, messages: Message[]): void => {
    const dernier = [...messages].reverse().find((m) => m.role === 'user')?.content
    if (typeof dernier !== 'string') return
    // Un fil dans SA copie travaille sur le dépôt de cette copie : citer un fichier de ce dépôt
    // (D:\AutoWinOS\src\…) ne le fait pas sortir de sa copie, seul un AUTRE projet le fait.
    const actif =
      copieOuTravailleLeFil(os.conversations.get(conversationId))?.depot ??
      dossierDuTour(conversationId)
    const cite = depotCiteDansLeMessage(dernier, actif)
    if (!cite) return
    try {
      os.conversations.rangerDansDossier(conversationId, cite)
      avisAvantTour.annoncer(
        conversationId,
        `📂 Ta demande nomme ${cite}, qui n'était pas le dossier de travail de cette ` +
          `conversation (${actif}). J'y bascule avant de traiter — c'est son AGENTS.md qui sera lu.`
      )
      broadcast({ type: 'refresh', scope: 'conversations' })
    } catch {
      // Une bascule ratee ne doit JAMAIS empecher le tour de partir : on reste sur le dossier d'avant.
    }
  }

  /**
   * RANGEMENT AUTOMATIQUE AU PREMIER MESSAGE, quand la demande NOMME un projet connu sans donner
   * son chemin.
   *
   * Cas mesure (2026-09-16) : conversation ouverte dans le dossier d'un autre projet, premier
   * message sur les bureaux virtuels d'Autowin -> restee au mauvais endroit jusqu'a un deplacement
   * a la main. `alignerDossierSurLaDemande` ne couvre que le chemin ECRIT ; ici l'utilisateur
   * nomme seulement son projet. On ne choisit QUE parmi les dossiers deja utilises sur ce poste,
   * jamais sur une conversation deja rangee, et seulement au PREMIER message : au-dela, le fil a
   * un sujet etabli et un deplacement serait une surprise. Comme la bascule par chemin, la
   * decision est ECRITE dans le fil et un echec ne doit pas empecher le tour de partir.
   */
  const rangerSurLePremierMessage = async (
    conversationId: string,
    messages: Message[],
    finDuTour: Promise<unknown>
  ): Promise<void> => {
    const conversation = os.conversations.get(conversationId)
    if (!conversation) return
    const dernierUtilisateur = [...messages].reverse().find((m) => m.role === 'user')?.content
    const messagesConversation = conversation.messages.some((m) => m.role === 'user')
      ? conversation.messages
      : typeof dernierUtilisateur === 'string'
        ? [{ role: 'user', content: dernierUtilisateur }]
        : conversation.messages
    /*
     * Un fil dans SA copie se range comme le fil qu'il était : né sans dossier, il reste rangeable
     * dans un autre projet au premier message ; rangé, il ne l'est pas. Le dossier actif est le dépôt
     * de la copie, et la copie d'un fil n'est jamais proposée comme projet connu.
     */
    const saCopie = copieOuTravailleLeFil(conversation)
    const actif = saCopie?.depot ?? dossierDuTour(conversationId)
    const applique = await rangerConversationSurLePremierMessage({
      conversation: {
        projectPath: saCopie ? saCopie.dossierAvant : conversation.projectPath,
        messages: messagesConversation
      },
      categorie: conversation.categorie,
      dossiersConnus: [
        ...new Set(
          os.conversations
            .listResumes()
            .map((c) => {
              const copie = copieOuTravailleLeFil(c)
              return (copie ? copie.dossierAvant : c.projectPath)?.trim()
            })
            .filter((chemin): chemin is string => Boolean(chemin))
        )
      ],
      // Le « dossier » de la barre laterale est souvent une CATEGORIE, pas un chemin
      // portait `categorie = "Autowin OS"` et aucun projectPath (mesure du 2026-09-16). Sans cette
      // liste, le cas fondateur ne pouvait pas etre range.
      categoriesConnues: [
        ...new Set(
          os.conversations
            .listResumes()
            .map((c) => c.categorie?.trim())
            .filter((libelle): libelle is string => Boolean(libelle))
        )
      ],
      dossierActif: actif,
      // Un seul appel court, sur le PREMIER message : le nom du projet est souvent absent du
      // message, seul le SUJET le rattache. Une panne du modele rend null et le
      // tour part comme avant. Un choix dans une liste, sans outil : le modèle des PETITES TÂCHES
      // (`roles.ts`, Haiku par défaut). Il partait sur le modèle du chat, effort xhigh.
      demanderAuModele: async (systeme, charge) => {
        await os.waitUntilReady()
        const binding = os.roles.bindingDesPetitesTaches()
        const reponse = await os.registry
          .send(binding.provider, [{ role: 'user', content: charge }], {
            system: systeme,
            systemBlocks: [{ name: 'rangementPremierMessage', chars: systeme.length }],
            model: binding.model,
            reasoningEffort: binding.reasoningEffort,
            requestId: randomUUID()
          })
          .catch((error: unknown) => {
            signalerPanneAppelCourt('rangementPremierMessage', error)
            throw error
          })
        noterAppelCourt(os.cost, {
          appel: 'rangementPremierMessage',
          binding,
          res: reponse,
          issue: reponse.text ?? '',
          conversationId
        })
        return reponse.text
      },
      finDuTour,
      toujoursNonRangee: () => {
        const actuelle = os.conversations.get(conversationId)
        const copie = copieOuTravailleLeFil(actuelle)
        const range = copie ? copie.dossierAvant : actuelle?.projectPath
        return Boolean(actuelle && !range?.trim() && !actuelle.categorie?.trim())
      },
      // Le dépôt de sa copie : le fil y travaille déjà, par elle. Le ranger dans le dépôt lui-même
      // le sortirait de sa copie pour l'y faire revenir au tour suivant.
      ranger: (chemin) => {
        // Relue au moment de ranger : la copie a pu s'ouvrir pendant le tour, à sa première écriture.
        const copie = copieOuTravailleLeFil(os.conversations.get(conversationId)) ?? saCopie
        if (copie && memeCheminSurDisque(chemin, copie.depot)) return undefined
        return os.conversations.rangerDansDossier(conversationId, chemin)
      },
      // Le tour est deja parti : l'annonce passe AU-DESSUS de sa reponse, vierge, en cours OU finie.
      // Un rangement differe l'ecrit APRES la fin du tour : en fin de fil, elle masquait la suite
      // proposee au champ pre-rempli et au mode auto (tour 2fefb532-3b2c-489c-9bc4-ef90c6ee4eba).
      annoncer: (message) =>
        os.conversations.append(conversationId, {
          role: 'assistant',
          content: message,
          avantLaReponseEnCours: true,
          auDessusDeLaReponseDuTour: true
        })
    })
    if (!applique) return
    broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
    broadcast({ type: 'refresh', scope: 'conversations' })
  }

  /**
   * LE FIL PASSE DANS SA COPIE AU DÉBUT DE SON TOUR (`preparerLeDossierDuTour`). Le dépôt partagé est
   * celui du fil (sa copie d'abord, son dossier rangé ensuite) dès que c'est un dépôt git ; ailleurs,
   * rien ne change. Une copie qui ne s'ouvre pas, même par une panne de git, est DITE dans le fil, et le
   * tour part là où il était : le passage ne coûte jamais la réponse. Une question seule n'en ouvre pas de neuve.
   * Un tour dont le modèle passe par un contrôle avant chaque outil (Claude ; Codex, Grok et agy quand
   * leurs réglages personnels le portent) n'en ouvre AUCUNE de neuve ici (`a-la-demande`) : ce contrôle
   * la demande juste avant la première écriture dans le code (`ouvrirLaCopieEnPleinTour`).
   */
  const passerLeFilDansSaCopie = async (
    conversationId: string,
    messages: Message[]
  ): Promise<IssueDuPassage> => {
    const fil = os.conversations.get(conversationId)
    const demande = [...messages].reverse().find((m) => m.role === 'user')?.content
    const providerDuTour =
      fil?.modeleChoisi?.provider ?? os.roles.getBinding('orchestrator').provider
    // fix-ok: le dépôt est celui du fil, quel qu'il soit ; limité au dépôt d'Autowin, un autre dépôt git n'aurait jamais de copie.
    const depot =
      fil?.copieDuFil?.depot ?? dossierDeLectureDuFil(fil?.projectPath, os.executionWorkspace)
    const annoncer = (ligne: string): void => avisAvantTour.annoncer(conversationId, ligne)
    const issue = await preparerLeDossierDuTour({
      fil,
      depotPartage: estUnDepotGit(depot) ? depot : null,
      actif: lireReglageCopieParFil(reglageCopieParFil()),
      rienAEcrire: demandeSansEcritureDansLeDepot(
        [...messages].reverse().find((m) => m.role === 'user')?.content
      ),
      aLaDemande:
        copieALaDemandePossible(providerDuTour, depot) && !demandeSurLeDepotPartage(demande),
      // la garde « copie d'avant déjà là » et les annonces de refus vivent dans bascule-dossier-conversation.ts, testées là.
      ouvrirCopie: async () => {
        const copie = await ouvrirLaCopieDuFilPourLeTour({
          dossierDeDonnees: ensureAutowinAppData(appDataRoot),
          depot: dossierDuTour(conversationId),
          conversationId
        })
        if (copie.ok && copie.dependances.fait === 'echec')
          annoncer(`⚠️ ${messageLiaison(copie.dependances)}`)
        return copie
      },
      passer: (copie) => {
        os.conversations.passerDansLaCopie(conversationId, copie)
      },
      revenir: () => {
        os.conversations.revenirDeLaCopie(conversationId)
      },
      annoncer
    })
    if (issue !== 'rien') broadcast({ type: 'refresh', scope: 'conversations' })
    /*
     * LA COPIE SUIT MAIN (`copie-du-fil-a-jour.ts`) : une copie déjà là reçoit, avant le tour, ce que
     * les autres fils ont fait entrer dans main depuis — seulement si elle ne porte rien de non publié.
     * Une copie qui vient de s'ouvrir part déjà de main. Ne dit rien quand main n'a pas bougé.
     */
    const copie = copieOuTravailleLeFil(os.conversations.get(conversationId))
    if (!copie || issue === 'ouverte') return issue
    const ligne = ligneDeMiseAJour(
      await mettreLaCopieDuFilAJour({ copie: copie.chemin, conversationId, depot: copie.depot })
    )
    if (ligne) annoncer(ligne)
    return issue
  }

  /**
   * LA COPIE S'OUVRE EN PLEIN TOUR, juste avant la première écriture dans le code : le contrôle du CLI
   * l'a demandée (`copies/copie-a-la-demande-app.ts`). Même ouverture que celle du début de tour ; les
   * annonces passent AU-DESSUS de la réponse en cours. Un refus est dit, et le tour écrit alors dans le
   * dossier partagé, comme quand l'ouverture du début de tour échoue.
   */
  const ouvrirLaCopieEnPleinTour = async (
    conversationId: string,
    depot: string
  ): Promise<ReponseDeCopie> => {
    const annoncer = (ligne: string): void => {
      os.conversations.append(conversationId, {
        role: 'assistant',
        content: ligne,
        avantLaReponseEnCours: true,
        auDessusDeLaReponseDuTour: true
      })
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
    }
    const copie = await ouvrirLaCopieDuFilPourLeTour({
      dossierDeDonnees: ensureAutowinAppData(appDataRoot),
      depot,
      conversationId
    })
    if (!copie.ok) {
      annoncer(
        `⚠️ La copie de travail de ce fil n'a pas pu s'ouvrir avant sa première modification : ${copie.raison} Ce tour écrit dans le dossier partagé ${depot}.`
      )
      return { ok: false, raison: copie.raison }
    }
    if (copie.dependances.fait === 'echec') annoncer(`⚠️ ${messageLiaison(copie.dependances)}`)
    os.conversations.passerDansLaCopie(conversationId, { chemin: copie.chemin, depot })
    annoncer(annonceDeCopieOuverteALaPremiereEcriture(depot, copie.chemin))
    broadcast({ type: 'refresh', scope: 'conversations' })
    return { ok: true, chemin: copie.chemin }
  }
  return {
    alignerDossierSurLaDemande,
    avertirDossierSansEffet,
    passerLeFilDansSaCopie,
    rangerSurLePremierMessage,
    ouvrirLaCopieEnPleinTour
  }
}
