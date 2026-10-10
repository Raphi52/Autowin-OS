'use strict'
/**
 * FILET ELECTRON DES AGENTS — chargé par `NODE_OPTIONS=--require` dans TOUS les processus qu'un agent
 * Autowin lance (posé par `envFiletElectronAgent`, src/main/providers/claude.ts). Conv-149, 2026-10-10.
 *
 * Cause mesurée : un agent lançait depuis bash un banc Electron en fenêtre cachée (`show: false`).
 * Le script avait une faute de syntaxe : Electron a ouvert SUR L'ÉCRAN DE L'UTILISATEUR la boîte
 * « A JavaScript error occurred in the main process », et le banc est resté bloqué dessus 150 s.
 * La redirection vers le bureau caché (mods/autowin/hooks/logique.mjs) ne pouvait pas le rattraper :
 * elle ne réécrit qu'une commande SIMPLE d'un programme graphique connu, et un banc sans fenêtre n'a
 * rien à faire dans hdesk-lancer.ps1 (il attend une fenêtre et ne rend pas la sortie du programme).
 *
 * Electron n'ouvre cette boîte que si personne d'autre n'écoute `uncaughtException`
 * (lib/browser/init.ts : `if (process.listenerCount('uncaughtException') > 1) return;`). Ce filet
 * écoute, ÉCRIT l'erreur sur stderr et termine le processus en code 1 — l'échec lisible de Node, au
 * lieu d'une fenêtre que personne ne lira et d'une attente muette.
 *
 * Hors du processus principal d'Electron (node, Electron en ELECTRON_RUN_AS_NODE, claude.exe…) :
 * AUCUN effet — un écouteur posé là avalerait les exceptions que Node aurait fait planter.
 * Mesuré le 2026-10-10 sur Electron 44.5.1 : `process.type === 'browser'` dès le chargement du filet.
 */
if (process.versions && process.versions.electron && process.type === 'browser') {
  process.on('uncaughtException', function filetAutowin(erreur) {
    // Electron (1) + ce filet (1) : au-delà, l'application a posé SON gestionnaire et garde la main.
    if (process.listenerCount('uncaughtException') > 2) return
    try {
      process.stderr.write(
        `Uncaught Exception (processus principal Electron — fenetre d'erreur remplacee par cette sortie, Autowin) :\n${
          (erreur && erreur.stack) || String(erreur)
        }\n`
      )
    } catch {
      // stderr fermé : le code de sortie reste la preuve.
    }
    process.exit(1)
  })
}
