// Édition d'un fichier dans une copie isolée (identité du bureau, mutation isolée, edit_file) : méthodes de
// AppCommandBus sorties de commands.ts telles quelles (lot 6). Elles s'appellent entre elles par
// `bus.<méthode>()` : un test en remplace une sur l'instance (edit-file-portee.test.ts).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { applyEdit, decideEdit, editDiff, refusRacineSysteme } from './edit-file-command'
import { refusReservationEdition } from '../fichiers/reservation-fichiers-app'
import { encodeFile, readFileText, unrepresentableCharacters } from '../fichiers/file-encoding'
import { decisionDeSynchronisation } from '../bureau/synchronisation-cible-bureau'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  VERIFY_RELATED_ANGLE_MORT,
  VERIFY_STYLE_ANGLE_MORT,
  VERIFY_TEXTE_ANGLE_MORT,
  estUneFeuilleDeStyle,
  estUnTexteDerivable,
  porteeDUneEdition,
  echecsDuRapport,
  verdictDifferentiel,
  noteDeDifferentiel
} from './verify-command'
import { natureDeLEchec } from '../verify/verify-echec-nature'
import { refusAvecIssue, refusPourOutcome, type OutcomeDePublication } from '../chat/issue-de-refus'
import { cleDeBureau, decisionDeReutilisation } from '../bureau/bureau-reutilisable'
import { readTestsCitant } from '../git/git-read-main'
import {
  appendConversationFileTrace,
  normalizeWorkspaceTracePath,
  workspaceTracePathKey
} from '../activity/conversation-file-trace-spool'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'
import { randomUUID } from 'node:crypto'
import { addedLineFingerprints } from '../fichiers/exact-line-fingerprint'
import {
  SAUT_NATURE,
  PUBLICATION_DIFFEREE,
  EDITION_ARRETEE_PAR_STOP,
  circonstanceDePublication
} from './publication'
import type { MesureVerifiee } from './publication'

/**
 * Petite edition ciblee — le « chemin du milieu » entre parler et orchestrer.
 *
 * C'est le SEUL point qui donne le droit d'ecrire hors pipeline. Il ne l'est que parce que l'agent
 * peut desormais PROUVER (`verify`) ce qu'il vient de changer. Toutes les bornes vivent dans
 * `decideEdit` (module pur, 16 tests de refus : traversee de chemin, .git, secrets, correspondance
 * ambigue, creation de fichier) — jamais dans un outil du CLI, dont les patterns d'autorisation ont
 * ete mesures inoperants le meme jour.
 */
/**
 * L'IDENTITE DU BUREAU : stable par tache, aleatoire seulement en dernier recours.
 *
 * DEFAUT MESURE le 2026-08-25 : un `randomUUID()` par appel, donc DIX bureaux (~50 Mo piece) pour
 * dix tentatives d'UNE edition, tous porteurs du meme JSX non compilable. La source des residus
 * n'est pas l'echec, c'est qu'un echec fabriquait un objet neuf au lieu de reprendre le sien.
 *
 * REGLE, tranchee par l'utilisateur : reinitialiser le bureau retrouve, SAUF s'il porte du travail
 * qu'aucune tentative precedente sur cette cible n'explique — auquel cas on ne le touche pas et la
 * nouvelle tentative va ailleurs. Les deux branches naives etaient mauvaises : heriter du contenu
 * fait repartir l'agent de son propre code casse, reinitialiser toujours detruit du travail non
 * trie.
 */
