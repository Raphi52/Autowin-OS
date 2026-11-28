import { join } from 'path'
import type { RelanceurTachesDeFond } from '../chat/relance-taches-de-fond'
import { autowinAppDataRoot } from '../app/app-data'
import { typerCeQuiPart, typeurTsc } from '../verify/typage-avant-publication'
import { verifierCeQuiPart, partageLeDepot } from '../chat/chat-turn-publication'
import { redacteurDeCommit, publierSansTour } from '../git/git-apres-fil-sans-tour'
import { lireProprietairesDeFichiers } from '../fichiers/proprietaire-fichier'
import {
  travauxTentesSurDisque,
  FileGitApresFil,
  classerCommitLocal,
  publicationInterditeDans,
  planEnCoursDuFil,
  planTourneEncore,
  lireAmont,
  commitsPublies,
  travauxParFil,
  filDeLaPasse,
  estUnDepotGit,
  filDesCommitsLocaux
} from '../git/git-apres-fil'
import {
  defaultGitRunner,
  autoCloseRun,
  autoCloseBranch,
  plageDesCommitsLocaux,
  publierLesCommitsLocaux
} from '../runs/run-autoclose'
import { ouvrirCopieDesCommitsLocaux } from '../git/comparaison-a-la-base'
import type { SuiviGitApresFil, SuiviDesPlans } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/** La copie des commits locaux porte déjà leurs fichiers : rien à y poser depuis l'arbre partagé. */
const rienAPoser = (): void => undefined

