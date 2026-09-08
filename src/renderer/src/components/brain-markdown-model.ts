export type Frontmatter = {
  body: string
  entries: Array<{ key: string; value: string }>
}

export function splitFrontmatter(source: string): Frontmatter {
  const normalized = source.replace(/^\uFEFF/, '')
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(normalized)
  if (!match) return { body: normalized, entries: [] }
  const entries = match[1]
    .split(/\r?\n/)
    .map((line) => /^([\w-]+):\s*(.+)$/.exec(line))
    .filter((entry): entry is RegExpExecArray => entry !== null)
    .map((entry) => ({ key: entry[1], value: entry[2].replace(/^['"]|['"]$/g, '') }))
    .filter((entry) => !/^(?:\[\s*\]|\{\s*\})$/.test(entry.value.trim()))
  return { body: normalized.slice(match[0].length), entries }
}

/**
 * PLAFOND DE RENDU MARKDOWN — mesure du 2026-09-08 sur le Brain reel.
 *
 * `remark-parse` + `remark-gfm` sont QUADRATIQUES sur les grandes notes de documentation :
 * 40 000 caracteres = 160 ms, 80 000 = 768 ms, 120 000 = 1 749 ms, 200 000 = 7 036 ms — et ce
 * n'est que l'analyse, avant la construction des elements React et la mise en page. Le contenu
 * arrive plafonne a 200 000 caracteres (`readNodeFile`), et cinq fiches du Brain depassent
 * 200 ko (`modele-ult.md` : 809 ko). Cliquer l'une d'elles figeait la fenetre — le travail se
 * fait dans le rendu, donc rien ne pouvait l'interrompre et rien ne le journalisait.
 *
 * Au-dela du plafond, la note s'affiche en TEXTE BRUT : rien n'est tronque, seul le formatage
 * est abandonne.
 */
export const MARKDOWN_RENDU_MAX_CARACTERES = 40_000

/** Vrai quand la note peut etre formatee sans tenir la fenetre. */
export function markdownRendable(body: string): boolean {
  return body.length <= MARKDOWN_RENDU_MAX_CARACTERES
}
