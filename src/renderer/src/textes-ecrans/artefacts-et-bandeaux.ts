import { tableDeTextes } from '../textes'

/**
 * TEXTES — APERÇUS D’ARTEFACTS ET BANDEAUX DE L’APP (traduction anglaise, conv-1170, 2026-10-27).
 *
 * Écrans couverts : les aperçus d’artefacts (vidéo, HTML, 3D, archive, police, diagramme, pile), Markdown et blocs
 * de données du fil, UpdateBanner, ModelQuestionPopup, et les durées « il y a… » (`depuis.ts`).
 *
 * Une table par groupe d'écrans pour que les lots de traduction, menés en même temps, n'écrivent
 * jamais dans le même fichier. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait
 * foi, mot pour mot celui de l'écran ; l'anglais a les MÊMES clés (le type refuse une clé manquante
 * ou en trop), n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`. Un anglais
 * volontairement identique au français (nom propre, nom de produit) se déclare dans
 * `IDENTIQUES_AU_FRANCAIS`, avec sa raison.
 *
 * RESTENT EN FRANÇAIS, hors de cette table : la référence vidéo insérée dans la saisie
 * (`referenceVideo`, video-pointage.ts) et le prompt `/maj` de « Faire réparer » (UpdateBanner.tsx),
 * que l'AGENT relit ; les mots-clés de statut que Markdown.tsx compare (`VERT`, `BLOQUÉ`…) ; les
 * libellés identiques dans les deux langues (« Image », « PDF », « Source », « −1 s », « Loop
 * Builder », « Chat »…), laissés en dur.
 */
