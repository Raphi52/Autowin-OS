import { describe, expect, it } from 'vitest'
import { CHAT_READ_ONLY_SHELL, claudeToolEvidenceKind } from '../providers/claude'
import { evidenceSatisfiesTask } from '../orchestrator'
import type { ExecutionEvidence } from '../providers/types'

/**
 * Régression du 2026-08-04, incident réel : « met toi à jour » (git stash avant self-update).
 *
 * L'agent a FAIT le travail — le stash existe dans le vrai dépôt, base 8aaa46d, contenant les
 * 7 fichiers de l'utilisateur — et le run est quand même revenu `failed`, avec un rapport disant
 * à l'utilisateur que rien n'avait probablement eu lieu.
 *
 * Cause : `evidenceSatisfiesTask` exige, pour toute tâche classée mutation, une preuve de kind
 * `mutation` ET une de kind `verification`. Or `claudeToolEvidenceKind` n'émettait `mutation` que
 * pour Edit/Write/MultiEdit/NotebookEdit. Une mutation faite par une COMMANDE (git stash, git
 * commit, un déplacement de fichier, un redémarrage de service) ne pouvait donc produire aucune
 * preuve de kind `mutation` : le gate était INSATISFIABLE par construction pour cette classe
 * entière de tâches. Échec garanti quoi que fasse l'agent.
 *
 * Ces tests fixent les deux moitiés du contrat : la classification d'une mutation d'état, et le
 * fait qu'un oracle d'état suffit à la vérifier QUAND la mutation est elle-même un état (pas une
 * édition de code — là un vrai test reste exigé).
 */

const ev = (
  kind: ExecutionEvidence['kind'],
  command: string,
  extra: Partial<ExecutionEvidence> = {}
): ExecutionEvidence =>
  ({
    type: 'Bash',
    kind,
    status: 'completed',
    ok: true,
    summary: command,
    command,
    ...extra
  }) as ExecutionEvidence

describe('classification des mutations faites par commande', () => {
  it('classe git stash comme une mutation, pas comme une inspection', () => {
    expect(
      claudeToolEvidenceKind('Bash', 'git -C "C:/Amitel/Autowin OS" stash push -u -m wip')
    ).toBe('mutation')
  })

  it.each([
    'git commit -m "wip"',
    'git checkout -- .',
    'git reset --hard origin/main',
    'git stash pop',
    'git worktree add ../wt HEAD',
    'mv src/a.ts src/b.ts',
    'rm -rf out'
  ])('classe %s comme une mutation', (command) => {
    expect(claudeToolEvidenceKind('Bash', command)).toBe('mutation')
  })

  it.each([
    'git status --porcelain',
    'git stash list',
    'git diff --exit-code',
    'git rev-parse HEAD'
  ])(
    'laisse %s en inspection — un oracle d’état n’est PAS une vérification universelle',
    (command) => {
      // Choix de conception : si `git status` valait `verification` partout, une édition de code
      // pourrait se « vérifier » par un git status. La promotion en preuve est décidée par
      // evidenceSatisfiesTask, qui sait si la mutation est un ÉTAT ou des FICHIERS.
      expect(claudeToolEvidenceKind('Bash', command)).toBe('inspection')
    }
  )

  it('ne promeut PAS une lecture de fichier en preuve', () => {
    expect(claudeToolEvidenceKind('Bash', 'rg "TODO" src')).toBe('inspection')
    expect(claudeToolEvidenceKind('Bash', 'cat package.json')).toBe('inspection')
  })

  it('garde git stash list distinct de git stash (le sous-verbe compte)', () => {
    expect(claudeToolEvidenceKind('Bash', 'git stash')).toBe('mutation')
    expect(claudeToolEvidenceKind('Bash', 'git stash list')).toBe('inspection')
    expect(claudeToolEvidenceKind('Bash', 'git stash show --stat')).toBe('inspection')
  })

  it('laisse Edit rester une mutation et un test rester une vérification', () => {
    expect(claudeToolEvidenceKind('Edit', 'src/a.ts')).toBe('mutation')
    expect(claudeToolEvidenceKind('Bash', 'npm run test')).toBe('verification')
  })
})

