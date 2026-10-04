import { describe, expect, it } from 'vitest'
import { refusGitDestructeur, scriptHookGardes } from './garde-git-destructeur'
import { refusReglageProd, refusSqlAgent } from '../main/prod-run-guard'
import { decouperHeredocs, sansHeredocsDeDonnees } from './heredocs'

/**
 * Rejeu du 2026-10-01 des gardes du hook sur 29 371 commandes Bash réelles (~/.claude/projects) :
 * trois refus venaient du seul TEXTE d'un heredoc, jamais exécuté. Réduits ici à leur forme.
 */
const SAUT = String.fromCharCode(10)
const shell = (commande: string): string => sansHeredocsDeDonnees(commande)

describe('sansHeredocsDeDonnees — le texte d’un heredoc n’est pas du shell', () => {
  it.each([
    [
      'git : un fichier source dont le commentaire cite git reset --hard',
      [
        "cat > src/shared/garde-git-destructeur.ts <<'EOF'",
        ' * l’agent a lancé `git reset --hard`',
        'EOF'
      ].join(SAUT),
      refusGitDestructeur
    ],
    [
      'SQL : un test ajouté par cat >> qui nomme sqlcmd',
      [
        "cat >> src/main/sql-read-command.porte-prod.test.ts <<'EOF'",
        'sqlcmd -S \'SRV-PROD\\PROD\' -d CATALOGUE -Q "SELECT 1"',
        'EOF'
      ].join(SAUT),
      (c: string) => refusSqlAgent(c, [])
    ],
    [
      'SQL : un message de commit qui nomme sqlcmd',
      [
        "cd /d/AutoWinOS; git add t.test.ts && git commit -q -F - <<'EOF'",
        'test(sqlcmd): verrouiller les drapeaux',
        'sqlcmd -S x -d CATALOGUE -Q "SELECT 1"',
        'EOF'
      ].join(SAUT),
      (c: string) => refusSqlAgent(c, [])
    ],
    [
      'git : message de commit par $(cat <<EOF)',
      ["git commit -m \"$(cat <<'EOF'", 'git stash avant de tester', 'EOF', ')"'].join(SAUT),
      refusGitDestructeur
    ],
    [
      'prod : notes reprises ensuite par git add seulement',
      ["cat > notes.md <<'EOF'", 'prod-autorite.json', 'EOF', 'git add notes.md'].join(SAUT),
      refusReglageProd
    ]
  ])('laisse passer — %s', (_nom, commande, garde) => {
    // La garde AURAIT refusé sur la commande brute : c'est bien le texte du heredoc qui la déclenchait.
    expect(garde(commande)).toBeTruthy()
    expect(garde(shell(commande))).toBeUndefined()
  })

  it.each([
    ['un shell lit le heredoc', ["bash <<'E'", 'git stash', 'E'].join(SAUT)],
    ['le heredoc part dans un shell par un tube', ["cat <<'E' | sh", 'git stash', 'E'].join(SAUT)],
    [
      'le script écrit est exécuté ensuite',
      ["cat > /tmp/s.sh <<'E'", 'git stash', 'E', 'bash /tmp/s.sh'].join(SAUT)
    ],
    [
      'un vrai git stash APRÈS le heredoc',
      ["cat > notes.md <<'E'", 'x', 'E', 'git stash -q'].join(SAUT)
    ],
    [
      'un <<E sans terminateur n’est pas un heredoc',
      ['grep -c "<<E" notes.md', 'git stash'].join(SAUT)
    ]
  ])('refuse toujours — %s', (_nom, commande) => {
    expect(refusGitDestructeur(shell(commande))).toBeTruthy()
  })

  it.each([
    ['node lit le heredoc', ["node <<'E'", 'git stash', 'E'].join(SAUT)],
    [
      'le script écrit est lancé par node',
      ["cat > /tmp/g.mjs <<'E'", 'git stash', 'E', 'node /tmp/g.mjs'].join(SAUT)
    ],
    [
      'le fichier écrit est rejoué par vitest',
      ["cat > t.test.ts <<'E'", 'git stash', 'E', 'npx vitest run t.test.ts'].join(SAUT)
    ]
  ])('garde le corps quand quelque chose l’exécute — %s', (_nom, commande) => {
    expect(shell(commande)).toBe(commande)
  })

  it('le client SQL qui LIT le heredoc reste vu (sqlcmd <<E)', () => {
    const commande = [
      "sqlcmd -S 'SRV-PROD\\PROD' -d CATALOGUE <<'E'",
      'UPDATE t SET x = 1',
      'E'
    ].join(SAUT)
    expect(refusSqlAgent(shell(commande), [])).toBeTruthy()
  })

  it('decouperHeredocs ne prend pas un <<E sans ligne terminatrice', () => {
    expect(decouperHeredocs(`python -c "s='<<E'"`).heredocs).toEqual([])
  })
})

describe('hook réel du CLI — heredoc de simple texte', () => {
  it('le script sérialisé laisse passer le texte et refuse toujours le vrai geste', async () => {
    const { spawnSync, execFileSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const script = join(mkdtempSync(join(tmpdir(), 'garde-heredoc-')), 'garde.mjs')
    writeFileSync(script, scriptHookGardes(refusReglageProd, refusSqlAgent, []), 'utf8')
    expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
    const decision = (commande: string): string | undefined => {
      const sortie = spawnSync(process.execPath, [script], {
        input: JSON.stringify({ tool_input: { command: commande } }),
        encoding: 'utf8'
      }).stdout
      return sortie ? JSON.parse(sortie).hookSpecificOutput.permissionDecision : undefined
    }
    expect(
      decision(
        ["cat > src/shared/garde-git-destructeur.ts <<'EOF'", ' * `git reset --hard`', 'EOF'].join(
          SAUT
        )
      )
    ).toBeUndefined()
    expect(decision(["bash <<'E'", 'git reset --hard', 'E'].join(SAUT))).toBe('deny')
    expect(decision('git stash')).toBe('deny')
  })
})
