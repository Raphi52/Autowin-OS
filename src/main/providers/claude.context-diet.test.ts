import { describe, expect, it } from 'vitest'
import { CHAT_READ_ONLY_SHELL } from './claude'
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
    // Tranche bornee a la branche EXECUTEUR seule. Elle allait jusqu'a `systemPromptDir`, donc elle
    // englobait aussi les branches suivantes ; depuis que celles-ci passent leur propre constante
    // d'outils web, la tranche large voyait deux variables et le test echouait alors qu'aucune
    // propriete n'etait cassee. C'est l'instrument qui etait trop large, pas le code qui a derive.
    const execBlock = source.slice(
      source.indexOf('if (execution) {'),
      source.indexOf('} else if (materialized) {')
    )
    /**
     * `--tools` recoit la liste a VIRGULES, `--allowedTools` la MEME liste en arguments SEPARES.
     *
     * La propriete protegee ici est inchangee — les deux drapeaux portent la meme liste, sinon on
     * autorise un outil non charge (ou l'inverse). Ce qui a change est la FORME, et elle a ete mesuree
     * en A/B sur le CLI reel : avec `--allowedTools WebFetch,WebSearch`, une recuperation de page PEND
     * jusqu'au delai maximum (code 124) ; avec les arguments separes, elle repond en quelques secondes.
     * Une chaine a virgules sur ce drapeau donne donc un outil DECLARE et inutilisable.
     */
    expect(execBlock).toMatch(/'--tools',\s*tools,\s*'--allowedTools',\s*\.\.\.autorises\(tools\)/)
    expect(source).toContain("const autorises = (liste: string): string[] => liste.split(',')")
  })

  it('desactive les slash-commands et skills du CLI (jamais utilisees ici)', () => {
    expect(source).toContain("'--disable-slash-commands'")
  })

  it('ne charge AUCUNE source de reglages (user/project/local)', () => {
    expect(source).toContain("'--setting-sources',")
    // La VALEUR, pas seulement le flag : `'user'` ou `'project'` ramenerait le CLAUDE.md de
    // l'utilisateur dans CHAQUE appel, et l'ancien test serait reste vert. Verifie empiriquement le
    // 2026-08-04 par A/B sur le CLI reel : sans le flag il recite les regles du CLAUDE.md global mot
    // pour mot, avec `--setting-sources ''` il repond n'en avoir aucune.
    expect(source).toMatch(/'--setting-sources',\s*\n?\s*''/)
  })

  it('REMPLACE le system prompt, ne s’y ajoute jamais', () => {
    expect(source).toContain("'--system-prompt'")
    expect(source).toContain("'--system-prompt-file'")
    // `--append-system-prompt` empilerait notre socle SUR celui du CLI : jamais.
    expect(source).not.toContain('append-system-prompt')
  })

  it('ramene la memoire auto au PROJET COURANT (et non celle d’un autre projet)', () => {
    // Mesure du 2026-07-28 : le settings.json de l'utilisateur pointait autoMemoryDirectory sur
    // ~/.claude/projects/C--Code-RIG/memory (552 Ko) — chargee a chaque appel alors qu'Autowin
    // travaille ailleurs. Cout mesure : 10 272 tokens contre 1 072 sans, soit ~9 200 par appel.
    expect(source).toContain("'--settings'")
    expect(source).toContain('autoMemoryDirectory')
  })

  it('n’ecrit JAMAIS dans le settings.json de l’utilisateur (fichier temporaire dedie)', () => {
    const block = source.slice(
      source.indexOf('let settingsDir'),
      source.indexOf('let systemPromptDir')
    )
    expect(block).toContain('mkdtempSync(')
    // Le kit de l'utilisateur ne doit pas etre modifie pour economiser des tokens.
    expect(block).not.toContain('.claude')
  })

  it('nettoie le dossier temporaire de reglages (pas de fuite disque)', () => {
    expect(source).toMatch(/if \(settingsDir\) rmSync\(settingsDir/)
  })

  it('donne la LECTURE SEULE au tour de chat (il n’est plus aveugle)', () => {
    // Avant : `--disallowedTools '*'` -> l'agent ne pouvait rien lire, donc toute question factuelle
    // exigeait une orchestration (conv-75 : 38,68 $). Verifie en reel : sans outils il repond « Je
    // dois verifier le fichier » ; avec Read/Grep/Glob il repond juste, pour ~0,12 $.
    const chatBranch = source.slice(source.indexOf('} else {'), source.indexOf('let settingsDir'))
    expect(chatBranch).toContain("'--add-dir'")
    // JAMAIS d'ECRITURE sur un tour de chat : un dialogue ne mute rien.
    const toolLists = [...chatBranch.matchAll(/'([A-Z][A-Za-z]*(?:,[A-Z][A-Za-z]*)*)'/g)].map(
      (m) => m[1]
    )
    expect(toolLists.length).toBeGreaterThan(0)
    for (const list of toolLists) {
      for (const mutating of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
        expect(list.split(',')).not.toContain(mutating)
      }
    }
  })

  it('ouvre le shell du chat UNIQUEMENT sur des commandes incapables de muter', () => {
    // Le contrat a CHANGÉ le 2026-08-04 : avant, aucun shell du tout. L'intention (un dialogue ne
    // mute rien) était juste, mais l'agent ne pouvait pas constater l'état du dépôt et devait
    // router vers une orchestration, qui répond depuis un worktree ISOLÉ — à côté de la question.
    // La propriété remplaçante est PLUS FORTE : shell ouvert, mais par périmètres vérifiés.
    const chatBranch = source.slice(source.indexOf('} else {'), source.indexOf('let settingsDir'))
    // Bash n'est jamais autorisé NU dans la branche chat (ce serait `rm`, `git checkout`, …).
    /**
     * La propriete est INCHANGEE : Bash n'apparait que dans la liste CHARGEE (`--tools`), jamais parmi
     * les outils AUTORISES nus — il n'est autorise que par perimetres verifies.
     *
     * Ce qui change est la FORME de la liste chargee : elle est desormais concatenee avec les outils web
     * (`'Read,Grep,Glob,Bash,' + OUTILS_WEB`), suite a la decision utilisateur du 2026-08-13 « je veux
     * que les agents soient florissants, expansifs, libres ». L'ancienne regex ne cherchait qu'un
     * litteral entierement majuscule-separe-de-virgules, donc elle ne voyait plus rien et rendait une
     * liste VIDE : un test qui passe a cote de sa propriete au lieu de la contredire.
     */
    expect(chatBranch).toMatch(/'--tools',\s*'Read,Grep,Glob,Bash,' \+ OUTILS_WEB/)
    // Et le point dur : aucun `'Bash'` isole dans cette branche, ce qui signalerait un Bash AUTORISE nu.
    const bashNu = [...chatBranch.matchAll(/(?<![A-Za-z,])'Bash'/g)]
    expect(bashNu).toHaveLength(0)
    expect(chatBranch).toContain('CHAT_READ_ONLY_SHELL')

    // Chaque périmètre est scopé, et sur un verbe git strictement lisible.
    const READ_ONLY_VERBS = [
      'status',
      'log',
      'diff',
      'show',
      'stash list',
      'rev-parse',
      'ls-files',
      'ls-remote',
      'worktree list'
    ]
    expect(CHAT_READ_ONLY_SHELL.length).toBeGreaterThan(0)
    for (const spec of CHAT_READ_ONLY_SHELL) {
      const scoped = spec.match(/^Bash\(git (.+?):\*\)$/)
      expect(scoped, `${spec} doit être un périmètre Bash(git …:*)`).not.toBeNull()
      expect(READ_ONLY_VERBS).toContain(scoped![1])
    }

    // DISCRIMINANT : aucun verbe mutant ne doit être atteignable, y compris ceux qui commencent
    // par un préfixe autorisé (`git stash list` est permis, `git stash push` ne doit PAS l'être).
    for (const mutating of [
      'checkout',
      'reset',
      'clean',
      'commit',
      'push',
      'pull',
      'branch',
      'remote',
      'stash push',
      'stash pop',
      'rm',
      'mv'
    ]) {
      for (const spec of CHAT_READ_ONLY_SHELL) {
        const prefix = spec.replace(/^Bash\(git /, '').replace(/:\*\)$/, '')
        expect(
          mutating.startsWith(prefix),
          `${mutating} ne doit pas être couvert par le périmètre « ${prefix} »`
        ).toBe(false)
      }
    }
  })

  it('sans workspace resolu, ne devine aucun dossier — mais garde le WEB', () => {
    // Avant, cette branche passait `--disallowedTools '*'` : sans workspace, l'agent perdait TOUT moyen
    // de fonder une reponse et ne pouvait plus que deviner. La propriete a preserver n'etait pas
    // « aucun outil », c'etait « aucun dossier devine » — et elle tient toujours : rien n'est ajoute au
    // disque, seul le web reste. Changement demande par l'utilisateur le 2026-08-13.
    const chatBranch = source.slice(source.indexOf('} else {'), source.indexOf('let settingsDir'))
    expect(chatBranch).not.toContain("'--add-dir', readOnlyWorkspace, '--tools', 'Read'")
    expect(chatBranch).toMatch(
      /'--tools', OUTILS_WEB, '--allowedTools', \.\.\.autorises\(OUTILS_WEB\)/
    )
    expect(chatBranch).toContain('existsSync(')
  })

  it('n’utilise PAS --bare : il couperait l’auto-memory mais aussi l’auth par abonnement', () => {
    // La doc : « Anthropic auth is strictly ANTHROPIC_API_KEY … OAuth and keychain are never read ».
    // Autowin passe par le CLI justement pour utiliser l'abonnement — le flag serait un piege de
    // facturation, pas une economie.
    expect(source).not.toContain("'--bare'")
  })
})
