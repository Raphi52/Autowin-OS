/**
 * Lecture des arguments tels que les envoient les deux voies d'appel (`<cmd>` et outil direct).
 *
 * Code libre sorti de `commands.ts` tel quel (conv-1580, lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

/**
 * Normalise l'argument `display` de desktop_observe : un rang 1-base, ou undefined pour tout le bureau.
 * Le modele envoie parfois un nombre sous forme de chaine ; tout le reste est un refus explicite.
 */
export function parseDisplayArg(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw
  // 0 = reflexe 0-base du modele (conv-30, 2026-09-01) : on le lit comme l'ecran principal
  // plutot que de brûler un aller-retour sur un refus.
  if (value === 0) return 1
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`display invalide: ${JSON.stringify(raw)} (entier >= 1 attendu)`)
  }
  return value
}

/**
 * Une liste telle que l'envoient les DEUX voies d'appel (conv-927, 2026-10-13). La voie <cmd>
 * passe un vrai tableau ; l'outil natif ne peut passer qu'une CHAINE, parce que `schemaEntree`
 * (skill-node-mcp.ts) declare tout argument en `type: 'string'` — meme raison que le `'true'`
 * accepte juste au-dessus. Seule une chaine qui se LIT comme un tableau JSON est acceptee : un
 * identifiant nu (« agent-a ») reste refuse, avec le meme message qu'avant.
 */
export function listeEnvoyee(brut: unknown, refus: string): unknown[] {
  if (Array.isArray(brut)) return brut
  const lu: unknown = typeof brut === 'string' ? jsonOuRien(brut) : undefined
  if (Array.isArray(lu)) return lu
  throw new Error(refus)
}

function jsonOuRien(texte: string): unknown {
  try {
    return JSON.parse(texte)
  } catch {
    return undefined // pas du JSON : l'appelant leve son refus nomme
  }
}

export const argumentAbsent = (brut: unknown): boolean =>
  brut === undefined || brut === null || (typeof brut === 'string' && !brut.trim())

/**
 * Un entier tel que l'envoient les DEUX voies d'appel (conv-1370, 2026-10-31) : vrai nombre par
 * l'outil direct, texte par `<cmd>`. Absent = `undefined`. Toute autre forme est REFUSÉE en nommant
 * l'argument : `Number(x) || defaut` l'ignorait et rendait autre chose que la demande, sans le dire.
 */
export function entierEnvoye(brut: unknown, nom: string, minimum: number): number | undefined {
  if (argumentAbsent(brut)) return undefined
  const lu = typeof brut === 'string' ? Number(brut.trim()) : brut
  if (typeof lu !== 'number' || !Number.isInteger(lu) || lu < minimum) {
    throw new Error(`\`${nom}\` invalide : ${JSON.stringify(brut)} (entier >= ${minimum} attendu)`)
  }
  return lu
}

/**
 * Un booléen, même règle. `=== true` seul ne voyait pas le « true » du texte : `oublier: "true"`
 * MARQUAIT le travail au lieu de l'oublier, sans rien dire (conv-1370).
 */
export function booleenEnvoye(brut: unknown, nom: string): boolean {
  if (argumentAbsent(brut) || brut === false || brut === 'false') return false
  if (brut === true || brut === 'true') return true
  throw new Error(`\`${nom}\` invalide : ${JSON.stringify(brut)} (true ou false attendu)`)
}