export async function identiteDeBureau(
  bus: AppCommandBus,
  famille: string,
  conversationId: string | undefined,
  cible: string | undefined
): Promise<string> {
  const aleatoire = `command-${famille}-${randomUUID()}`
  const cle = cleDeBureau(famille, conversationId, cible)
  if (!cle) return aleatoire
  /*
   * HORS DU THREAD QUI DESSINE LA FENETRE.
   *
   * Mesure du 2026-09-03 (`gels.jsonl`, 08:30:01) : 7 244 ms de fenetre morte, accumulation
   * `execFileSync git rev-parse` x48, `git status` x34, `git cherry` x11. C'etait ce recensement,
   * paye ICI sur le thread main au debut de chaque commande. La voie hors-thread existe deja
   * (`travauxNonPubliesAsync`, worker) ; sans worker elle retombe d'elle-meme sur la voie
   * synchrone, meme reponse.
   */
  /*
   * SORTIE COURTE : ne pas payer le recensement COMPLET pour une question a UN bureau.
   *
   * Mesure le 2026-09-04 : ce recensement coute 18 699 ms avec 40 copies accumulees,
   * paye AVANT la moindre edition et dans le meme budget que l'operation worktree — au-dela du
   * delai, `edit_file` echoue sur « Operation worktree interrompue » sans avoir rien ecrit. Le
   * cout croit avec le nombre de copies : allonger le delai deplace le mur, il ne l'enleve pas.
   *
   * La sortie est NEGATIVE, donc sure : sans dossier de bureau ni branche pour cette cle, le
   * recensement n'aurait rien trouve non plus. Une reponse inconnue vaut `true` — on recense.
   */
  if (bus.os.worktrees?.bureauPeutPorterDuTravail?.(cle) === false) return cle

  const retenus =
    (await bus.os.worktrees?.travauxNonPubliesAsync?.()) ??
    bus.os.worktrees?.travauxNonPublies?.() ??
    []
  const existant = retenus.find((travail) => travail.agentId === cle)
  if (!existant) return cle
  // On transmet l'INDETERMINATION : sans elle, une lecture git ratee se lisait « bureau vide »
  // et faisait jeter un bureau porteur de travail (cycle 2 de l'audit du 2026-08-26).
  const decision = decisionDeReutilisation(existant.fichiers, cible ? [cible] : [], {
    lectureEchouee: existant.lectureEchouee === true
  })
  if (decision === 'preserver') return aleatoire
  // Reinitialisation = liberer le brouillon precedent AVANT de reprendre sa place. Si la liberation
  // echoue, on ne force RIEN : un bureau qu'on n'a pas pu liberer reste intact, et la tentative va
  // ailleurs plutot que d'ecrire par-dessus.
  const libere = await bus.os.worktrees?.discardHeldAsync?.(cle)
  return libere ? cle : aleatoire
}

