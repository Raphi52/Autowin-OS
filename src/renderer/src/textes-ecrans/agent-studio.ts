import { tableDeTextes } from '../textes'

/**
 * TEXTES — ÉCRAN AGENT STUDIO (traduction anglaise, 2026-10-27).
 *
 * Écrans couverts : AgentStudioView, la topologie des agents, les profils de workflow, le canevas et l’éditeur de
 * graphe, ViewTopBar.
 *
 * Une table par groupe d'écrans pour que les lots de traduction, menés en même temps, n'écrivent
 * jamais dans le même fichier. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait
 * foi, mot pour mot celui de l'écran ; l'anglais a les MÊMES clés (le type refuse une clé manquante
 * ou en trop), n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`. Un anglais
 * volontairement identique au français (nom propre, nom de produit) se déclare dans
 * `IDENTIQUES_AU_FRANCAIS`, avec sa raison.
 *
 * RESTENT EN DUR, hors de cette table (lot « Agent Studio ») :
 *  - les mots déjà identiques dans les deux langues, écrits une fois dans le composant :
 *    « ORCHESTRATION », « Agent Studio », « Workflows », « Models », les noms de panneaux
 *    « Scouts », « Frame », « Judges » (noms des phases du moteur), « Phases »,
 *    « Agents », « Agent N », « Angle », « Effort », « Quorum » ;
 *  - `'annulé'` (WorkflowProfilesView) : la raison qu'envoie le processus principal quand
 *    l'utilisateur ferme la boîte d'export ou d'import — le code la COMPARE, elle ne s'affiche pas ;
 *  - `Workflow N`, le nom donné à un workflow créé : une donnée enregistrée dans le profil ;
 *  - les données : noms de phases, de skills, de modèles, d'efforts, verdicts du journal des duels,
 *    raisons d'échec renvoyées par le processus principal, défauts de `checkWorkflowGraph`.
 */