/**
 * PUBLIER LES FILS FINIS : la file `/git` après un fil, le balayage des travaux d’agents et le
 * rattrapage des commits locaux.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `demarrerLaPublicationDesTravaux` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesPublicationDesTravaux {
  suiviGitApresFil: SuiviGitApresFil
  suiviDesPlans: SuiviDesPlans
  relanceurTachesDeFond: RelanceurTachesDeFond
}

/** La publication des travaux d’agents finis. */
export function demarrerLaPublicationDesTravaux(
  ctx: ContexteIpcChat,
  deps: DependancesPublicationDesTravaux
): void {
  const { activeChatTurns, broadcast, bus, dossierDuTour, os, publicationsEnVol } = ctx
  const { suiviGitApresFil, suiviDesPlans, relanceurTachesDeFond } = deps
  /*
   * « PUBLIER LES FILS FINIS » : une passe à la fois. AUCUN tour ni
   * message dans le fil : l'app vérifie, commite et pousse elle-même, et seul le titre du commit part
   * au petit modèle d'Agent Studio. Le fil ne reçoit que le bloc git (ou la note de ce qui reste à trier).
   */
  const redigerUnCommit = redacteurDeCommit(os)
  const travauxTentes = travauxTentesSurDisque(
    join(autowinAppDataRoot(), 'git-apres-fil-travaux-tentes.json')
  )
  // Le dossier d'un fil en copie EST sa copie, à tête détachée : la branche où la porte a fait entrer
  // son travail, son amont et ses commits publiés vivent dans le dépôt de la copie.
  const depotDeLaPasse = (fil: string): string =>
    os.conversations.get(fil)?.copieDuFil?.depot ?? dossierDuTour(fil)
  suiviGitApresFil.file = new FileGitApresFil({
    publier: async (fil, passe) => {
      const repo = dossierDuTour(fil)
      const depotDuFil = depotDeLaPasse(fil)
      const runGit = await defaultGitRunner()
      const filDuRun = new Map(
        os.getWorktreeActivity().map((agent) => [agent.agentId, agent.conversationId])
      )
      return publierSansTour(
        {
          repo,
          runGit,
          proprietaires: (chemins) =>
            lireProprietairesDeFichiers({ workspace: repo, chemins, conversationId: fil }),
          typer: (fichiers) =>
            typerCeQuiPart({ repo, fichiers, typer: typeurTsc(process.execPath) }),
          verifier: (fichiers) =>
            verifierCeQuiPart(repo, fichiers, (racine, liste) =>
              bus.verifierAvantPublication(racine, liste)
            ),
          rediger: (charge) => redigerUnCommit(charge, fil),
          // Un tour d'un autre fil du dépôt en cours : ce qu'il écrit n'a pas encore d'auteur.
          autreTourEnCours: () =>
            activeChatTurns
              .inFlightConversations()
              .some((id) => !passe.fils.includes(id) && partageLeDepot(repo, dossierDuTour(id))),
          commiter: (message, fichiers, runGitTrace) =>
            autoCloseRun({
              repo,
              branch: autoCloseBranch(`${fil}-git`),
              message,
              paths: fichiers,
              runGit: runGitTrace,
              direct: true
            }),
          // Les passages de porte restés sur la branche locale, jugés au niveau du distant.
          commitsLocaux: {
            lire: () => plageDesCommitsLocaux(depotDuFil, runGit),
            classer: (commit) =>
              classerCommitLocal(commit, {
                filDuRun: (run) => filDuRun.get(run),
                // Un fil archivé (inactif depuis 14 jours) ou supprimé n'est plus en mémoire : plus
                // aucune demande ne peut y interdire de publier, et le refuser figerait la branche.
                publiable: (autre) =>
                  !publicationInterditeDans(
                    (os.conversations.get(autre)?.messages ?? [])
                      .filter((message) => message.role === 'user')
                      .map((message) => String(message.content))
                  ),
                planEnCours: (autre) =>
                  planEnCoursDuFil(suiviDesPlans.coordinateur?.planDuFil(autre))
              }),
            typer: (plage) =>
              typerCeQuiPart({
                repo: depotDuFil,
                fichiers: plage.fichiers,
                typer: typeurTsc(process.execPath),
                ouvrirCopie: (depot) => ouvrirCopieDesCommitsLocaux(depot, plage),
                appliquer: rienAPoser
              }),
            verifier: (plage) =>
              verifierCeQuiPart(
                depotDuFil,
                plage.fichiers,
                (racine, liste) => bus.verifierAvantPublication(racine, liste),
                (depot) => ouvrirCopieDesCommitsLocaux(depot, plage),
                rienAPoser
              ),
            pousser: (plage, runGitTrace) =>
              publierLesCommitsLocaux({ repo: depotDuFil, plage, runGit: runGitTrace })
          }
        },
        {
          fil,
          fichiers: passe.fichiers,
          fils: passe.fils,
          travaux: passe.travaux.length,
          commitsLocaux: passe.commitsLocaux === true
        }
      )
    },
    // Le chef d'un plan qui tourne encore attend : ses lots écrivent toujours. La publication du
    // dernier tour aussi (typage, tests, push : plusieurs minutes) : passée avant elle, la passe
    // concluait « rien à publier » juste avant que ce tour pousse son commit.
    filOccupe: (fil) =>
      activeChatTurns.isInFlight(fil) ||
      publicationsEnVol.conversations().includes(fil) ||
      planTourneEncore(suiviDesPlans.coordinateur?.planDuFil(fil)),
    lireAmont: async (fil) => lireAmont(await defaultGitRunner(), depotDeLaPasse(fil)),
    commitsDepuis: async (fil, depuis, fils) =>
      commitsPublies(await defaultGitRunner(), depotDeLaPasse(fil), depuis, fils),
    annoncer: (fil, contenu) => {
      os.conversations.append(fil, { role: 'assistant', content: contenu })
      broadcast({ type: 'refresh', scope: 'chat', convId: fil })
      broadcast({ type: 'refresh', scope: 'conversations' })
    },
    contenusDuFil: (fil) =>
      (os.conversations.get(fil)?.messages ?? []).map((message) => String(message.content ?? '')),
    noterTravauxTentes: (agentIds) => travauxTentes.noter(agentIds),
    journal: (message, detail) => console.warn('[git apres fil]', message, detail ?? '')
  })
  /*
   * LES TRAVAUX D'AGENTS RESTÉS HORS DE LA BRANCHE — le bandeau « 1 travail terminé n'a
   * jamais été publié ». Relus à chaque fin de run et une fois après le démarrage, rangés par fil qui
   * a lancé le run, puis confiés à la même file : un /git par fil, après son calme. Même accord que
   * le reste de « Publication auto », même refus (publication interdite dans le fil). Tout dépôt
   * part, pas seulement celui d'Autowin (2026-11-21).
   */
  const balayerLesTravauxDAgents = async (): Promise<void> => {
    if (!os.autoCloseEnabled() || !os.gitApresFilActif()) return
    const travaux = await os.travauxNonPubliesAsync()
    if (!travaux.length) return
    const filDuRun = new Map(
      os.getWorktreeActivity().map((agent) => [agent.agentId, agent.conversationId])
    )
    const parFil = travauxParFil({
      travaux: travaux.map((travail) => ({
        ...travail,
        conversationId: filDuRun.get(travail.agentId)
      })),
      dejaTentes: travauxTentes.lire(),
      publiable: (fil) =>
        Boolean(os.conversations.get(fil)) &&
        !publicationInterditeDans(
          (os.conversations.get(fil)?.messages ?? [])
            .filter((message) => message.role === 'user')
            .map((message) => String(message.content))
        )
    })
    for (const [fil, liste] of parFil)
      suiviGitApresFil.file?.ajouterTravaux(
        filDeLaPasse(fil, suiviDesPlans.coordinateur?.planDuFil(fil)),
        liste,
        fil
      )
  }
  const balayerSansBruit = (): void =>
    void balayerLesTravauxDAgents().catch((erreur) =>
      console.warn('[git apres fil] travaux d’agents illisibles :', erreur)
    )
  os.onFinDeRun(balayerSansBruit)
  // Une minute après le démarrage : le recensement git ne s'ajoute pas au coût du lancement.
  setTimeout(balayerSansBruit, 60_000).unref?.()
  /*
   * LES COMMITS RESTÉS SUR MAIN LOCAL APRÈS UN REDÉMARRAGE. Le passage de porte d'un fil y entre sans
   * partir, et sa passe attend le calme du fil dans une file en mémoire : un redémarrage
   * (`restart_app`, relance du moteur au repos) la vide, et rien ne la remplissait au démarrage.
   * Mesuré le 13/11 : deux commits de lots restés une heure sur main local, partis seulement avec le
   * passage de porte d'un autre fil. Git dit ce qui attend : la passe repart dans le fil du plus
   * récent, et juge chaque commit de la branche comme d'habitude (`classerCommitLocal`).
   */
  const rattraperLesCommitsLocaux = async (): Promise<void> => {
    if (!os.autoCloseEnabled() || !os.gitApresFilActif()) return
    // Tout dépôt git (2026-11-21) : le dossier de travail de l'app peut être un autre projet.
    if (!estUnDepotGit(os.executionWorkspace)) return
    const plage = await plageDesCommitsLocaux(os.executionWorkspace, await defaultGitRunner())
    if (!plage) return
    const filDuRun = new Map(
      os.getWorktreeActivity().map((agent) => [agent.agentId, agent.conversationId])
    )
    const fil = filDesCommitsLocaux(plage.commits, {
      filDuRun: (run) => filDuRun.get(run),
      connu: (autre) => Boolean(os.conversations.get(autre))
    })
    if (!fil) return
    suiviGitApresFil.file?.ajouter(
      filDeLaPasse(fil, suiviDesPlans.coordinateur?.planDuFil(fil)),
      [],
      fil,
      { commitsLocaux: true }
    )
  }
  const rattraperSansBruit = (): void =>
    void rattraperLesCommitsLocaux().catch((erreur) =>
      console.warn('[git apres fil] commits locaux illisibles :', erreur)
    )
  setTimeout(rattraperSansBruit, 60_000).unref?.()
  void relanceurTachesDeFond
    .reprendreAuDemarrage()
    .catch((erreur) => console.warn('[taches de fond] reprise au demarrage impossible :', erreur))
}
