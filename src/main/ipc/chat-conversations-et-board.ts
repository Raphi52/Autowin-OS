import { nomUtilisateurCourant } from '../profil/identite-utilisateur'
import { registerConversationsIpc } from './conversations'
import { registerCarteDesBesoinsIpc } from './carte-des-besoins'
import { creerDossierDuBoard, sousDossierDuPoste } from '../board/board-dossier'
import { creerPublicationDeLaPresence } from '../mascotte/quartier-presence'
import { groupeDe } from '../../renderer/src/components/conversation-groups'
import { ANIMAL_PAR_DEFAUT } from '../../shared/quartier-presence'
import { registerQuartierPresenceIpc } from './quartier-presence'
import { registerLangueIpc } from './langue'
import { registerCaptureElementIpc } from './capture-element'
import { creerMesureDesEcarts } from '../board/ecarts-des-fiches'
import type { ConversationPourLaCarte } from '../board/carte-des-besoins'
import { type BranchePourLaFiche, messagesRecopies } from '../board/fiches-de-demande'
import { lireDossiersProjetsClaude } from '../providers/dossiers-claude-cli'
import { registerChatArtifactsIpc } from './chat-artifacts'
import { app, ipcMain } from 'electron'
import { join } from 'path'
import { assertTrustedRendererSender } from './ipc-senders'
import { ensureAutowinAppData } from '../app/app-data'
import { homedir } from 'node:os'
import { canonicalProjectPath } from '../../shared/project-path'
import { DOSSIER_DES_COPIES_DE_FIL } from '../../shared/copie-du-fil'
import { branchesARattacher } from '../store/conversations'
import type { SuiviDesFilsCoupes } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LES CONVERSATIONS ET LE BOARD : canaux des fils, artefacts, langue, capture d’élément, Board du
 * poste, présence du quartier, carte des besoins, écarts des fiches, dossiers Claude.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `registerConversationsEtBoardIpc` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesConversationsEtBoard {
  suiviDesFilsCoupes: SuiviDesFilsCoupes
}

