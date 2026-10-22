/**
 * FIL ASYNCHRONE — la fin d'un tour vient chercher l'utilisateur (conv-1038, 2026-10-21).
 *
 * Pourquoi : un tour de chat dure 226 s en médiane et ~17 min au 90e centile (mesure du scout
 * conv-1038 sur les fils enregistrés). L'utilisateur part faire autre chose ; rien ne le rappelait,
 * sauf la jauge de la barre des tâches et la pastille « non lu », invisibles hors de la fenêtre. La
 * seule notification Windows du main signalait un travail ABANDONNÉ (`os.ts`, `onAbandon`).
 *
 * Ce module ne connaît pas Electron : la notification est fabriquée par l'appelant, ce qui laisse
 * la décision et le texte testables sans fenêtre (même découpe que `os-presence-main.ts`).
 */
import { faitsDuRapport } from '../shared/orchestration-outcome'
import { extrairePropositionsSuite, retirerLignePromptSuivant } from '../shared/prompt-suivant'

/** Ce que la fin d'un tour dit d'elle-même — le sous-ensemble utile du résultat de `lancerTour`. */
export type FinDeTourPourNotification = {
  ok: boolean
  cancelled: boolean
  text?: string
  error?: string
  /**
   * Dernière demande de l'utilisateur dans ce tour : les gardes de publication des suites la lisent
   * (une publication jamais demandée ne devient pas un bouton).
   */
  demandeDuTour?: string
}

export type ContenuNotification = {
  title: string
  body: string
  /**
   * Suites proposées par le tour, mieux notées d'abord (`extrairePropositionsSuite`) : chacune est
   * un BOUTON de la bulle et part, entière, dans le fil au clic. Absent quand il n'y en a pas.
   */
  suites?: string[]
  /**
   * Titre NU du fil et issue du tour : la carte en bas à droite (`notification-popup.ts`, conv-1066)
   * les met sur deux lignes distinctes, là où la bulle Windows les recolle dans `title`.
   * fix-ok: pas un correctif à l'aveugle — les trois modifications de ce fichier posent ce même
   * couple `fil`/`issue` (ce type, le retour d'échec, le retour réussi), parce que `title` colle le
   * titre du fil à son issue ; attentes de notification-fin-de-tour.test.ts rouges avant, vertes
   * après (conv-1066).
   */
  fil: string
  issue: 'prete' | 'echec'
}

/**
 * Deux boutons au plus : la bulle Windows reste lisible, et ce sont les deux mieux notées — la
 * première est celle que le mode auto enverrait.
 */
const MAX_BOUTONS = 2
/** Au-delà, Windows coupe le libellé d'un bouton sans prévenir. */
const LONGUEUR_MAX_BOUTON = 40

/** Le libellé affiché sur le bouton ; la suite envoyée, elle, reste entière. */
export function libelleDeBouton(suite: string): string {
  return suite.length > LONGUEUR_MAX_BOUTON
    ? `${suite.slice(0, LONGUEUR_MAX_BOUTON - 1).trimEnd()}…`
    : suite
}

/** Une ligne de la notification : au-delà, Windows coupe de toute façon, et sans « … ». */
const LONGUEUR_MAX_LIGNE = 120

function couper(ligne: string): string {
  return ligne.length > LONGUEUR_MAX_LIGNE
    ? `${ligne.slice(0, LONGUEUR_MAX_LIGNE - 1).trimEnd()}…`
    : ligne
}