export async function withIsolatedMutation<T>(
  bus: AppCommandBus,
  command: 'edit_file',
  conversationId: string | undefined,
  action: (workspaceRoot: string) => T | Promise<T>,
  /** Fichier vise par la tache : c'est lui qui donne au bureau une IDENTITE stable. */
  cible?: string,
  /** Octets du fichier AVANT l'edition, lus APRES l'action — socle de la baseline. */
  lireOctetsAvant?: () => Buffer | undefined
): Promise<T> {
  if (!bus.os.worktrees) {
    throw new Error(refusAvecIssue('isolation-indisponible', command))
  }
  const runId = await bus.identiteDeBureau('edit', conversationId, cible)
  const beginOptions = {
    task: command,
    role: 'command',
    ...(conversationId ? { conversationId } : {})
  }
  const workspaceRoot = bus.os.worktrees.beginAsync
    ? await bus.os.worktrees.beginAsync(runId, `Commande ${command}`, true, beginOptions)
    : bus.os.worktrees.begin(runId, `Commande ${command}`, true, beginOptions)
  if (!workspaceRoot) throw new Error(refusAvecIssue('isolation-indisponible', command))
  /*
   * LE BUREAU EST RESYNCHRONISE SUR LA CIBLE NOMMEE — voir `synchronisation-cible-bureau.ts`.
   *
   * Le bureau est cree sur `baseSha` et EXCLUT les fichiers non committes
   * (`excludedDirtyFiles`), alors que l'agent lit l'espace de travail VIVANT (`read_file`).
   * Sans ce geste, `edit_file` edite une copie PERIMEE : soit l’extrait est « introuvable »,
   * soit — pire — il existe des deux cotes et l’edition publiee ECRASE le travail non
   * committe. Un seul fichier est copie, celui que la tache NOMME ; le reste du bureau
   * demeure isole.
   */
  if (command === 'edit_file' && typeof cible === 'string' && cible.trim()) {
    const synchro = decisionDeSynchronisation(
      cible,
      // DEPOT DE BASE de la copie isolee, PAS le dossier du tour : la synchronisation reporte le
      // fichier du bureau isole vers le depot dont ce bureau est issu (`os.worktrees`, construit
      // sur `executionWorkspace`). Y mettre le dossier du tour ecrirait dans un AUTRE projet.
      bus.os.executionWorkspace,
      workspaceRoot,
      (chemin) => (existsSync(chemin) ? readFileSync(chemin) : undefined)
    )
    if (synchro.action === 'copier') copyFileSync(synchro.cheminWorkspace, synchro.cheminBureau)
  }
  let completed = false
  try {
    let result: Awaited<T> = await action(workspaceRoot)
    /*
     * UNE ACTION REFUSEE N'A RIEN ECRIT — donc il n'y a RIEN a verifier, ni a publier.
     *
     * Sans ce point de sortie, un refus de `runEditFile` (chemin hors bureau, encodage non UTF-8,
     * extrait ambigu) tombait quand meme dans la verification : portee vide -> repli sur la suite
     * COMPLETE -> sur une base au rouge preexistant, le motif rendu au modele devenait
     * « Verification du bureau echouee », et la VRAIE raison du refus etait perdue. Un refus qui
     * n'enseigne plus renvoie l'agent a la devinette, exactement ce que `decideEdit` evite.
     */
    if ((result as { allowed?: unknown } | undefined)?.allowed === false) return result
    if (command === 'edit_file') {
      /*
       * On juge ce que l'EDITION a pu casser, pas l'etat general du depot.
       *
       * DEFAUT VECU le 22/08 : le verdict etait GLOBAL, donc une edition SAINE de
       * `orchestration-outcome.ts` a ete jetee parce que `Markdown.test.tsx` echouait — 11 tests
       * sur 62, sur le commit COMMITTE, sans rapport avec elle. « Le depot est-il vert ? » et
       * « cette edition a-t-elle casse quelque chose ? » ne sont pas la meme question des que la
       * base cesse d'etre verte.
       *
       * Le REPLI est la suite globale, jamais l'absence de verification : une portee
       * indeterminable doit couter cher, pas ouvrir une porte. La garantie « publie seulement si
       * prouve » est intacte — un test qui importe le fichier edite est joue, donc une vraie
       * regression est toujours refusee.
       */
      /*
       * UNE PORTEE VIDE N'EST PAS UNE PORTEE.
       *
       * CausalHypothesis MESUREE le 2026-08-27, hors modele, dans le depot reel :
       *   npx vitest related README.md --run  ->  EXIT=0, « No test files found, exiting with
       *   code 0 »
       * `vitest related` raisonne sur un graphe d'IMPORTS : un `.md`, un `.json`, un dossier non
       * suivi n'y ont aucune place. La commande sortait donc a 0 SANS EXECUTER UN SEUL TEST, et ce
       * point publiait sur cette portee vide en annoncant `verifie: vitest related …`. Un vert vide
       * est pire qu'une suite lente : il porte le mot « verifie » alors que rien n'a tourne.
       *
       * La garde existait DEJA — `porteeDerivableDesChangements` exige que TOUT ce qui a change
       * soit du code — mais elle n'etait cablee que sur `runVerifyAt` (voie `verify`), jamais ici.
       * On la branche donc, plutot que d'en ecrire une seconde : meme regle, un seul endroit ou
       * elle est definie.
       *
       * Le repli reste la suite COMPLETE, jamais l'absence de verification. Cout assume et connu :
       * sur une base au rouge preexistant, une edition non-code se fait refuser par ce repli. C'est
       * le prix de ne pas fabriquer de faux vert, et c'est le probleme que la baseline
       * differentielle (option A du cadrage) doit lever ensuite.
       */
      /*
       * UNE FEUILLE DE STYLE A UNE PORTEE, ELLE AUSSI — corrige le 2026-09-03.
       *
       * DEFAUT VECU : corriger une couleur dans `ChatView.css` rejouait la SUITE ENTIERE. Elle
       * depasse le plafond de temps, donc l'edition etait refusee sans qu'aucun verdict n'existe —
       * et le contournement pris sur le moment a ete de RELEVER le plafond, c'est-a-dire de payer
       * l'attente au lieu de la supprimer. La cause etait ici : `porteeDerivableDesChangements`
       * n'accepte que du code, donc « rien a cibler », donc repli global.
       *
       * MESURE HORS MODELE du meme jour : `vitest related <la feuille> --run` rend 89 fichiers /
       * 401 tests en 38 s. Cibler marche. Mais la MEME mesure a montre pourquoi la voie rapide
       * seule aurait ete un faux vert : les tests qui jugent le CSS le LISENT au lieu de
       * l'importer, donc le graphe d'imports ne les voit pas. `porteeDUneEdition` recolle les deux
       * moities ; le detail vit dans `verify-command.ts`, sous `VERIFY_STYLE_ANGLE_MORT`.
       */
      const octetsAvantEdition = lireOctetsAvant?.()
      const edite = (result as { path?: unknown } | undefined)?.path
      const cible =
        (typeof edite === 'string'
          ? await porteeDUneEdition(
              edite,
              async (motif) => await readTestsCitant(workspaceRoot, motif)
            )
          : undefined) ?? []
      /*
       * LA BASELINE EMPRUNTE LA MEME VOIE QUE LA MESURE — par CONSTRUCTION, pas par verification.
       *
       * `cibleEffective` retient la voie reellement suivie. Sans elle, un repli sur la suite
       * complete cote APRES laissait la baseline retenter la PORTEE : deux voies differentes, donc
       * deux perimetres, donc un refus (juste, mais evitable). Mesure par repetition : 2 rouges sur
       * 12 avec un code md5-identique, tous deux sur cette asymetrie.
       *
       * La garde `issue.command === commandeAttendue` reste en aval, comme ceinture : elle
       * verifiait cet invariant APRES coup, il est desormais tenu AVANT.
       */
      let cibleEffective: readonly string[] = cible
      /*
       * LE STOP ATTEINT AUSSI CETTE VERIFICATION, comme `run` et `verify`.
       *
       * Sans le signal du tour, une suite lancee ici continuait jusqu'a sa fin apres un Stop :
       * processus vivant derriere un tour clos. Une mesure coupee ne prouve rien, donc l'edition
       * n'est PAS publiee — et le refus le dit, au lieu de se faire passer pour un echec de tests.
       * Le test est fait APRES chaque mesure, jamais dedans : `baselineAvantEdition` avale les
       * erreurs de sa mesure pour toujours restaurer le fichier.
       */
      const signalDuTour = conversationId ? bus.signalDuTour?.(conversationId) : undefined
      const refuserSiArrete = (): void => {
        if (signalDuTour?.aborted) throw new Error(EDITION_ARRETEE_PAR_STOP)
      }
      const mesurer = (): Promise<MesureVerifiee> =>
        bus.mesurerAvecRapport(workspaceRoot, cibleEffective, undefined, signalDuTour)
      let verification = await mesurer()
      refuserSiArrete()
      /*
       * UNE PORTEE QUI N'A JOUE AUCUN TEST CEDE LA PLACE A LA SUITE COMPLETE — elle ne refuse pas.
       *
       * DEFAUT DE MON PROPRE CORRECTIF, mesure par repetition : le refus « 0 test joue » est juste,
       * mais applique a la voie de PORTEE il transforme une intermittence benigne en refus de
       * publication. `vitest related sujet.ts --run` a rendu 0 test collecte sur un depot ou
       * `sujet.test.ts` importe pourtant `sujet.ts` — 1 run sur 2 dans la mesure. Le refus est alors
       * un FAUX refus, et il aurait mordu en production.
       *
       * C'est la doctrine deja ecrite dans ce module : « le repli est la suite globale, jamais
       * l'absence de verification ». Une portee vide n'est pas une preuve, mais ce n'est pas une
       * faute de l'edition : on remesure plus large. Si la suite COMPLETE ne joue elle non plus
       * aucun test, alors le projet n'a rien a prouver et le refus, lui, est fonde.
       */
      if (verification.allowed && verification.ok && verification.parPortee) {
        const compte = echecsDuRapport(verification.rapport)
        if (compte.concluant && compte.testsJoues === 0) {
          const globale = await bus.mesurerAvecRapport(
            workspaceRoot,
            [],
            undefined,
            signalDuTour
          )
          refuserSiArrete()
          if (globale.allowed) {
            verification = globale
            // La voie a BASCULE : la baseline suivra la meme, sinon elle mesure autre chose.
            cibleEffective = []
          }
        }
      }
      if (!verification.allowed) {
        throw new Error(refusAvecIssue('verification-indisponible', verification.reason))
      }
      const parPortee = verification.parPortee ? verification : null
      /*
       * UN ROUGE N'EST PAS UNE PREUVE D'AVOIR CASSE QUELQUE CHOSE.
       *
       * Ce point jetait l'edition sur TOUT rouge, sans jamais avoir mesure l'etat AVANT : il ne
       * pouvait donc pas distinguer sa propre regression d'un rouge deja present sur la base,
       * alors que le prompt du pilote lui ORDONNE cette distinction. Consequence observee dans le
       * produit : le modele routait ses retouches par `orchestrate`, la seule voie qui publie sur
       * une base bruyante, faute d'une mesure ici.
       *
       * La baseline n'est mesuree QUE sur rouge — le chemin vert ne coute pas un test de plus, et
       * un compteur d'executions le VERIFIE dans les tests. La comparaison porte sur l'ARTEFACT
       * STRUCTURE du runner, jamais sur sa sortie humaine : la premiere version de ce mecanisme a
       * ete DEFAITE (revert `97f2e9dc`) parce que le parsing de texte publiait des regressions par
       * cinq voies prouvees. Le detail vit dans `verify-command.ts`, en tete de `echecsDuRapport`.
       */
      let noteDifferentielle: string | undefined
      let testsJouesMesures: number | undefined
      /*
       * ON NE MESURE UNE BASELINE QUE SI ELLE PEUT CONCLURE.
       *
       * DEFAUT ATTRAPE PAR LA NON-REGRESSION le 2026-08-27 : sur un projet qui ne teste pas avec
       * vitest, aucun rapport n'est produit — le differentiel ne pourra donc JAMAIS conclure, mais
       * la baseline etait quand meme mesuree. Resultat : le temps de la suite DOUBLE pour rien, et
       * un test du depot est passe de 1,4 s a un plafond de 20 s. Lire le rapport d'APRES d'abord
       * rend le cout nul quand la mesure est de toute facon impossible.
       */
      /*
       * LE RAPPORT EST LU AUSSI SUR UN VERT — pour savoir COMBIEN de tests ont tourne.
       *
       * Mesure hors modele : `vitest related <fichier de code sans test associe> --run` rend
       * EXIT 0, `numTotalTests: 0`. Toute edition qu'aucun test n'exerce etait donc publiee sous
       * l'etiquette « verifie ». La lecture ne coute rien (le fichier est deja la) et c'est
       * `verdictDifferentiel` qui tranche : un exit 0 sans test joue n'est pas un vert.
       *
       * La sanite des fichiers cites est branchee ici : un rapport qui designe une suite absente du
       * bureau n'a pas ete produit par la mesure qu'on croit lire.
       */
      /*
       * VITEST NOMME SES SUITES EN CHEMIN ABSOLU. Mesure : la garde de sanite, ecrite pour des
       * chemins relatifs, declarait donc TOUTE suite « introuvable » et rendait le differentiel
       * non concluant en permanence — un faux refus total, attrape par les tests d'integration
       * alors que les tests unitaires (fixture a chemins relatifs) restaient verts. Les deux formes
       * sont acceptees ici, et un test unitaire verrouille desormais la forme ABSOLUE.
       */
      const fichierExiste = (chemin: string): boolean =>
        existsSync(isAbsolute(chemin) ? chemin : join(workspaceRoot, chemin))
      let rapportApres = echecsDuRapport(verification.rapport, fichierExiste)
      if (
        !verification.ok &&
        rapportApres.concluant &&
        octetsAvantEdition &&
        typeof edite === 'string'
      ) {
        const avant = await bus.baselineAvantEdition(
          join(workspaceRoot, edite),
          octetsAvantEdition,
          mesurer,
          verification.command
        )
        refuserSiArrete()
        let rapportAvant = avant ? echecsDuRapport(avant.rapport, fichierExiste) : undefined
        let verdict = verdictDifferentiel(false, rapportApres, rapportAvant)
        /*
         * LA PORTEE S'EST REVELEE NON FIABLE : ON REMESURE LES DEUX PLUS LARGE.
         *
         * `vitest related` peut collecter 0 test par intermittence. Quand cela frappe la BASELINE,
         * le differentiel ne peut rien conclure — et refuser ici serait un faux refus au hasard,
         * exactement ce que la repetition a mesure. On rejoue donc les DEUX mesures sur la suite
         * complete, ENSEMBLE : le perimetre reste commun par construction.
         */
        if (
          !verdict.publiable &&
          !verdict.concluant &&
          verification.parPortee &&
          rapportAvant?.concluant === true &&
          rapportAvant.testsJoues === 0
        ) {
          cibleEffective = []
          const globale = await mesurer()
          refuserSiArrete()
          if (globale.allowed) {
            verification = globale
            rapportApres = echecsDuRapport(globale.rapport, fichierExiste)
            const avantGlobal = await bus.baselineAvantEdition(
              join(workspaceRoot, edite),
              octetsAvantEdition,
              mesurer,
              globale.command
            )
            refuserSiArrete()
            rapportAvant = avantGlobal
              ? echecsDuRapport(avantGlobal.rapport, fichierExiste)
              : undefined
            verdict = verification.ok
              ? verdictDifferentiel(true, rapportApres, rapportAvant)
              : verdictDifferentiel(false, rapportApres, rapportAvant)
          }
        }
        if (verdict.publiable) {
          noteDifferentielle = noteDeDifferentiel(verdict)
          // Le compte joue est une PREUVE, pas un ornement : il doit accompagner les deux chemins.
          testsJouesMesures = verdict.testsJoues
        } else if (verdict.nouvelles.length > 0) {
          /*
           * LE REFUS NOMME CE QU'IL IMPUTE. Un « vérification échouée » nu renvoie le modele a la
           * devinette : il ne sait pas lesquels des rouges affiches sont DE LUI. Mineur releve par
           * le panel, et c'est aussi ce qui rend ce refus diagnosticable de l'exterieur.
           */
          throw new Error(
            `Vérification du bureau échouée (${verification.command}) — ` +
              `${verdict.nouvelles.length} échec(s) NOUVEAU(X) imputable(s) à cette édition : ` +
              `${verdict.nouvelles
                .slice(0, 5)
                .map((n) => `« ${n} »`)
                .join(', ')}` +
              `${SAUT_NATURE}${verification.output}`
          )
        } else if (verdict.raison) {
          // Le refus ENSEIGNE : « baseline non mesurable » n'est pas « regression imputable ».
          // Sans cette distinction, le modele est envoye corriger un test qu'il n'a pas touche.
          throw new Error(
            `Vérification du bureau échouée (${verification.command}) — différentiel non ` +
              `concluant (${verdict.raison}), donc publication refusée par précaution :` +
              `${SAUT_NATURE}${verification.output}`
          )
        }
      }
      /*
       * LE CHEMIN VERT PASSE PAR LE MEME JUGE. Il ne mesure toujours AUCUNE baseline (le compteur
       * d'executions le prouve), mais il doit refuser un exit 0 qui n'a joue aucun test.
       */
      let testsJoues: number | undefined = testsJouesMesures
      if (verification.ok) {
        const verdictDuVert = verdictDifferentiel(true, rapportApres, undefined)
        testsJoues = verdictDuVert.testsJoues
        if (!verdictDuVert.publiable) {
          throw new Error(
            refusAvecIssue(
              'verification-indisponible',
              `${verdictDuVert.raison} (${verification.command})`
            )
          )
        }
      }
      if (!verification.ok && noteDifferentielle === undefined) {
        /*
         * LA NATURE DE L'ECHEC EN TETE, avant la sortie brute.
         *
         * Mesure le 2026-08-25 : ce message etait generique, et une edition qui avait
         * produit du JSX aux balises desequilibrees se lisait comme « un test casse ». L'agent a
         * donc retente une correction de LOGIQUE, reproduisant huit fois la meme faute de balises
         * jusqu'a ce que le budget d'appels coupe le tour. Les deux natures appellent des gestes
         * opposes ; les confondre garantit la boucle.
         */
        const { consigne } = natureDeLEchec(verification.output)
        throw new Error(
          `Vérification du bureau échouée (${verification.command}) : ` +
            `${consigne ? `${consigne}${SAUT_NATURE}` : ''}${verification.output}`
        )
      }
      // Le verdict NOMME sa portee et son angle mort. Un vert dont on ignore l'etendue se lit
      // comme une preuve plus large qu'elle ne l'est — c'est ainsi qu'on fabrique un faux vert.
      if (result && typeof result === 'object') {
        // Le verdict porte le COMPTE de tests joues : « verifie » sans ce chiffre laissait croire
        // a une preuve dont l'etendue etait inconnue — y compris quand elle etait nulle.
        result = {
          ...result,
          verifie: verification.command,
          // L'angle mort d'un style n'est pas celui du code : il faut NOMMER le bon, sinon le
          // verdict promet une couverture qu'il n'a pas.
          portee: !parPortee
            ? 'suite complète'
            : typeof edite === 'string' && estUneFeuilleDeStyle(edite)
              ? VERIFY_STYLE_ANGLE_MORT
              : // Un TEXTE n'est dans aucun graphe d'imports : annoncer l'angle mort du
                // `related` promettrait une couverture qui n'existe pas pour un `.md`.
                typeof edite === 'string' && estUnTexteDerivable(edite)
                ? VERIFY_TEXTE_ANGLE_MORT
                : VERIFY_RELATED_ANGLE_MORT,
          ...(testsJoues === undefined ? {} : { testsJoues }),
          ...(noteDifferentielle ? { differentiel: noteDifferentielle } : {})
        } as Awaited<T>
      }
    }
    const finalized = bus.os.worktrees.endAsync
      ? await bus.os.worktrees.endAsync(runId, { merge: true })
      : bus.os.worktrees.end(runId, { merge: true })
    completed = true
    /*
     * UN REPORT N'EST PAS UN ECHEC.
     *
     * DEFAUT VECU le 2026-08-25 : trois `edit_file` sur quatre ont rendu « publication
     * automatique incomplete » alors que les trois manifestes portaient `verdict: green,
     * publication: complete` et que les trois commits etaient dans `HEAD`. Le coordinateur rend
     * `undefined` quand la copie a encore des processus actifs — typiquement les workers `vitest`
     * que la verification vient elle-meme de lancer : elle passe en attente et `retryRecovery` la
     * publie ensuite. Cette absence d'issue tombait dans le `throw`.
     *
     * Le cout n'etait pas cosmetique : face a un faux echec l'agent RECOMMENCE — quatre appels
     * pour deux changements utiles, quatre bureaux sur le disque, trois branches de recuperation.
     *
     * On ne blanchit RIEN d'autre : une issue reellement bloquee (`blocked`, `conflict`, `refuse`)
     * continue d'echouer bruyamment. Et l'attente est NOMMEE plutot que tue — un differe passe
     * pour un vert exactement comme un faux echec passe pour un rouge.
     */
    if (finalized === undefined) {
      if (result && typeof result === 'object') {
        return {
          ...result,
          publication: PUBLICATION_DIFFEREE
        } as Awaited<T>
      }
      return result
    }
    if (
      finalized.outcome !== 'merged' &&
      finalized.outcome !== 'nothing' &&
      finalized.outcome !== 'cleanup-pending' &&
      finalized.outcome !== 'published-residue'
    ) {
      // CHAQUE issue porte son propre message. Les six retombaient sur « publication differee »,
      // un texte unique qui ne nommait jamais la cause et promettait un geste impossible sur
      // `absente` et `libere`. Mesure : le meme refus mot pour mot, trois fois, puis un
      // run arrete a 0,96 $ -- face a un refus qui ne dit pas ce qui s'est passe, l'agent ne peut
      // que retenter a l'identique. Le detail porte la CIRCONSTANCE, jamais le nom de l'outil :
      // `edit_file` est deja affiche au-dessus du message.
      throw new Error(
        refusPourOutcome(
          finalized.outcome as OutcomeDePublication,
          circonstanceDePublication(finalized)
        )
      )
    }
    return result
  } catch (error) {
    if (!completed) {
      if (bus.os.worktrees.endAsync) await bus.os.worktrees.endAsync(runId, { merge: false })
      else bus.os.worktrees.end(runId, { merge: false })
    }
    throw error
  }
}

