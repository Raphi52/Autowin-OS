import { tableDeTextes } from '../textes'

/**
 * TEXTES — ÉCRAN ACCUEIL (traduction anglaise, conv-1170, 2026-10-27).
 *
 * Écrans couverts : HomeView et ses widgets : Jarvis (voix, Whisper local), Interlocuteurs, Enregistrements,
 * Outlook, micros.
 *
 * Une table par groupe d'écrans pour que les lots de traduction, menés en même temps, n'écrivent
 * jamais dans le même fichier. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait
 * foi, mot pour mot celui de l'écran ; l'anglais a les MÊMES clés (le type refuse une clé manquante
 * ou en trop), n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`. Un anglais
 * volontairement identique au français (nom propre, nom de produit) se déclare dans
 * `IDENTIQUES_AU_FRANCAIS`, avec sa raison.
 *
 * RESTENT EN FRANÇAIS, hors de cette table (lot « Accueil », conv-1170) :
 *  - ce que Jarvis PRONONCE (`phraseDeJarvis`, l'essai de voix) : la voix choisie d'office est
 *    française, la reconnaissance écoute en `fr-FR`, et le filtre d'écho compare ce qu'il entend à
 *    la phrase dite — une phrase anglaise passerait ce filtre et repartirait comme un ordre ;
 *  - les erreurs internes du son système (`jarvis-moteur-whisper.ts`) : jamais affichées,
 *    `codeErreurMicro` n'en lit que le `name` ;
 *  - `auteur: 'moi'` d'un message Outlook (`outlook-model.ts`) : une valeur, jamais affichée ;
 *  - les noms propres : « Autowin », « Cyberpunk », « Nier Automata (radar) », le nom de l'assistant.
 */
