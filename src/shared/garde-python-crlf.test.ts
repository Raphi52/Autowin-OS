import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { refusEcriturePythonCrlf } from './garde-python-crlf'

/**
 * Mesuré le 2026-10-01 : 48 fichiers de D:\AutoWinOS étaient LF dans git et CRLF sur le disque ; 47
 * venaient d'un script Python lancé par un agent, qui écrivait en MODE TEXTE. Sous Windows,
 * `open(p, 'w')` et `Path.write_text()` remplacent chaque `\n` par `os.linesep` (`\r\n`). Exemple
 * vécu : conv-817, 2026-09-23 19:13:13, `src/renderer/src/App.tsx` réécrit ainsi —
 * `moteur-perime-cablage.test.ts`, qui lit le fichier octet par octet, est rouge depuis.
 */
const SAUT = String.fromCharCode(10)
const heredoc = (...lignes: string[]): string =>
  ["cd /d/AutoWinOS; python - <<'E'", ...lignes, 'E'].join(SAUT)

describe('refusEcriturePythonCrlf', () => {
  it('refuse la commande exacte qui a passé App.tsx en CRLF (conv-817, 23/09 19:13:13)', () => {
    const motif = refusEcriturePythonCrlf(
      heredoc(
        "p='src/renderer/src/App.tsx';s=open(p,encoding='utf8').read()",
        "open(p,'w',encoding='utf8').write(s)"
      )
    )
    expect(motif).toBeTruthy()
    // Le refus renvoie vers l'outil d'édition, et nomme la voie Python sûre.
    expect(motif).toMatch(/outil d.édition/)
    expect(motif).toMatch(/newline=''/)
  })

  it.each([
    'python -c "import pathlib;p=pathlib.Path(\'a.ts\');p.write_text(p.read_text())"',
    "python3 - <<'EOF'\nwith open('x.ts', 'w') as f:\n    f.write(s)\nEOF",
    "\"C:\\Users\\x\\Python312\\python.exe\" -c \"open('a.ts','a').write('x')\"",
    "py -3 -c \"open('a.ts','w+').write('x')\"",
    "cat > /tmp/m.py <<'E'\nopen('a.ts','w').write(s)\nE\npython /tmp/m.py",
    "python -c \"from pathlib import Path; Path('a.ts').open('w').write('x')\"",
    "python -c \"import io; io.open('a.ts', mode='w', encoding='utf8').write('x')\"",
    "cd repo && python - <<'E'\np.write_text(s, encoding='utf8')\nE"
  ])('refuse une écriture Python en mode texte sans newline : %s', (commande) => {
    expect(refusEcriturePythonCrlf(commande)).toBeTruthy()
  })

  it.each([
    // La voie sûre, celle que le refus recommande.
    heredoc("open(p,'w',encoding='utf8',newline='').write(s)"),
    "python -c \"p.write_text(s, encoding='utf8', newline='')\"",
    "python -c \"open('a.ts','w',newline='\\n').write('x')\"",
    // Binaire : aucune traduction des fins de ligne.
    "python -c \"open('a.bin','wb').write(b'x')\"",
    // Lectures.
    'python -c "print(open(\'a.ts\').read())"',
    "python -c \"print(open('a.ts', 'r', encoding='utf8').read())\"",
    // codecs.open ouvre en binaire sous le capot : pas de traduction.
    "python -c \"import codecs; codecs.open('a.ts', 'w', 'utf8').write('x')\"",
    // Mode inconnu (variable) : on ne devine pas.
    "python -c \"open('a.ts', mode).write('x')\"",
    // MENTIONS, sans Python lancé.
    'grep -rn "open(p,\'w\')" scripts',
    'git commit -m "python open(p, \'w\') convertit en CRLF"',
    'echo "p.write_text(s)" >> notes.md',
    // Vécu (rejeu du 2026-10-01) : `\|` est une alternative de motif grep, Python n'y est pas lancé.
    "git grep -n -i \"python -\\|python3 -\\|open(p, *'w'\\|write_text\" -- 'skills/*.md'",
    'grep -n -e "x\\|python -c" -e "open(p,\'w\')" notes.md',
    'npm run typecheck'
  ])('laisse passer : %s', (commande) => {
    expect(refusEcriturePythonCrlf(commande)).toBeUndefined()
  })

  it('est câblé aux DEUX points d’exécution : le hook du CLI et la commande run interne', () => {
    const src = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
    expect(src('./garde-git-destructeur.ts')).toMatch(/refusEcriturePythonCrlf\(cmd\)/)
    expect(src('../main/commands.ts')).toMatch(/refusEcriturePythonCrlf\(ligne\)/)
  })
})

describe('hook réel du CLI — écriture Python en mode texte', () => {
  it("rend un refus deny pour la commande de conv-817, et laisse passer la version newline=''", async () => {
    const { execFileSync, spawnSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { scriptHookGardes } = await import('./garde-git-destructeur')
    const script = join(mkdtempSync(join(tmpdir(), 'garde-python-')), 'garde.mjs')
    writeFileSync(
      script,
      scriptHookGardes(() => undefined),
      'utf8'
    )
    expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
    const sortie = (commande: string): string =>
      spawnSync(process.execPath, [script], {
        input: JSON.stringify({ tool_input: { command: commande } }),
        encoding: 'utf8'
      }).stdout
    const refus = JSON.parse(sortie(heredoc("open(p,'w',encoding='utf8').write(s)")))
    expect(refus.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(refus.hookSpecificOutput.permissionDecisionReason).toMatch(/outil d.édition/)
    expect(sortie(heredoc("open(p,'w',encoding='utf8',newline='').write(s)"))).toBe('')
  })
})
