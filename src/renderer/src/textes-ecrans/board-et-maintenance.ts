import { tableDeTextes } from '../textes'

/**
 * TEXTES — ÉCRANS BOARD ET MAINTENANCE (traduction anglaise, conv-1170, 2026-10-27).
 *
 * Écrans couverts : Board : CarteDesBesoinsView, RiviereDuProjet, VerificationDuBoard, TachesDeLaDemande.
 * Maintenance : TestsView, MaintenanceSkillsPanel, PerfLagPanel, tailles en octets.
 *
 * Une table par groupe d'écrans pour que les lots de traduction, menés en même temps, n'écrivent
 * jamais dans le même fichier. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait
 * foi, mot pour mot celui de l'écran ; l'anglais a les MÊMES clés (le type refuse une clé manquante
 * ou en trop), n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`. Un anglais
 * volontairement identique au français (nom propre, nom de produit) se déclare dans
 * `IDENTIQUES_AU_FRANCAIS`, avec sa raison.
 *
 * Préfixes : `vue.` (en-tête du Board, CarteDesBesoinsView), `riviere.` et `fiche.` (la rivière et
 * la fiche d'un post-it, RiviereDuProjet), `etage.` et `jour.` (carte-riviere), `statut.`,
 * `constat.` et `titre.` (textes de la carte écrits en français par le processus principal, traduits
 * à l'affichage par RiviereDuProjet), `taches.` (TachesDeLaDemande), `verif.` (VerificationDuBoard,
 * verification-du-board), `commun.` ; `maint.` (TestsView), `skills.` (maintenance-skills,
 * MaintenanceSkillsPanel), `perf.` (PerfLagPanel), `octets.` (formater-octets).
 *
 * Restent en dur, identiques dans les deux langues : les titres d'écran « Board » et « Maintenance »
 * (`nomDeDestination`, textes.ts), « + task », le groupe « Routine », les rôles « GPU » et
 * « Service », les unités `ms` et `%`, « exit », « Segment », `n`, `p50`, `p95`, `max`, `PID`.
 */
