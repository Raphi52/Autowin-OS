/**
 * SCOUT INTERNE — des candidats d'AJOUT nés de l'app elle-même, pas d'un changelog concurrent.
 *
 * Demande utilisateur du 2026-08-13 : l'onglet Tickets > « Autowin OS » ne doit pas proposer que des
 * idées venues des concurrents — un scout doit analyser les conversations réellement loggées
 * (Observatory : cost.jsonl, prompt-observability, runs), les workflows et le code, et en tirer des
 * candidats de NOUVELLES CAPACITÉS. C'est le pendant « ajouts » d'`audit-interne` (qui, lui, produit
 * les corrections, par détecteurs déterministes) : ici la découverte est un jugement, donc un agent —
 * mais la PREUVE reste exigée, comme pour la veille web : chaque candidat porte un ancrage interne
 * (`fichier:ligne`) et une citation recopiée d'un artefact réellement lu. `trierCandidats` refuse déjà
 * ce qui n'en porte pas — le même contrôle en aval que pour le web, aucun chemin privilégié.
 */
import { lancerScoutCli } from './scout-claude'
import { extraireCandidats } from './passe'
import type { CandidatBrut } from './candidats'

export interface ParametresScoutInterne {
  /** Racine du dépôt — le scout y lit le code et les workflows. */
  racineDepot: string
  /** Racine de données de l'app — cost.jsonl, prompt-observability/, runs/, turn-journals/. */
  racineDonnees: string
}

export function construirePromptScoutInterne(params: ParametresScoutInterne): string {
  return [
    'Tu analyses Autowin OS DE L’INTÉRIEUR pour proposer des NOUVELLES CAPACITÉS (features), pas des',
    'corrections de bugs. Tes matières premières sont les traces d’usage réelles et le code :',
    `- traces d’usage : ${params.racineDonnees} (cost.jsonl, prompt-observability/, runs/, turn-journals/) ;`,
    `- code et workflows : ${params.racineDepot} (src/main, src/renderer, .claude/workflows s’il existe).`,
    '',
    'Cherche ce que l’usage RÉEL réclame : gestes répétés à la main dans les conversations, frictions',
    'visibles dans les runs (reprises, échecs récurrents d’une même famille), données loggées mais',
    'jamais exploitées par une vue, workflows que les utilisateurs recomposent à chaque fois.',
    '',
    'Rends un tableau JSON strict, sans aucun commentaire autour :',
    '[{"type":"ajout","titre":"...","url":"src/main/fichier.ts:123","dateSource":"...","citation":"...","langue":"fr","pertinence":0}]',
    '',
    'Règles :',
    '- `type` vaut TOUJOURS `ajout` : les corrections internes ont leur propre canal (audit interne).',
    '- `url` est un ANCRAGE INTERNE dans le DÉPÔT : `src/...:ligne` ou `scripts/...:ligne` — le code',
    '  qui prouve le manque (la vue qui n’exploite pas la donnée, le geste sans raccourci…). Les traces',
    '  d’usage INSPIRENT le candidat mais l’ancrage vit dans le code : un log est volatil, le code se',
    '  vérifie. Jamais une URL web, jamais un chemin que tu n’as pas ouvert.',
    '- `citation` est une ligne RECOPIÉE MOT POUR MOT du fichier ancré. C’est elle qu’un vérificateur',
    '  rejouera : une citation introuvable fait rejeter le candidat.',
    '- `dateSource` : la date de l’artefact lu si elle existe (horodatage de trace), sinon la date du jour.',
    '- `pertinence` : entier 0-100 — la valeur de la capacité pour Autowin OS, prouvée par l’usage',
    '  observé. En cas de doute, sous-note.',
    '- 3 à 8 candidats maximum : garde les plus forts, pas un inventaire.',
    '- Rien de solide à proposer → réponds exactement : []'
  ].join('\n')
}

export interface DepsScoutInterne extends ParametresScoutInterne {
  /** Injectable pour les tests : le vrai lanceur spawne le CLI Claude avec les outils de lecture. */
  lancer?: (prompt: string) => Promise<string>
}

/**
 * Lance le scout interne et rend ses candidats BRUTS, estampillés `Autowin OS`.
 *
 * Le concurrent est posé ICI, jamais par l'agent : même règle que la passe web (un scout ne rattache
 * pas une trouvaille à une origine qu'on ne lui a pas donnée). La sortie illisible rend `[]` avec un
 * échec nommé chez l'appelant — pas d'invention réparatrice.
 */
export async function candidatsDuScoutInterne(deps: DepsScoutInterne): Promise<CandidatBrut[]> {
  const lancer =
    deps.lancer ??
    ((prompt: string) =>
      // Outils de LECTURE seuls : un scout n'a rien à écrire ni à exécuter — et c'est aussi ce qui
      // l'empêche de « prouver » un besoin en le fabriquant.
      lancerScoutCli(prompt, { outils: ['Read', 'Grep', 'Glob'], cwd: deps.racineDepot }))
  const sortie = await lancer(construirePromptScoutInterne(deps))
  const bruts = extraireCandidats(sortie)
  if (!bruts) throw new Error('sortie du scout interne illisible : aucun JSON exploitable')
  return bruts.map((brut) => ({ ...brut, type: 'ajout', concurrent: 'Autowin OS' }))
}
