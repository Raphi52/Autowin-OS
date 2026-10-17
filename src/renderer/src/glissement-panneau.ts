/**
 * LE PANNEAU DE DROITE GLISSE A L'OUVERTURE ET A LA FERMETURE (conv-987, 2026-10-16 : « je veux une
 * animation d'ouverture fermeture pour le paneau de droite »). Avant, le panneau Details du Chat
 * apparaissait et disparaissait d'un coup : il n'est monte que pendant qu'il est ouvert.
 *
 * Le panneau glisse depuis le bord droit, par sa marge de fin :
 * - fenetre large, il est une COLONNE du Chat : sa marge negative lui retire sa place, le fil se
 *   resserre a mesure qu'il entre (et s'elargit a mesure qu'il sort), sans saut ;
 * - fenetre etroite (< 1180 px, ChatView.css), il est un TIROIR pose a droite : la meme marge le
 *   pousse hors du cadre du Chat.
 * Hors de sa place, il est cache : le cadre du Chat rogne tout ce qui le depasse, en permanence
 * (ChatView.css, `.cosmic-outline .chat-layout { overflow: hidden }`, la classe de toute l'app).
 * Le contenu garde sa largeur : rien ne se re-met en page pendant le glissement.
 *
 * L'API d'animation du navigateur et pas `@keyframes` : la propriete `animation` du panneau porte
 * deja l'entree de ses bords (entree-cascade.ts, themes a chanfrein) ; une seconde regle l'aurait
 * ecrasee. Pas de garde « reduire les animations » : ce poste l'a actif et c'est un effet court,
 * declenche par un clic (meme choix que le menu, app-shell.css).
 */
export const DUREE_GLISSEMENT_MS = 240
const ENTREE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'
const SORTIE = 'cubic-bezier(0.4, 0, 1, 1)'

export type Sens = 'ouverture' | 'fermeture'

/**
 * Le glissement EN COURS de chaque panneau, et sa marge de repos. Les evenements `finish` et
 * `cancel` arrivent en differe : seule l'animation encore courante a le droit de conclure, sinon
 * la fin d'une ouverture remplacee effacerait l'etat de la fermeture qui l'a suivie.
 */
const enCours = new WeakMap<HTMLElement, { animation: Animation; repos: number }>()

/** La distance a parcourir : la largeur du panneau, plus l'ecart qui le separe du fil en colonne. */
export function courseDuPanneau(panneau: HTMLElement): number {
  const vue = panneau.ownerDocument.defaultView
  const largeur = panneau.getBoundingClientRect().width
  if (!vue || largeur <= 0) return 0
  if (vue.getComputedStyle(panneau).position === 'absolute') return largeur
  const parent = panneau.parentElement
  const ecart = parent ? parseFloat(vue.getComputedStyle(parent).columnGap) || 0 : 0
  return largeur + ecart
}

/** Arrete le glissement en cours, sans conclure (demontage, double effet du mode strict). */
export function arreterGlissement(panneau: HTMLElement): void {
  const courant = enCours.get(panneau)
  if (!courant) return
  enCours.delete(panneau)
  courant.animation.cancel()
}

/**
 * Fait glisser le panneau vers l'ouverture ou la fermeture, A PARTIR DE LA OU IL EST : une
 * fermeture interrompue par une reouverture repart de sa position, sans saut. `depuisDehors` : le
 * panneau vient d'etre monte, il part de hors champ. Rend `false` si rien n'a glisse (API absente,
 * panneau sans largeur, deja a destination) : l'appelant conclut alors tout de suite. `surFin`
 * n'est appele que si CE glissement va a son terme.
 */
export function glisserPanneau(
  panneau: HTMLElement,
  sens: Sens,
  options: { depuisDehors?: boolean; surFin?: () => void } = {}
): boolean {
  const { depuisDehors = false, surFin } = options
  const vue = panneau.ownerDocument.defaultView
  if (!vue || typeof panneau.animate !== 'function') return false
  const course = courseDuPanneau(panneau)
  if (course <= 0) return false
  // La position se lit AVANT d'arreter le glissement precedent : c'est lui qui la donne.
  const precedent = enCours.get(panneau)
  const marge = parseFloat(vue.getComputedStyle(panneau).marginInlineEnd) || 0
  const repos = precedent ? precedent.repos : marge
  const depart = depuisDehors ? repos - course : marge
  arreterGlissement(panneau)
  const arrivee = sens === 'ouverture' ? repos : repos - course
  const reste = Math.abs(arrivee - depart) / course
  if (reste < 0.01) return false
  const animation = panneau.animate(
    [{ marginInlineEnd: `${depart}px` }, { marginInlineEnd: `${arrivee}px` }],
    {
      duration: Math.round(DUREE_GLISSEMENT_MS * Math.min(1, reste)),
      easing: sens === 'ouverture' ? ENTREE : SORTIE,
      // Ferme, le panneau reste dehors jusqu'a son demontage (sinon une image le montre revenu).
      fill: sens === 'fermeture' ? 'forwards' : 'none'
    }
  )
  enCours.set(panneau, { animation, repos })
  animation.addEventListener('finish', () => {
    if (enCours.get(panneau)?.animation !== animation) return
    enCours.delete(panneau)
    surFin?.()
  })
  return true
}