export function runEditFile(
  bus: AppCommandBus,
  input: { path: unknown; oldText: unknown; newText: unknown },
  workspaceRoot: string,
  /** Reçoit les octets du fichier AVANT l'écriture — socle de la baseline différentielle. */
  avantEdition?: (octets: Buffer) => void
): {
  allowed: boolean
  reason?: string
  path?: string
  diff?: string
} {
  // ENCODAGE PRÉSERVÉ. Cette commande lisait et écrivait en `'utf8'` codé en dur, ce qui la rendait
  // inutilisable — et dangereuse — sur un dépôt VB6, dont les sources sont en mono-octet. Mesuré le
  // 2026-08-07 sur `ULT_1RIL_SE.cls` : la lecture rendait « l'<?>quipe » au lieu de « l'équipe »,
  // donc `oldText` ne correspondait JAMAIS ; et la réécriture aurait remplacé chaque accent du
  // fichier ENTIER par `EF BF BD`. Choix de `latin1` et garanties : voir `file-encoding.ts`.
  //
  // L'encodage est résolu UNE SEULE FOIS, à la lecture, puis réutilisé pour l'écriture : le détecter
  // deux fois pourrait donner deux réponses différentes et écrire dans un encodage autre que celui
  // sur lequel la correspondance a été validée.
  let lecture: ReturnType<typeof readFileText> | undefined
  const decision = decideEdit(input, workspaceRoot, (absolutePath) => {
    if (!existsSync(absolutePath)) return null
    lecture = readFileText(readFileSync(absolutePath), absolutePath)
    // Illisible : on rend un contenu vide pour arrêter `decideEdit`, mais c'est le motif RÉEL qui
    // est rendu à l'agent juste en dessous — pas « texte introuvable », qui serait mensonger.
    return lecture.ok ? lecture.text : ''
  })
  if (lecture && !lecture.ok) return { allowed: false, reason: lecture.reason }
  if (!decision.allowed) return { allowed: false, reason: decision.reason }
  if (!lecture?.ok) return { allowed: false, reason: 'fichier illisible' }
  /*
   * CARACTERES IMPOSSIBLES A ECRIRE dans l'encodage REEL du fichier : on refuse en le NOMMANT,
   * plutot que de detruire des octets hors de la zone editee. L'encodage n'est plus force en
   * UTF-8 : il est resolu une fois a la lecture et reutilise a l'ecriture.
   */
  const impossibles = unrepresentableCharacters(decision.newText, lecture.encoding)
  if (impossibles.length > 0) {
    return {
      allowed: false,
      reason: `caractère(s) impossible(s) à écrire dans ce fichier (${lecture.encoding}) : ${impossibles.join(' ')}. Utilise l’équivalent simple (apostrophe droite, « EUR »…) — les écrire quand même les transformerait en caractères de contrôle.`
    }
  }
  /*
   * LES OCTETS D'AVANT, RENDUS A L'APPELANT — pas relus plus tard. La baseline differentielle a
   * besoin de l'etat PRE-EDITION, en BUFFER (la restauration doit etre une identite d'OCTETS).
   * Le chemin est deja borne par `decideEdit`.
   */
  avantEdition?.(readFileSync(decision.absolutePath))
  writeFileSync(
    decision.absolutePath,
    encodeFile(applyEdit(lecture.text, decision.oldText, decision.newText), lecture.encoding)
  )
  bus.broadcast({ type: 'refresh', scope: 'conversations' })
  return {
    allowed: true,
    path: decision.relativePath,
    diff: editDiff(decision.oldText, decision.newText)
  }
}