export const TEXTES_FR = {
  // Type d'artefact (artifact-outils.ts) : seuls les types dont l'anglais diffère.
  'artefact.type.vector': 'Vecteur',
  'artefact.type.text': 'Texte',
  'artefact.type.structured-data': 'Données',
  'artefact.type.table': 'Tableau',
  'artefact.type.diagram': 'Diagramme',
  'artefact.type.presentation': 'Présentation',
  'artefact.type.spreadsheet': 'Tableur',
  'artefact.type.video': 'Vidéo',
  'artefact.type.font': 'Police',
  'artefact.type.executable': 'Exécutable',
  'artefact.type.binary': 'Binaire',
  'artefact.genere.image': 'Image générée',
  'artefact.genere.vector': 'Vecteur générée',
  'artefact.poids.octets': '{taille} o',
  'artefact.poids.ko': '{taille} Ko',
  'artefact.poids.mo': '{taille} Mo',

  // ArtifactPreview
  'apercu.cellule': 'cellule',
  'apercu.sortie': 'Sortie {rang}',
  'apercu.agrandir': 'Agrandir {nom}',
  'apercu.apercuDe': 'Aperçu de {nom}',
  'apercu.executionInterdite': 'Exécution interdite · métadonnées uniquement',
  'apercu.binaireNonExecute': 'Binaire non exécuté · métadonnées uniquement',
  'apercu.fichierConserve': 'Fichier conservé sur le disque',
  'apercu.indisponible': 'Aperçu indisponible',
  'apercu.lectureImpossible': 'Lecture de l’artefact impossible',
  'apercu.chargeALApproche': 'Aperçu chargé à l’approche',
  'apercu.chargement': 'Chargement de l’aperçu…',
  'apercu.fichierIntrouvable': '⚠ Fichier introuvable',
  'apercu.afficherFichier': 'Afficher le fichier',

  // ArtifactPile
  'pile.derniereLue': 'la dernière lue',
  'pile.plusRecente': 'la plus récente',
  'pile.autres.une': 'et {nombre} autre image',
  'pile.autres.plusieurs': 'et {nombre} autres images',

  // ArtifactArchivePreview
  'archive.indisponible': 'Contenu d’archive indisponible',
  'archive.rtfIllisible': 'Document RTF illisible',
  'archive.illisible': 'Archive illisible ou format non pris en charge',
  'archive.inspectes': '{nombre} éléments inspectés',

  // ArtifactDiagramPreview
  'diagramme.invalide': 'Diagramme invalide ou syntaxe non prise en charge',
  'diagramme.rendu': 'Rendu du diagramme…',

  // ArtifactFontPreview : la phrase d'essai contient toutes les lettres de SA langue.
  'police.phraseEssai': 'Portez ce vieux whisky au juge blond qui fume.',

  // ArtifactModel3dPreview et artifact-model3d-validation.ts
  'modele3d.illisible': 'Modèle 3D illisible',
  'modele3d.illisibleOuRessources': 'Modèle 3D illisible ou ressources externes manquantes',
  'modele3d.chargement': 'Chargement de la scène 3D…',
  'modele3d.refuse.structure': 'Modèle 3D refusé : structure trop complexe',
  'modele3d.refuse.geometrie': 'Modèle 3D refusé : géométrie hors limites',
  'modele3d.refuse.buffers': 'Modèle 3D refusé : buffers trop volumineux',
  'modele3d.refuse.ressource': 'Modèle 3D refusé : ressource externe',
  'modele3d.refuse.scene': 'Modèle 3D refusé : scène trop complexe',

  // ArtifactVideoPlayer
  'video.nonJointe.pasChargee': 'image non jointe : vidéo pas encore chargée',
  'video.nonJointe.dessin': 'image non jointe : dessin indisponible',
  'video.nonJointe.erreur': 'image non jointe : {erreur}',
  'video.nonJointe.png': 'image non jointe : encodage PNG impossible',
  'video.cadenceInconnue': 'images/s inconnues · {fps} supposé',
  'video.cadence': '{cadence} i/s',
  'video.lecteur': 'Lecteur vidéo image par image — flèches : ±1 image, Maj + flèches : ±1 s',
  'video.reculer': 'Reculer d’une seconde',
  'video.imagePrecedente': 'Image précédente',
  'video.moinsUneImage': '−1 img',
  'video.imageSuivante': 'Image suivante',
  'video.plusUneImage': '+1 img',
  'video.avancer': 'Avancer d’une seconde',
  'video.etat': ' · image {image}{total} · {cadence}',
  'video.pointer': 'Pointer ce moment',
  'video.pointerAide': 'Insère une référence à cette image dans ton message et joint l’image',
  'video.imageEnChargement': 'Image en cours de chargement',

  // SandboxedHtmlPreview
  'html.titre': 'Rendu HTML',
  'html.modes': 'Mode du rendu HTML',
  'html.apercu': 'Aperçu',
  'html.relancer': 'Relancer le rendu',
  'html.relancerAria': 'Relancer le rendu HTML',
  'html.reduireAria': 'Réduire le rendu HTML',
  'html.agrandirAria': 'Agrandir le rendu HTML',
  'html.tropVolumineux': 'Rendu HTML trop volumineux',
  'html.limite': '{taille} caractères. La limite du rendu dans le fil est de {limite} caractères.',
  'html.consulter':
    'Consulte la source ici, ou demande à l’agent de fournir cette page comme artefact',
  'html.voirSource': 'Voir la source',
  'html.agrandi': 'Rendu HTML agrandi',

  // Communs à SandboxedHtmlPreview et Bloc3D
  'commun.reduire': 'Réduire',
  'commun.agrandir': 'Agrandir',

  // Bloc3D
  'scene.erreurInconnue': 'Erreur inconnue',
  'scene.titre': 'Scène 3D',
  'scene.aideScene': 'glisser pour pivoter · molette pour zoomer',
  'scene.aideSource': 'code three.js',
  'scene.modes': 'Affichage du bloc 3D',
  'scene.scene': 'Scène',
  'scene.relancer': 'Relancer la scène',
  'scene.relancerAria': 'Relancer la scène 3D',
  'scene.plantee': 'La scène a planté : {message}',
  'scene.cadre': 'Scène 3D du fil',

  // Markdown
  'markdown.resumeFinal': 'Résumé final du modèle',
  'markdown.htmlIgnore':
    'Rendu HTML ignoré — {taille} caractères, au-delà de la limite de {limite}. Voir la source.',
  'markdown.copier': 'Copier',

  // BlocDonnees
  'donnees.statut.fait': 'fait',
  'donnees.statut.enCours': 'en cours',
  'donnees.statut.aFaire': 'à faire',
  'donnees.statut.echec': 'échec',
  'donnees.recommande': 'Recommandé',

  // depuis.ts
  'depuis.instant': 'à l’instant',

  // UpdateBanner. Les voies et leurs aides reprennent mot pour mot `UPDATE_STRATEGY_LABELS` et
  // `UPDATE_STRATEGY_HINTS` (shared/update-contract.ts), affichés seulement ici :
  // ArtefactsEtBandeaux.langue.test.tsx vérifie que les deux côtés ne divergent pas.
  'maj.voie.fast-forward': 'Mettre à jour',
  'maj.voie.merge': 'Fusionner origin/main',
  'maj.voie.rebase': 'Rebaser sur origin/main',
  'maj.voie.switch-main': 'Basculer sur main',
  'maj.aide.fast-forward': 'Avance ta branche main sur origin/main, sans commit de fusion.',
  'maj.aide.merge': 'Fusionne origin/main dans ta branche courante en conservant ton historique.',
  'maj.aide.rebase':
    'Rejoue tes commits par-dessus origin/main — historique linéaire, hashes réécrits.',
  'maj.aide.switch-main': 'Bascule sur main et l’avance. Ton travail reste intact sur ta branche.',
  'maj.autresFichiers': '… et {nombre} autre(s) fichier(s)',
  'maj.titreConversation': 'Réparer la mise à jour',
  'maj.verificationImpossible': 'Verification des mises a jour impossible.',
  'maj.verificationReessayer': 'Verification des mises a jour impossible : {erreur}. Reessayer',
  'maj.reessayer': 'Reessayer',
  'maj.etatChange':
    'L’état du dépôt a changé : « {voie} » ne s’applique plus. Choisis parmi les voies encore possibles.',
  'maj.echec': 'Échec de la mise à jour.',
  'maj.ailleurs': ' · tu es sur {branche}',
  'maj.travailEnCours':
    ' · ton travail en cours reste en place ; la mise à jour est refusée si elle entre en conflit',
  'maj.detail': '{nombre} commit(s) à récupérer depuis {reference}{ailleurs}{travail}',
  'maj.quiLeCommit': 'Qui a poussé quoi ? — voir le commit à récupérer depuis {reference}',
  'maj.quiLesCommits':
    'Qui a poussé quoi ? — voir les {nombre} commits à récupérer depuis {reference}',
  'maj.enCours': 'Mise à jour en cours',
  'maj.echecReessayer': 'Échec de la mise à jour : {erreur}. Réessayer',
  'maj.miseAJour': 'Mise à jour…',
  'maj.commitsARecuperer': 'Commits à récupérer depuis {reference}',
  'maj.plusAnciens': '… et {nombre} commit(s) plus ancien(s)',
  'maj.autresFacons': 'Autres façons d’intégrer {reference}',
  'maj.faireReparerAria': 'Faire réparer le blocage de mise à jour',
  'maj.faireReparerAide':
    "Ouvre une conversation et pré-remplit un prompt pour que l'agent résolve ce blocage, puis relance la mise à jour",
  'maj.faireReparer': 'Faire réparer',

  // ModelQuestionPopup (« Loop Builder » et « Chat », noms de vues, restent en dur)
  'question.echecEnvoi': "La réponse n'a pas pu être envoyée : {erreur}. Réessaie.",
  'question.enAttente': '{nombre} questions en attente',
  'question.titre': 'Le modèle a besoin de toi',
  'question.reponseLibre': 'Réponse libre',
  'question.placeholder': 'Répondre au modèle…',
  'question.raccourcis': 'Ctrl + Entrée pour envoyer · Échap pour passer',
  'question.passer': 'Passer',
  'question.transmission': 'Transmission…',
  'question.repondre': 'Répondre et reprendre'
} as const

