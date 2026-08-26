import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * TOUR DE CHAT PLEINEMENT OUTILLÉ — décision explicite de l'utilisateur (2026-08-26) :
 * « Tout ouvrir : Bash + Write + Edit, et ajuster les 3 tests qui verrouillent ».
 *
 * Avant : le tour de chat partait sans Write/Edit et avec un Bash borné à 5 périmètres git
 * (`CHAT_READ_ONLY_SHELL`). Conséquence mesurée sur conv-1410 : une correction d'une ligne dans
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
  it('charge Bash, Write et Edit', () => {
    expect(blocChat()).toMatch(/'--tools',\s*'Read,Grep,Glob,Bash,Write,Edit,' \+ OUTILS_WEB/)
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
    for (const interdit of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(bloc, `${interdit} ne doit pas apparaître dans la branche watchdog`).not.toMatch(
        new RegExp(`'${interdit}'`)
      )
    }
  })

  it('la décision est TRACÉE dans le code, pour qu’on ne la « corrige » pas', () => {
    expect(source).toMatch(/2026-08-26/)
  })
})