export async function runTracedEditFile(
  bus: AppCommandBus,
  input: { path: unknown; oldText: unknown; newText: unknown },
  conversationId?: string,
  turnId?: string
): Promise<{ allowed: boolean; reason?: string; path?: string; diff?: string }> {
  const previous = bus.editFileTail
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  bus.editFileTail = previous.then(() => current)
  await previous
  try {
    const baseDecision = decideEdit(input, bus.workspaceDuTour, (absolutePath) =>
      existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null
    )
    /*
     * RÉSERVATION DES FICHIERS ENTRE FILS : le même registre que le hook des agents
     * Claude, consulté AVANT la bifurcation dépôt d'Autowin / autre dépôt, pour tout modèle IA.
     * Un fichier qu'un autre fil a modifié et pas encore commité est refusé en nommant ce fil.
     */
    if (baseDecision.allowed && conversationId) {
      const refusReserve = refusReservationEdition(conversationId, baseDecision.absolutePath)
      if (refusReserve) return { allowed: false, reason: refusReserve }
    }
    /*
     * CIBLE DANS UN AUTRE DEPOT — ecriture DIRECTE, sans bureau isole ni verification vitest.
     *
     * Toute la machinerie qui suit (bureau isole, `vitest related`, publication) est faite POUR CE
     * DEPOT : elle cree un bureau depuis le git d'Autowin, resynchronise un chemin RELATIF a lui, et
     * juge l'edition avec la suite de tests d'Autowin. Sur `D:\GIT\ContosoApp`,
     * rien de tout cela n'a de sens : ce depot a son propre git, sa branche, sa compilation .NET.
     * L'appliquer la-bas ne protegerait rien — il refuserait tout, ou publierait ailleurs.
     * L'utilisateur garde la main sur la verification chez lui : c'est exactement ce qu'il a annonce
     * (« je m'occupe de compiler, du commit et des PR »). Les gardes qui comptent restent celles de
     * `decideEdit`, deja evaluees ci-dessus.
     */
    if (baseDecision.allowed && baseDecision.externe) {
      return bus.runEditFile(input, bus.workspaceDuTour)
    }
    /*
     * UN REFUS DE RACINE SYSTEME SE REND TEL QUEL — il ne depend ni du contenu du fichier ni d'un
     * bureau. Sans ce point de sortie, il tombait dans l'isolation : sans bureau disponible, la
     * reponse devenait « isolation-indisponible » et la VRAIE raison (« racine système protégée »)
     * etait perdue. Un refus qui n'enseigne plus renvoie l'agent a la devinette.
     */
    if (typeof input.path === 'string') {
      const refusSysteme = refusRacineSysteme(input.path)
      if (refusSysteme) return { allowed: false, reason: refusSysteme }
    }
    const baseContentBefore = baseDecision.allowed
      ? readFileSync(baseDecision.absolutePath, 'utf8')
      : undefined
    const before = await captureWorkspaceMutationSnapshot(bus.workspaceDuTour)
    /*
     * Les octets d'AVANT sont CAPTURES, pas remis dans le resultat : le resultat part au modele, et
     * y coller le contenu entier d'un fichier inonderait son contexte pour rien.
     */
    let octetsAvantEdition: Buffer | undefined
    const outcome = await bus.withIsolatedMutation(
      'edit_file',
      conversationId,
      (workspaceRoot) =>
        bus.runEditFile(input, workspaceRoot, (octets) => {
          octetsAvantEdition = octets
        }),
      typeof (input as { path?: unknown }).path === 'string'
        ? ((input as { path?: string }).path as string)
        : undefined,
      () => octetsAvantEdition
    )
    const path =
      outcome.allowed && outcome.path
        ? normalizeWorkspaceTracePath(outcome.path, bus.workspaceDuTour)
        : null
    if (conversationId && path) {
      const after = await captureWorkspaceMutationSnapshot(bus.workspaceDuTour)
      const key = workspaceTracePathKey(path)
      const fingerprint = [...after].find(
        ([candidate]) => workspaceTracePathKey(candidate) === key
      )?.[1]
      const baseFingerprint = [...before].find(
        ([candidate]) => workspaceTracePathKey(candidate) === key
      )?.[1]
      const baseGenerationMarker = [...before.generationMarkers].find(
        ([candidate]) => workspaceTracePathKey(candidate) === key
      )?.[1]
      const generationMarker = await captureWorkspacePathGenerationMarker(
        bus.workspaceDuTour,
        path
      )
      const baseContentAfter = existsSync(resolve(bus.workspaceDuTour, path))
        ? readFileSync(resolve(bus.workspaceDuTour, path), 'utf8')
        : ''
      appendConversationFileTrace({
        timestamp: new Date().toISOString(),
        conversationId,
        ...(turnId ? { turnId } : {}),
        workspaceRoot: bus.workspaceDuTour,
        source: 'edit_file',
        paths: [path],
        ...(fingerprint ? { pathFingerprints: { [path]: fingerprint } } : {}),
        pathBaseFingerprints: { [path]: baseFingerprint ?? null },
        pathGenerationMarkers: { [path]: generationMarker },
        pathBaseGenerationMarkers: { [path]: baseGenerationMarker ?? null },
        ...(baseContentBefore !== undefined
          ? {
              pathLineFingerprints: {
                [path]: addedLineFingerprints(baseContentBefore, baseContentAfter)
              }
            }
          : {})
      })
    }
    return outcome
  } finally {
    release()
  }
}
