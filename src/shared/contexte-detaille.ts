/**
 * LE CONTEXTE PAR CATEGORIE — comme le panneau « Contexte » de claude.exe (demande conv-1000,
 * 2026-10-16 : « fais un truc comme claude.exe pour le contexte popup »).
 *
 * La jauge (`context-gauge.ts`) ne disait que COMBIEN le fil occupe. Ce module dit DE QUOI : prompt
 * systeme, outils, outils MCP, fichiers memoire, skills, messages, reserve, espace libre.
 *
 * D'OU VIENNENT LES CHIFFRES. Rien n'est estime ici : le CLI Claude repond a une requete de controle
 * `get_context_usage` (mesure du 2026-10-16, CLI 2.1.301 : ~1,1 s, AUCUN appel au modele). La sonde
 * est lancee EN PARALLELE du tour (`providers/claude-sonde-contexte.ts`) avec les memes arguments :
 * elle voit donc le meme prompt systeme, les memes outils et le meme serveur MCP, mais PAS les
 * messages du tour, qui n'existent pas encore. On ne garde d'elle que la partie FIXE du contexte.
 *
 * LES MESSAGES SE DEDUISENT, ils ne se mesurent pas a part. C'est aussi ce que fait le CLI : sur une
 * session reprise, changer le prompt systeme deplacait l'ecart vers « Messages » et laissait le total
 * identique (277 595 dans les deux mesures du 2026-10-16). Ici : Messages = occupation reelle du
 * dernier appel (la jauge) − partie fixe. Le total reste donc celui que l'API a facture.
 */

/** Rang d'une categorie dans le panneau, et la classe CSS qui la peint. */
export type GenreCategorie = 'utilise' | 'differe' | 'reserve' | 'libre'

export interface CategorieContexte {
  /** Cle stable (couleur, tests) — derivee du nom du CLI. */
  readonly cle: string
  readonly libelle: string
  readonly tokens: number
  readonly genre: GenreCategorie
}

export interface ElementContexte {
  readonly nom: string
  readonly tokens: number
}

/** Ce que la sonde mesure : tout le contexte SAUF les messages. Persiste par conversation. */
export interface ContexteStatique {
  /** Categories fixes, noms du CLI conserves (la traduction est faite a l'affichage). */
  readonly categories: readonly { nom: string; tokens: number; differe: boolean }[]
  /** Reserve d'auto-compaction : une place que le CLI s'interdit d'utiliser. */
  readonly reserve: number
  readonly outilsMcp: readonly ElementContexte[]
  readonly fichiersMemoire: readonly ElementContexte[]
  readonly skills: readonly ElementContexte[]
  /** Fenetre declaree par le CLI pour le modele servi. */
  readonly max: number
  readonly modele?: string
  /** Horodatage de la mesure : un detail d'un autre tour se dit comme tel. */
  readonly mesureLe: number
}

/** Le panneau entier, pret a peindre. */
export interface ContexteDetaille {
  readonly utilise: number
  readonly limite: number
  readonly categories: readonly CategorieContexte[]
  readonly outilsMcp: readonly ElementContexte[]
  readonly fichiersMemoire: readonly ElementContexte[]
  readonly skills: readonly ElementContexte[]
  readonly mesureLe: number
}

/**
 * Libelles francais des categories du CLI. Un nom absent de la table reste affiche tel quel :
 * une categorie ajoutee par une future version du CLI se voit, elle ne disparait pas.
 */
const LIBELLES: Record<string, string> = {
  'System prompt': 'Prompt système',
  'System tools': 'Outils système',
  'MCP tools': 'Outils MCP',
  'Memory files': 'Fichiers mémoire',
  Skills: 'Skills',
  'MCP server instructions': 'Instructions des serveurs MCP',
  'Custom agents': 'Agents',
  Messages: 'Messages',
  'Autocompact buffer': 'Réserve d’auto-compaction',
  'Free space': 'Espace libre'
}

const DIFFERE = / \(deferred\)$/

