import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * REGIME DE CONTEXTE du spawn CLI — ce qu'on refuse de payer a chaque appel.
 *
 * Mesures du 2026-07-28 sur les journaux reels : 34 outils DECLARES alors que 3 seulement etaient
 * autorises en read-only, et 45 slash-commands + 18 skills chargees par le CLI malgre
 * `--setting-sources ''`. Rien de tout cela n'est utilise : Autowin pilote par prompt.
 *
 * La semantique vient de la doc du CLI, verifiee et non supposee :
 *   --tools        « the list of available tools from the built-in set » → restreint ce qui est CHARGE
 *   --allowedTools « tool names to allow »                              → restreint l'USAGE
 * Les deux sont necessaires : `--allowedTools` seul laissait les 34 definitions dans le prompt.
 */
const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')

describe('spawn CLI — regime de contexte', () => {
  it('restreint les outils CHARGES, pas seulement autorises', () => {
    expect(source).toContain("'--tools',")
    expect(source).toContain("'--allowedTools',")
    // Les deux doivent recevoir la MEME liste : sinon on autorise un outil non charge (ou l'inverse).
    const execBlock = source.slice(source.indexOf('if (execution) {'), source.indexOf('let systemPromptDir'))
    const toolsArgs = [...execBlock.matchAll(/'--(?:allowed)?[Tt]ools',\s*\n?\s*(\w+)/g)].map((m) => m[1])
    expect(toolsArgs.length).toBeGreaterThanOrEqual(2)
    expect(new Set(toolsArgs).size).toBe(1) // une seule variable source
  })

  it('desactive les slash-commands et skills du CLI (jamais utilisees ici)', () => {
    expect(source).toContain("'--disable-slash-commands'")
  })

  it('ne charge AUCUNE source de reglages (user/project/local)', () => {
    expect(source).toContain("'--setting-sources',")
  })

  it('REMPLACE le system prompt, ne s’y ajoute jamais', () => {
    expect(source).toContain("'--system-prompt'")
    expect(source).toContain("'--system-prompt-file'")
    // `--append-system-prompt` empilerait notre socle SUR celui du CLI : jamais.
    expect(source).not.toContain('append-system-prompt')
  })

  it('n’utilise PAS --bare : il couperait l’auto-memory mais aussi l’auth par abonnement', () => {
    // La doc : « Anthropic auth is strictly ANTHROPIC_API_KEY … OAuth and keychain are never read ».
    // Autowin passe par le CLI justement pour utiliser l'abonnement — le flag serait un piege de
    // facturation, pas une economie.
    expect(source).not.toContain("'--bare'")
  })
})