export const TEXTES_FR = {
  // — Agent Studio : en-tête et onglets (AgentStudioView), barre du haut (ViewTopBar) —
  'studio.description': 'Quels modèles jouent quels rôles, et quels workflows les enchaînent.',
  'studio.aria': 'Sections Agent Studio',
  'studio.onglet.topologie': 'Modèles & topologie',
  'studio.anomalie.workflows': 'Workflow(s) non exécutable(s) : {liste}',
  // Le petit surtitre au-dessus du nom de chaque rôle : ce que le rôle fait, en quelques mots.
  'studio.surtitre.petites': 'Choix courts, sans outil',
  'studio.surtitre.orchestrateur': 'Te répond dans le chat',
  'studio.surtitre.sousAgents': 'Font le travail lancé',
  'barre.sections': 'Sections {titre}',

  // — Modèles & topologie (AgentsTopologyView) —
  'topo.erreur.rafraichissement': 'Rafraîchissement de la topologie impossible : {raison}',
  'topo.slot.introuvableTitre':
    'Aucun modèle « {modele} » au catalogue : choisissez-en un autre dans le menu',
  'topo.slot.introuvable': 'modèle introuvable',
  'topo.slot.retirer': 'Retirer ce modèle',
  'topo.chargement': 'Chargement de la topologie…',
  'topo.reessayer': 'Réessayer',
  'topo.etat.enregistrement': 'Enregistrement…',
  'topo.etat.erreur': 'Erreur · {erreur}',
  'topo.etat.enregistre': 'Enregistré dans le profil Autowin',
  'topo.profil.nom': 'Nom du profil',
  'topo.profil.enregistrer': 'Enregistrer',
  'topo.profil.annuler': 'Annuler',
  'topo.profil.gelTitre':
    'Un slot pointe un modèle introuvable : résolvez-le avant de figer un profil',
  'topo.profil.nouveau': '＋ Profil',
  'topo.profil.appliquerAria': 'Appliquer un profil',
  'topo.profil.modifie': ' · modifié',
  'topo.confirmer.aria': 'Confirmer l’application du profil',
  'topo.confirmer.question': 'Écraser la topologie courante ?',
  'topo.confirmer.questionModifiee':
    'Écraser la topologie courante (modifications non enregistrées dans un profil) ?',
  'topo.confirmer.appliquer': 'Appliquer',
  'topo.profil.supprimer': 'Supprimer le profil {nom}',
  'topo.supprimer.aria': 'Confirmer la suppression du profil',
  'topo.supprimer.question': 'Supprimer le profil « {nom} » ? La topologie en place ne change pas.',
  'topo.supprimer.confirmer': 'Supprimer',
  'topo.profils.illisible': 'Liste des profils illisible : {erreur}',
  'topo.slotsIntrouvables':
    '{n} slot(s) pointent un modèle introuvable au catalogue ({slots}) : profils et application gelés tant qu’ils ne sont pas résolus.',
  'topo.orchestrateur.titre': 'Orchestrateur',
  'topo.orchestrateur.description': 'Un seul modèle pilote et consolide.',
  'topo.orchestrateur.aide':
    'Modèle des fils qui n’ont pas choisi le leur, dès leur prochain message.',
  'topo.sousAgents.titre': 'Sous-agents',
  'topo.sousAgents.description': 'Un ou plusieurs modèles qui font le travail.',
  'topo.sousAgents.libelle': 'Sous-agent {n}',
  'topo.sousAgents.aide': 'S’applique aux travaux lancés ensuite.',
  'topo.sousAgents.ajouter': '+ Ajouter un modèle',
  'topo.sousAgents.vide': 'Aucun sous-agent : l’orchestrateur fait le travail lui-même.',
  'topo.sousAgents.doublon':
    'Ce modèle est déjà dans les sous-agents avec cet effort : choisissez un autre modèle ou un autre effort.',
  'topo.sousAgents.premier': 'écrit le code',
  'topo.sousAgents.premierTitre':
    'Le premier sous-agent écrit le code (build, clean). Tous explorent, cadrent et votent au contrôle final.',
  'topo.runtime.titre': 'Runtime actuel',
  'topo.runtime.detail':
    '**Orchestrateur** : un seul modèle. **Sous-agents** : avec plusieurs modèles, le premier écrit le code (build, clean) ; **tous** explorent (scout) et cadrent (frame) en parallèle, puis l’orchestrateur fusionne leurs propositions ; au contrôle final (judge), **chacun vote** et la majorité tranche.',
  'topo.runtime.workflow':
    '**Workflows** : un workflow (onglet Workflows) qui place ses propres agents sur une étape passe avant ces blocs, pour cette étape seulement.',

  // — Ce que couvre chaque rôle : un bloc par panneau (AgentsTopologyView) —
  'topo.couvre.titre': 'Ce que ça couvre',
  'topo.couvre.couvre': 'Couvre',
  'topo.couvre.pendant': 'Pendant un travail',
  'topo.couvre.horsChamp': 'Ne couvre pas',
  'topo.couvre.plusieurs': 'Plusieurs modèles',
  'topo.couvre.vide': 'Bloc vide',
  'topo.couvre.skills': 'Skills qui lancent des sous-agents',
  'topo.couvre.modeleSkills': 'Modèle de ces sous-agents',
  'topo.couvre.orchestrateur.couvre':
    'Le modèle qui **te répond dans le Chat**, dans chaque fil qui n’a pas choisi le sien. Changer de modèle dans l’en-tête d’un chat change aussi ce bloc.',
  'topo.couvre.orchestrateur.pendant':
    'Il **découpe** un gros chantier en morceaux menés en parallèle, et il **fusionne** les propositions quand plusieurs modèles travaillent sur une même étape (plusieurs sous-agents, ou un workflow).',
  'topo.couvre.orchestrateur.horsChamp':
    'Les **petites tâches** (carte voisine) et l’exécution des étapes (**Sous-agents**).',
  'topo.couvre.sousAgents.couvre':
    'Le modèle qui **fait le travail** lancé depuis le chat, **à toutes les étapes** : scout, frame, build, clean et le contrôle final (judge). Seul, il **juge son propre travail**, sauf si un **workflow** place un autre modèle sur l’étape judge.',
  'topo.couvre.sousAgents.plusieurs':
    '**Oui** : le premier écrit le code (build, clean) ; **tous** explorent et cadrent en parallèle, puis l’orchestrateur fusionne ; au contrôle final, **chacun vote** et la majorité tranche.',
  'topo.couvre.sousAgents.vide': 'L’**orchestrateur** fait le travail lui-même.',
  'topo.couvre.sousAgents.skills':
    '**/arena** (un par bras du banc) · **/scout** (un par angle) · **/steal** (un par couche de recherche) · **/frame** et **/draft** (pistes et variantes générées en parallèle) · **/remake** (angles en parallèle, puis travaux enfants) · **/kaizen** (6 à 9 angles, dans un run seulement) · **/judge** (juges en parallèle hors de l’app ; dans l’app, l’un après l’autre).',
  'topo.couvre.sousAgents.modeleSkills':
    'Le modèle **qui joue la skill** (celui du chat ou de l’étape en cours) : Autowin ne leur transmet **pas** le modèle de ce bloc.',

  // — Workflows : liste des profils (WorkflowProfilesView) —
  'wf.cout': '{montant} $',
  'wf.arene.aucune': 'Arène : aucune mesure enregistrée',
  'wf.arene.un': 'Arène : {n} duel · {duree} médian · {cout} médian{verdicts}',
  'wf.arene.plusieurs': 'Arène : {n} duels · {duree} médian · {cout} médian{verdicts}',
  'wf.reels.aucun': 'Usage réel : aucun run enregistré sous ce nom',
  'wf.reels.phrase': 'Usage réel : {morceaux}',
  'wf.reels.run.un': '{n} run',
  'wf.reels.run.plusieurs': '{n} runs',
  'wf.reels.abouti.un': '{n} abouti',
  'wf.reels.abouti.plusieurs': '{n} aboutis',
  'wf.reels.echecs': '{n} en échec',
  'wf.reels.taux': '{issues} ({taux} % de réussite)',
  'wf.reels.interrompu.un': '{n} interrompu, hors taux',
  'wf.reels.interrompu.plusieurs': '{n} interrompus, hors taux',
  'wf.reels.nonClos': '{n} non clos',
  'wf.reels.median': '{valeur} médian',
  'wf.erreur.lecture': 'Impossible de lire les workflows : {raison}',
  'wf.erreur.selection': 'La sélection n’a pas pu être enregistrée : {raison}',
  'wf.erreur.suppression': 'La suppression a échoué : {raison}',
  'wf.erreur.enregistrement': 'L’enregistrement a échoué : {raison}',
  'wf.erreur.renommage': 'Le renommage a échoué : {raison}',
  'wf.erreur.exportRaison': 'Export : {raison}',
  'wf.erreur.export': 'L’export a échoué : {raison}',
  'wf.erreur.importRaison': 'Import : {raison}',
  'wf.erreur.importEcartes': '{importes} workflow(s) importé(s) ; {ecartes} écarté(s) : {liste}',
  'wf.erreur.import': 'L’import a échoué : {raison}',
  'wf.erreur.creation': 'La création a échoué : {raison}',
  'wf.sousTitre': 'Une façon de travailler nommée — modèles, efforts, phases, consignes.',
  'wf.importer': 'Importer',
  'wf.toutExporter': 'Tout exporter',
  'wf.nouveau': 'Nouveau',
  'wf.actif.injouable':
    'Workflow « {nom} » imposé au chat mais NON EXÉCUTABLE : {soucis}. Il ne sera pas joué — corrige-le ou re-clique-le pour le désélectionner.',
  'wf.actif.parDefaut':
    '« {nom} » est le workflow par défaut : le choix automatique passe avant lui, et il ne pilote que les demandes pour lesquelles ce choix n’en propose aucun. Re-clique-le pour n’avoir aucun workflow par défaut.',
  'wf.chargement': 'Chargement des workflows…',
  'wf.vide':
    'Aucun workflow pour l’instant. Crée-en un pour figer une façon de travailler et pouvoir la comparer à une autre.',
  'wf.imposer.bloque': 'Non exécutable : {soucis}',
  'wf.imposer.titre':
    'Imposer {nom} au chat — la case à côté dit seulement si le chat a le droit de l’invoquer lui-même, et le bouton Éditer n’impose rien',
  'wf.renommer.aria': 'Nom du workflow {nom}',
  'wf.badge.actif': 'actif',
  'wf.badge.injouable': 'non exécutable',
  'wf.invocable.bloque':
    'Non exécutable : {soucis} — le chat ne peut pas l’invoquer tant que ce n’est pas corrigé',
  'wf.invocable.non': '{nom} : le chat ne peut pas l’invoquer',
  'wf.invocable.oui': '{nom} : le chat peut l’invoquer',
  'wf.invocable.aria': 'Rendre {nom} invocable par le chat',
  'wf.editer.titre': 'Ouvrir l’éditeur de {nom} sans l’imposer au chat',
  'wf.editer.aria': 'Ouvrir l’éditeur de {nom}',
  'wf.editer': 'Éditer',
  'wf.exporter': 'Exporter {nom}',
  'wf.supprimer.confirmerAria': 'Confirmer la suppression de {nom}',
  'wf.supprimer.question': 'Supprimer ?',
  'wf.oui': 'Oui',
  'wf.non': 'Non',
  'wf.supprimer': 'Supprimer {nom}',
  'wf.role.workflow': '(imposé par ce workflow)',
  'wf.role.topologie': '(topologie)',
  'wf.prompt': 'Prompt effectif',
  'wf.prompt.remplace': 'remplace les consignes de phase',
  'wf.prompt.ajoute': 's’ajoute aux consignes de phase',
  'wf.prompt.phase': '(consigne de phase)',
  'wf.prompt.globale': '(globale)',

  // — Exécutabilité d'un workflow (workflow-executability.ts) —
  'exec.aucunePhase': 'aucune phase : ce workflow ne jouerait rien',
  'exec.skillIntrouvable': 'skill introuvable sur cette machine : {phase}',
  'exec.phaseInconnue': 'phase inconnue : {phase}',
  'exec.aucunAgent': 'aucun agent sur le nœud {noeud}',
  'exec.areteSource': 'arête orpheline : {de} → {vers} (source inconnue)',
  'exec.areteCible': 'arête orpheline : {de} → {vers} (cible inconnue)',

  // — Résumé d'un profil en une ligne (workflow-profile-summary.ts) —
  'resume.juges': '{n} juge(s)',
  'resume.consignesRemplacees': 'consignes remplacées',
  'resume.consigneAjoutee': 'consigne ajoutée',
  'resume.aucunEcart': 'aucun écart — configuration courante',

  // — Éditeur de graphe (WorkflowGraphEditor) —
  'graphe.verificationIndisponible': 'Vérification indisponible.',
  'graphe.enregistre': 'Enregistré',
  'graphe.enregistrer': 'Enregistrer le workflow',
  'graphe.bloquant': '{n} point(s) à corriger avant d’enregistrer.',
  'graphe.pireCas': 'au plus {n} exécution(s) de phase',

  // — Canevas du workflow (WorkflowCanvas) —
  'canevas.aide': 'Cliquer ajoute la phase au bout de la chaîne. Glisser un nœud le réordonne.',
  'canevas.retirer': 'Retirer {phase}',
  'canevas.modeleParDefaut': 'modèle par défaut',
  'canevas.unAgent': '1 agent',
  'canevas.pireCas': '≤{n} exéc. au pire cas',
  'canevas.defaut.un': '{n} défaut',
  'canevas.defaut.plusieurs': '{n} défauts',
  'canevas.valide': 'valide',
  'canevas.noeudSelectionne': 'Nœud sélectionné',
  'canevas.aucunAngle': 'aucun angle imposé',
  'canevas.modele': 'Modèle',
  'canevas.indisponible': '{modele} (indisponible)',
  'canevas.parDefaut': 'par défaut',
  'canevas.majorite': 'majorité',
  'canevas.renvoyerVers': 'Renvoyer vers',
  'canevas.renvoiTrace': 'Renvoi vers {phase} déjà tracé — retirez-le dans « Retours »',
  'canevas.inspecteurVide': 'Cliquer un nœud pour régler ses agents, son quorum et ses retours.',
  'canevas.retours': 'Retours',
  'canevas.retourVert': '{de} → {vers} si vert',
  'canevas.retourRouge': '{de} → {vers} si rouge',
  'canevas.auPlus': 'au plus',
  'canevas.retirerRetour': 'Retirer ce retour'
} as const