/** Le décor Markdown n'a rien à faire dans une bulle système qui l'affiche tel quel. */
function sansDecorMarkdown(ligne: string): string {
  return ligne
    .trim()
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/u, '')
    .replace(/\*\*|__|`/gu, '')
    .trim()
}

/** Les deux lignes du corps : les faits de « ✅ Fait » d'abord, sinon le début de la réponse. */
function corpsDeReponse(brut: string | undefined): string {
  // La ligne technique des suites sert aux boutons ; dans le corps, elle serait du bruit.
  const texte = brut === undefined ? undefined : retirerLignePromptSuivant(brut)
  const faits = faitsDuRapport(texte, 2)
  const lignes =
    faits.length > 0
      ? faits
      : (texte ?? '')
          .split(/\r?\n/u)
          .map(sansDecorMarkdown)
          .filter((ligne) => ligne.length > 0 && ligne !== '---')
          .slice(0, 2)
  return lignes.length > 0 ? lignes.map(couper).join('\n') : 'Le tour est terminé.'
}

/**
 * Faut-il sonner, et avec quoi ? `null` = silence. Silence quand :
 *  - l'utilisateur REGARDE déjà une fenêtre d'Autowin (il voit la réponse arriver) ;
 *  - le tour a été ARRÊTÉ (c'est lui qui l'a fait) ;
 *  - l'instance est une instance de TEST (capture cachée de `scripts/ui-capture.mjs`) : elle ne
 *    doit jamais rien afficher sur l'écran de l'utilisateur ;
 *  - le tour est un tour de FOND (tâche planifiée) : personne n'attend devant.
 * Un ÉCHEC sonne aussi : c'est précisément ce que l'utilisateur parti doit apprendre.
 */
export function contenuDeNotificationDeFinDeTour(
  entree: FinDeTourPourNotification & {
    titreDuFil?: string
    fenetreRegardee: boolean
    instanceDeTest: boolean
    tourDeFond: boolean
  }
): ContenuNotification | null {
  if (entree.instanceDeTest || entree.tourDeFond || entree.cancelled || entree.fenetreRegardee)
    return null
  const titre = entree.titreDuFil?.trim() || 'Autowin'
  if (!entree.ok) {
    const premiere = (entree.error ?? '').split(/\r?\n/u).find((ligne) => ligne.trim()) ?? ''
    return {
      title: `${titre} — le tour a échoué`,
      body: couper(premiere.trim()) || 'Le tour s’est arrêté sur une erreur.',
      fil: titre,
      issue: 'echec'
    }
  }
  const suites = extrairePropositionsSuite(entree.text, entree.demandeDuTour)
    .slice(0, MAX_BOUTONS)
    .map((proposition) => proposition.texte)
  return {
    title: `${titre} — réponse prête`,
    body: corpsDeReponse(entree.text),
    ...(suites.length > 0 ? { suites } : {}),
    fil: titre,
    issue: 'prete'
  }
}

/** Le strict minimum d'une `Notification` Electron, pour que le test la double. */
export type NotificationAffichable = {
  show(): void
  close(): void
  on(evenement: 'click', ecouteur: () => void): void
  /** Bouton pressé (Windows et macOS, Electron 44) : `actionIndex` = rang dans `suites`. */
  on(evenement: 'action', ecouteur: (details: { actionIndex?: number }) => void): void
}

/**
 * Le notifieur câblé : fabrique la notification, ouvre LE fil du tour au clic, et REMPLACE la
 * notification précédente du même fil. Sans ce remplacement, le mode auto, qui enchaîne les tours
 * d'un fil non affiché, empilerait une rafale de bulles dans le centre de notifications.
 */
export function creerNotifieurDeFinDeTour(deps: {
  fabrique: (contenu: ContenuNotification) => NotificationAffichable
  fenetreRegardee: () => boolean
  instanceDeTest: boolean
  titreDuFil: (conversationId: string) => string | undefined
  ouvrirFil: (conversationId: string) => void
  /** Un bouton de suite pressé : la suite part dans CE fil, sans ramener la fenêtre. */
  envoyerSuite?: (conversationId: string, suite: string) => void
}): (conversationId: string, fin: FinDeTourPourNotification & { tourDeFond?: boolean }) => void {
  const affichees = new Map<string, NotificationAffichable>()
  return (conversationId, fin) => {
    try {
      const contenu = contenuDeNotificationDeFinDeTour({
        ...fin,
        titreDuFil: deps.titreDuFil(conversationId),
        fenetreRegardee: deps.fenetreRegardee(),
        instanceDeTest: deps.instanceDeTest,
        tourDeFond: fin.tourDeFond === true
      })
      if (!contenu) return
      affichees.get(conversationId)?.close()
      const notification = deps.fabrique(contenu)
      notification.on('click', () => {
        affichees.delete(conversationId)
        deps.ouvrirFil(conversationId)
      })
      notification.on('action', (details) => {
        const suite = contenu.suites?.[details?.actionIndex ?? -1]
        if (!suite || !deps.envoyerSuite) return
        affichees.delete(conversationId)
        deps.envoyerSuite(conversationId, suite)
      })
      affichees.set(conversationId, notification)
      notification.show()
    } catch {
      // Une notification qui échoue (plateforme sans support, centre de notifications coupé) ne
      // doit jamais faire tomber la fin du tour : la réponse est déjà dans le fil.
    }
  }
}