export const TEXTES_FR = {
  // — En-tête du Board (CarteDesBesoinsView)
  'vue.surtitre': 'PROJET',
  'vue.demande': 'demande',
  'vue.demandes': 'demandes',
  'vue.prouvee': 'prouvée',
  'vue.prouvees': 'prouvées',
  'vue.refusee': 'refusée',
  'vue.refusees': 'refusées',
  'vue.runBloque': 'run bloqué',
  'vue.runsBloques': 'runs bloqués',
  'vue.calcul': 'Calcul…',
  'vue.actualiser': 'Actualiser',
  'vue.erreur': 'Carte impossible à calculer : {erreur}',
  'vue.chargement': 'Calcul de la carte…',
  'vue.sourceInjoignable': 'source de tickets injoignable : liens #1234 non vérifiés',
  'vue.tasksNonVerifiees': 'tasks non vérifiées : {erreur}',
  // Le dossier où le Board est recopié (conv-1206)
  'vue.dossier': 'Dossier…',
  'vue.dossierAide':
    'Choisir un dossier (un partage réseau par exemple) où recopier le Board à chaque calcul, un post-it par fil avec l’identifiant de sa conversation',
  'vue.dossierEnregistre': 'Recopié dans {cible} à {heure} · {n} post-it',
  'vue.dossierAttente': 'Copie vers {cible} en attente…',
  'vue.dossierErreur': 'Copie vers le dossier impossible : {erreur}',
  'vue.dossierOublier': 'Ne plus recopier le Board dans ce dossier',
  // Les post-it des collègues relus dans ce dossier (conv-1210)
  'vue.dossierCollegues': 'Post-it des collègues : {noms}',
  'vue.dossierColleguesErreur': 'Collègues non relus : {erreur}',

  // — La rivière (RiviereDuProjet)
  'riviere.aide':
    'molette sur le tableau ou clic sur une colonne : la colonne visée s’élargit, et ses post-it grandissent · la molette vers le haut remonte le temps jusqu’au plus vieux fil · glisse un post-it vers un autre étage pour changer son état — gardé sur ce poste jusqu’à la prochaine demande du fil, jamais compté comme une preuve',
  'riviere.fenetre.derniers': 'les {n} derniers jours',
  'riviere.fenetre.du': 'du {debut} au {fin}',
  'riviere.aria': 'La rivière, {fenetre}',
  'riviere.titre': 'La rivière',
  'riviere.aujourdhui.aide': 'Ramener la frise et la loupe sur aujourd’hui',
  'riviere.aujourdhui': 'revenir à aujourd’hui',
  'riviere.personnes': 'Filtrer par personne',
  'riviere.tous': 'Tous',
  'riviere.pied.filsSur': 'fils sur {fenetre}',
  'riviere.pied.fils': 'fils {fenetre}',
  'riviere.pied.plusAnciens': ' · {n} plus anciens',
  'riviere.pied.plusRecents': ' · {n} plus récents',
  'riviere.pied.loupe': ' · molette ou clic = loupe',
  'riviere.pied.molette': ', molette vers le haut = plus ancien',
  'riviere.postit.poseALaMain': ' · posé à la main',
  'riviere.postit.collegue': ' · fil de {nom}, en lecture seule',
  'riviere.postit.demandes': '{n} dem.',

  // — La fiche d'un post-it (RiviereDuProjet)
  'fiche.fermer': 'Fermer la fiche',
  'fiche.demandeurInconnu': 'demandeur inconnu',
  'fiche.manuel': 'posé à la main · ses preuves disent « {etat} »',
  'fiche.revenir': 'revenir à l’état prouvé',
  'fiche.plusAnciennes': '{n} demandes plus anciennes',
  'fiche.ouvrir': 'Ouvrir le fil',
  'fiche.collegue': 'Fil de {nom}, sur son poste ({conv}) : lecture seule.',

  // — Les étages et les jours de la rivière (carte-riviere)
  'etage.aFaire': 'À faire',
  'etage.aFaire.aide': 'posé à la main',
  'etage.enCours': 'En cours',
  'etage.enCours.aide': 'un tour tourne ou une question attend',
  'etage.bloque': 'Bloqué',
  'etage.bloque.aide': 'contrôle refusé, run rouge ou tour arrêté',
  'etage.aVerifier': 'À vérifier',
  'etage.aVerifier.aide': 'fini sans aucune vérification jouée',
  'etage.fait': 'Fait',
  'etage.fait.aide': 'une vérification a rendu vert',
  'jour.aujourdhui': 'aujourd’hui',
  'jour.aujourdhuiCourt': 'auj.',

  // — L'état prouvé d'un fil, dans la fiche (« ses preuves disent … »)
  'statut.prouve': 'prouvé',
  'statut.refuse': 'refusé',
  'statut.enCours': 'en cours',
  'statut.sansPreuve': 'sans preuve',

  // — Constats et titres de repli écrits par `carte-du-fil.ts` dans le processus principal
  'constat.agentTravaille': 'l’agent travaille',
  'constat.attenteReponse': 'en attente de la réponse',
  'constat.aucuneReponse': 'aucune réponse',
  'constat.tourEnEchec': 'tour en échec',
  'constat.tourEnEchecDetail': 'tour en échec : {detail}',
  'constat.tourArrete': 'tour arrêté avant la fin',
  'constat.finiSansVerification': 'fini sans vérification',
  'constat.repartDuResume': 'l’agent repart de ce résumé',
  'constat.questionTAttend': 'une question t’attend',
  'titre.demande': 'Demande',
  'titre.compactage': 'Compactage du fil',
  'titre.suiteAcceptee': 'Suite acceptée',
  'titre.suite': 'Suite : {suite}',

  // — La task d'une demande (TachesDeLaDemande)
  'taches.origine.tickets': 'fil ouvert depuis la vue Tickets pour cette fiche',
  'taches.origine.mention': 'numéro écrit dans le prompt, fiche lue à la source',
  'taches.origine.manuel': 'rattaché à la main',
  'taches.herite': 'repris de la demande précédente (ce prompt la poursuit)',
  'taches.titreNonLu': ' · titre pas encore lu à la source',
  'taches.detacher': 'Détacher #{id}',
  'taches.detacher.aide': 'Détacher cette task de la demande',
  'taches.sans': 'sans task',
  'taches.lier.aide': 'Lier cette demande à un work item',
  'taches.source': 'Source du work item',
  'taches.source.aide': 'Dans quelle source chercher ce numéro',
  'taches.numero': 'Numéro du work item',
  'taches.numero.exemple': '1234 ou #1234',
  'taches.lecture': 'Lecture…',
  'taches.lier': 'Lier',
  'commun.annuler': 'Annuler',

  // — « Vérifier » et « Tout vérifier » (VerificationDuBoard, verification-du-board)
  'verif.aide':
    'Envoie /check dans ce fil : un tour y rejoue la preuve. Vert → « Fait », rouge → « Bloqué ».',
  'verif.aideALaMain':
    'Le pose en « Fait » sans preuve, gardé sur ce poste jusqu’à la prochaine demande du fil.',
  'verif.aucunLanceErreur': 'aucun /check lancé : {erreur}',
  'verif.confirmer': 'Confirmer la vérification de la ligne',
  'verif.question.un': 'Lancer /check dans {n} fil ? ({n} tour de modèle)',
  'verif.question.plusieurs': 'Lancer /check dans {n} fils ? ({n} tours de modèle)',
  'verif.lancer': 'Lancer',
  'verif.aucunPostit': 'Aucun post-it affiché dans la ligne « À vérifier »',
  'verif.toutAide': 'Envoie /check dans les {n} fils de la ligne « À vérifier » affichés',
  'verif.envoi': 'Envoi…',
  'verif.tout': 'Tout vérifier · {n}',
  'verif.court': '▶ vérifier',
  'verif.long': 'Vérifier (/check)',
  'verif.mainCourt': '✓ à la main',
  'verif.mainLong': 'Vérifié à la main',
  'verif.refus': '/check refusé : {raison}',
  'verif.envoiRefuse': 'envoi refusé',
  'verif.bilan.aucun': 'aucun /check lancé',
  'verif.bilan.un': '/check lancé dans {n} fil',
  'verif.bilan.plusieurs': '/check lancé dans {n} fils',
  'verif.bilan.refusUn': '{lance} · {e} refusé : {raison}',
  'verif.bilan.refusPlusieurs': '{lance} · {e} refusés : {raison}',

  // — Vue Maintenance et ses suites de tests (TestsView)
  'maint.surtitre': 'ENTRETIEN',
  'maint.description':
    'Lance les skills d’entretien d’Autowin, et les tests unitaires de tes projets.',
  'maint.canalAbsent': 'canal tests:projects indisponible (moteur non reconstruit ?)',
  'maint.onglet.suites': 'Tests unitaires',
  'maint.onglet.latence': 'Latence',
  'maint.filtre': 'Filtrer (motif de fichier)',
  'maint.echecsSeuls': 'Échecs seuls',
  'maint.ajouter': '+ Projet',
  'maint.execution': 'Exécution…',
  'maint.lancer': 'Lancer la suite',
  'maint.enCours': '{projet} — exécution en cours · {secondes} s',
  'maint.aucunProjet':
    'Aucun projet enregistré. « + Projet » ajoute n’importe quelle racine (Autowin OS ou un autre dépôt).',
  'maint.echecs': '{n} échec(s)',
  'maint.retirer': 'Retirer du registre',
  'maint.aucuneExecution':
    'Aucune exécution pour ce projet. « Lancer la suite » produit le rapport.',
  'maint.nonExecutable': 'Projet non exécutable.',
  'maint.passes': 'passés',
  'maint.echecsTotal': 'échecs',
  'maint.ignores': '{n} ignorés',
  'maint.memorise': '↺ dernier run mémorisé (non rejoué)',
  'maint.rejouer': 'Rejouer ce fichier seul',
  'maint.copier': 'Copier l’erreur',
  'maint.ouvrir': 'Ouvrir le fichier',

  // — Les skills d'entretien (maintenance-skills, MaintenanceSkillsPanel)
  'skills.groupe.analyse': 'Analyse et amélioration',
  'skills.groupe.depannage': 'Dépannage',
  'skills.maintenance.titre': 'Bulletin de santé',
  'skills.maintenance.role':
    'Bugs, lenteurs, retard, travail inachevé — répare au plus un défaut prouvé.',
  'skills.gc.titre': 'Ménage des données',
  'skills.gc.role': 'Déplace les déchets prouvés de .autowin-data en corbeille datée.',
  'skills.curate.titre': 'Trier le savoir',
  'skills.curate.role': 'Promeut, fusionne ou rejette les candidats en attente du Brain.',
  'skills.rendement.titre': 'Coûts et lenteurs',
  'skills.rendement.role':
    'Classe les conversations par gaspillage et remonte à la cause du détour.',
  'skills.residus.titre': 'Code mort',
  'skills.residus.role':
    'Repère fichiers morts et branches jamais atteintes — propose, ne supprime rien.',
  'skills.glean.titre': 'Récolter le savoir',
  'skills.glean.role': 'Dépose comme candidats Brain les faits jamais retenus des conversations.',
  'skills.kaizen.titre': 'Corriger un comportement',
  'skills.kaizen.role':
    'Trouve un défaut de comportement des agents et applique le correctif à sa source.',
  'skills.heal.titre': 'Corriger les défauts',
  'skills.heal.role':
    'Trouve les défauts prouvés du code (test rouge, lenteur mesurée) et les corrige un à un.',
  'skills.salvage.titre': 'Travail non publié',
  'skills.salvage.role':
    'Retrouve le travail resté de côté, le trie par contenu, puis publie ce qu’il garde.',
  'skills.gel.titre': 'Enquête sur un gel',
  'skills.gel.role':
    'Remonte un gel de l’app jusqu’à son fichier et sa ligne — désigne, ne corrige pas.',
  'skills.maj.titre': 'Débloquer la mise à jour',
  'skills.maj.role': 'Résout ce qui bloque la mise à jour sans perdre le travail local.',
  'skills.aucunModele':
    'Aucun modèle IA n’est attribué aux rôles : règle-le dans Settings › Routage.',
  'skills.conversationNonCreee': 'La conversation n’a pas pu être créée.',
  'skills.aria': 'Skills de maintenance',
  'skills.aide': '{role}\n\nEnvoie : {prompt}',
  'skills.ouverture': 'ouverture…',

  // — Onglet Latence (PerfLagPanel)
  'perf.role.principal': 'Processus principal',
  'perf.role.fenetre': 'Fenêtre',
  'perf.canalAbsent': 'canal perf:turnLatency indisponible (moteur non reconstruit ?)',
  'perf.relire': 'Relire le journal',
  'perf.sondeEnCours': 'Sonde en cours…',
  'perf.sonder': 'Sonder le renderer ({secondes} s)',
  'perf.tours': '{n} tours · {source}',
  'perf.gels.titre': 'Gels du process principal',
  'perf.gels.indisponible':
    'Aucun journal de gels ({source}) : le détecteur n’a pas encore tourné sur ce poste. Rien n’est affiché plutôt qu’un zéro rassurant.',
  'perf.gels.vide': 'Aucun blocage au-dessus de {seuil} ms sur la fenêtre observée.',
  'perf.gels.resume': '{gels} gel(s) · pire {pire} ms · {cumul} ms figés au total',
  'perf.gels.nonImputables':
    '+ {n} gel(s) hors de notre boucle ({ms} ms) : le process n’a pas consommé de CPU pendant le blocage — machine saturée ou mise en veille, non imputable à une opération.',
  'perf.col.operation': 'Opération',
  'perf.col.gels': 'gels',
  'perf.col.cumul': 'cumul',
  'perf.col.pire': 'pire',
  'perf.jalons.indisponible':
    'Aucun journal de jalons ({source}) : aucun tour de chat mesuré sur ce poste. Rien n’est affiché plutôt qu’un zéro rassurant.',
  'perf.suspects.aucun': 'Aucun segment au-dessus de {seuil} ms (p95).',
  'perf.suspects': 'Suspects (p95 > {seuil} ms) : {liste}',
  'perf.illisibles': '⚠ {n} ligne(s) illisible(s)',
  'perf.disque.titre': 'Espace disque — {poids}',
  'perf.auMoins': ' (au moins)',
  'perf.col.famille': 'Famille',
  'perf.col.poids': 'Poids',
  'perf.col.fichiers': 'Fichiers',
  'perf.col.menage': 'Ménage au démarrage',
  'perf.menage': '{supprimes} supprimé(s), {liberes} libéré(s)',
  'perf.menage.reste': ' · reste {n}',
  'perf.disque.note':
    'Rien n’est supprimé par cet écran : il MONTRE ce que le ménage du démarrage a déjà fait. Un poids marqué « au moins » a été arrêté par le plafond de comptage — un plancher, pas un total.',
  'perf.memoire.titre': 'Mémoire et processeur — {total} Mo (pic depuis le lancement : {pic} Mo)',
  'perf.col.processus': 'Processus',
  'perf.col.memoire': 'Mémoire',
  'perf.col.processeur': 'Processeur',
  'perf.memoire.note':
    'Relevé du {heure}, un toutes les {secondes} s ({n} depuis le lancement). Mémoire = ensemble de travail de chaque processus.',
  'perf.sonde':
    'Renderer : {ticks} ticks · retard max {retard} ms · {longues} tâche(s) longue(s), pire {pire} ms — {verdict}',
  'perf.sonde.gel': '⚠ gel observé',
  'perf.sonde.fluide': 'fluide',

  // — Tailles en octets (formater-octets)
  'octets.o': '{n} o',
  'octets.ko': '{n} Ko',
  'octets.mo': '{n} Mo',
  'octets.go': '{n} Go'
} as const

