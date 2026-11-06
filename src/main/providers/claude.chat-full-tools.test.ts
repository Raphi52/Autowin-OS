import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reglagesCliAutowin } from './claude'

/**
 * TOUR DE CHAT PLEINEMENT OUTILLÉ — décision explicite de l'utilisateur (2026-08-26) :
 * « Tout ouvrir : Bash + Write + Edit, et ajuster les 3 tests qui verrouillent ».
 *
 * Avant : le tour de chat partait sans Write/Edit et avec un Bash borné à 5 périmètres git
 * (`CHAT_READ_ONLY_SHELL`). Conséquence mesurée : une correction d'une ligne dans
 * `home-decor-scene.ts` a exigé une orchestration complète, qui répond depuis un worktree ISOLÉ —
 * donc à côté du dépôt que l'utilisateur regarde. Plusieurs tours ont été dépensés à expliquer un
 * refus au lieu de faire le travail.
 *
 * Ce que ces tests verrouillent, et qui doit rester FALSIFIABLE :
 *  1. la branche chat AUTORISE `Bash`, `Write`, `Edit` nus ;
 *  2. la frontière du fond autonome (`watchdog-read-only`) reste, elle, sans aucune écriture ni
 *     aucun shell — c'est le DISCRIMINANT : une ouverture faite « en gros » sur tout le fichier
 *     ferait tomber ce second test.
 *
 * Entrée qui doit faire échouer (2) si l'ouverture est mal faite : un `'Write'` ou un `'Bash'` posé
 * dans le bloc `toolProfile === 'watchdog-read-only'`.
 */

const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')

const blocChat = () => {
  const debut = source.indexOf('TOUR DE CHAT')
  expect(debut).toBeGreaterThan(-1)
  return source.slice(debut, source.indexOf('MEMOIRE AUTO', debut))
}

const blocWatchdog = () => {
  const debut = source.indexOf("toolProfile === 'watchdog-read-only'")
  expect(debut).toBeGreaterThan(-1)
  return source.slice(debut, source.indexOf('} else {', debut))
}

describe('tour de chat — outils de mutation ouverts', () => {
  it('charge Bash, Write, Edit et MultiEdit', () => {
    // MultiEdit ajouté le 2026-08-27 par agence de la copie isolée run-f2f7fec8c587-1 (0734729).
    // La liste vit dans `OUTILS_TOUR_DE_CHAT` : la question à côté déclare la même.
    expect(blocChat()).toMatch(/'--tools',\s*OUTILS_TOUR_DE_CHAT,/)
    expect(source).toMatch(
      /OUTILS_TOUR_DE_CHAT =\s*'Read,Grep,Glob,Bash,Write,Edit,MultiEdit,WebFetch,WebSearch,'/
    )
  })

  it('charge ET autorise Monitor et TaskStop, écrits dans une seule constante (conv-1370, lot 5)', () => {
    // L'aide de Bash renvoie vers Monitor (« Foreground sleep is blocked ») : chargé sans être
    // autorisé, ou l'inverse, l'outil serait annoncé puis refusé.
    expect(source).toMatch(/export const OUTILS_ARRIERE_PLAN = 'Monitor,TaskStop'/)
    expect(source).toMatch(
      /OUTILS_TOUR_DE_CHAT =\s*'[^']*' \+\s*OUTILS_ETAPES \+\s*',' \+\s*OUTILS_ARRIERE_PLAN/
    )
    expect(blocChat()).toMatch(/\.\.\.autorises\(OUTILS_ARRIERE_PLAN\)/)
  })

  it('Monitor lance une commande : mêmes gardes que Bash, en échec fermé', () => {
    const [terminal, autres] = (
      reglagesCliAutowin('G.mjs', 'N.mjs') as {
        hooks: { PreToolUse: { matcher: string; hooks: Record<string, unknown>[] }[] }
      }
    ).hooks.PreToolUse
    expect(terminal.matcher.split('|')).toContain('Monitor')
    expect(terminal.hooks.every((h) => h.onFailure === 'block')).toBe(true)
    // Matchers DISJOINTS : un appel qui passerait deux fois compterait double au détecteur de boucle.
    expect(autres.matcher.split('|')).not.toContain('Monitor')
  })

  it('passe bypassPermissions — sans lui, les outils sont déclarés mais refusés', () => {
    // Même agence : `--tools`/`--allowedTools` déclarent et autorisent, mais le CLI retombe sur une
    // demande d'autorisation interactive sans ce mode — donc échoue en spawn non interactif.
    expect(blocChat()).toMatch(/'--permission-mode',\s*'bypassPermissions'/)
  })

  it('AUTORISE Bash, Write et Edit nus (pas seulement chargés)', () => {
    const bloc = blocChat()
    for (const outil of ['Bash', 'Write', 'Edit']) {
      expect(bloc, `${outil} doit être autorisé nu dans la branche chat`).toMatch(
        new RegExp(`(?<![A-Za-z,])'${outil}'`)
      )
    }
  })

  it('ne conserve aucun périmètre git résiduel qui rétrécirait Bash', () => {
    expect(blocChat()).not.toContain('CHAT_READ_ONLY_SHELL')
  })

  it('DISCRIMINANT — le fond autonome (watchdog) reste sans écriture ni shell', () => {
    const bloc = blocWatchdog()
    for (const interdit of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Monitor']) {
      expect(bloc, `${interdit} ne doit pas apparaître dans la branche watchdog`).not.toMatch(
        new RegExp(`'${interdit}'`)
      )
    }
    // Monitor exécute une commande : ouvert ici, il rouvrirait le shell que cette branche ferme.
    expect(bloc).not.toContain('OUTILS_ARRIERE_PLAN')
    expect(bloc).not.toContain('OUTILS_TOUR_DE_CHAT')
  })

  it('la décision est TRACÉE dans le code, pour qu’on ne la « corrige » pas', () => {
    expect(source).toMatch(/2026-08-26/)
  })
})

/**
 * RECHERCHE D'OUTILS (lot 1/3, 2026-11-03). La doc du CLI : « If you deny
 * `ToolSearch` or leave it out of `--tools`, MCP tools load upfront instead ». Le tour de chat
 * listait ses outils natifs SANS lui : les 55 outils du serveur Autowin partaient en entier à chaque
 * appel. Mesuré sur le CLI 2.1.317, 40 outils MCP de test : 15 236 jetons écrits sans `ToolSearch`,
 * 6 015 (3 810 écrits + 2 205 relus) avec ; l'outil différé reste appelable (ToolSearch puis appel).
 * Entrée qui fait échouer ce test : retirer `OUTIL_RECHERCHE_OUTILS` de `OUTILS_TOUR_DE_CHAT`, ou
 * le charger sans l'autoriser (chargé, il serait refusé au premier appel).
 */
describe('tour de chat — définitions des outils MCP chargées à la demande', () => {
  it('charge ET autorise ToolSearch, dans la liste partagée avec la question à côté', () => {
    expect(source).toMatch(/export const OUTIL_RECHERCHE_OUTILS = 'ToolSearch'/)
    expect(source).toMatch(
      /OUTILS_TOUR_DE_CHAT =[^;]*?OUTILS_ARRIERE_PLAN \+\s*',' \+\s*OUTIL_RECHERCHE_OUTILS/
    )
    expect(blocChat()).toMatch(/\.\.\.autorises\(OUTIL_RECHERCHE_OUTILS\)/)
  })
})