describe('un gate satisfiable pour une mutation d’état', () => {
  const task = 'mets le dépôt de côté en stash avant la mise à jour'

  it('accepte un oracle d’état quand la mutation EST un état — le cas de l’incident', () => {
    const evidence = [
      ev('mutation', 'git -C "C:/Amitel/Autowin OS" stash push -u -m autowin-pre-update'),
      ev('inspection', 'git -C "C:/Amitel/Autowin OS" status --porcelain')
    ]
    expect(evidenceSatisfiesTask(task, evidence)).toBe(true)
  })

  it('refuse toujours une mutation sans aucune vérification', () => {
    const evidence = [ev('mutation', 'git stash push -u')]
    expect(evidenceSatisfiesTask(task, evidence)).toBe(false)
  })

  it('refuse une inspection déguisée en preuve', () => {
    const evidence = [ev('mutation', 'git stash push -u'), ev('inspection', 'cat README.md')]
    expect(evidenceSatisfiesTask(task, evidence)).toBe(false)
  })

  it('EXIGE encore un vrai test quand la mutation touche des FICHIERS', () => {
    const fileEdit = ev('mutation', '', { type: 'Edit', path: 'src/a.ts', command: undefined })
    const gitOracle = ev('inspection', 'git status --porcelain')
    // Un git status n'atteste pas qu'une édition de code est correcte : la strictesse reste.
    expect(evidenceSatisfiesTask('corrige le bug dans src/a.ts', [fileEdit, gitOracle])).toBe(false)
    const realTest = ev('verification', 'npm run test')
    expect(evidenceSatisfiesTask('corrige le bug dans src/a.ts', [fileEdit, realTest])).toBe(true)
  })

  it('ne demande aucune preuve à une tâche de lecture seule', () => {
    expect(evidenceSatisfiesTask('analyse le dépôt', [])).toBe(true)
  })
})

/**
 * Exploits TROUVÉS PAR L'AUDIT du 2026-08-04 sur ce même correctif, et refermés.
 * Chacun est ici pour ne pas revenir : ils sont passés une fois.
 */
describe('le gate ne peut pas se prouver tout seul', () => {
  const task = 'mets le dépôt de côté en stash'

  it('une commande unique ne vaut PAS à la fois mutation et oracle', () => {
    // `echo "git status" > f` matchait les DEUX motifs : redirection (mutation) et littéral
    // « git status » cité en argument (oracle). Un echo bidon fermait donc le gate.
    const auto = ev('mutation', 'echo "git status" > f.txt')
    expect(evidenceSatisfiesTask(task, [auto])).toBe(false)
  })

  it('exige un oracle DISTINCT de la mutation, pas la même preuve comptée deux fois', () => {
    const mutation = ev('mutation', 'git stash push -u')
    expect(evidenceSatisfiesTask(task, [mutation])).toBe(false)
    expect(evidenceSatisfiesTask(task, [mutation, ev('inspection', 'git status')])).toBe(true)
  })

  it('ne prend plus un nom de commande CITÉ pour un constat', () => {
    expect(claudeToolEvidenceKind('Bash', 'printf "git log"')).toBe('inspection')
    expect(claudeToolEvidenceKind('Bash', 'echo "git status" > f.txt')).toBe('mutation')
  })

  it('ne classe plus une LISTE en mutation (git tag nu ne mute rien)', () => {
    expect(claudeToolEvidenceKind('Bash', 'git tag')).toBe('inspection')
    expect(claudeToolEvidenceKind('Bash', 'git tag --list')).toBe('inspection')
    // Créer un tag reste bien une mutation.
    expect(claudeToolEvidenceKind('Bash', 'git tag v1.2.3')).toBe('mutation')
  })
})

describe('le shell du chat ne porte aucune primitive d’écriture', () => {
  it('exclut les sous-commandes qui acceptent --output', () => {
    // PROUVÉ : `git diff --output=victim.txt HEAD HEAD` ramène un fichier à 0 octet, et
    // `git show --output=…` en crée un. Le préfixe autorisé est pourtant respecté : le périmètre
    // portait lui-même la primitive de destruction.
    for (const verb of ['git diff', 'git show', 'git log']) {
      expect(
        CHAT_READ_ONLY_SHELL.some((spec) => spec.startsWith(`Bash(${verb}`)),
        `${verb} accepte --output=<chemin> : il ne peut pas être autorisé par simple préfixe`
      ).toBe(false)
    }
  })

  it('n’ouvre aucun accès réseau depuis un tour de chat', () => {
    for (const spec of CHAT_READ_ONLY_SHELL) {
      expect(spec).not.toMatch(/ls-remote|fetch|clone|push|pull/)
    }
  })

  it('garde ce qui est réellement inoffensif', () => {
    expect(CHAT_READ_ONLY_SHELL).toContain('Bash(git status:*)')
    expect(CHAT_READ_ONLY_SHELL).toContain('Bash(git stash list:*)')
  })
})
