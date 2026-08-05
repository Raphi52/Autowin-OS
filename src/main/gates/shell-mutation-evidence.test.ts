import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHAT_READ_ONLY_SHELL,
  NON_INTERACTIVE_ENV,
  claudeToolEvidenceKind
} from '../providers/claude'
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

/**
 * Le besoin d'origine — et le commentaire d'`evidence-vocabulary.ts` — nommaient « un redémarrage
 * de service » parmi les mutations débloquées. C'était FAUX : le vocabulaire était purement git,
 * donc `Restart-Service` restait `inspection` et le gate restait insatisfiable pour cette famille.
 * L'audit du 2026-08-04 l'a relevé comme une sur-revendication. Les deux côtés sont désormais
 * symétriques : une mutation d'état non-git a un oracle d'état non-git.
 */
describe('les mutations d’état NON-git satisfont aussi le gate', () => {
  it.each([
    ['Restart-Service RigSvc', 'Get-Service RigSvc'],
    ['systemctl restart nginx', 'systemctl status nginx'],
    ['docker compose up -d', 'docker ps -a'],
    ['dotnet publish -o out', 'Test-Path out'],
    ['dotnet ef database update', 'dotnet ef migrations list'],
    ['Rename-Item a.txt b.txt', 'Test-Path b.txt'],
    ['pip install foo', 'Get-Item foo']
  ])('« %s » se prouve par « %s »', (mutation, oracle) => {
    expect(claudeToolEvidenceKind('Bash', mutation)).toBe('mutation')
    expect(claudeToolEvidenceKind('Bash', oracle)).toBe('inspection')
    expect(
      evidenceSatisfiesTask('redémarre le service et prouve qu’il tourne', [
        ev('mutation', mutation),
        ev('inspection', oracle)
      ])
    ).toBe(true)
  })

  it('ne prend PAS une lecture de conteneur ou de service pour une mutation', () => {
    for (const lecture of ['docker ps', 'docker inspect x', 'Get-Service', 'sc query RigSvc']) {
      expect(claudeToolEvidenceKind('Bash', lecture)).toBe('inspection')
    }
  })

  it('une mutation non-git SEULE ne suffit toujours pas', () => {
    expect(
      evidenceSatisfiesTask('redémarre le service', [ev('mutation', 'Restart-Service RigSvc')])
    ).toBe(false)
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

  it('neutralise pager, visualiseur d’aide et invites au niveau du processus fils', () => {
    // `git status --help` respecte le périmètre autorisé et pourtant LANCE un visualiseur. Cette
    // défense agit sur l'environnement du fils, donc elle tient quelle que soit la façon dont le
    // CLI interprète ses règles — propriété que je n'ai PAS pu établir.
    expect(NON_INTERACTIVE_ENV.GIT_PAGER).toBe('cat')
    expect(NON_INTERACTIVE_ENV.PAGER).toBe('cat')
    expect(NON_INTERACTIVE_ENV.GIT_TERMINAL_PROMPT).toBe('0')
    expect(NON_INTERACTIVE_ENV.GIT_ASKPASS).toBeTruthy()
    // `--help` retombe sur `man`, absent sous Windows : échec propre au lieu d'un navigateur.
    expect(NON_INTERACTIVE_ENV.GIT_CONFIG_VALUE_0).toBe('man')
  })

  it('applique réellement cet environnement au spawn (pas une constante morte)', () => {
    const source = readFileSync(join(__dirname, '..', 'providers', 'claude.ts'), 'utf8')
    // On assère la LIGNE de code, pas une mention : un commentaire citant la constante ferait
    // passer un test qui ne prouve rien (erreur commise une première fois sur ce même fichier).
    const envLine = source
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('env: {'))
    expect(envLine).toBeDefined()
    // Étalé EN DERNIER : ni l'env hérité ni celui de l'invocation ne peuvent le réintroduire.
    expect(envLine).toMatch(/\.\.\.process\.env.*\.\.\.NON_INTERACTIVE_ENV\s*}/)
  })
})
