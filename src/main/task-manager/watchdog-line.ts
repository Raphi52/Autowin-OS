export { exactLineFingerprint as lineFingerprint } from '../exact-line-fingerprint'

/**
 * Normalise le bruit variable d'une ligne sans perdre la nature de l'incident.
 *
 * Deux familles de jetons, et la seconde est celle qui manquait :
 *
 * 1. Les jetons de FORME — horodatage, uuid, hexa, nombres. Deux occurrences du meme incident qui
 *    ne different que par leur heure doivent avoir la meme signature.
 *
 * 2. Les jetons d'OCCURRENCE — `conv-1080`, `<slug>-workspace`, epoch. Repris de
 *    `auto-kaizen-supervisor.normalizedCause`, qui les avait identifies PAR LA MESURE : « jetons
 *    volatils mesures le 2026-08-04 : ils laissaient 1233 cles singleton pour une poignee de causes
 *    reelles ». Chacun identifie l'OCCURRENCE, jamais la cause.
 *
 * Ce que leur absence a coute, observe sur l'instance canary le 2026-08-10 : le contexte d'une
 * orchestration rouge contient le chemin de son RUN, donc le slug de son workspace, donc un texte
 * DIFFERENT a chaque run. La regle Auto-kaizen s'est reveillee 6 fois en 2 h 30 sur la meme panne —
 * dont trois fois entre 10:39 et 10:40 malgre une fenetre d'apaisement de 5 minutes — et les
 * reveils surnumeraires n'ont produit que 65, 94 et 55 caracteres. Une fenetre d'apaisement ne peut
 * rien contre un texte qui ne se repete jamais.
 */
export function lineSignature(line: string): string {
  return (
    line
      .toLowerCase()
      .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:z|[+-]\d{2}:?\d{2})?/g, '<ts>')
      .replace(/\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '<ts>')
      .replace(/0x[0-9a-f]+/g, '<hex>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
      // Jetons d'OCCURRENCE, AVANT la neutralisation des nombres : le slug de workspace ne contient
      // pas que des chiffres et serait perdu si `\d+` passait en premier.
      .replace(/\bconv-\d+\b/g, 'conv-<n>')
      // Le slug ENTIER, prefixe compris : il derive du titre de la tache (`build-recuperation-…`,
      // `relaunch-scout-knowledge-…`), donc il identifie le RUN et jamais la cause. N'en neutraliser
      // que la queue laissait deux orchestrations rouges distinctes — le defaut observe.
      // Repetition BORNEE, pas `*` : une ligne de log geante (900 000 caracteres, cas couvert par le
      // test) faisait backtracker un `*` non borne a chaque position de depart — un deni de service
      // en O(n²) sur le chemin le plus chaud du moteur. Un slug de workspace tient largement en 80.
      .replace(/[a-z0-9][a-z0-9_-]{0,80}-workspace\b/g, '<slug>-workspace')
      .replace(/\b1[0-9]{9}\b/g, '<epoch>')
      .replace(/\d+/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
