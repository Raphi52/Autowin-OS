/**
 * DEPOUILLER LES SEQUENCES DE TERMINAL — un seul endroit, pour les deux processus.
 *
 * DEFAUT VECU le 2026-08-25 (conv-1404) : le fil affichait « 9 min 27 s · <ESC>[33m<ESC>[2m … » et
 * le panneau de `verify` des lignes entieres de codes de couleur. La cause n'etait pas un motif
 * faux — c'etait qu'il n'y en avait PAS sur ces deux chemins, alors qu'une version correcte dormait
 * dans `verify-command.ts` sans etre appliquee a ce qui est RENDU. Trois chemins de sortie, deux
 * definitions, une seule appliquee : le defaut etait dans la dispersion.
 *
 * Deux degats a chaque fuite, pas un : les codes salissent l'affichage, ET ils consomment le budget
 * de troncature, donc le texte utile est coupe bien avant sa vraie longueur.
 */

/**
 * Les caracteres de controle sont construits par leur CODE, jamais ecrits a la main : ce depot a
 * deja paye le prix d'un echappement fige en dur par un patch (voir `SAUT` et `ANTISLASH` dans
 * `verify-command.ts`). `[[]` est la classe qui matche un crochet ouvrant — elle evite un
 * echappement de plus.
 */
const ECHAPPEMENT = String.fromCharCode(27)
const SONNERIE = String.fromCharCode(7)

/**
 * SGR et compagnie : `<ESC>[` puis des parametres numeriques puis une lettre finale. On exige
 * l'ancre `<ESC>` — sans elle le motif mordrait tout crochet legitime (`[1/10]`, `items[3]`), et un
 * motif qui retire `[31m` en LAISSANT l'echappement seul produit des carres a l'ecran tout en
 * passant une assertion ecrite sur `<ESC>[`.
 */
const SEQUENCE_CSI = new RegExp(ECHAPPEMENT + '[[]' + '[0-9;?]*' + '[A-Za-z]', 'g')

/** Sequences de systeme d'exploitation (titre de fenetre, hyperliens) : `<ESC>]` … `BEL`. */
const SEQUENCE_OSC = new RegExp(ECHAPPEMENT + ']' + '[^' + SONNERIE + ']*' + SONNERIE, 'g')

/** Un echappement ORPHELIN — reste d'un depouillement partiel, ou sortie tronquee au milieu. */
const ECHAPPEMENT_ORPHELIN = new RegExp(ECHAPPEMENT, 'g')

/**
 * Rend le texte tel qu'un humain le lit. Ne retire QUE des sequences de terminal : un crochet du
 * message reste intact, c'est ce qui distingue ce depouillement d'une troncature.
 */
export function sansSequencesAnsi(texte: string): string {
  return texte
    .replace(SEQUENCE_OSC, '')
    .replace(SEQUENCE_CSI, '')
    .replace(ECHAPPEMENT_ORPHELIN, '')
}