/** Cle CSS d'un nom de categorie du CLI : `MCP tools (deferred)` → `mcp-tools`. */
export function cleCategorie(nom: string): string {
  return nom
    .replace(DIFFERE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function libelleCategorie(nom: string): string {
  const differe = DIFFERE.test(nom)
  const base = nom.replace(DIFFERE, '')
  const libelle = LIBELLES[base] ?? base
  return differe ? `${libelle} (différés)` : libelle
}

const entier = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined

const texte = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined

/** Une liste d'elements nommes, triee du plus lourd au plus leger ; les entrees illisibles partent. */
function elements(
  brut: unknown,
  nommer: (o: Record<string, unknown>) => string | undefined
): ElementContexte[] {
  if (!Array.isArray(brut)) return []
  const lus: ElementContexte[] = []
  for (const e of brut) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const nom = nommer(o)
    const tokens = entier(o['tokens'])
    if (nom && tokens !== undefined) lus.push({ nom, tokens })
  }
  return lus.sort((a, b) => b.tokens - a.tokens)
}

/** Categories que la sonde ne PEUT pas mesurer juste : elles se recalculent a l'affichage. */
const CALCULEES = new Set(['Messages', 'Free space', 'Autocompact buffer'])

/**
 * Lit la reponse `get_context_usage` du CLI. `undefined` des que la forme attendue manque : un
 * detail a moitie lu serait affiche comme complet.
 */
export function lireReponseContexte(brut: unknown, mesureLe: number): ContexteStatique | undefined {
  if (!brut || typeof brut !== 'object') return undefined
  const r = brut as Record<string, unknown>
  const max = entier(r['maxTokens'])
  if (!max || !Array.isArray(r['categories'])) return undefined
  const categories: { nom: string; tokens: number; differe: boolean }[] = []
  let reserve = 0
  for (const c of r['categories'] as unknown[]) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const nom = texte(o['name'])
    const tokens = entier(o['tokens'])
    if (!nom || tokens === undefined) continue
    if (nom === 'Autocompact buffer') reserve = tokens
    if (CALCULEES.has(nom)) continue
    categories.push({ nom, tokens, differe: o['isDeferred'] === true || DIFFERE.test(nom) })
  }
  const skills = (r['skills'] as Record<string, unknown> | undefined)?.['skillFrontmatter']
  return {
    categories,
    reserve,
    max,
    ...(texte(r['model']) ? { modele: r['model'] as string } : {}),
    // claude.exe ecrit « Serveur · outil » : le prefixe `mcp__serveur__` n'apprend rien de plus.
    outilsMcp: elements(r['mcpTools'], (o) => {
      const nom = texte(o['name'])
      if (!nom) return undefined
      const serveur = texte(o['serverName'])
      const court = serveur ? nom.replace(`mcp__${serveur}__`, '') : nom
      return serveur ? `${serveur} · ${court}` : court
    }),
    fichiersMemoire: elements(r['memoryFiles'], (o) => texte(o['path'])),
    skills: elements(skills, (o) => texte(o['name'])),
    mesureLe
  }
}

/**
 * Compose le panneau : la partie fixe mesuree par la sonde + l'occupation REELLE du dernier appel.
 *
 * `utilise` est la jauge (entree du dernier appel, `occupationDeFenetre`) : c'est elle qui fait foi.
 * Si la partie fixe la depasse (jauge absente, estimation du CLI plus large que la facture), les
 * « Messages » sont bornes a zero et le total devient la partie fixe : les barres ne debordent jamais
 * du total affiche, et aucune categorie n'est rendue negative.
 */
export function composerContexte(
  statique: ContexteStatique,
  utilise: number,
  limite: number
): ContexteDetaille {
  const fixes = statique.categories.filter((c) => !c.differe)
  const sommeFixe = fixes.reduce((s, c) => s + c.tokens, 0)
  const messages = Math.max(0, utilise - sommeFixe)
  const libre = Math.max(0, limite - Math.max(utilise, sommeFixe) - statique.reserve)
  const vers = (nom: string, tokens: number, genre: GenreCategorie): CategorieContexte => ({
    cle: cleCategorie(nom),
    libelle: libelleCategorie(nom),
    tokens,
    genre
  })
  const utilisees = [
    ...fixes.map((c) => vers(c.nom, c.tokens, 'utilise' as const)),
    // Avant le premier tour d'une session, la sonde existe deja mais aucun message non.
    ...(utilise > 0 ? [vers('Messages', messages, 'utilise')] : [])
  ].sort((a, b) => b.tokens - a.tokens)
  return {
    utilise: Math.max(utilise, sommeFixe),
    limite,
    categories: [
      ...utilisees,
      ...(statique.reserve > 0 ? [vers('Autocompact buffer', statique.reserve, 'reserve')] : []),
      vers('Free space', libre, 'libre'),
      ...statique.categories.filter((c) => c.differe).map((c) => vers(c.nom, c.tokens, 'differe'))
    ],
    outilsMcp: statique.outilsMcp,
    fichiersMemoire: statique.fichiersMemoire,
    skills: statique.skills,
    mesureLe: statique.mesureLe
  }
}

/** « 93.9k », « 733 », « 1M » — la notation du panneau de claude.exe. */
export function tokensCourts(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
