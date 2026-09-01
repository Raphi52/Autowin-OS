/**
 * Le panneau de reglages de l'accueil est-il ouvert ? Memoire de SESSION D'AFFICHAGE.
 *
 * Deux exigences qui semblent contradictoires, posees par l'utilisateur le 2026-09-01 :
 *  - au DEMARRAGE de l'application, le panneau est ferme : il ne doit pas masquer l'accueil de
 *    quelqu'un qui vient juste regarder ses tuiles ;
 *  - s'il l'a OUVERT puis change de page, il le retrouve OUVERT en revenant : reregler un panneau
 *    qu'on vient d'ouvrir, juste parce qu'on est passe par le chat, est une friction.
 *
 * La solution tient a l'endroit ou l'etat vit. Ni dans le composant (il est demonte des qu'on change
 * de page, donc l'ouverture serait perdue), ni sur le disque (elle survivrait au redemarrage, donc le
 * panneau s'ouvrirait tout seul au lancement). Il vit ICI, dans le module : sa duree de vie est
 * exactement celle de la fenetre chargee.
 */

let ouvert = false

export function reglagesSontOuverts(): boolean {
  return ouvert
}

export function memoriserOuvertureReglages(valeur: boolean): void {
  ouvert = valeur
}

/** Remet la memoire a son etat de demarrage. Sert aux tests, et au rechargement de la vue. */
export function oublierOuvertureReglages(): void {
  ouvert = false
}
