/**
 * CE QU'UNE PHASE TRANSMET À LA SUIVANTE — une projection, plus une découpe aveugle.
 *
 * Le portage était `texte.slice(0, 2000)` : il gardait le début et jetait le reste, au milieu d'une
 * phrase, sans égard pour ce que la phase suivante avait besoin de savoir. Un agent qui « dérive »
 * n'est alors pas défaillant — il travaille sur un cadrage dont il n'a jamais reçu la fin.
 *
 * MESURÉ sur les données réelles de l'app (1280 sorties de phase issues de 403 runs) :
 *  - 25,8 % de toutes les sorties étaient tronquées ;
 *  - et surtout les phases dont le MÉTIER est de transmettre : scout 62,5 %, frame 46,7 %,
 *    terrain 40,0 % — quand le `judge`, qui ne transmet à personne, tombe à 2,3 %. La corrélation
 *    va donc dans le sens de la cause ;
 *  - la sortie médiane fait 775 caractères : la borne ne rogne pas un peu partout, elle DÉCAPITE
 *    les sorties riches et laisse les autres intactes.
 *
 * DEUX ÉTAGES, et le second vient d'un fait mesuré qui a corrigé le premier jet de ce module :
 * 44,8 % des sorties tronquées ne portent AUCUN titre `##`. Une projection par sections seule
 * couvrirait donc la moitié du problème en ayant l'air de le résoudre.
 *  1. SECTIONS PORTEUSES si elles existent (55,2 % des sorties tronquées en ont une) ;
 *  2. TÊTE + QUEUE sinon — parce que les titres réellement observés sont des titres de CONCLUSION
 *     (`besoin` 98×, `changement` 20, `défauts` 16, `verdict` 8, `résultat` 6, `conclusion` 5) et
 *     que `slice(0, cap)` jette précisément la fin, donc la décision.
 *
 * L'idiome n'est pas inventé ici : `evidence-digest.ts` a résolu le même problème sur un autre couple
 * producteur/consommateur (le juge payait la charge d'affichage du Chat — prompt de 422 504
 * caractères dont ~81 % inexploitables, run mort sur « Budget tokens total dépassé »). Sa réponse
 * était déjà de PROJETER vers le besoin du consommateur, et de garder « l'écho de la commande en
 * tête, la ligne de résultat en queue ». Ce module applique ce geste au couple phase N → phase N+1.
 *
 * PUR à dessein : pas d'horloge, pas de provider, pas d'Electron, aucune E/S. C'est ce qui permet de
 * le tester sur des sorties fabriquées sans lancer un run qui coûte de l'argent.
 *
 * CE QU'IL NE FAIT PAS : remonter la borne. Le résultat reste BORNÉ, parce que c'est ce qui garde le
 * devis calculable — lever la borne échangerait un défaut mesuré contre un coût non mesuré.
 */

import { clampMiddle } from './evidence-digest'

/**
 * Titres considérés comme PORTEURS. Les sept premiers sont ceux dont la mesure a compté les
 * occurrences (`besoin` 98×, `changement` 20×, `defauts` 16×, `verdict` 8×, `sop` 7×, `resultat` 6×,
 * `conclusion` 5×). Les suivants sont des titres du VOCABULAIRE DU PIPELINE lui-même (`frame` écrit
 * `## Contraintes` et `## Options`, `frame`/`judge` écrivent `## Décision`) : ils sont attendus par
 * construction, pas observés statistiquement — la distinction est dite ici plutôt que laissée
 * croire que la mesure les justifie tous.
 *
 * Un titre absent de cette liste n'est pas ignoré : il tombe dans l'étage 2, qui est le
 * comportement sûr par défaut.
 */
const SECTIONS_PORTEUSES = [
  'besoin',
  'decision',
  'verdict',
  'defauts',
  'contraintes',
  'resultat',
  'conclusion',
  'changement',
  'sop',
  'options',
  'localisation',
  'constats',
  'cartographie'
] as const