/** Ce que `registerConversationsEtBoardIpc` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface ConversationsEtBoard {
  rattacherLaBranche: ContexteIpcChat['rattacherLaBrancheAuxFiches']
  dossierDesRetours: () => string
  dossierDesCopiesDeFil: () => string
  boardDuPoste: ReturnType<typeof registerCarteDesBesoinsIpc>
  mesureDesEcarts: ReturnType<typeof creerMesureDesEcarts>
}

/** IPC : conversations, Board et carte des besoins. */
export function registerConversationsEtBoardIpc(
  ctx: ContexteIpcChat,
  deps: DependancesConversationsEtBoard
): ConversationsEtBoard {
  const {
    activeChatTurns,
    appDataRoot,
    broadcast,
    bus,
    causalTrace,
    dossierDuTour,
    fichesDeDemande,
    isolatedTestInstance,
    journalDesBesoins,
    os,
    pickDirectory,
    rattacherLaBrancheAuxFiches,
    repriseDesFilsActive,
    ticketSources,
    tickets,
    turnJournalRoot
  } = ctx
  const { suiviDesFilsCoupes } = deps
  /*
   * UNE BRANCHE REPREND LE JOURNAL ET LES FICHES DE SA SOURCE. Le journal d'abord : une
   * question recopiée y redevient une question, au lieu d'une demande sans fiche. Fail-open, comme
   * le journal : un échec ici ne retient jamais le rattachement des fiches.
   */
  const rattacherLaBranche = (
    branche: Parameters<typeof rattacherLaBrancheAuxFiches>[0],
    source: Parameters<typeof rattacherLaBrancheAuxFiches>[1]
  ): Promise<number> => {
    try {
      journalDesBesoins.recopierLaBranche({
        branche: (branche as BranchePourLaFiche).id,
        source: (source as ConversationPourLaCarte).id,
        paires: messagesRecopies(branche as BranchePourLaFiche, source as ConversationPourLaCarte)
      })
    } catch (error) {
      console.warn('[besoins] branche non recopiée au journal :', error)
    }
    return rattacherLaBrancheAuxFiches(branche, source)
  }
  /** Les copies des essais et des retours à un tour : « Garder » ne reconnaît une façon que dedans. */
  const dossierDesRetours = (): string => join(ensureAutowinAppData(appDataRoot), 'retours-de-tour')
  /**
   * Les copies d'avant (`copies-de-fil/<fil>`), encore là jusqu'à leur retrait : une nouvelle copie ne s'y
   * ouvre plus (elle va sous la racine unique). La porte de fin de tour part de la copie notée sur le fil,
   * jamais de son nom.
   */
  const dossierDesCopiesDeFil = (): string =>
    join(ensureAutowinAppData(appDataRoot), DOSSIER_DES_COPIES_DE_FIL)
  // Les canaux des conversations vivent dans src/main/ipc/conversations.ts.
  registerConversationsIpc({
    os,
    activeChatTurns,
    causalTrace,
    turnJournalRoot,
    isolatedTestInstance,
    broadcast,
    pickDirectory,
    compterLectureIsolee: () => {
      ctx.isolatedConversationReadCount += 1
    },
    etatDeReprise: (fil) => suiviDesFilsCoupes.reprise?.etatDuFil(fil),
    relireLesFilsCoupes: () => {
      if (repriseDesFilsActive) suiviDesFilsCoupes.reprise?.replanifier()
    },
    dossierDuFil: (id) => dossierDuTour(id),
    dossierDesRetours: () => join(ensureAutowinAppData(appDataRoot), 'retours-de-tour'),
    couperLeRun: (id, motif) => bus.abortOrchestration(id, motif),
    retirerLesFiches: fichesDeDemande.retirerLeFil,
    rattacherLesFiches: rattacherLaBranche
  })
  // Les canaux des artefacts du chat vivent dans src/main/ipc/chat-artifacts.ts.
  registerChatArtifactsIpc({ os })
  // La langue de Settings · Interface : l'agent répond dans celle qui est choisie.
  registerLangueIpc()
  // La capture de l'élément désigné par Alt+clic, jointe au brouillon du fil.
  registerCaptureElementIpc()
  // La carte des besoins : lecture seule, calculée ici où vivent tous les fils.
  // Work items : les liens prompt → task dans `liens-work-items.jsonl`, et la seule
  // LECTURE des fiches — aucune écriture chez le fournisseur n'est transmise.
  // Le dossier où le Board est recopié : réglé sur ce poste, rangé sous userData. Partagé
  // avec la présence du village commun, qui écrit à côté de `board.json`.
  const dossierDuBoard = creerDossierDuBoard({
    racine: app.getPath('userData'),
    utilisateur: nomUtilisateurCourant()
  })
  // La présence de ce poste dans le village commun : les tanukis de la vue, filtrés, dans
  // `<dossier du Board>\<compte>\presence.json`. Le réglage est relu à chaque écriture.
  const publicationDeLaPresence = creerPublicationDeLaPresence({
    poste: sousDossierDuPoste(nomUtilisateurCourant()),
    reglage: () => {
      const etat = dossierDuBoard.etat()
      return {
        dossier: etat.dossier,
        nom: dossierDuBoard.nomDuPoste().nom,
        partager: etat.partagerPresence !== false,
        // Toujours écrit, même sans choix : le réglage de l'Accueil montre l'animal que
        // les collègues voient, pas celui d'un tirage sur le nom du poste.
        animal: etat.animal ?? ANIMAL_PAR_DEFAUT,
        // La couleur de leur tenue ; absente = la tenue d'origine, rien à écrire.
        ...(etat.tenue ? { tenue: etat.tenue } : {}),
        // « Afficher mes agents à » des réglages de l'Accueil.
        masquesPour: etat.masquerPresencePour ?? [],
        // Les projets cochés dans le Board : seuls leurs tanukis partent. Absent = tous.
        projets: etat.projets ?? null
      }
    },
    // Le projet du fil, calculé comme sur le Board (`carte-des-besoins.ts`) : même clé, même repli.
    projetDuFil: (id) => {
      const fil = os.conversations.get(id)
      return fil ? groupeDe(fil, os.executionWorkspace).key : undefined
    }
  })
  registerQuartierPresenceIpc({ dossierDuBoard, publication: publicationDeLaPresence })
  // Rend la copie du Board de fin de tour, appelée par l'observateur de fin de tour.
  const boardDuPoste = registerCarteDesBesoinsIpc({
    os,
    journal: journalDesBesoins,
    racineDesLiens: app.getPath('userData'),
    tickets: {
      listSources: () => ticketSources.list(),
      get: (request) => tickets.get(request)
    },
    dossierDuBoard,
    choisirDossier: pickDirectory,
    // Où la copie de fin de tour garde les états posés à la main.
    racineDuPoste: app.getPath('userData'),
    // Un post-it par RUN.md léger : la fiche de chaque demande rangée.
    lireFiches: fichesDeDemande.fichesParDemande,
    // Un projet coché ou décoché : les tanukis suivent dans les 5 s, sans attendre le battement.
    apresChoixDesProjets: () => publicationDeLaPresence.reglageChange()
  })
  // Les RUN.md légers comparés au Board : le Board est lu, jamais changé.
  const mesureDesEcarts = creerMesureDesEcarts({
    racine: app.getPath('userData'),
    lireLaCarte: boardDuPoste.lireLaCarte,
    lireLignes: fichesDeDemande.lignes,
    // Une fiche qui contredit le Board suit son état : la mesure ne fait que constater sinon.
    resynchroniser: fichesDeDemande.resynchroniser
  })
  /*
   * Les branches nées avant le rattachement (les « façon 1/3 », seules
   * demandes sans fiche de `ecarts.json`) : leurs demandes recopiées rejoignent la fiche d'origine,
   * une fois, quand tous les fils sont chargés. Rejoué au démarrage suivant, cela n'ajoute rien.
   */
  void os.conversations.archivesChargees
    .then(async () => {
      let rattachees = 0
      // fix-ok: la boucle tourne sur la liste prise avant la première attente : relire chaque fil
      // pendant l'attente ferait sauter une branche supprimée entre-temps.
      for (const branche of branchesARattacher(os.conversations)) {
        const source = branche.forkedFrom && os.conversations.get(branche.forkedFrom.conversationId)
        if (source) rattachees += await rattacherLaBranche(branche, source)
      }
      if (rattachees > 0) mesureDesEcarts.planifier()
    })
    .catch((error) => console.warn('[fiches] branches non rattachées :', error))

  // fix-ok: cause mesurée — aucun code du dépôt ne lisait `~/.claude.json` (grep « claude.json »
  // vide dans src/ avant ce travail) : la liste des dossiers du Chat ne pouvait donc pas
  // s'enrichir des projets claude.exe. Sonde réelle sur le poste : 24 entrées `projects`,
  // 5 vrais projets après filtre.
  // Les projets déjà ouverts dans claude.exe : le main lit et FILTRE `~/.claude.json`,
  // le renderer ne reçoit que des chemins de dossiers — jamais le contenu du profil (jetons,
  // comptes). Relu à CHAQUE appel plutôt que mis en cache : le fichier bouge à chaque session
  // claude.exe, et le renderer n'appelle qu'une fois par montage du Chat.
  ipcMain.handle('os:dossiersClaudeCli', (event) => {
    assertTrustedRendererSender(event, 'Dossiers Claude CLI')
    return lireDossiersProjetsClaude()
  })
  // « This computer » dans le choix du dossier de travail : travailler sur la machine
  // sans projet, comme claude.exe lancé depuis le dossier personnel. Le renderer n'a pas le
  // disque : seul le main connaît ce dossier.
  ipcMain.handle('os:dossierPersonnel', (event) => {
    assertTrustedRendererSender(event, 'Dossier personnel')
    return canonicalProjectPath(homedir()) ?? homedir()
  })
  return {
    rattacherLaBranche,
    dossierDesRetours,
    dossierDesCopiesDeFil,
    boardDuPoste,
    mesureDesEcarts
  }
}
