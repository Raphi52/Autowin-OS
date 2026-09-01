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

  it('nettoie le dossier temporaire de reglages (pas de fuite disque), sans figer la boucle', () => {
    // La propriete protegee reste la MEME — le dossier temporaire par appel est bien supprime.
    // Ce qui a change est le GESTE : `rmSync` figeait la fin de chaque appel (mesure reelle du
    // 2026-08-31 dans gels.jsonl : 1 625 ms). Le nettoyage passe maintenant par une fonction
    // asynchrone dediee, dont l'effet est prouve par `claude.nettoyage-non-bloquant.test.ts`.
    expect(source).toMatch(/await nettoyerTemporairesDeLAppel\(\{[\s\S]*?settingsDir/)
    expect(source).not.toMatch(/if \(settingsDir\) rmSync\(settingsDir/)
  })

  it('donne le PLEIN OUTILLAGE au tour de chat (il n’est ni aveugle ni manchot)', () => {
    // Etape 1 (avant le 2026-08-04) : `--disallowedTools '*'` -> l'agent ne pouvait rien lire, donc
    // toute question factuelle exigeait une orchestration (conv-75 : 38,68 $).
    // Etape 2 : lecture seule + 5 perimetres git. Il pouvait constater, pas agir.
    // Etape 3 (2026-08-26, decision utilisateur, conv-1410) : Bash + Write + Edit ouverts. Une
    // correction d'une ligne ne doit plus couter une orchestration qui repond depuis un worktree
    // ISOLE, donc a cote du depot que l'utilisateur regarde.
    //
    // La propriete « aucune ECRITURE » a donc ete RETIREE ici volontairement, pas cassee par
    // accident : ce qui la remplace est verifie par `claude.chat-full-tools.test.ts`, et la garde
    // d'ecriture reste, elle, sur le fond autonome (watchdog).
    const chatBranch = source.slice(source.indexOf('} else {'), source.indexOf('let settingsDir'))
    expect(chatBranch).toContain("'--add-dir'")
    for (const outil of ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit']) {
      expect(chatBranch, `${outil} doit etre autorise sur le tour de chat`).toMatch(
        new RegExp(`(?<![A-Za-z,])'${outil}'`)
      )
    }
  })

  it('ouvre le shell du chat en ENTIER, et garde le fond autonome ferme', () => {
    // Ce test verrouillait l'inverse : Bash uniquement par perimetres `Bash(git …:*)`. La decision
    // utilisateur du 2026-08-26 l'a renverse. Ce qui reste FALSIFIABLE, et qui est le vrai risque :
    // que l'ouverture ait ete faite « en gros » et ait emporte le fond autonome avec elle.
    const chatBranch = source.slice(source.indexOf('} else {'), source.indexOf('let settingsDir'))
    // Bash est desormais autorise NU sur le chat (plus aucun perimetre par prefixe).
    expect([...chatBranch.matchAll(/(?<![A-Za-z,])'Bash'/g)]).toHaveLength(1)
    expect(chatBranch).not.toContain('CHAT_READ_ONLY_SHELL')

    // DISCRIMINANT : la sous-branche `watchdog-read-only`, elle, ne recoit ni shell ni ecriture.
    const debutWatchdog = source.indexOf("toolProfile === 'watchdog-read-only'")
    const watchdog = source.slice(debutWatchdog, source.indexOf('} else {', debutWatchdog))
    for (const interdit of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(watchdog, `${interdit} ne doit pas etre ouvert au fond autonome`).not.toMatch(
        new RegExp(`'${interdit}'`)
      )
    }
  })

  it('sans workspace resolu, ne devine aucun dossier — mais garde le WEB', () => {
    // Avant, cette branche passait `--disallowedTools '*'` : sans workspace, l'agent perdait TOUT moyen
    // de fonder une reponse et ne pouvait plus que deviner. La propriete a preserver n'etait pas
    // « aucun outil », c'etait « aucun dossier devine » — et elle tient toujours : rien n'est ajoute au
    // disque, seul le web reste. Changement demande par l'utilisateur le 2026-08-13.
    const chatBranch = source.slice(source.indexOf('} else {'), source.indexOf('let settingsDir'))
    expect(chatBranch).not.toContain("'--add-dir', readOnlyWorkspace, '--tools', 'Read'")
    /**
     * Assertion recalee sur la PROPRIETE, pas sur la mise en forme.
     *
     * L'ancienne regex exigeait les deux drapeaux sur UNE SEULE ligne, espaces compris. Le
     * 2026-08-20, l'ajout des outils MCP d'un noeud skill a reparti l'appel sur plusieurs lignes
     * (prettier) : le test est tombe alors que la propriete — web CHARGE et web AUTORISE, aucun
     * dossier devine — etait intacte. C'est le deuxieme piege de forme sur cette meme assertion
     * (cf. le commentaire du test voisin, ou une regex trop litterale rendait une liste VIDE).
     *
     * On verifie donc les deux drapeaux SEPAREMENT, tolerants aux sauts de ligne. Ce n'est pas un
     * assouplissement : les deux exigences restent, et la seule chose qu'on cesse d'imposer est
     * l'endroit ou prettier place ses retours a la ligne.
     */
    expect(chatBranch).toMatch(/'--tools',\s*OUTILS_WEB/)
    expect(chatBranch).toMatch(/'--allowedTools',\s*\.\.\.autorises\(OUTILS_WEB\)/)
    expect(chatBranch).toContain('existsSync(')
  })

  it('n’utilise PAS --bare : il couperait l’auto-memory mais aussi l’auth par abonnement', () => {
    // La doc : « Anthropic auth is strictly ANTHROPIC_API_KEY … OAuth and keychain are never read ».
    // Autowin passe par le CLI justement pour utiliser l'abonnement — le flag serait un piege de
    // facturation, pas une economie.
    expect(source).not.toContain("'--bare'")
  })
})