export const TEXTES_EN: Record<keyof typeof TEXTES_FR, string> = {
  'studio.description': 'Which models play which roles, and which workflows chain them.',
  'studio.aria': 'Agent Studio sections',
  'studio.onglet.topologie': 'Models & topology',
  'studio.anomalie.workflows': 'Non-runnable workflow(s): {liste}',
  'studio.surtitre.petites': 'Short choices, no tools',
  'studio.surtitre.orchestrateur': 'Answers you in the chat',
  'studio.surtitre.sousAgents': 'Do the work you launch',
  'barre.sections': '{titre} sections',

  'topo.erreur.rafraichissement': 'Could not refresh the topology: {raison}',
  'topo.slot.introuvableTitre': 'No model “{modele}” in the catalog: pick another one in the menu',
  'topo.slot.introuvable': 'model not found',
  'topo.slot.retirer': 'Remove this model',
  'topo.chargement': 'Loading the topology…',
  'topo.reessayer': 'Retry',
  'topo.etat.enregistrement': 'Saving…',
  'topo.etat.erreur': 'Error · {erreur}',
  'topo.etat.enregistre': 'Saved in the Autowin profile',
  'topo.profil.nom': 'Profile name',
  'topo.profil.enregistrer': 'Save',
  'topo.profil.annuler': 'Cancel',
  'topo.profil.gelTitre': 'A slot points to a missing model: resolve it before freezing a profile',
  'topo.profil.nouveau': '＋ Profile',
  'topo.profil.appliquerAria': 'Apply a profile',
  'topo.profil.modifie': ' · modified',
  'topo.confirmer.aria': 'Confirm applying the profile',
  'topo.confirmer.question': 'Overwrite the current topology?',
  'topo.confirmer.questionModifiee':
    'Overwrite the current topology (changes not saved in a profile)?',
  'topo.confirmer.appliquer': 'Apply',
  'topo.profil.supprimer': 'Delete the profile {nom}',
  'topo.supprimer.aria': 'Confirm deleting the profile',
  'topo.supprimer.question': 'Delete the profile “{nom}”? The current topology does not change.',
  'topo.supprimer.confirmer': 'Delete',
  'topo.profils.illisible': 'Profile list unreadable: {erreur}',
  'topo.slotsIntrouvables':
    '{n} slot(s) point to a model missing from the catalog ({slots}): profiles and applying are frozen until they are resolved.',
  'topo.orchestrateur.titre': 'Orchestrator',
  'topo.orchestrateur.description': 'A single model drives and consolidates.',
  'topo.orchestrateur.aide':
    'Model of the threads that have not picked their own, from their next message.',
  'topo.sousAgents.titre': 'Sub-agents',
  'topo.sousAgents.description': 'One or more models that do the work.',
  'topo.sousAgents.libelle': 'Sub-agent {n}',
  'topo.sousAgents.aide': 'Applies to the jobs started next.',
  'topo.sousAgents.ajouter': '+ Add a model',
  'topo.sousAgents.vide': 'No sub-agent: the orchestrator does the work itself.',
  'topo.sousAgents.doublon':
    'This model is already a sub-agent with this effort: pick another model or another effort.',
  'topo.sousAgents.premier': 'writes the code',
  'topo.sousAgents.premierTitre':
    'The first sub-agent writes the code (build, clean). All of them explore, frame and vote at the final check.',
  'topo.runtime.titre': 'Current runtime',
  'topo.runtime.detail':
    '**Orchestrator**: a single model. **Sub-agents**: with several models, the first one writes the code (build, clean); **all of them** explore (scout) and frame in parallel, then the orchestrator merges their proposals; at the final check (judge), **each one votes** and the majority decides.',
  'topo.runtime.workflow':
    '**Workflows**: a workflow (Workflows tab) that places its own agents on a step takes precedence over these blocks, for that step only.',

  'topo.couvre.titre': 'What it covers',
  'topo.couvre.couvre': 'Covers',
  'topo.couvre.pendant': 'During a job',
  'topo.couvre.horsChamp': 'Does not cover',
  'topo.couvre.plusieurs': 'Several models',
  'topo.couvre.vide': 'Empty block',
  'topo.couvre.skills': 'Skills that launch sub-agents',
  'topo.couvre.modeleSkills': 'Model of those sub-agents',
  'topo.couvre.orchestrateur.couvre':
    'The model that **answers you in the Chat**, in every thread that has not picked its own. Changing the model in a chat header changes this block too.',
  'topo.couvre.orchestrateur.pendant':
    'It **splits** a large job into pieces run in parallel, and it **merges** the proposals when several models work on the same step (several sub-agents, or a workflow).',
  'topo.couvre.orchestrateur.horsChamp':
    'The **small tasks** (the card next to it) and running the steps (**Sub-agents**).',
  'topo.couvre.sousAgents.couvre':
    'The model that **does the work** started from the chat, **at every step**: scout, frame, build, clean and the final check (judge). On its own, it **judges its own work**, unless a **workflow** puts another model on the judge step.',
  'topo.couvre.sousAgents.plusieurs':
    '**Yes**: the first one writes the code (build, clean); **all of them** explore and frame in parallel, then the orchestrator merges; at the final check, **each one votes** and the majority decides.',
  'topo.couvre.sousAgents.vide': 'The **orchestrator** does the work itself.',
  'topo.couvre.sousAgents.skills':
    '**/arena** (one per bench arm) · **/scout** (one per angle) · **/steal** (one per research layer) · **/frame** and **/draft** (leads and variants generated in parallel) · **/remake** (angles in parallel, then child jobs) · **/kaizen** (6 to 9 angles, in a run only) · **/judge** (judges in parallel outside the app; inside the app, one after the other).',
  'topo.couvre.sousAgents.modeleSkills':
    'The model **that runs the skill** (the chat’s or the current step’s): Autowin does **not** pass them this block’s model.',

  'wf.cout': '${montant}',
  'wf.arene.aucune': 'Arena: no measurement recorded',
  'wf.arene.un': 'Arena: {n} duel · median {duree} · median {cout}{verdicts}',
  'wf.arene.plusieurs': 'Arena: {n} duels · median {duree} · median {cout}{verdicts}',
  'wf.reels.aucun': 'Real usage: no run recorded under this name',
  'wf.reels.phrase': 'Real usage: {morceaux}',
  'wf.reels.run.un': '{n} run',
  'wf.reels.run.plusieurs': '{n} runs',
  'wf.reels.abouti.un': '{n} completed',
  'wf.reels.abouti.plusieurs': '{n} completed',
  'wf.reels.echecs': '{n} failed',
  'wf.reels.taux': '{issues} ({taux}% success)',
  'wf.reels.interrompu.un': '{n} interrupted, excluded from the rate',
  'wf.reels.interrompu.plusieurs': '{n} interrupted, excluded from the rate',
  'wf.reels.nonClos': '{n} not closed',
  'wf.reels.median': 'median {valeur}',
  'wf.erreur.lecture': 'Could not read the workflows: {raison}',
  'wf.erreur.selection': 'The selection could not be saved: {raison}',
  'wf.erreur.suppression': 'Deletion failed: {raison}',
  'wf.erreur.enregistrement': 'Saving failed: {raison}',
  'wf.erreur.renommage': 'Renaming failed: {raison}',
  'wf.erreur.exportRaison': 'Export: {raison}',
  'wf.erreur.export': 'Export failed: {raison}',
  'wf.erreur.importRaison': 'Import: {raison}',
  'wf.erreur.importEcartes': '{importes} workflow(s) imported; {ecartes} rejected: {liste}',
  'wf.erreur.import': 'Import failed: {raison}',
  'wf.erreur.creation': 'Creation failed: {raison}',
  'wf.sousTitre': 'A named way of working — models, efforts, phases, instructions.',
  'wf.importer': 'Import',
  'wf.toutExporter': 'Export all',
  'wf.nouveau': 'New',
  'wf.actif.injouable':
    'Workflow “{nom}” is forced on the chat but NOT RUNNABLE: {soucis}. It will not run — fix it, or click it again to deselect it.',
  'wf.actif.parDefaut':
    '“{nom}” is the default workflow: the automatic choice comes first, and it only drives the requests for which that choice proposes none. Click it again to have no default workflow.',
  'wf.chargement': 'Loading workflows…',
  'wf.vide':
    'No workflow yet. Create one to freeze a way of working and be able to compare it with another.',
  'wf.imposer.bloque': 'Not runnable: {soucis}',
  'wf.imposer.titre':
    'Force {nom} on the chat — the box next to it only says whether the chat may invoke it on its own, and the Edit button forces nothing',
  'wf.renommer.aria': 'Name of workflow {nom}',
  'wf.badge.actif': 'active',
  'wf.badge.injouable': 'not runnable',
  'wf.invocable.bloque': 'Not runnable: {soucis} — the chat cannot invoke it until this is fixed',
  'wf.invocable.non': '{nom}: the chat cannot invoke it',
  'wf.invocable.oui': '{nom}: the chat can invoke it',
  'wf.invocable.aria': 'Let the chat invoke {nom}',
  'wf.editer.titre': 'Open the editor of {nom} without forcing it on the chat',
  'wf.editer.aria': 'Open the editor of {nom}',
  'wf.editer': 'Edit',
  'wf.exporter': 'Export {nom}',
  'wf.supprimer.confirmerAria': 'Confirm deleting {nom}',
  'wf.supprimer.question': 'Delete?',
  'wf.oui': 'Yes',
  'wf.non': 'No',
  'wf.supprimer': 'Delete {nom}',
  'wf.role.workflow': '(forced by this workflow)',
  'wf.role.topologie': '(topology)',
  'wf.prompt': 'Effective prompt',
  'wf.prompt.remplace': 'replaces the phase instructions',
  'wf.prompt.ajoute': 'adds to the phase instructions',
  'wf.prompt.phase': '(phase instruction)',
  'wf.prompt.globale': '(global)',

  'exec.aucunePhase': 'no phase: this workflow would run nothing',
  'exec.skillIntrouvable': 'skill not found on this machine: {phase}',
  'exec.phaseInconnue': 'unknown phase: {phase}',
  'exec.aucunAgent': 'no agent on node {noeud}',
  'exec.areteSource': 'orphan edge: {de} → {vers} (unknown source)',
  'exec.areteCible': 'orphan edge: {de} → {vers} (unknown target)',

  'resume.juges': '{n} judge(s)',
  'resume.consignesRemplacees': 'instructions replaced',
  'resume.consigneAjoutee': 'instruction added',
  'resume.aucunEcart': 'no difference — current configuration',

  'graphe.verificationIndisponible': 'Check unavailable.',
  'graphe.enregistre': 'Saved',
  'graphe.enregistrer': 'Save the workflow',
  'graphe.bloquant': '{n} issue(s) to fix before saving.',
  'graphe.pireCas': 'at most {n} phase run(s)',

  'canevas.aide': 'Clicking adds the phase at the end of the chain. Dragging a node reorders it.',
  'canevas.retirer': 'Remove {phase}',
  'canevas.modeleParDefaut': 'default model',
  'canevas.unAgent': '1 agent',
  'canevas.pireCas': '≤{n} runs in the worst case',
  'canevas.defaut.un': '{n} defect',
  'canevas.defaut.plusieurs': '{n} defects',
  'canevas.valide': 'valid',
  'canevas.noeudSelectionne': 'Selected node',
  'canevas.aucunAngle': 'no angle imposed',
  'canevas.modele': 'Model',
  'canevas.indisponible': '{modele} (unavailable)',
  'canevas.parDefaut': 'default',
  'canevas.majorite': 'majority',
  'canevas.renvoyerVers': 'Send back to',
  'canevas.renvoiTrace': 'Send-back to {phase} already drawn — remove it under “Returns”',
  'canevas.inspecteurVide': 'Click a node to set its agents, its quorum and its returns.',
  'canevas.retours': 'Returns',
  'canevas.retourVert': '{de} → {vers} if green',
  'canevas.retourRouge': '{de} → {vers} if red',
  'canevas.auPlus': 'at most',
  'canevas.retirerRetour': 'Remove this return'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {
  'wf.reels.run.un': '« run » : le même mot en anglais',
  'wf.reels.run.plusieurs': '« runs » : le même mot en anglais',
  'canevas.unAgent': '« agent » : le même mot en anglais'
}

export const { useTextes: useTextesAgentStudio, traduire: traduireAgentStudio } = tableDeTextes(
  TEXTES_FR,
  TEXTES_EN
)
