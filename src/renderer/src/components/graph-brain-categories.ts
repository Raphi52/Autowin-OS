import type { MetierGraphe } from '../../../main/viz/fs-brains'
import type { Langue } from '../../../shared/langue'
import { TEXTES_FR, traduireKnowledge, type CleKnowledge } from '../textes-ecrans/knowledge'
import { pathSegments, relativePathOf } from './graph-vault-paths'
import type { GraphNode } from './graph-view-model'

/** Fichiers de consigne à la racine du vault : des règles de conduite, pas des inclassables. */
const RACINE_CONDUITE = new Set(['claude.md', 'agents.md', 'readme.md', 'home.md', 'index.md'])

const has = (themes: readonly string[], ...cherches: string[]): boolean =>
  themes.some((theme) => cherches.includes(theme.toLowerCase()))

/**
 * L'AXE SUJET — « de quoi ça parle ». C'est lui qui a gagné la campagne d'architecture, et c'est lui
 * qui porte désormais le premier anneau de l'arbre.
 *
 * Mesuré sur 18 sous-agents, 18 questions à vérité-terrain vérifiée, 3 tirages par axe :
 *   · sujet          78 %, étendue 72-83 %   ← le meilleur ET le plus STABLE
 *   · nature         67 %, étendue 44-83 %   ← instable : il dépend du tirage
 *   · intention      61 %
 *   · sujet×intention 50 %   ← croiser deux axes NUIT, il faut réussir deux choix au lieu d'un
 *   · dossiers       28 %
 *   · liste plate    21 %
 *
 * Le sujet est retenu pour sa STABILITÉ : une architecture dont le résultat varie de 44 à 83 % selon
 * le tirage ne peut pas servir de socle.
 *
 * L'ORDRE des règles compte et n'est pas cosmétique : le sous-projet du domaine métier avant le
 * domaine (son chemin contient la clé du domaine, il serait avalé), et `autowin` avant tout le reste
 * (un chemin peut citer les deux).
 *
 * Le DOMAINE MÉTIER de l'entreprise (clé, libellé, sous-projet, documentation) vient de son profil
 * (`metier`, conv-916), transmis avec le Brain (`BrainGraphRef.metier`). Le code n'en nomme aucun :
 * sans profil (version publique), ses fiches restent dans les sujets génériques.
 */
export type BrainSubject = string

export function brainSubjectOf(
  node: Pick<GraphNode, 'id' | 'file' | 'themes'>,
  metier?: MetierGraphe
): BrainSubject {
  const themes = (node.themes ?? []).map((t) => t.toLowerCase())
  const chemin = relativePathOf(node).toLowerCase()
  const segments = pathSegments(chemin)

  if (chemin.includes('autowin')) return 'Autowin OS'
  if (chemin.includes('portail') || chemin.includes('fiche_nouveau')) return 'Portail'
  const sousProjet = metier?.sousProjet
  if (sousProjet && sousProjet.motifs.some((motif) => chemin.includes(motif)))
    return sousProjet.libelle
  if (has(themes, 'kit', 'process') || segments[0] === 'governance') return TEXTES_FR['sujet.kit']
  if (segments.length === 1 && RACINE_CONDUITE.has(segments[0])) return TEXTES_FR['sujet.kit']
  if (chemin.includes('brain') || segments[1] === '_maps') return TEXTES_FR['sujet.brain']
  if (metier && (chemin.includes(metier.cle) || has(themes, metier.cle)))
    return metier.libelle + '/' + sousDomaineMetier(segments, metier)
  if (segments[0] === 'inbox') return TEXTES_FR['sujet.aTrier']
  return TEXTES_FR['sujet.transverse']
}

/**
 * LE SUJET TEL QU'IL S'AFFICHE (traduction anglaise, conv-1170, 2026-10-27). `brainSubjectOf` rend le
 * FRANÇAIS parce que le sujet devient l'IDENTIFIANT de sa branche (`__tree__:Transverse/…`), relu
 * par le code — branches repliées, sélection — et qui ne doit pas changer avec la langue. Seul ce qui
 * est montré passe par ici. Un libellé qui n'est pas un sujet générique (dossier, domaine métier)
 * ressort tel quel.
 */
const CLES_DES_SUJETS: ReadonlyMap<string, CleKnowledge> = new Map(
  (
    [
      'sujet.kit',
      'sujet.brain',
      'sujet.aTrier',
      'sujet.transverse',
      'sujet.decisions',
      'sujet.savoirGeneral'
    ] as const
  ).map((cle) => [TEXTES_FR[cle], cle])
)

export function libelleDeSujet(libelle: string, langue: Langue): string {
  const cle = CLES_DES_SUJETS.get(libelle)
  return cle ? traduireKnowledge(cle, langue) : libelle
}

/**
 * Le second niveau du domaine métier — subdiviser le gros paquet À L'INTÉRIEUR de son secteur.
 *
 * Mesuré : le domaine métier porte 454 fiches sur 628. Sans second niveau, l'anneau suivant retombe sur les
 * dossiers bruts (`knowledge`, `projects`) et ne dit rien. Ce n'est PAS un croisement d'axes — la
 * campagne a montré que croiser sujet et intention fait chuter la justesse à 50 %, sous chacun des
 * axes pris seul. C'est le MÊME axe, affiné.
 *
 * Les sections ne sont pas inventées : ce sont celles que la documentation du domaine porte déjà
 * (`reference/70-edi-integrations`, `reference/proc`…). On retire seulement le préfixe numérique de
 * tri et les tirets, qui sont de la mécanique de dossier, pas du sens.
 */
function sousDomaineMetier(segments: readonly string[], metier: MetierGraphe): string {
  const i = metier.documentation ? segments.indexOf(metier.documentation) : -1
  if (i >= 0) {
    const section = segments[i + 1] === 'reference' ? segments[i + 2] : segments[i + 1]
    if (section) return section.replace(/^\d+-/, '').replace(/-/g, ' ')
  }
  // Les cartes de code d'un dépôt du domaine (`projects/<clé>-<dépôt>`) : leur dépôt EST leur
  // sous-domaine.
  const prefixe = `${metier.cle}-`
  if (segments[0] === 'projects' && segments[1]?.startsWith(prefixe))
    return segments[1].slice(prefixe.length)
  if (segments.includes('decisions') || segments.includes('lessons'))
    return TEXTES_FR['sujet.decisions']
  return TEXTES_FR['sujet.savoirGeneral']
}
