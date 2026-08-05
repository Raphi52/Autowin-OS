import { describe, expect, it } from 'vitest'
import { claudeToolEvidenceKind } from '../providers/claude'
import { codexExecutionEvidenceKind } from '../providers/codex'

/**
 * Les deux providers doivent classer une commande IDENTIQUEMENT.
 *
 * Le vocabulaire était dupliqué : Codex portait son propre `CODEX_MUTATION_COMMAND`, sans aucun
 * verbe git. Conséquence mesurée le 2026-08-04 — `git -C "<dépôt>" stash push`, la commande EXACTE
 * de l'incident fondateur, valait `mutation` sous Claude et `inspection` sous Codex. La même tâche
 * passait le gate sous un provider et échouait sous l'autre : le défaut réparé n'avait pas disparu,
 * il avait changé de côté.
 *
 * Ce test est le garde-fou de la source unique. Il compare les deux classifieurs sur la même
 * liste, donc il tombe dès que l'un des deux repart avec son propre vocabulaire.
 */
const CASES = [
  'git -C "C:/Amitel/Autowin OS" stash push -u -m wip',
  'git stash push -u',
  'git commit -m "wip"',
  'git checkout -- .',
  'git reset --hard origin/main',
  'git worktree add ../wt HEAD',
  'git tag v1.2.3',
  'mv src/a.ts src/b.ts',
  'rm -rf out',
  'npm install',
  'echo "x" > f.txt',
  'set-content f.txt x',
  'copy-item a b',
  // Lectures : aucun des deux ne doit y voir une mutation.
  'git status --porcelain',
  'git stash list',
  'git tag',
  'git rev-parse HEAD',
  'rg "TODO" src',
  'cat package.json',
  'printf "git log"',
  // Vérifications : identiques des deux côtés.
  'npm run test',
  'npx vitest run',
  'tsc --noEmit'
]

describe('parité de classement entre les providers', () => {
  it.each(CASES)('classe « %s » de la même façon sous Claude et sous Codex', (command) => {
    const claude = claudeToolEvidenceKind('Bash', command)
    const codex = codexExecutionEvidenceKind({ type: 'command_execution', command })
    expect(codex).toBe(claude)
  })

  it('classe le cas de l’incident fondateur comme une mutation des DEUX côtés', () => {
    const command = 'git -C "C:/Amitel/Autowin OS" stash push -u -m autowin-pre-update'
    expect(claudeToolEvidenceKind('Bash', command)).toBe('mutation')
    expect(codexExecutionEvidenceKind({ type: 'command_execution', command })).toBe('mutation')
  })

  it('garde les spécificités LÉGITIMES de Codex, sans les confondre avec le vocabulaire', () => {
    // Une édition de fichier remontée comme `file_change` reste une mutation, indépendamment de la
    // commande ; et l'assertion PowerShell (oracle explicite) reste une vérification propre à Codex.
    expect(codexExecutionEvidenceKind({ type: 'file_change', command: '' })).toBe('mutation')
    expect(
      codexExecutionEvidenceKind({
        type: 'command_execution',
        command: 'if ($x -eq 1) { exit 0 } else { exit 1 }'
      })
    ).toBe('verification')
    // Un type ni commande ni édition n'est pas classable : il reste `other` côté Codex.
    expect(codexExecutionEvidenceKind({ type: 'reasoning', command: '' })).toBe('other')
  })
})