export const TEXTES_FR = {
  // — Accueil : en-tête, réglages, tuiles (HomeView) —
  'entete.accueil': 'Accueil',
  'reglages.ariaBouton': 'Réglages de l’accueil',
  'reglages.titreBouton':
    "Réglages de l'accueil : fond, widgets affichés, nom de l'assistant, disposition",
  'reglages.ariaPanneau': "Réglages de l'accueil",
  'reglages.fond': 'Fond',
  'reglages.ariaFond': "Fond de l'accueil",
  'reglages.widgets': 'Widgets affichés',
  'reglages.disposition': 'Disposition',
  'reglages.annulerTitre': 'Défaire le dernier déplacement ou redimensionnement',
  'reglages.annuler': 'Annuler',
  'reglages.disperser': 'Disperser',
  'reglages.retablir': 'Rétablir la disposition',
  'reglages.rappelTitre': 'Rappeler comment manipuler les tuiles',
  'reglages.rappel': "Rappeler l'aide",
  'aide.tuiles':
    'Prenez une tuile n’importe où et posez-la : elle reste exactement là où vous la lâchez. Les huit bords la redimensionnent, les flèches aussi (Maj pour la taille).',
  'fond.aucun': 'Aucun',
  'fond.planetes': 'Planètes',
  // Les titres de `HOME_WIDGET_TITLES` (home-layout.ts), recopiés mot pour mot : le test de langue
  // de l'accueil refuse un écart. Celui de Jarvis n'y est pas : c'est le nom choisi.
  'tuile.mails': 'Interlocuteurs',
  'tuile.agenda': 'Agenda',
  'tuile.routines': 'Départs des routines',
  'tuile.notifications': 'Remontées des agents',
  'tuile.conversations': 'Conversations',
  'tuile.enregistrements': 'Transcription',
  'tuile.aria': '{titre} — flèches pour déplacer, Maj+flèches pour redimensionner',
  'tuile.remontees': '{n} remontée(s) à lire',
  'tuile.enAttente': '{n} conversation(s) en attente de reprise',
  'outlook.luA': 'Outlook lu à {heure}',
  'outlook.relire': 'Relire Outlook maintenant',
  'outlook.actualiser': 'Actualiser',
  'outlook.nonLus':
    '{personnes} non lu(s) de personnes — {total} au total avec les envois automatiques',
  'outlook.passerelleAbsente': "la passerelle Outlook n'est pas disponible",
  'outlook.ouvrirAbsent': 'Cette version ne sait pas encore ouvrir un élément dans Outlook.',
  'outlook.ouvrirEchec': "Outlook n'a pas pu ouvrir cet élément.",
  'outlook.repondreAbsent': 'Cette version ne sait pas encore répondre depuis Outlook.',
  'outlook.nouvelleAbsente':
    'Cette version ne sait pas encore ouvrir une conversation depuis Outlook.',
  'outlook.marquerAbsent': 'Cette version ne sait pas encore marquer un message comme lu.',
  'outlook.chargement': 'Lecture d’Outlook…',
  'outlook.injoignable': 'Outlook injoignable : {cause}',
  'taches.injoignable': 'Task Manager injoignable : {erreur}',
  'taches.chargement': 'Lecture du Task Manager…',
  'routines.aucune': 'Aucune routine horaire n’est programmée.',
  'routines.creer': 'En créer une',
  'routines.desactivee': 'désactivée',
  'remontees.rien': 'Rien à signaler. Vos agents n’ont rien remonté.',
  'remontees.voirWatchdog': 'Voir le Watchdog',
  'remontees.ouvrirTitre': 'Ouvrir le Watchdog — {origine}',
  'remontees.ratee': 'occurrence ratée',
  'remontees.echec': 'échec',
  'remontees.acquitterTitre': 'Acquitter : l’alerte sort du compteur',
  'remontees.acquitter': 'Acquitter',
  'conversations.aucune':
    'Aucune conversation en attente. Les fenêtres dont le tour vient de finir apparaîtront ici.',
  'conversations.ouvrirTitre': 'Ouvrir cette conversation dans le chat',
  'conversations.sansTitre': 'Sans titre',
  'agenda.aucun': 'Aucun rendez-vous à venir dans votre agenda.',
  'agenda.ouvrirTitre': 'Ouvrir le rendez-vous dans Outlook',
  'agenda.prochain': 'Prochain',
  'agenda.aujourdhui': 'Aujourd’hui',
  'agenda.semaine': 'Cette semaine',
  'commun.ouverture': 'Ouverture…',

  // — Délai avant un départ de routine (home-widgets-model.ts) —
  'delai.enRetard': 'en retard',
  'delai.imminent': 'imminent',
  'delai.minutes': 'dans {minutes} min',
  'delai.heures': 'dans {heures} h',
  'delai.heuresMinutes': 'dans {heures} h {minutes} min',
  'delai.demain': 'demain',
  'delai.jours': 'dans {jours} jours',

  // — Outlook, côté décisions (outlook-model.ts) —
  'outlook.sansObjet': '(sans objet)',
  'outlook.sansTitre': '(sans titre)',
  'outlook.journee': 'journée',
  'outlook.hier': 'hier',
  'outlook.reponseIllisible': 'réponse illisible de la passerelle Outlook',
  'outlook.causeInconnue': 'cause inconnue',
  'outlook.reponseIncomplete': 'réponse incomplète de la passerelle Outlook',

  // — Widget Interlocuteurs (InterlocuteursWidget, interlocuteurs-pieces.ts) —
  'inter.introuvable': 'Interlocuteur introuvable',
  'inter.contactDisparu':
    'Ce contact n’est plus dans les messages lus. Actualisez, ou revenez à la liste.',
  'inter.nouvelleConversation': 'Nouvelle conversation',
  'inter.filIntrouvable': 'Fil introuvable',
  'inter.filDisparu': 'Ce fil n’apparaît plus dans les messages lus.',
  'inter.retourTitre': 'Revenir à l’étape précédente',
  'inter.precedent': '‹ Précédent',
  'inter.boiteVide': 'Aucun message dans votre boîte de réception.',
  'inter.nouveauUn': 'conversation avec du nouveau',
  'inter.nouveauPlusieurs': 'conversations avec du nouveau',
  'inter.aucunePersonne':
    'Aucun message d’une personne à qui vous avez déjà écrit. Ci-dessous, les envois automatiques.',
  'inter.envoisAuto': 'Envois automatiques',
  'inter.voirFils': 'Voir mes fils avec {qui}',
  'inter.alerteTitre': 'Popup + son à chaque nouveau message de {nom}',
  'inter.alerte': 'Alerte',
  'inter.nouveauTitre': 'Écrire un nouveau message à {adresse}',
  'inter.nouveauBouton': '+ Nouvelle conversation par mail',
  'inter.sansAdresse':
    'Aucune adresse connue pour ce contact : impossible de lui écrire un nouveau message.',
  'inter.aucunFil': 'Aucun fil de discussion avec cette personne.',
  'inter.messagesUn': '{n} message',
  'inter.messagesPlusieurs': '{n} messages',
  'inter.marquerEchec': "Outlook n'a pas pu marquer ces messages comme lus.",
  'inter.reponseEchec': "Outlook n'a pas pu envoyer cette réponse.",
  'inter.messageEchec': "Outlook n'a pas pu envoyer ce message.",
  'inter.deposez': 'Déposez vos fichiers',
  'inter.pieceReponse': 'Ils partiront en pièce jointe de cette réponse',
  'inter.pieceMessage': 'Ils partiront en pièce jointe de ce message',
  'inter.restentNonLus': 'Ces messages restent non lus dans Outlook : {erreur}',
  'inter.queVosEnvois':
    'Ce fil ne contient que vos envois : il n’y a pas de message auquel répondre.',
  'inter.repondreA': 'Répondre à {nom}…',
  'inter.retirer': 'Retirer {nom}',
  'inter.glissez': 'Glissez un fichier ici pour le joindre ({max} max, 10 Mo chacun).',
  'inter.ouvrirFilTitre': 'Ouvrir ce fil dans Outlook',
  'inter.ouvrirDansOutlook': 'Ouvrir dans Outlook',
  'inter.reponseEnvoyee':
    'Réponse envoyée. Elle apparaîtra dans le fil à la prochaine actualisation.',
  'inter.envoyerParOutlook': 'Envoyer par Outlook',
  'inter.confirmerEnvoi': 'Confirmer l’envoi à {nom}',
  'inter.annuler': 'Annuler',
  'inter.nouveauMessageA': 'Nouveau message à {adresse}',
  'inter.objet': 'Objet',
  'inter.premierMessage': 'Premier message à {nom}…',
  'inter.messageEnvoye':
    'Message envoyé. La conversation apparaîtra dans la liste à la prochaine actualisation.',
  'pieces.tropNombreuses': 'Pas plus de {max} pièces jointes par message.',
  'pieces.tropGrosse': '{nom} dépasse la limite de 10 Mo.',
  'pieces.totalTropGros': 'Le total des pièces jointes dépasse 20 Mo.',
  'pieces.lectureImpossible': 'Lecture impossible : {cause}',

  // — Les voix d'un transcript, et « Moi » d'une bulle de message (enregistrements.ts) —
  'commun.moi': 'Moi',
  'voix.interlocuteur': 'Interlocuteur',
  'voix.ligne': '{voix} : {texte}',

  // — Micro et audio, communs à Jarvis et aux Enregistrements —
  'micro.numero': 'Micro {n}',
  'micro.coupe': 'Micro coupé',
  'audio.parametres': 'Paramètres audio',
  'audio.micro': 'Micro',
  'audio.microDefaut': 'Micro par défaut du système',
  'verdict.silence': 'Aucun son détecté — vérifiez le micro ou la sensibilité',
  'verdict.faible': 'Son faible — parlez plus près du micro',
  'verdict.bon': 'Micro OK — je vous entends',
  'verdict.sature': 'Son saturé — éloignez-vous du micro',
  'moteur.network':
    'Le moteur de reconnaissance de Chromium est injoignable dans cette fenêtre (erreur « network ») : installez l’écoute hors ligne ci-dessous.',
  'moteur.refuse':
    'Micro refusé pour Autowin OS : autorisez le microphone dans Windows (Confidentialité → Microphone), puis réessayez.',
  'moteur.absent':
    'Aucun micro disponible sur cette machine : branchez un micro ou un casque, puis réessayez. En session à distance, le micro n’arrive que si la redirection audio est activée côté client.',
  'moteur.occupe':
    'Le micro est déjà pris par une autre application (visio, enregistreur) : libérez-le, puis réessayez.',
  'moteur.introuvable':
    'Le micro choisi dans « Paramètres audio » n’existe plus : choisissez-en un autre, puis réessayez.',
  'moteur.indisponible':
    'Micro indisponible : l’entrée audio n’a pas pu s’ouvrir. Vérifiez le micro choisi dans « Paramètres audio », puis réessayez.',
  'moteur.transcription':
    'La reconnaissance locale n’a pas pu transcrire : réinstallez l’écoute hors ligne.',
  'moteur.interrompue': 'Reconnaissance vocale interrompue : {code}',

  // — Widget Jarvis (JarvisWidget) —
  'jarvis.passerelleConversations': 'Passerelle des conversations indisponible',
  'jarvis.aucuneConversation': 'Aucune conversation {nom}',
  'jarvis.passerellePilote': 'Passerelle du pilote indisponible : ordre non execute',
  'jarvis.ordreNonExecute': 'Ordre non execute',
  'jarvis.aucunMoteur':
    'Aucun moteur de reconnaissance disponible : installez la reconnaissance hors ligne ci-dessous.',
  'jarvis.reglagesWindows': 'Les réglages Windows ne s’ouvrent que sous Windows.',
  'jarvis.etatHorsLigne': 'hors ligne',
  'jarvis.etatEnregistre': 'enregistre',
  'jarvis.etatEcoute': 'a l’ecoute',
  'jarvis.etatVeille': 'en veille',
  'jarvis.couper': '● Écoute en cours — couper',
  'jarvis.activer': 'Activer l’écoute',
  'jarvis.microVerrouille': 'Micro verrouillé — déverrouiller',
  'jarvis.verrouillerMicro': 'Verrouiller le micro',
  'jarvis.voixCoupee': 'Voix coupée — la rétablir',
  'jarvis.couperVoix': 'Couper la voix',
  'jarvis.enregistrement': '⏺ Enregistrement du transcript — {nom} ne répond pas',
  'jarvis.jeVousEcoute': '🔊 Je vous écoute — dites votre demande',
  'jarvis.dites': 'Dites « {nom} » : un bip vous répondra',
  'jarvis.autoriserMicro': 'Autoriser le micro dans Windows',
  'jarvis.reessayerMicro': 'Réessayer le micro',
  'jarvis.installationPourcent': 'Installation {etape} — {pourcent} %',
  'jarvis.installationAttente': 'Installation {etape}…',
  'jarvis.installerWhisper': 'Installer l’écoute hors ligne (≈ {mo} Mo, une seule fois)',
  'jarvis.whisperAide':
    'Reconnaissance locale (whisper.cpp) : téléchargée une fois, puis plus aucun réseau.',
  'jarvis.whisperPret': 'Écoute locale prête — hors ligne',
  'jarvis.installationVoixPourcent': 'Installation de la voix {etape} — {pourcent} %',
  'jarvis.installationVoixAttente': 'Installation de la voix {etape}…',
  'jarvis.installerPiper': 'Installer une vraie voix française (≈ {mo} Mo, une seule fois)',
  'jarvis.piperAide':
    'Voix neuronale (Piper) : téléchargée une fois, puis plus aucun réseau. Sans elle, Jarvis garde la voix de Windows.',
  'jarvis.piperPret': 'Voix française installée — hors ligne',
  'jarvis.microVerrouilleRien': 'Micro verrouillé — rien n’est écouté',
  'jarvis.reglagesAssistant': 'Réglages de l’assistant',
  'jarvis.sonNom': 'Son nom',
  'jarvis.saVoix': 'Sa voix',
  'jarvis.voixAuto': 'Voix automatique (français si disponible)',
  'jarvis.voixPiper': 'Voix française neuronale (Piper) — hors ligne',
  'jarvis.aucuneVoix':
    'Aucune voix installée sur ce poste : l’assistant écoute mais ne répondra pas à voix haute.',
  'jarvis.debit': 'Débit — {valeur}×',
  'jarvis.hauteur': 'Hauteur — {valeur}×',
  'jarvis.essaiTitre': 'Prononcer une phrase avec la voix et les réglages choisis',
  'jarvis.essai': 'Écouter un essai',
  'jarvis.seuil': 'Seuil de déclenchement',
  'jarvis.changementMicro':
    'Un changement de micro s’applique à la prochaine activation de l’écoute.',
  'jarvis.envoiA': 'Envoi à {nom} : « {texte} »',

  // — Widget Enregistrements / Transcription (EnregistrementsWidget, enregistrements.ts) —
  'enreg.ecritureImpossible': 'Écriture impossible : {cause} — enregistrement arrêté',
  'enreg.sonInterrompu': 'Le son du système s’est interrompu ({code}) — enregistrement arrêté',
  'enreg.passerelle': 'Passerelle d’enregistrement indisponible',
  'enreg.appelExigeWhisper':
    'Le mode conversation exige la reconnaissance hors ligne : installez-la depuis le widget Jarvis.',
  'enreg.aucunMoteur':
    'Aucun moteur de reconnaissance disponible : installez l’écoute hors ligne depuis le widget Jarvis.',
  'enreg.sonNonCapte': 'Le son du système n’a pas pu être capté — enregistrement arrêté',
  'enreg.aucunMoteurArret': 'Aucun moteur de reconnaissance disponible — enregistrement arrêté',
  'enreg.arreter': '■ Arrêter',
  'enreg.enregistrer': '⏺ Enregistrer',
  'enreg.etatUne': '{duree} · {n} phrase · {taille}',
  'enreg.etatPlusieurs': '{duree} · {n} phrases · {taille}',
  'enreg.microCoupe': 'Micro coupé — rien n’est écrit',
  'enreg.mode': 'Mode',
  'enreg.modeDictee': 'Dictée — ce que je dis',
  'enreg.modeAppel': 'Conversation — ce que je dis et ce que j’entends',
  'enreg.modeFichier': 'Fichier audio — isoler les interlocuteurs d’un mp3',
  'enreg.pret':
    'Prêt : chaque passage sera attribué à « Locuteur 1 », « Locuteur 2 »… à l’oreille.',
  'enreg.jetonManquant':
    'Brique posée, mais il manque le jeton Hugging Face (gratuit) : sans lui, le modèle ne se télécharge pas. Renseignez HF_TOKEN dans vos variables d’environnement.',
  'enreg.pyannote':
    'Séparer les voix d’un seul fichier exige pyannote (≈ {mo} Mo, une seule fois).',
  'enreg.pythonAbsent':
    'Python est introuvable sur ce poste : la séparation des voix ne peut pas être posée ici.',
  'enreg.installationEnCours': 'Installation en cours… (plusieurs minutes)',
  'enreg.installerDiarisation': 'Installer la séparation des voix (≈ {mo} Mo, une seule fois)',
  'enreg.echec': 'Échec : {erreur}',
  'enreg.appelAide':
    'Le son de Teams, Meet ou du navigateur est transcrit à part, sous « Interlocuteur ». Windows uniquement.',
  'enreg.indisponible':
    'Indisponible : ce mode exige la reconnaissance hors ligne, à installer depuis le widget Jarvis.',
  'enreg.changementMicro': 'Un changement de micro s’applique au prochain enregistrement.',
  'enreg.ecritureDans': 'Écriture au fil de l’eau dans {fichier}',
  'enreg.derniers': 'Derniers enregistrements',
  'enreg.aucun': 'Aucun pour l’instant — appuyez sur Enregistrer.',
  'enreg.montrer': 'Montrer {chemin} dans l’explorateur',
  'taille.octets': '{n} o',
  'taille.ko': '{n} ko',
  'taille.mo': '{n} Mo',
  'quand.instant': 'à l’instant',
  'quand.minutes': 'il y a {n} min',
  'quand.aujourdhui': 'aujourd’hui {heure}',
  'titre.enregistrement': '{jour}/{mois}/{annee} à {heure}:{minute}'
} as const

