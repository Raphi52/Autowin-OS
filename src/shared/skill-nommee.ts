/**
 * SKILL NOMMÉE EN TÊTE D'UN MESSAGE — avec ou sans barre oblique.
 *
 * Sert au chargement du corps de la skill (main, `skill-pipeline.ts`). La bulle du fil ne s'en sert
 * plus depuis conv-1334 : un message qui nomme une skill s'affiche tel qu'il a été tapé.
 *
 * Origine (conv-988, 2026-10-16) : « draft des animations… » tapé SANS `/` ne recevait ni la bulle
 * de skill ni le corps de la skill, alors que la consigne du chat dit « SKILL NOMMÉE = SKILL
 * INVOQUÉE ». Mesure sur les conversations du poste : 169 messages commencent par un nom de skill
 * sans `/` ; l'agent n'a lu le SKILL.md correspondant que dans 5 d'entre eux.
 *
 * Volontairement STRICT pour la forme sans barre : nom EXACT d'une skill connue (pas de rattrapage
 * de faute de frappe — « look » deviendrait « book »), en TÊTE seulement, suivi d'un espace, d'une
 * ponctuation ou de la fin. « fais un draft », « scouting », « drafty » ne déclenchent rien, et
 * « draft = 6 ask = 10 » (une réponse chiffrée, conv-427) non plus.
 */
export interface SkillNommee {
  /** Identifiant de la skill tel qu'il est connu (casse de l'inventaire). */
  skill: string
  /** Le texte qui suit le nom, débarrassé du séparateur (« think : X » → « X »). */
  reste: string
  /** `true` pour `/nom`, `false` pour le nom nu. */
  barre: boolean
}

const AVEC_BARRE = /^\s*\/([A-Za-z0-9][\w-]*)(?=\s|$)/
const SANS_BARRE = /^\s*([A-Za-z][\w-]*)(?=[\s,:.;!]|$)/

/*
 * Skills dont le nom est AUSSI une commande courante : en tête d'un message, le mot nu désigne la
 * commande (« git status me dit… », « git push refusé »), pas la skill. Or `/git` commite, pousse et
 * supprime des branches : un faux déclenchement publierait sans demande (conv-1250, 2026-10-29).
 * Pour elles, seule la forme avec barre invoque.
 */
const BARRE_OBLIGATOIRE = new Set(['git'])

export function skillNommeeEnTete(
  texte: string | null | undefined,
  nomsConnus: Iterable<string>
): SkillNommee | null {
  const contenu = texte ?? ''
  const slash = AVEC_BARRE.exec(contenu)
  const m = slash ?? SANS_BARRE.exec(contenu)
  if (!m) return null
  const nom = m[1].toLowerCase()
  let connu: string | undefined
  for (const n of nomsConnus) {
    if (n.toLowerCase() === nom) {
      connu = n
      break
    }
  }
  if (!connu) return null
  if (!slash && BARRE_OBLIGATOIRE.has(nom)) return null
  let reste = contenu.slice(m[0].length)
  if (!slash) {
    if (/^\s*=/.test(reste)) return null
    reste = reste.replace(/^\s*[,:.;!]?/, '')
  }
  return { skill: connu, reste: reste.replace(/^\s+/, ''), barre: Boolean(slash) }
}
