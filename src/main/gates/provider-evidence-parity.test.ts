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
/**
 * Table `[commande, kind attendu]` et non simple égalité : l'audit du 3e cycle a montré qu'un tiers
 * des cas étaient une égalité TRIVIALE (les deux retombaient sur `inspection` par défaut, sans
 * exercer aucune branche partagée), et surtout que la liste ne contenait AUCUNE commande à
 * l'intersection mutation ∩ vérification — la seule zone où l'ORDRE des branches est observable,
 * précisément ce que le recâblage n'avait pas unifié. Les cas composés ci-dessous couvrent cette
 * intersection.
 */
const CASES: Array<[string, 'mutation' | 'verification' | 'inspection']> = [
  // Mutations d'état, dont le cas de l'incident fondateur.
  ['git -C "C:/Amitel/Autowin OS" stash push -u -m wip', 'mutation'],
  ['git stash push -u', 'mutation'],
  ['git commit -m "wip"', 'mutation'],
  ['git checkout -- .', 'mutation'],
  ['git reset --hard origin/main', 'mutation'],
  ['git worktree add ../wt HEAD', 'mutation'],
  ['git tag v1.2.3', 'mutation'],
  ['mv src/a.ts src/b.ts', 'mutation'],
  ['rm -rf out', 'mutation'],
  ['npm install', 'mutation'],
  ['echo "x" > f.txt', 'mutation'],
  ['set-content f.txt x', 'mutation'],
  ['copy-item a b', 'mutation'],
  ['Restart-Service RigSvc', 'mutation'],
  ['docker compose up -d', 'mutation'],
  // INTERSECTION mutation ∩ vérification : l'ordre des branches y est observable.
  ['npm install && npm test', 'verification'],
  ['npm ci && npx vitest run', 'verification'],
  ['dotnet restore; dotnet test', 'verification'],
  ['npm install; npx tsc --noEmit', 'verification'],
  ['docker compose up -d && npm run test', 'verification'],
  // Vérifications simples.
  ['npm run test', 'verification'],
  ['npx vitest run', 'verification'],
  ['tsc --noEmit', 'verification'],
  // Lectures.
  ['git status --porcelain', 'inspection'],
  ['git stash list', 'inspection'],
  ['git tag', 'inspection'],
  ['git rev-parse HEAD', 'inspection'],
  ['rg "TODO" src', 'inspection'],
  ['cat package.json', 'inspection'],
  ['printf "git log"', 'inspection'],
  ['rg "Restart-Service" src', 'inspection']
]

describe('parité de classement entre les providers', () => {
  it.each(CASES)('classe « %s » en %s des DEUX côtés', (command, expected) => {
    // On exige le kind ATTENDU, pas seulement l'égalité : deux `inspection` par défaut sont égales
    // sans rien prouver de la parité.
    expect(claudeToolEvidenceKind('Bash', command)).toBe(expected)
    expect(codexExecutionEvidenceKind({ type: 'command_execution', command })).toBe(expected)
  })

  it('couvre réellement les trois kinds, dont l’intersection mutation ∩ vérification', () => {
    const kinds = new Set(CASES.map(([, kind]) => kind))
    expect(kinds).toEqual(new Set(['mutation', 'verification', 'inspection']))
    // Au moins une commande COMPOSÉE qui mute ET vérifie : sans elle, l'ordre des branches n'est
    // pas observable et le test ne peut pas tomber sur la divergence qu'il prétend garder.
    const composees = CASES.filter(
      ([command, kind]) => /&&|;/.test(command) && kind === 'verification'
    )
    expect(composees.length).toBeGreaterThanOrEqual(3)
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