/** Une clé de la table de l'accueil, pour les modules hors React (`traduireAccueil`). */
export type CleAccueil = keyof typeof TEXTES_FR

export const TEXTES_EN: Record<keyof typeof TEXTES_FR, string> = {
  'entete.accueil': 'Home',
  'reglages.ariaBouton': 'Home settings',
  'reglages.titreBouton': 'Home settings: background, widgets shown, assistant name, layout',
  'reglages.ariaPanneau': 'Home settings',
  'reglages.fond': 'Background',
  'reglages.ariaFond': 'Home background',
  'reglages.widgets': 'Widgets shown',
  'reglages.disposition': 'Layout',
  'reglages.annulerTitre': 'Undo the last move or resize',
  'reglages.annuler': 'Undo',
  'reglages.disperser': 'Scatter',
  'reglages.retablir': 'Reset the layout',
  'reglages.rappelTitre': 'Show again how to handle the tiles',
  'reglages.rappel': 'Show the help again',
  'aide.tuiles':
    'Pick up a tile anywhere and put it down: it stays exactly where you release it. The eight edges resize it, and so do the arrow keys (Shift for the size).',
  'fond.aucun': 'None',
  'fond.planetes': 'Planets',
  'tuile.mails': 'Contacts',
  'tuile.agenda': 'Calendar',
  'tuile.routines': 'Upcoming routine runs',
  'tuile.notifications': 'Agent reports',
  'tuile.conversations': 'Conversations',
  'tuile.enregistrements': 'Transcription',
  'tuile.aria': '{titre} — arrows to move, Shift+arrows to resize',
  'tuile.remontees': '{n} report(s) to read',
  'tuile.enAttente': '{n} conversation(s) waiting to be resumed',
  'outlook.luA': 'Outlook read at {heure}',
  'outlook.relire': 'Read Outlook again now',
  'outlook.actualiser': 'Refresh',
  'outlook.nonLus': '{personnes} unread from people — {total} in total with automatic senders',
  'outlook.passerelleAbsente': 'the Outlook gateway is not available',
  'outlook.ouvrirAbsent': 'This version cannot open an item in Outlook yet.',
  'outlook.ouvrirEchec': 'Outlook could not open this item.',
  'outlook.repondreAbsent': 'This version cannot reply from Outlook yet.',
  'outlook.nouvelleAbsente': 'This version cannot start a conversation from Outlook yet.',
  'outlook.marquerAbsent': 'This version cannot mark a message as read yet.',
  'outlook.chargement': 'Reading Outlook…',
  'outlook.injoignable': 'Outlook unreachable: {cause}',
  'taches.injoignable': 'Task Manager unreachable: {erreur}',
  'taches.chargement': 'Reading the Task Manager…',
  'routines.aucune': 'No timed routine is scheduled.',
  'routines.creer': 'Create one',
  'routines.desactivee': 'turned off',
  'remontees.rien': 'Nothing to report. Your agents have raised nothing.',
  'remontees.voirWatchdog': 'Open the Watchdog',
  'remontees.ouvrirTitre': 'Open the Watchdog — {origine}',
  'remontees.ratee': 'missed run',
  'remontees.echec': 'failure',
  'remontees.acquitterTitre': 'Acknowledge: the alert leaves the counter',
  'remontees.acquitter': 'Acknowledge',
  'conversations.aucune':
    'No conversation waiting. Windows whose turn has just finished will appear here.',
  'conversations.ouvrirTitre': 'Open this conversation in the chat',
  'conversations.sansTitre': 'Untitled',
  'agenda.aucun': 'No upcoming appointment in your calendar.',
  'agenda.ouvrirTitre': 'Open the appointment in Outlook',
  'agenda.prochain': 'Next',
  'agenda.aujourdhui': 'Today',
  'agenda.semaine': 'This week',
  'commun.ouverture': 'Opening…',

  'delai.enRetard': 'late',
  'delai.imminent': 'about to start',
  'delai.minutes': 'in {minutes} min',
  'delai.heures': 'in {heures} h',
  'delai.heuresMinutes': 'in {heures} h {minutes} min',
  'delai.demain': 'tomorrow',
  'delai.jours': 'in {jours} days',

  'outlook.sansObjet': '(no subject)',
  'outlook.sansTitre': '(untitled)',
  'outlook.journee': 'all day',
  'outlook.hier': 'yesterday',
  'outlook.reponseIllisible': 'unreadable answer from the Outlook gateway',
  'outlook.causeInconnue': 'unknown cause',
  'outlook.reponseIncomplete': 'incomplete answer from the Outlook gateway',

  'inter.introuvable': 'Contact not found',
  'inter.contactDisparu':
    'This contact is no longer in the messages read. Refresh, or go back to the list.',
  'inter.nouvelleConversation': 'New conversation',
  'inter.filIntrouvable': 'Thread not found',
  'inter.filDisparu': 'This thread no longer appears in the messages read.',
  'inter.retourTitre': 'Go back to the previous step',
  'inter.precedent': '‹ Previous',
  'inter.boiteVide': 'No message in your inbox.',
  'inter.nouveauUn': 'conversation with new messages',
  'inter.nouveauPlusieurs': 'conversations with new messages',
  'inter.aucunePersonne':
    'No message from a person you have already written to. Below, the automatic senders.',
  'inter.envoisAuto': 'Automatic senders',
  'inter.voirFils': 'See my threads with {qui}',
  'inter.alerteTitre': 'Popup + sound for each new message from {nom}',
  'inter.alerte': 'Alert',
  'inter.nouveauTitre': 'Write a new message to {adresse}',
  'inter.nouveauBouton': '+ New email conversation',
  'inter.sansAdresse': 'No known address for this contact: no new message can be written to them.',
  'inter.aucunFil': 'No discussion thread with this person.',
  'inter.messagesUn': '{n} message',
  'inter.messagesPlusieurs': '{n} messages',
  'inter.marquerEchec': 'Outlook could not mark these messages as read.',
  'inter.reponseEchec': 'Outlook could not send this reply.',
  'inter.messageEchec': 'Outlook could not send this message.',
  'inter.deposez': 'Drop your files',
  'inter.pieceReponse': 'They will be attached to this reply',
  'inter.pieceMessage': 'They will be attached to this message',
  'inter.restentNonLus': 'These messages stay unread in Outlook: {erreur}',
  'inter.queVosEnvois':
    'This thread only holds messages you sent: there is no message to reply to.',
  'inter.repondreA': 'Reply to {nom}…',
  'inter.retirer': 'Remove {nom}',
  'inter.glissez': 'Drag a file here to attach it ({max} max, 10 MB each).',
  'inter.ouvrirFilTitre': 'Open this thread in Outlook',
  'inter.ouvrirDansOutlook': 'Open in Outlook',
  'inter.reponseEnvoyee': 'Reply sent. It will appear in the thread at the next refresh.',
  'inter.envoyerParOutlook': 'Send with Outlook',
  'inter.confirmerEnvoi': 'Confirm sending to {nom}',
  'inter.annuler': 'Cancel',
  'inter.nouveauMessageA': 'New message to {adresse}',
  'inter.objet': 'Subject',
  'inter.premierMessage': 'First message to {nom}…',
  'inter.messageEnvoye':
    'Message sent. The conversation will appear in the list at the next refresh.',
  'pieces.tropNombreuses': 'No more than {max} attachments per message.',
  'pieces.tropGrosse': '{nom} exceeds the 10 MB limit.',
  'pieces.totalTropGros': 'The attachments together exceed 20 MB.',
  'pieces.lectureImpossible': 'Could not read: {cause}',

  'commun.moi': 'Me',
  'voix.interlocuteur': 'Other speaker',
  'voix.ligne': '{voix}: {texte}',

  'micro.numero': 'Microphone {n}',
  'micro.coupe': 'Microphone off',
  'audio.parametres': 'Audio settings',
  'audio.micro': 'Microphone',
  'audio.microDefaut': 'System default microphone',
  'verdict.silence': 'No sound detected — check the microphone or the sensitivity',
  'verdict.faible': 'Weak sound — speak closer to the microphone',
  'verdict.bon': 'Microphone OK — I can hear you',
  'verdict.sature': 'Saturated sound — move away from the microphone',
  'moteur.network':
    'Chromium’s recognition engine is unreachable in this window (“network” error): install offline listening below.',
  'moteur.refuse':
    'Microphone refused for Autowin OS: allow the microphone in Windows (Privacy → Microphone), then try again.',
  'moteur.absent':
    'No microphone available on this machine: plug in a microphone or a headset, then try again. In a remote session, the microphone only comes through if audio redirection is enabled on the client side.',
  'moteur.occupe':
    'The microphone is already used by another application (video call, recorder): free it, then try again.',
  'moteur.introuvable':
    'The microphone chosen in “Audio settings” no longer exists: choose another one, then try again.',
  'moteur.indisponible':
    'Microphone unavailable: the audio input could not open. Check the microphone chosen in “Audio settings”, then try again.',
  'moteur.transcription': 'Local recognition could not transcribe: reinstall offline listening.',
  'moteur.interrompue': 'Speech recognition interrupted: {code}',

  'jarvis.passerelleConversations': 'Conversation gateway unavailable',
  'jarvis.aucuneConversation': 'No {nom} conversation',
  'jarvis.passerellePilote': 'Pilot gateway unavailable: order not carried out',
  'jarvis.ordreNonExecute': 'Order not carried out',
  'jarvis.aucunMoteur': 'No recognition engine available: install offline recognition below.',
  'jarvis.reglagesWindows': 'Windows settings only open on Windows.',
  'jarvis.etatHorsLigne': 'offline',
  'jarvis.etatEnregistre': 'recording',
  'jarvis.etatEcoute': 'listening',
  'jarvis.etatVeille': 'standby',
  'jarvis.couper': '● Listening — turn off',
  'jarvis.activer': 'Start listening',
  'jarvis.microVerrouille': 'Microphone locked — unlock',
  'jarvis.verrouillerMicro': 'Lock the microphone',
  'jarvis.voixCoupee': 'Voice muted — restore it',
  'jarvis.couperVoix': 'Mute the voice',
  'jarvis.enregistrement': '⏺ Recording the transcript — {nom} does not answer',
  'jarvis.jeVousEcoute': '🔊 I’m listening — say your request',
  'jarvis.dites': 'Say “{nom}”: a beep will answer you',
  'jarvis.autoriserMicro': 'Allow the microphone in Windows',
  'jarvis.reessayerMicro': 'Retry the microphone',
  'jarvis.installationPourcent': 'Installing {etape} — {pourcent}%',
  'jarvis.installationAttente': 'Installing {etape}…',
  'jarvis.installerWhisper': 'Install offline listening (≈ {mo} MB, one time only)',
  'jarvis.whisperAide': 'Local recognition (whisper.cpp): downloaded once, then no more network.',
  'jarvis.whisperPret': 'Local listening ready — offline',
  'jarvis.installationVoixPourcent': 'Installing the voice {etape} — {pourcent}%',
  'jarvis.installationVoixAttente': 'Installing the voice {etape}…',
  'jarvis.installerPiper': 'Install a real French voice (≈ {mo} MB, one time only)',
  'jarvis.piperAide':
    'Neural voice (Piper): downloaded once, then no more network. Without it, Jarvis keeps the Windows voice.',
  'jarvis.piperPret': 'French voice installed — offline',
  'jarvis.microVerrouilleRien': 'Microphone locked — nothing is heard',
  'jarvis.reglagesAssistant': 'Assistant settings',
  'jarvis.sonNom': 'Its name',
  'jarvis.saVoix': 'Its voice',
  'jarvis.voixAuto': 'Automatic voice (French if available)',
  'jarvis.voixPiper': 'Neural French voice (Piper) — offline',
  'jarvis.aucuneVoix':
    'No voice installed on this computer: the assistant listens but will not answer out loud.',
  'jarvis.debit': 'Rate — {valeur}×',
  'jarvis.hauteur': 'Pitch — {valeur}×',
  'jarvis.essaiTitre': 'Speak a sentence with the chosen voice and settings',
  'jarvis.essai': 'Play a sample',
  'jarvis.seuil': 'Trigger threshold',
  'jarvis.changementMicro': 'A microphone change applies the next time listening is turned on.',
  'jarvis.envoiA': 'Sending to {nom}: “{texte}”',

  'enreg.ecritureImpossible': 'Cannot write: {cause} — recording stopped',
  'enreg.sonInterrompu': 'The system sound was interrupted ({code}) — recording stopped',
  'enreg.passerelle': 'Recording gateway unavailable',
  'enreg.appelExigeWhisper':
    'Conversation mode needs offline recognition: install it from the Jarvis widget.',
  'enreg.aucunMoteur':
    'No recognition engine available: install offline listening from the Jarvis widget.',
  'enreg.sonNonCapte': 'The system sound could not be captured — recording stopped',
  'enreg.aucunMoteurArret': 'No recognition engine available — recording stopped',
  'enreg.arreter': '■ Stop',
  'enreg.enregistrer': '⏺ Record',
  'enreg.etatUne': '{duree} · {n} sentence · {taille}',
  'enreg.etatPlusieurs': '{duree} · {n} sentences · {taille}',
  'enreg.microCoupe': 'Microphone off — nothing is written',
  'enreg.mode': 'Mode',
  'enreg.modeDictee': 'Dictation — what I say',
  'enreg.modeAppel': 'Conversation — what I say and what I hear',
  'enreg.modeFichier': 'Audio file — separate the speakers of an mp3',
  'enreg.pret': 'Ready: each passage will be assigned to “Speaker 1”, “Speaker 2”… by ear.',
  'enreg.jetonManquant':
    'Component installed, but the Hugging Face token (free) is missing: without it, the model does not download. Set HF_TOKEN in your environment variables.',
  'enreg.pyannote':
    'Separating the voices of a single file needs pyannote (≈ {mo} MB, one time only).',
  'enreg.pythonAbsent':
    'Python was not found on this computer: voice separation cannot be installed here.',
  'enreg.installationEnCours': 'Installing… (several minutes)',
  'enreg.installerDiarisation': 'Install voice separation (≈ {mo} MB, one time only)',
  'enreg.echec': 'Failed: {erreur}',
  'enreg.appelAide':
    'Sound from Teams, Meet or the browser is transcribed separately, under “Other speaker”. Windows only.',
  'enreg.indisponible':
    'Unavailable: this mode needs offline recognition, to install from the Jarvis widget.',
  'enreg.changementMicro': 'A microphone change applies to the next recording.',
  'enreg.ecritureDans': 'Writing as it goes to {fichier}',
  'enreg.derniers': 'Latest recordings',
  'enreg.aucun': 'None yet — press Record.',
  'enreg.montrer': 'Show {chemin} in the file explorer',
  'taille.octets': '{n} B',
  'taille.ko': '{n} kB',
  'taille.mo': '{n} MB',
  'quand.instant': 'just now',
  'quand.minutes': '{n} min ago',
  'quand.aujourdhui': 'today {heure}',
  'titre.enregistrement': '{jour}/{mois}/{annee} at {heure}:{minute}'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {
  'tuile.conversations': 'le même mot en anglais',
  'tuile.enregistrements': 'le même mot en anglais',
  'inter.messagesUn': 'le même mot en anglais',
  'inter.messagesPlusieurs': 'le même mot en anglais',
  'enreg.mode': 'le même mot en anglais'
}

export const { useTextes: useTextesAccueil, traduire: traduireAccueil } = tableDeTextes(
  TEXTES_FR,
  TEXTES_EN
)