export type CleBoardEtMaintenance = keyof typeof TEXTES_FR

export const TEXTES_EN: Record<CleBoardEtMaintenance, string> = {
  'vue.surtitre': 'PROJECT',
  'vue.demande': 'request',
  'vue.demandes': 'requests',
  'vue.prouvee': 'proven',
  'vue.prouvees': 'proven',
  'vue.refusee': 'refused',
  'vue.refusees': 'refused',
  'vue.runBloque': 'blocked run',
  'vue.runsBloques': 'blocked runs',
  'vue.calcul': 'Computing…',
  'vue.actualiser': 'Refresh',
  'vue.erreur': 'The map could not be computed: {erreur}',
  'vue.chargement': 'Computing the map…',
  'vue.sourceInjoignable': 'ticket source unreachable: #1234 links not checked',
  'vue.tasksNonVerifiees': 'tasks not checked: {erreur}',
  'vue.dossier': 'Folder…',
  'vue.dossierAide':
    'Choose a folder (a network share, for instance) where the Board is copied at each refresh, one sticky note per thread with its conversation id',
  'vue.dossierEnregistre': 'Copied to {cible} at {heure} · {n} sticky notes',
  'vue.dossierAttente': 'Copy to {cible} pending…',
  'vue.dossierErreur': 'Could not copy to the folder: {erreur}',
  'vue.dossierOublier': 'Stop copying the Board to this folder',
  'vue.dossierCollegues': 'Colleagues’ sticky notes: {noms}',
  'vue.dossierColleguesErreur': 'Colleagues not read: {erreur}',

  'riviere.aide':
    'wheel on the board or click on a column: the targeted column widens, and its sticky notes grow · wheel up goes back in time to the oldest thread · drag a sticky note to another floor to change its state — kept on this computer until the thread’s next request, never counted as proof',
  'riviere.fenetre.derniers': 'the last {n} days',
  'riviere.fenetre.du': 'from {debut} to {fin}',
  'riviere.aria': 'The river, {fenetre}',
  'riviere.titre': 'The river',
  'riviere.aujourdhui.aide': 'Bring the timeline and the magnifier back to today',
  'riviere.aujourdhui': 'back to today',
  'riviere.personnes': 'Filter by person',
  'riviere.tous': 'All',
  'riviere.pied.filsSur': 'threads over {fenetre}',
  'riviere.pied.fils': 'threads {fenetre}',
  'riviere.pied.plusAnciens': ' · {n} older',
  'riviere.pied.plusRecents': ' · {n} newer',
  'riviere.pied.loupe': ' · wheel or click = magnifier',
  'riviere.pied.molette': ', wheel up = older',
  'riviere.postit.poseALaMain': ' · set by hand',
  'riviere.postit.collegue': ' · {nom}’s thread, read-only',
  'riviere.postit.demandes': '{n} req.',

  'fiche.fermer': 'Close the card',
  'fiche.demandeurInconnu': 'unknown requester',
  'fiche.manuel': 'set by hand · its proof says “{etat}”',
  'fiche.revenir': 'back to the proven state',
  'fiche.plusAnciennes': '{n} older requests',
  'fiche.ouvrir': 'Open the thread',
  'fiche.collegue': '{nom}’s thread, on their computer ({conv}): read-only.',

  'etage.aFaire': 'To do',
  'etage.aFaire.aide': 'set by hand',
  'etage.enCours': 'In progress',
  'etage.enCours.aide': 'a turn is running or a question is waiting',
  'etage.bloque': 'Blocked',
  'etage.bloque.aide': 'check refused, red run or stopped turn',
  'etage.aVerifier': 'To check',
  'etage.aVerifier.aide': 'finished without any check run',
  'etage.fait': 'Done',
  'etage.fait.aide': 'a check came back green',
  'jour.aujourdhui': 'today',
  'jour.aujourdhuiCourt': 'today',

  'statut.prouve': 'proven',
  'statut.refuse': 'refused',
  'statut.enCours': 'in progress',
  'statut.sansPreuve': 'no proof',

  'constat.agentTravaille': 'the agent is working',
  'constat.attenteReponse': 'waiting for the answer',
  'constat.aucuneReponse': 'no answer',
  'constat.tourEnEchec': 'turn failed',
  'constat.tourEnEchecDetail': 'turn failed: {detail}',
  'constat.tourArrete': 'turn stopped before the end',
  'constat.finiSansVerification': 'finished without a check',
  'constat.repartDuResume': 'the agent restarts from this summary',
  'constat.questionTAttend': 'a question is waiting for you',
  'titre.demande': 'Request',
  'titre.compactage': 'Thread compaction',
  'titre.suiteAcceptee': 'Follow-up accepted',
  'titre.suite': 'Next: {suite}',

  'taches.origine.tickets': 'thread opened from the Tickets view for this card',
  'taches.origine.mention': 'number written in the prompt, card read at the source',
  'taches.origine.manuel': 'attached by hand',
  'taches.herite': 'carried over from the previous request (this prompt continues it)',
  'taches.titreNonLu': ' · title not yet read from the source',
  'taches.detacher': 'Detach #{id}',
  'taches.detacher.aide': 'Detach this task from the request',
  'taches.sans': 'no task',
  'taches.lier.aide': 'Link this request to a work item',
  'taches.source': 'Work item source',
  'taches.source.aide': 'Which source to search for this number',
  'taches.numero': 'Work item number',
  'taches.numero.exemple': '1234 or #1234',
  'taches.lecture': 'Reading…',
  'taches.lier': 'Link',
  'commun.annuler': 'Cancel',

  'verif.aide':
    'Sends /check in this thread: a turn replays the proof there. Green → “Done”, red → “Blocked”.',
  'verif.aideALaMain':
    'Sets it to “Done” without proof, kept on this computer until the thread’s next request.',
  'verif.aucunLanceErreur': 'no /check launched: {erreur}',
  'verif.confirmer': 'Confirm checking the row',
  'verif.question.un': 'Run /check in {n} thread? ({n} model turn)',
  'verif.question.plusieurs': 'Run /check in {n} threads? ({n} model turns)',
  'verif.lancer': 'Run',
  'verif.aucunPostit': 'No sticky note shown in the “To check” row',
  'verif.toutAide': 'Sends /check to the {n} threads shown in the “To check” row',
  'verif.envoi': 'Sending…',
  'verif.tout': 'Check all · {n}',
  'verif.court': '▶ check',
  'verif.long': 'Check (/check)',
  'verif.mainCourt': '✓ by hand',
  'verif.mainLong': 'Checked by hand',
  'verif.refus': '/check refused: {raison}',
  'verif.envoiRefuse': 'sending refused',
  'verif.bilan.aucun': 'no /check launched',
  'verif.bilan.un': '/check launched in {n} thread',
  'verif.bilan.plusieurs': '/check launched in {n} threads',
  'verif.bilan.refusUn': '{lance} · {e} refused: {raison}',
  'verif.bilan.refusPlusieurs': '{lance} · {e} refused: {raison}',

  'maint.surtitre': 'UPKEEP',
  'maint.description': 'Runs Autowin’s maintenance skills, and the unit tests of your projects.',
  'maint.canalAbsent': 'tests:projects channel unavailable (engine not rebuilt?)',
  'maint.onglet.suites': 'Unit tests',
  'maint.onglet.latence': 'Latency',
  'maint.filtre': 'Filter (file pattern)',
  'maint.echecsSeuls': 'Failures only',
  'maint.ajouter': '+ Project',
  'maint.execution': 'Running…',
  'maint.lancer': 'Run the suite',
  'maint.enCours': '{projet} — running · {secondes} s',
  'maint.aucunProjet':
    'No project registered. “+ Project” adds any root (Autowin OS or another repository).',
  'maint.echecs': '{n} failure(s)',
  'maint.retirer': 'Remove from the registry',
  'maint.aucuneExecution': 'No run for this project. “Run the suite” produces the report.',
  'maint.nonExecutable': 'Project cannot be run.',
  'maint.passes': 'passed',
  'maint.echecsTotal': 'failures',
  'maint.ignores': '{n} skipped',
  'maint.memorise': '↺ last run remembered (not replayed)',
  'maint.rejouer': 'Rerun this file alone',
  'maint.copier': 'Copy the error',
  'maint.ouvrir': 'Open the file',

  'skills.groupe.analyse': 'Analysis and improvement',
  'skills.groupe.depannage': 'Troubleshooting',
  'skills.maintenance.titre': 'Health report',
  'skills.maintenance.role':
    'Bugs, slowness, lag, unfinished work — repairs at most one proven defect.',
  'skills.gc.titre': 'Data cleanup',
  'skills.gc.role': 'Moves the proven waste of .autowin-data into a dated bin.',
  'skills.curate.titre': 'Sort the knowledge',
  'skills.curate.role': 'Promotes, merges or rejects the Brain candidates waiting.',
  'skills.rendement.titre': 'Costs and slowness',
  'skills.rendement.role':
    'Ranks the conversations by waste and traces back to the cause of the detour.',
  'skills.residus.titre': 'Dead code',
  'skills.residus.role': 'Spots dead files and never-reached branches — suggests, deletes nothing.',
  'skills.glean.titre': 'Harvest the knowledge',
  'skills.glean.role': 'Drops as Brain candidates the facts never kept from the conversations.',
  'skills.kaizen.titre': 'Fix a behaviour',
  'skills.kaizen.role': 'Finds a behaviour defect of the agents and applies the fix at its source.',
  'skills.heal.titre': 'Fix the defects',
  'skills.heal.role':
    'Finds the proven defects of the code (red test, measured slowness) and fixes them one by one.',
  'skills.salvage.titre': 'Unpublished work',
  'skills.salvage.role':
    'Finds the work left aside, sorts it by content, then publishes what it keeps.',
  'skills.gel.titre': 'Freeze investigation',
  'skills.gel.role': 'Traces an app freeze back to its file and line — points, does not fix.',
  'skills.maj.titre': 'Unblock the update',
  'skills.maj.role': 'Resolves what blocks the update without losing local work.',
  'skills.aucunModele': 'No AI model is assigned to the roles: set it in Settings › Routing.',
  'skills.conversationNonCreee': 'The conversation could not be created.',
  'skills.aria': 'Maintenance skills',
  'skills.aide': '{role}\n\nSends: {prompt}',
  'skills.ouverture': 'opening…',

  'perf.role.principal': 'Main process',
  'perf.role.fenetre': 'Window',
  'perf.canalAbsent': 'perf:turnLatency channel unavailable (engine not rebuilt?)',
  'perf.relire': 'Reread the log',
  'perf.sondeEnCours': 'Probing…',
  'perf.sonder': 'Probe the renderer ({secondes} s)',
  'perf.tours': '{n} turns · {source}',
  'perf.gels.titre': 'Main process freezes',
  'perf.gels.indisponible':
    'No freeze log ({source}): the detector has not run on this computer yet. Nothing is shown rather than a reassuring zero.',
  'perf.gels.vide': 'No block above {seuil} ms over the observed window.',
  'perf.gels.resume': '{gels} freeze(s) · worst {pire} ms · {cumul} ms frozen in total',
  'perf.gels.nonImputables':
    '+ {n} freeze(s) outside our loop ({ms} ms): the process used no CPU during the block — machine saturated or asleep, not attributable to an operation.',
  'perf.col.operation': 'Operation',
  'perf.col.gels': 'freezes',
  'perf.col.cumul': 'total',
  'perf.col.pire': 'worst',
  'perf.jalons.indisponible':
    'No milestone log ({source}): no chat turn measured on this computer. Nothing is shown rather than a reassuring zero.',
  'perf.suspects.aucun': 'No segment above {seuil} ms (p95).',
  'perf.suspects': 'Suspects (p95 > {seuil} ms): {liste}',
  'perf.illisibles': '⚠ {n} unreadable line(s)',
  'perf.disque.titre': 'Disk space — {poids}',
  'perf.auMoins': ' (at least)',
  'perf.col.famille': 'Family',
  'perf.col.poids': 'Size',
  'perf.col.fichiers': 'Files',
  'perf.col.menage': 'Startup cleanup',
  'perf.menage': '{supprimes} deleted, {liberes} freed',
  'perf.menage.reste': ' · {n} left',
  'perf.disque.note':
    'Nothing is deleted by this screen: it SHOWS what the startup cleanup already did. A size marked “at least” was stopped by the counting cap — a floor, not a total.',
  'perf.memoire.titre': 'Memory and processor — {total} MB (peak since launch: {pic} MB)',
  'perf.col.processus': 'Process',
  'perf.col.memoire': 'Memory',
  'perf.col.processeur': 'Processor',
  'perf.memoire.note':
    'Reading of {heure}, one every {secondes} s ({n} since launch). Memory = working set of each process.',
  'perf.sonde':
    'Renderer: {ticks} ticks · max delay {retard} ms · {longues} long task(s), worst {pire} ms — {verdict}',
  'perf.sonde.gel': '⚠ freeze observed',
  'perf.sonde.fluide': 'smooth',

  'octets.o': '{n} B',
  'octets.ko': '{n} KB',
  'octets.mo': '{n} MB',
  'octets.go': '{n} GB'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<CleBoardEtMaintenance, string>>> = {}

export const { useTextes: useTextesBoardEtMaintenance, traduire: traduireBoardEtMaintenance } =
  tableDeTextes(TEXTES_FR, TEXTES_EN)