/** Sans accents ni casse : `Défauts`, `defauts` et `DÉFAUTS` sont le même titre. */
export function normaliserTitre(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface SectionTrouvee {
  titre: string
  /** Le corps de la section, titre EXCLU. */
  corps: string
  porteuse: boolean
}

/**
 * Découpe un texte markdown en sections `##`/`###`.
 *
 * Remplace `extractSection()` de `runs/conv-runs.ts`, qui cherchait UN titre nommé à la fois : ici on
 * a besoin de l'inventaire complet, pour savoir aussi ce qu'on N'A PAS porté et le dire.
 */
export function decouperSections(texte: string): SectionTrouvee[] {
  const sections: SectionTrouvee[] = []
  const motif = /(?:^|\n)(#{2,4})[ \t]+([^\n]+)\n?/g
  const marques: { titre: string; debut: number; finTitre: number }[] = []
  let m: RegExpExecArray | null
  while ((m = motif.exec(texte)) !== null) {
    marques.push({ titre: m[2].trim(), debut: m.index, finTitre: m.index + m[0].length })
  }
  for (let i = 0; i < marques.length; i++) {
    const fin = i + 1 < marques.length ? marques[i + 1].debut : texte.length
    const cle = normaliserTitre(marques[i].titre)
    sections.push({
      titre: marques[i].titre,
      corps: texte.slice(marques[i].finTitre, fin).trim(),
      // Un titre « Besoin réel » ou « Décision retenue » compte : on cherche le mot porteur DANS le
      // titre normalisé, sinon la moitié des titres réels tomberaient à côté pour un adjectif.
      porteuse: SECTIONS_PORTEUSES.some((p) => cle === p || cle.startsWith(`${p} `))
    })
  }
  return sections
}

export interface PortageResultat {
  /** Le texte à transmettre à la phase suivante. Toujours ≤ `cap`. */
  texte: string
  /**
   * Comment il a été obtenu. Lu par les TESTS, pas par la production : `porterVersPhaseSuivante`
   * dans l'orchestrateur ne consomme que `.texte`. Dire « pour l'observabilité » était faux — il n'y
   * a aucune observabilité câblée sur ce champ, et un commentaire qui promet un branchement absent
   * fait chercher longtemps.
   */
  voie: 'entier' | 'sections' | 'tete-queue'
  /** Titres présents dans la sortie mais NON transmis. Ce que la troncature a coûté, nommé. */
  omises: string[]
  /** Caractères non transmis. 0 quand la sortie passait entière. */
  coupes: number
}

/**
 * Part de la borne réservée à la TÊTE dans l'étage 2. Le reste va à la QUEUE.
 *
 * DEUX TIERS / UN TIERS, ET C'EST UN ÉCHANGE, PAS UN GAIN NET — il faut le dire clairement, parce
 * que la première version de ce commentaire prétendait le contraire. L'ancien `slice(0, cap)`
 * transmettait les caractères `[0, cap)`. Celui-ci transmet `[0, ~2cap/3)` puis le dernier tiers du
 * texte. La tranche MÉDIANE de l'ancienne tête — de ~2cap/3 jusqu'au début de la queue — n'est donc
 * plus portée du tout.
 *
 * L'échange est fait en connaissance de cause : les titres réellement observés dans les sorties
 * d'agents sont des titres de CONCLUSION (`verdict`, `résultat`, `défauts`, `conclusion`), et une
 * mesure sur les sorties réelles montre que la fin du texte n'arrivait quasiment jamais à la phase
 * suivante. On préfère donc perdre du milieu de raisonnement que perdre la conclusion. Mais ce n'est
 * pas « au moins autant d'information » : c'est un arbitrage, et il peut se retourner sur une sortie
 * dont la substance vit précisément au milieu.
 */
const PART_TETE = 2 / 3

/**
 * Projette la sortie d'une phase vers ce que la phase suivante doit en savoir, sous la borne `cap`.
 *
 * `cap` est fourni par l'appelant plutôt que lu ici : ce module ne décide pas de la politique de
 * coût, il l'applique. Un `cap` ≤ 0 ou non fini rend le texte entier — refuser de porter quoi que ce
 * soit serait pire que porter trop.
 */
export function porterSortieDePhase(texte: string, cap: number): PortageResultat {
  const propre = texte ?? ''
  if (!Number.isFinite(cap) || cap <= 0 || propre.length <= cap) {
    return { texte: propre, voie: 'entier', omises: [], coupes: 0 }
  }

  const sections = decouperSections(propre)
  const porteuses = sections.filter((s) => s.porteuse && s.corps)
  if (porteuses.length > 0) {
    // ÉTAGE 1 — on empile les sections porteuses dans l'ordre du texte, tant que ça rentre. Une
    // section qui ne rentre pas est ANNONCÉE dans `omises` : c'est la différence avec un `…[tronqué]`
    // muet, qui laissait la phase suivante ignorer jusqu'à l'existence de ce qui manquait.
    const gardees: SectionTrouvee[] = []
    const omises: string[] = []
    let taille = 0
    for (const s of porteuses) {
      const bloc = `## ${s.titre}\n${s.corps}`
      // +2 pour le séparateur entre blocs, compté seulement à partir du deuxième.
      const coutBloc = bloc.length + (gardees.length ? 2 : 0)
      if (taille + coutBloc <= cap) {
        gardees.push(s)
        taille += coutBloc
      } else {
        omises.push(s.titre)
      }
    }
    // Les non-porteuses sont omises par construction : on le DIT aussi, sinon « ce qui manque » reste
    // invisible exactement comme avant.
    for (const s of sections) {
      if (!s.porteuse && s.corps && !omises.includes(s.titre)) omises.push(s.titre)
    }
    if (gardees.length > 0) {
      const corps = gardees.map((s) => `## ${s.titre}\n${s.corps}`).join('\n\n')
      const avis = omises.length
        ? `\n…[non transmis : ${omises.join(', ')} — voir le fil des sous-agents]`
        : ''
      // L'avis se taille sur le corps, jamais l'inverse — un avis tronqué ne dirait plus ce qu'il
      // manque, et c'est sa seule raison d'être.
      const place = Math.max(0, cap - avis.length)
      const brut = corps.length > place ? `${corps.slice(0, place)}${avis}` : `${corps}${avis}`
      // GARDE FINALE, absente ici jusqu'au 2026-08-19 : quand l'avis est à lui seul plus long que la
      // borne (beaucoup de titres omis, titres longs), `place` tombe à 0 et cette branche rendait
      // l'avis SEUL, sans aucune borne. Mesuré : `cap=200` rendait 1807 caractères, soit 9× la
      // limite — dans un module dont l'en-tête affirme « le résultat reste BORNÉ ». Une contrainte
      // HARD démentie par le code qui la documente est pire qu'une contrainte absente.
      const rendu = brut.length <= cap ? brut : brut.slice(0, cap)
      return {
        texte: rendu,
        voie: 'sections',
        // Compté sur ce qui est RÉELLEMENT rendu : figer `coupes` avant la garde finale annonçait à
        // l'appelant un chiffre que la garde démentait ensuite.
        omises,
        coupes: Math.max(0, propre.length - rendu.length)
      }
    }
  }

  /**
   * ÉTAGE 2 — aucune section porteuse exploitable : on garde les BORDS.
   *
   * `clampMiddle` vient de `evidence-digest.ts`, qui faisait DÉJÀ exactement ce geste (garder deux
   * bords en annonçant ce qui est coupé au milieu). Ce module citait ce fichier comme modèle dans son
   * en-tête… et réimplémentait sa fonction à la main juste en dessous. Le doublon est supprimé : une
   * seule définition de « couper au milieu », déjà testée là-bas.
   */
  /**
   * Place à réserver pour le marqueur que `clampMiddle` insère au milieu.
   *
   * Sa longueur dépend du nombre de CHIFFRES du compte d'omission, donc on ne peut pas la coder en
   * dur — un `avisLongueur = 64` écrit au doigt devenait faux dès que ce compte passait à neuf
   * chiffres, et le garde-fou final tronquait alors la conclusion, c'est-à-dire exactement ce que cet
   * étage existe pour préserver.
   *
   * On la MESURE donc sur un gabarit minuscule, puis on ajoute les chiffres manquants. Et on ne sonde
   * PAS avec `clampMiddle(propre, 0, 0)`, ce qui paraissait plus élégant : en JavaScript
   * `slice(-0) === slice(0)`, donc une queue de zéro rend le texte ENTIER et la sonde mesurait tout
   * le texte au lieu du marqueur. Les tests l'ont attrapé ; le piège vaut d'être écrit ici.
   */
  // `'abc'` et pas `'ab'` : avec 2 caractères pour `head + tail = 2`, `clampMiddle` prend son retour
  // anticipé (`text.length <= head + tail`) et rend le texte sans marqueur — la sonde mesurait 0.
  const gabarit = clampMiddle('abc', 1, 1).length - 2 // marqueur avec un compte à 1 chiffre
  const largeurMarqueur = (omis: number): number => gabarit - 1 + String(Math.max(1, omis)).length

  /**
   * POINT FIXE, en un pas — et il corrige une réservation qui surestimait d'un caractère.
   *
   * Le marqueur annonce le nombre de caractères OMIS, donc sa largeur dépend des chiffres de ce
   * nombre… qui dépend lui-même de la place laissée par le marqueur. La première version réservait
   * la place d'après les chiffres de la longueur TOTALE, une borne supérieure : dès que le compte
   * omis retombait sous une puissance de 10, elle réservait un caractère de trop et le budget
   * n'était pas rempli. Mesuré : `porterSortieDePhase('x'.repeat(1000), 200)` rendait 199 au lieu
   * de 200 — un caractère de substance abandonné en silence, et un commentaire qui affirmait
   * pourtant « rempli au caractère près ».
   *
   * On part donc de la borne supérieure, on en déduit le compte omis réel, et on RE-mesure. Un seul
   * pas suffit : la largeur ne varie que par le nombre de chiffres, et le second calcul ne peut que
   * la réduire — jamais osciller.
   */
  const utileMajorant = Math.max(0, cap - largeurMarqueur(propre.length))
  const utile = Math.max(0, cap - largeurMarqueur(propre.length - utileMajorant))

  /**
   * `cap` plus petit que le marqueur : il n'y a de place pour AUCUN contenu.
   *
   * Sans cette garde, `tete` et `queue` valaient 0, et `clampMiddle(propre, 0, 0)` retombait sur le
   * piège `slice(-0) === slice(0)` — il rendait le texte ENTIER précédé du marqueur, que la garde
   * finale tronquait ensuite à `cap`. Le résultat était un FRAGMENT DU MARQUEUR : « \n… [520 ca »
   * pour `cap=10`. La borne était respectée et le contenu n'avait aucun sens — il annonçait une
   * omission sans jamais montrer ni tête ni queue. Inatteignable en production (`PHASE_CONTEXT_CAP`
   * vaut 2000) mais atteignable par l'API publique, donc par un futur appelant.
   */
  if (utile <= 0) {
    const rendu = propre.slice(0, cap)
    return {
      texte: rendu,
      voie: 'tete-queue',
      omises: sections.filter((s) => s.corps).map((s) => s.titre),
      coupes: propre.length - rendu.length
    }
  }

  const tete = Math.floor(utile * PART_TETE)
  const queue = utile - tete
  const brut = clampMiddle(propre, tete, queue)
  const rendu = brut.length <= cap ? brut : brut.slice(0, cap)
  return {
    texte: rendu,
    voie: 'tete-queue',
    omises: sections.filter((s) => s.corps).map((s) => s.titre),
    coupes: Math.max(0, propre.length - rendu.length)
  }
}