export const TEXTES_EN: Record<keyof typeof TEXTES_FR, string> = {
  'artefact.type.vector': 'Vector',
  'artefact.type.text': 'Text',
  'artefact.type.structured-data': 'Data',
  'artefact.type.table': 'Table',
  'artefact.type.diagram': 'Diagram',
  'artefact.type.presentation': 'Presentation',
  'artefact.type.spreadsheet': 'Spreadsheet',
  'artefact.type.video': 'Video',
  'artefact.type.font': 'Font',
  'artefact.type.executable': 'Executable',
  'artefact.type.binary': 'Binary',
  'artefact.genere.image': 'Generated image',
  'artefact.genere.vector': 'Generated vector',
  'artefact.poids.octets': '{taille} B',
  'artefact.poids.ko': '{taille} KB',
  'artefact.poids.mo': '{taille} MB',

  'apercu.cellule': 'cell',
  'apercu.sortie': 'Output {rang}',
  'apercu.agrandir': 'Enlarge {nom}',
  'apercu.apercuDe': 'Preview of {nom}',
  'apercu.executionInterdite': 'Execution forbidden · metadata only',
  'apercu.binaireNonExecute': 'Binary not executed · metadata only',
  'apercu.fichierConserve': 'File kept on disk',
  'apercu.indisponible': 'Preview unavailable',
  'apercu.lectureImpossible': 'Could not read the artifact',
  'apercu.chargeALApproche': 'Preview loads as you scroll to it',
  'apercu.chargement': 'Loading the preview…',
  'apercu.fichierIntrouvable': '⚠ File not found',
  'apercu.afficherFichier': 'Show the file',

  'pile.derniereLue': 'the last one read',
  'pile.plusRecente': 'the most recent',
  'pile.autres.une': 'and {nombre} other image',
  'pile.autres.plusieurs': 'and {nombre} other images',

  'archive.indisponible': 'Archive content unavailable',
  'archive.rtfIllisible': 'Unreadable RTF document',
  'archive.illisible': 'Unreadable archive or unsupported format',
  'archive.inspectes': '{nombre} items inspected',

  'diagramme.invalide': 'Invalid diagram or unsupported syntax',
  'diagramme.rendu': 'Rendering the diagram…',

  'police.phraseEssai': 'The quick brown fox jumps over the lazy dog.',

  'modele3d.illisible': 'Unreadable 3D model',
  'modele3d.illisibleOuRessources': 'Unreadable 3D model or missing external resources',
  'modele3d.chargement': 'Loading the 3D scene…',
  'modele3d.refuse.structure': '3D model refused: structure too complex',
  'modele3d.refuse.geometrie': '3D model refused: geometry out of bounds',
  'modele3d.refuse.buffers': '3D model refused: buffers too large',
  'modele3d.refuse.ressource': '3D model refused: external resource',
  'modele3d.refuse.scene': '3D model refused: scene too complex',

  'video.nonJointe.pasChargee': 'frame not attached: video not loaded yet',
  'video.nonJointe.dessin': 'frame not attached: drawing unavailable',
  'video.nonJointe.erreur': 'frame not attached: {erreur}',
  'video.nonJointe.png': 'frame not attached: PNG encoding failed',
  'video.cadenceInconnue': 'frame rate unknown · {fps} assumed',
  'video.cadence': '{cadence} fps',
  'video.lecteur': 'Frame-by-frame video player — arrows: ±1 frame, Shift + arrows: ±1 s',
  'video.reculer': 'Back one second',
  'video.imagePrecedente': 'Previous frame',
  'video.moinsUneImage': '−1 frame',
  'video.imageSuivante': 'Next frame',
  'video.plusUneImage': '+1 frame',
  'video.avancer': 'Forward one second',
  'video.etat': ' · frame {image}{total} · {cadence}',
  'video.pointer': 'Mark this moment',
  'video.pointerAide': 'Inserts a reference to this frame in your message and attaches the frame',
  'video.imageEnChargement': 'Frame loading',

  'html.titre': 'HTML render',
  'html.modes': 'HTML render mode',
  'html.apercu': 'Preview',
  'html.relancer': 'Reload the render',
  'html.relancerAria': 'Reload the HTML render',
  'html.reduireAria': 'Shrink the HTML render',
  'html.agrandirAria': 'Enlarge the HTML render',
  'html.tropVolumineux': 'HTML render too large',
  'html.limite': '{taille} characters. The render limit in the thread is {limite} characters.',
  'html.consulter': 'View the source here, or ask the agent to provide this page as an artifact',
  'html.voirSource': 'View the source',
  'html.agrandi': 'Enlarged HTML render',

  'commun.reduire': 'Shrink',
  'commun.agrandir': 'Enlarge',

  'scene.erreurInconnue': 'Unknown error',
  'scene.titre': '3D scene',
  'scene.aideScene': 'drag to rotate · wheel to zoom',
  'scene.aideSource': 'three.js code',
  'scene.modes': '3D block display',
  'scene.scene': 'Scene',
  'scene.relancer': 'Restart the scene',
  'scene.relancerAria': 'Restart the 3D scene',
  'scene.plantee': 'The scene crashed: {message}',
  'scene.cadre': '3D scene in the thread',

  'markdown.resumeFinal': 'Model’s final summary',
  'markdown.htmlIgnore':
    'HTML render skipped — {taille} characters, over the {limite} limit. See the source.',
  'markdown.copier': 'Copy',

  'donnees.statut.fait': 'done',
  'donnees.statut.enCours': 'in progress',
  'donnees.statut.aFaire': 'to do',
  'donnees.statut.echec': 'failed',
  'donnees.recommande': 'Recommended',

  'depuis.instant': 'just now',

  'maj.voie.fast-forward': 'Update',
  'maj.voie.merge': 'Merge origin/main',
  'maj.voie.rebase': 'Rebase onto origin/main',
  'maj.voie.switch-main': 'Switch to main',
  'maj.aide.fast-forward': 'Fast-forwards your main branch to origin/main, with no merge commit.',
  'maj.aide.merge': 'Merges origin/main into your current branch, keeping your history.',
  'maj.aide.rebase':
    'Replays your commits on top of origin/main — linear history, rewritten hashes.',
  'maj.aide.switch-main':
    'Switches to main and fast-forwards it. Your work stays intact on your branch.',
  'maj.autresFichiers': '… and {nombre} more file(s)',
  'maj.titreConversation': 'Repair the update',
  'maj.verificationImpossible': 'Could not check for updates.',
  'maj.verificationReessayer': 'Could not check for updates: {erreur}. Retry',
  'maj.reessayer': 'Retry',
  'maj.etatChange':
    'The repository state changed: “{voie}” no longer applies. Choose among the options still available.',
  'maj.echec': 'Update failed.',
  'maj.ailleurs': ' · you are on {branche}',
  'maj.travailEnCours':
    ' · your work in progress stays in place; the update is refused if it conflicts',
  'maj.detail': '{nombre} commit(s) to fetch from {reference}{ailleurs}{travail}',
  'maj.quiLeCommit': 'Who pushed what? — see the commit to fetch from {reference}',
  'maj.quiLesCommits': 'Who pushed what? — see the {nombre} commits to fetch from {reference}',
  'maj.enCours': 'Update in progress',
  'maj.echecReessayer': 'Update failed: {erreur}. Retry',
  'maj.miseAJour': 'Updating…',
  'maj.commitsARecuperer': 'Commits to fetch from {reference}',
  'maj.plusAnciens': '… and {nombre} older commit(s)',
  'maj.autresFacons': 'Other ways to integrate {reference}',
  'maj.faireReparerAria': 'Have the update blocker repaired',
  'maj.faireReparerAide':
    'Opens a conversation and pre-fills a prompt so the agent resolves this blocker, then restarts the update',
  'maj.faireReparer': 'Get it repaired',

  'question.echecEnvoi': 'The answer could not be sent: {erreur}. Try again.',
  'question.enAttente': '{nombre} questions waiting',
  'question.titre': 'The model needs you',
  'question.reponseLibre': 'Free answer',
  'question.placeholder': 'Answer the model…',
  'question.raccourcis': 'Ctrl + Enter to send · Esc to skip',
  'question.passer': 'Skip',
  'question.transmission': 'Sending…',
  'question.repondre': 'Answer and resume'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {}

/** Une clé de cette table, pour les fonctions qui la reçoivent (états d'erreur, libellés de type). */
export type CleArtefactsEtBandeaux = keyof typeof TEXTES_FR

export const { useTextes: useTextesArtefactsEtBandeaux, traduire: traduireArtefactsEtBandeaux } =
  tableDeTextes(TEXTES_FR, TEXTES_EN)
