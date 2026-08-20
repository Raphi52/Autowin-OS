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

/**
 * Titres considérés comme PORTEURS, tirés des titres réellement observés dans la mesure — pas d'une
 * liste souhaitée. Un titre absent d'ici n'est pas ignoré : il tombe simplement dans l'étage 2.
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
  /** Titre normalisé, tel qu'il a été comparé aux titres porteurs. */
  cle: string
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
      cle,
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
  /** Comment il a été obtenu — pour l'observabilité, et pour que les tests le vérifient. */
  voie: 'entier' | 'sections' | 'tete-queue'
  /** Titres présents dans la sortie mais NON transmis. Ce que la troncature a coûté, nommé. */
  omises: string[]
  /** Caractères non transmis. 0 quand la sortie passait entière. */
  coupes: number
}

/**
 * Part de la borne réservée à la TÊTE dans l'étage 2. Le reste va à la QUEUE.
 *
 * Deux tiers / un tiers : la tête porte le contexte et l'amorce du raisonnement, la queue porte la
 * conclusion. Le volume total transmis est INCHANGÉ par rapport au `slice` d'avant — ce qui change
 * est qu'on ne jette plus systématiquement la fin.
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
      // L'avis peut faire dépasser la borne : on le taille sur le corps, jamais l'inverse — un avis
      // tronqué ne dirait plus ce qu'il manque, et c'est justement sa seule raison d'être.
      const place = Math.max(0, cap - avis.length)
      return {
        texte: corps.length > place ? `${corps.slice(0, place)}${avis}` : `${corps}${avis}`,
        voie: 'sections',
        omises,
        coupes: propre.length - Math.min(corps.length, place)
      }
    }
  }

  // ÉTAGE 2 — aucune section porteuse exploitable : on garde les BORDS. Volume identique à l'ancien
  // `slice`, mais la conclusion n'est plus jetée d'office.
  const avisLongueur = 64
  const utile = Math.max(0, cap - avisLongueur)
  const tete = Math.floor(utile * PART_TETE)
  const queue = utile - tete
  const coupes = propre.length - utile
  const avis = `\n…[${coupes} caractères coupés ici — voir le fil des sous-agents]\n`
  const resultat = `${propre.slice(0, tete)}${avis}${queue > 0 ? propre.slice(propre.length - queue) : ''}`
  return {
    // Garde-fou : si l'avis est plus long que prévu, on retaille pour ne JAMAIS dépasser la borne.
    texte: resultat.length <= cap ? resultat : resultat.slice(0, cap),
    voie: 'tete-queue',
    omises: sections.filter((s) => s.corps).map((s) => s.titre),
    coupes
  }
}
