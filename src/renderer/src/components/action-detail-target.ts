/**
 * Un groupe d'actions a-t-il quelque chose a montrer DANS Workflows ?
 *
 * Constate en usage reel (2026-07-29) : sur « 1 action terminee · 1 action en cours — edit_file ·
 * verify », cliquer le bloc n'affichait RIEN. Cause : le bloc renvoie vers Workflows, mais seule une
 * ORCHESTRATION y produit une carte (`liveRunCardRef` n'est attache qu'aux runs). Les commandes
 * locales livrees le meme jour — `edit_file`, `verify`, `brain_query` — ne creent aucun run : le
 * scroll visait donc un element inexistant.
 *
 * Un bouton qui promet ce qu'il ne peut pas tenir est pire qu'un bloc inerte : l'utilisateur clique,
 * rien ne bouge, et il ne sait pas si c'est casse ou si c'est lui. D'ou cette decision explicite —
 * s'il n'y a pas de run, le detail doit s'afficher SUR PLACE, pas ailleurs.
 */

/** Commandes qui produisent un run consultable dans Workflows. */
const RUN_PRODUCING = new Set(['orchestrate'])

export interface ActionLike {
  name: string
  ok?: boolean
  interrupted?: boolean
  data?: unknown
}

/** Vrai si AU MOINS une action du groupe a produit (ou produit) un run consultable. */
export function hasConsultableRun(actions: readonly ActionLike[]): boolean {
  return actions.some((action) => {
    if (RUN_PRODUCING.has(action.name)) return true
    // Repli robuste : une action qui porte une reference de run est consultable, quel que soit son nom.
    const data = action.data
    if (!data || typeof data !== 'object') return false
    const reference = data as { runPath?: unknown; runId?: unknown }
    return typeof reference.runPath === 'string' || typeof reference.runId === 'string'
  })
}

/** Detail lisible d'une action LOCALE, a montrer dans le fil faute de run. */
export interface LocalActionDetail {
  name: string
  /** Diff d'une edition, sortie d'une verification, ou raison d'un refus. */
  text: string
  ok: boolean
}

/** Au-dela, on ne lit plus : on noie. Mesure reelle sur une sortie de suite complete : 187 000 car. */
const MAX_DETAIL_CHARS = 3_000

/** Sequences de couleur du terminal : elles ne veulent rien dire dans une interface. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*[A-Za-z]/gu

/**
 * Lignes qui PORTENT l'echec. Tout le reste d'une sortie de suite — les tests verts, les compteurs
 * de duree, les journaux d'etape — enterre le signal sous des milliers de lignes.
 */
const LIGNE_UTILE =
  /(^|\s)(FAIL|×|✗|AssertionError|TypeError|RangeError|ReferenceError|SyntaxError|Error:|Expected|Received|\d+\s+failed)/u

/** Une ligne de SUCCES ne dit rien d'un echec : elle n'a rien a faire dans le resume. */
const LIGNE_VERTE = /(^|\s)(✓|OK\s|passed\b|TOUS VERTS)/u

/**
 * Resume lisible d'une sortie brute.
 *
 * Retour utilisateur du 2026-08-19 : « c'est pas super clair a comprendre pour moi ». La cause etait
 * bien affichee, mais noyee dans 3000 caracteres de sortie vitest coloree. Montrer trop equivaut a
 * ne rien montrer.
 *
 * On garde la PREMIERE ligne — c'est la cause, telle que la commande l'annonce — puis les seules
 * lignes qui portent un echec, dedupliquees. Si rien ne ressort, on retombe sur le texte borne :
 * mieux vaut du brut que du vide.
 */
function resumeLisible(brut: string): string {
  const lignes = brut
    .replace(ANSI, '')
    .split('\n')
    .map((ligne) => ligne.replace(/\s+$/u, ''))
    .filter((ligne) => ligne.trim().length > 0)
  if (lignes.length === 0) return ''
  const retenues = [lignes[0]]
  for (const ligne of lignes.slice(1)) {
    if (LIGNE_VERTE.test(ligne) || !LIGNE_UTILE.test(ligne)) continue
    const propre = ligne.trim()
    if (!retenues.some((deja) => deja.trim() === propre)) retenues.push(propre)
    if (retenues.length >= 7) break
  }
  const texte = retenues.join('\n')
  return texte.length > MAX_DETAIL_CHARS ? `${texte.slice(0, MAX_DETAIL_CHARS)}…` : texte
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/**
 * Extrait ce qu'il y a d'utile a LIRE dans le resultat d'une commande locale. Rien d'exploitable →
 * l'action est ignoree plutot que rendue comme une ligne vide.
 */
export function localActionDetails(actions: readonly ActionLike[]): LocalActionDetail[] {
  const details: LocalActionDetail[] = []
  for (const action of actions) {
    /**
     * `data` n'est PAS toujours un objet. Un `edit_file` en echec rend une CHAINE — verifie dans les
     * messages reels (conv-1308, conv-1326) : « Le bureau edit_file a ete conserve : publication
     * automatique incomplete ». `asRecord` rendait `undefined` et l'action etait SAUTEE : la cause
     * etait la, entiere, et se faisait jeter parce que le lecteur ne connaissait qu'une forme.
     *
     * On borne : les sorties reelles montent a 187 000 caracteres (une suite de tests complete).
     */
    if (typeof action.data === 'string') {
      const brut = action.data.trim()
      if (!brut) continue
      const texte = resumeLisible(brut)
      if (!texte) continue
      details.push({ name: action.name, text: texte, ok: action.ok !== false })
      continue
    }
    const data = asRecord(action.data)
    if (!data) continue
    const ok = action.ok !== false && data.allowed !== false
    // Un refus explique POURQUOI : c'est l'information la plus utile du lot.
    const reason = typeof data.reason === 'string' ? data.reason : undefined
    const diff = typeof data.diff === 'string' ? data.diff : undefined
    const output = typeof data.output === 'string' ? data.output : undefined
    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined
    const knowledge = typeof data.knowledge === 'string' ? data.knowledge : undefined
    /**
     * La CAUSE d'un echec. Une commande qui echoue rend `{ ok: false, error: <message> }`
     * (`commands.ts:1120`), et ce champ n'etait lu par personne : faute de texte, l'action etait
     * IGNOREE. Vecu le 2026-08-18 — « 1 action avec erreur — graphify » dans le fil, et rien d'autre.
     * Un echec sans sa raison n'apprend rien ; c'est precisement le moment ou l'utilisateur en a le
     * plus besoin. Place APRES `reason`, qui reste prioritaire : un refus explique deja pourquoi.
     */
    const error =
      typeof data.error === 'string' && data.error.trim() ? data.error.trim() : undefined
    /**
     * Une vérification qui PASSE n'a rien à raconter : son verdict est « exit 0 », et le reste est
     * la sortie de l'outil — souvent des milliers de lignes de bruit (avertissements git, worktrees
     * préparés) tronquées à leur queue la moins parlante. On ne montre donc la sortie que lorsqu'elle
     * sert : quand ça a ÉCHOUÉ. Constaté en usage : un pavé de 68 000 caractères sous un « exit 0 ».
     */
    const succeeded = ok && exitCode === 0
    const text =
      reason ??
      error ??
      diff ??
      (output !== undefined || exitCode !== undefined
        ? [exitCode !== undefined ? `exit ${exitCode}` : '', succeeded ? '' : (output ?? '')]
            .filter(Boolean)
            .join('\n')
        : undefined) ??
      knowledge
    if (!text || !text.trim()) continue
    details.push({ name: action.name, text: text.trim(), ok })
  }
  return details
}
