import { Notification, app, BrowserWindow } from 'electron'
import {
  type ContenuNotification,
  libelleDeBouton,
  creerNotifieurDeFinDeTour
} from '../app/notification-fin-de-tour'
import { creerPopupsDeFinDeTour } from '../app/notification-popup-fenetre'
import { lireMascotteAffichee, styleAffiche, lireStyleMascotte } from '../mascotte/mascotte-reglage'
import type { ContexteIpcChat } from '../index'

/**
 * LA FIN D’UN TOUR ANNONCÉE À L’UTILISATEUR : bulle Windows, carte de fin de tour, mascotte.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** Ce que `creerLaNotificationDeFinDeTour` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface NotificationDeFinDeTour {
  notifierFinDeTour: ReturnType<typeof creerNotifieurDeFinDeTour>
}

/** La notification de fin de tour. */
export function creerLaNotificationDeFinDeTour(ctx: ContexteIpcChat): NotificationDeFinDeTour {
  const {
    activeChatTurns,
    broadcast,
    headlessTestInstance,
    isolatedTestInstance,
    mascotteDuBureau,
    os,
    showMainWindow
  } = ctx
  /*
   * FIL ASYNCHRONE (2026-10-21) : un tour fini SONNE quand aucune fenetre d'Autowin
   * n'est regardee (tour median 226 s, p90 ~17 min). Le clic ouvre le fil du tour ; la decision et
   * le texte vivent dans `notification-fin-de-tour.ts`, testes sans fenetre.
   */
  /*
   * POPUP « VERRE NACRE » (2026-10-22) : la fin d'un tour s'affiche dans une carte au
   * theme d'Autowin en bas a droite (`notification-popup.ts`), plus dans la bulle Windows, que
   * rien ne permet de styler. La bulle reste le SECOURS si la carte ne peut pas se creer.
   * Les cartes n'existent que tant qu'Autowin n'est pas regarde : une fenetre d'Autowin qui
   * reprend le focus les ferme toutes (elles couvriraient sinon le bas de la fenetre, la saisie).
   */
  const bulleWindows = (contenu: ContenuNotification): Notification => {
    if (!Notification.isSupported()) throw new Error('Notifications non supportees')
    return new Notification({
      title: contenu.title,
      body: contenu.body,
      // Les suites du tour en boutons (Windows et macOS depuis Electron 44) : la suite part entiere.
      ...(contenu.suites
        ? {
            actions: contenu.suites.map((suite) => ({
              type: 'button' as const,
              text: libelleDeBouton(suite)
            }))
          }
        : {})
    })
  }
  // La bulle sert DEUX fois de secours : carte impossible a creer (`fabriquer` jette, ci-dessous) et
  // page de carte non chargee, qui n'arrive qu'APRES `fabriquer` (la pile passe alors la main).
  const popupsDeFinDeTour = creerPopupsDeFinDeTour({
    secours: bulleWindows,
    zone: mascotteDuBureau.zoneDesCartes,
    page: mascotteDuBureau.decorerCarte
  })
  // Les cartes collees a la bille la suivent quand on la glisse (« snap ensemble »).
  mascotteDuBureau.quandElleBouge(popupsDeFinDeTour.replacer)
  app.on('browser-window-focus', (_evenement, fenetre) => {
    if (!popupsDeFinDeTour.estUneCarte(fenetre)) popupsDeFinDeTour.toutFermer()
  })
  const notifierFinDeTour = creerNotifieurDeFinDeTour({
    fabrique: (contenu) => {
      try {
        return popupsDeFinDeTour.fabriquer(contenu)
      } catch (erreur) {
        console.warn('[fin-de-tour] carte impossible, bulle Windows a la place —', String(erreur))
      }
      return bulleWindows(contenu)
    },
    // Une carte n'est pas une fenetre d'Autowin « regardee » (elle ne prend jamais le focus, mais
    // si Windows la lui donnait, la carte suivante ne doit pas se taire pour autant).
    fenetreRegardee: () => {
      const fenetre = BrowserWindow.getFocusedWindow()
      return fenetre !== null && !popupsDeFinDeTour.estUneCarte(fenetre)
    },
    // Les instances cachees (capture, tache planifiee) ne s'affichent jamais chez l'utilisateur.
    instanceDeTest: isolatedTestInstance || headlessTestInstance,
    titreDuFil: (id) => os.conversations.get(id)?.title,
    ouvrirFil: (id) => {
      showMainWindow()
      // L'interface bascule elle-meme sur le chat (`App.tsx`, `openTaskConversation`).
      broadcast({ type: 'open-conversation', convId: id })
    },
    // Sans ramener la fenetre : l'interface envoie la suite dans ce fil (`ChatView`, `App.tsx`).
    envoyerSuite: (id, suite) =>
      broadcast({ type: 'suite-depuis-notification', convId: id, texte: suite })
  })
  // La mascotte du bureau : jamais dans une instance cachée (capture, tâche planifiée),
  // pour la même raison que les cartes — elle s'afficherait sur l'écran de l'utilisateur.
  if (!isolatedTestInstance && !headlessTestInstance)
    mascotteDuBureau.demarrer(
      {
        toursEnCours: () => activeChatTurns.inFlightConversations().length,
        autowinRegardee: () => {
          const fenetre = BrowserWindow.getFocusedWindow()
          return (
            fenetre !== null &&
            // Une fenêtre cachée ou réduite ne se regarde pas, même si Electron la croit active.
            fenetre.isVisible() &&
            !fenetre.isMinimized() &&
            !popupsDeFinDeTour.estUneCarte(fenetre) &&
            !mascotteDuBureau.estLaMascotte(fenetre)
          )
        },
        ouvrirFil: (id) => {
          showMainWindow()
          broadcast({ type: 'open-conversation', convId: id })
        },
        ouvrirAutowin: () => showMainWindow(),
        titreDuFil: (id) => os.conversations.get(id)?.title
      },
      lireMascotteAffichee(),
      styleAffiche(lireStyleMascotte(), ctx.themeDeLaMascotte)
    )
  return { notifierFinDeTour }
}
