import { tableDeTextes } from '../textes'

/**
 * TEXTES — ÉCRAN AGENT STUDIO (traduction anglaise, conv-1170, 2026-10-27).
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
 * RESTENT EN DUR, hors de cette table (lot « Agent Studio », conv-1170) :
 *  - les mots déjà identiques dans les deux langues, écrits une fois dans le composant :
 *    « ORCHESTRATION », « Agent Studio », « Workflows », « Models », les noms de panneaux
 *    « Scouts », « Frame », « Terrain », « Judges » (noms des phases du moteur), « Phases »,
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
  'barre.sections': 'Sections {titre}',

  // — Modèles & topologie (AgentsTopologyView) —
  'topo.erreur.rafraichissement': 'Rafraîchissement de la topologie impossible : {raison}',
  'topo.erreur.fanout':
    'Le fan-out des sous-agents n’est pas branché : un second sous-agent ne serait pas exécuté. Remplacez le slot existant.',
  'topo.rang.orchestrateur': '01 · Autorité unique',
  'topo.rang.sousAgents': '02 · Exécution bornée',
  'topo.rang.panel': 'Panel parallèle',
  'topo.slot.introuvableTitre':
    'Aucun modèle « {modele} » au catalogue : déposez-en un pour résoudre ce slot',
  'topo.slot.introuvable': 'modèle introuvable',
  'topo.slot.retirer': 'Retirer ce slot',
  'topo.slot.actif': 'actif',
  'topo.slot.roleRuntime': 'rôle runtime',
  'topo.slot.paralleleTitre':
    "Exécuté en parallèle puis agrégé par l'orchestrateur (union pour scout/frame, quorum pour judge)",
  'topo.slot.parallele': 'parallèle · actif',
  'topo.slot.inactifTitre':
    "Le fan-out des sous-agents n'est pas encore branché — ce slot n'est pas utilisé au runtime",
  'topo.slot.inactif': 'non actif',
  'topo.vide': 'Glissez un modèle ici',
  'topo.ajouter.fanoutTitre':
    'Fan-out des sous-agents non branché : un second slot ne serait pas exécuté',
  'topo.ajouter.remplacer': 'Remplacer avec le modèle sélectionné',
  'topo.ajouter.fanout': 'Fan-out non branché — remplacez le slot existant',
  'topo.ajouter.ajouter': '+ Ajouter le modèle sélectionné',
  'topo.chargement': 'Chargement de la topologie…',
  'topo.reessayer': 'Réessayer',
  'topo.eyebrow': 'Configuration des agents',
  'topo.description': 'Assigne les modèles aux rôles et contrôle leur disponibilité.',
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
  'topo.profil.sauvegardes': 'Profils sauvegardés',
  'topo.profil.modifie': ' · modifié',
  'topo.confirmer.aria': 'Confirmer l’application du profil',
  'topo.confirmer.question': 'Écraser la topologie courante ?',
  'topo.confirmer.questionModifiee':
    'Écraser la topologie courante (modifications non enregistrées dans un profil) ?',
  'topo.confirmer.appliquer': 'Appliquer',
  'topo.profils.illisible': 'Liste des profils illisible : {erreur}',
  'topo.slotsIntrouvables':
    '{n} slot(s) pointent un modèle introuvable au catalogue ({slots}) : profils et application gelés tant qu’ils ne sont pas résolus.',
  'topo.biblio.eyebrow': 'Modèles importés',
  'topo.biblio.aide': 'Glissez un modèle sur un slot ou sélectionnez-le puis utilisez Ajouter.',
  'topo.gemini.erreur': "Le login Gemini n'a pas pu être lancé : {raison}",
  'topo.gemini.connecter': 'Connecter Gemini avec Google',
  'topo.modele.efforts': ' · efforts {liste}',
  'topo.autorite.titre': 'Autorité',
  'topo.autorite.main': 'La configuration est validée et persistée par le main process.',
  'topo.autorite.fanout':
    'Scouts, Frame, Terrain et Judges : tous les modèles déposés s’exécutent (fan-out + agrégation). Orchestrateur et Sous-agents : seul le premier slot alimente le runtime.',
  'topo.orchestrateur.titre': 'Orchestrateur',
  'topo.orchestrateur.description': 'Un seul modèle pilote et consolide.',
  'topo.sousAgents.titre': 'Sous-agents',
  'topo.sousAgents.description': 'Zéro à plusieurs exécutants bornés.',
  'topo.panels.eyebrow': 'Panels composés',
  'topo.panels.titre': 'Exploration et vérification parallèles',
  'topo.panels.note': 'Les sorties restent distinctes avant synthèse.',
  'topo.scout.description': 'Plusieurs lectures indépendantes du même front.',
  'topo.frame.description': 'Plusieurs modèles cadrent la même tâche ; angles fusionnés.',
  'topo.terrain.description':
    'Plusieurs modèles préparent le harnais et les preuves ; sorties fusionnées.',
  'topo.judge.description': 'Plusieurs challenges indépendants avant verdict.',
  'topo.runtime.titre': 'Runtime actuel',
  'topo.runtime.detail':
    '**Scouts, Frame, Terrain et Judges** : déposez-y plusieurs modèles — ils s’exécutent en parallèle puis l’orchestrateur agrège (union des sorties pour Scouts/Frame/Terrain, quorum de vote pour Judges). **Orchestrateur et Sous-agents** : seul le premier slot alimente le runtime (fan-out des sous-agents pas encore branché).',

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
  'barre.sections': '{titre} sections',

  'topo.erreur.rafraichissement': 'Could not refresh the topology: {raison}',
  'topo.erreur.fanout':
    'Sub-agent fan-out is not wired: a second sub-agent would not run. Replace the existing slot.',
  'topo.rang.orchestrateur': '01 · Single authority',
  'topo.rang.sousAgents': '02 · Bounded execution',
  'topo.rang.panel': 'Parallel panel',
  'topo.slot.introuvableTitre': 'No model “{modele}” in the catalog: drop one to resolve this slot',
  'topo.slot.introuvable': 'model not found',
  'topo.slot.retirer': 'Remove this slot',
  'topo.slot.actif': 'active',
  'topo.slot.roleRuntime': 'runtime role',
  'topo.slot.paralleleTitre':
    'Run in parallel, then aggregated by the orchestrator (union for scout/frame, quorum for judge)',
  'topo.slot.parallele': 'parallel · active',
  'topo.slot.inactifTitre': 'Sub-agent fan-out is not wired yet — this slot is not used at runtime',
  'topo.slot.inactif': 'inactive',
  'topo.vide': 'Drop a model here',
  'topo.ajouter.fanoutTitre': 'Sub-agent fan-out not wired: a second slot would not run',
  'topo.ajouter.remplacer': 'Replace with the selected model',
  'topo.ajouter.fanout': 'Fan-out not wired — replace the existing slot',
  'topo.ajouter.ajouter': '+ Add the selected model',
  'topo.chargement': 'Loading the topology…',
  'topo.reessayer': 'Retry',
  'topo.eyebrow': 'Agent configuration',
  'topo.description': 'Assign models to roles and check their availability.',
  'topo.etat.enregistrement': 'Saving…',
  'topo.etat.erreur': 'Error · {erreur}',
  'topo.etat.enregistre': 'Saved in the Autowin profile',
  'topo.profil.nom': 'Profile name',
  'topo.profil.enregistrer': 'Save',
  'topo.profil.annuler': 'Cancel',
  'topo.profil.gelTitre': 'A slot points to a missing model: resolve it before freezing a profile',
  'topo.profil.nouveau': '＋ Profile',
  'topo.profil.appliquerAria': 'Apply a profile',
  'topo.profil.sauvegardes': 'Saved profiles',
  'topo.profil.modifie': ' · modified',
  'topo.confirmer.aria': 'Confirm applying the profile',
  'topo.confirmer.question': 'Overwrite the current topology?',
  'topo.confirmer.questionModifiee':
    'Overwrite the current topology (changes not saved in a profile)?',
  'topo.confirmer.appliquer': 'Apply',
  'topo.profils.illisible': 'Profile list unreadable: {erreur}',
  'topo.slotsIntrouvables':
    '{n} slot(s) point to a model missing from the catalog ({slots}): profiles and applying are frozen until they are resolved.',
  'topo.biblio.eyebrow': 'Imported models',
  'topo.biblio.aide': 'Drag a model onto a slot, or select it and use Add.',
  'topo.gemini.erreur': 'The Gemini login could not be started: {raison}',
  'topo.gemini.connecter': 'Connect Gemini with Google',
  'topo.modele.efforts': ' · effort levels {liste}',
  'topo.autorite.titre': 'Authority',
  'topo.autorite.main': 'The configuration is validated and persisted by the main process.',
  'topo.autorite.fanout':
    'Scouts, Frame, Terrain and Judges: every model dropped there runs (fan-out + aggregation). Orchestrator and Sub-agents: only the first slot feeds the runtime.',
  'topo.orchestrateur.titre': 'Orchestrator',
  'topo.orchestrateur.description': 'A single model drives and consolidates.',
  'topo.sousAgents.titre': 'Sub-agents',
  'topo.sousAgents.description': 'Zero to several bounded executors.',
  'topo.panels.eyebrow': 'Composed panels',
  'topo.panels.titre': 'Parallel exploration and verification',
  'topo.panels.note': 'Outputs stay separate until the synthesis.',
  'topo.scout.description': 'Several independent readings of the same front.',
  'topo.frame.description': 'Several models frame the same task; angles merged.',
  'topo.terrain.description':
    'Several models prepare the harness and the evidence; outputs merged.',
  'topo.judge.description': 'Several independent challenges before the verdict.',
  'topo.runtime.titre': 'Current runtime',
  'topo.runtime.detail':
    '**Scouts, Frame, Terrain and Judges**: drop several models there — they run in parallel, then the orchestrator aggregates (union of outputs for Scouts/Frame/Terrain, voting quorum for Judges). **Orchestrator and Sub-agents**: only the first slot feeds the runtime (sub-agent fan-out not wired yet).',

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
