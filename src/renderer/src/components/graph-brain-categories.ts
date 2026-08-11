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
 * L'ORDRE des règles compte et n'est pas cosmétique : `rig-tv` avant `rig` (sinon RIG-TV serait avalé
 * par RIG), et `autowin` avant tout le reste (un chemin peut citer les deux).
 */
export type BrainSubject = string

export function brainSubjectOf(node: Pick<GraphNode, 'id' | 'file' | 'themes'>): BrainSubject {
  const themes = (node.themes ?? []).map((t) => t.toLowerCase())
  const chemin = relativePathOf(node).toLowerCase()
  const segments = pathSegments(chemin)

  if (chemin.includes('autowin')) return 'Autowin OS'
  if (chemin.includes('portail') || chemin.includes('fiche_nouveau')) return 'Portail Amitel'
  if (chemin.includes('rig-tv') || chemin.includes('rigtv') || chemin.includes('testviewer'))
    return 'RIG-TV'
  if (has(themes, 'kit', 'process') || segments[0] === 'governance')
    return 'Le kit et la façon de travailler'
  if (segments.length === 1 && RACINE_CONDUITE.has(segments[0]))
    return 'Le kit et la façon de travailler'
  if (chemin.includes('brain') || segments[1] === '_maps') return 'Le Brain lui-même'
  if (chemin.includes('rig') || has(themes, 'rig')) return 'RIG/' + sousDomaineRig(segments)
  if (segments[0] === 'inbox') return 'À trier'
  return 'Transverse'
}

/**
 * Le second niveau de RIG — subdiviser le gros paquet À L'INTÉRIEUR de son secteur.
 *
 * Mesuré : RIG porte 454 fiches sur 628. Sans second niveau, l'anneau suivant retombe sur les
 * dossiers bruts (`knowledge`, `projects`) et ne dit rien. Ce n'est PAS un croisement d'axes — la
 * campagne a montré que croiser sujet et intention fait chuter la justesse à 50 %, sous chacun des
 * axes pris seul. C'est le MÊME axe, affiné.
 *
 * Les sections ne sont pas inventées : ce sont celles que la documentation RIG porte déjà
 * (`reference/70-edi-integrations`, `reference/proc`…). On retire seulement le préfixe numérique de
 * tri et les tirets, qui sont de la mécanique de dossier, pas du sens.
 */
function sousDomaineRig(segments: readonly string[]): string {
  const i = segments.indexOf('rigapplication-documentation')
  if (i >= 0) {
    const section = segments[i + 1] === 'reference' ? segments[i + 2] : segments[i + 1]
    if (section) return section.replace(/^\d+-/, '').replace(/-/g, ' ')
  }
  // Les cartes de code d'un dépôt RIG : leur nom de dépôt EST leur sous-domaine.
  if (segments[0] === 'projects' && segments[1]?.startsWith('rig-')) return segments[1].slice(4)
  if (segments.includes('decisions') || segments.includes('lessons')) return 'décisions et leçons'
  return 'savoir général'
}
