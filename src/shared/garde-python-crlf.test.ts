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

  /**
   * Vécu le 2026-10-01 (conv-770) : une commande qui écrivait par heredoc un fichier JavaScript dont
   * le TEXTE contenait `; python - <<'E'` et `open(p,'w',…)` a été refusée, alors que Python n'était
   * jamais lancé (`cat > sonde.cjs <<'EOF' … EOF` puis `node sonde.cjs`). Le corps d'un heredoc est une
   * DONNÉE, sauf si Python (ou un shell) le lit, ou exécute ensuite le fichier qu'il écrit.
   */
  describe('corps de heredoc : donnée ou code', () => {
    it.each([
      // La commande vécue, réduite.
      [
        `cat > "$TEMP/sonde-hook.cjs" <<'EOF'`,
        `const cmd = (l) => ["cd /d/AutoWinOS; python - <<'E'", l, 'E'].join(N)`,
        `console.log(cmd("open(p,'w',encoding='utf8').write(s)"))`,
        'EOF',
        'node "$TEMP/sonde-hook.cjs"'
      ].join(SAUT),
      // Message de commit qui documente la cause (forme usuelle des agents).
      [
        `git commit -m "$(cat <<'EOF'`,
        'fix: garde CRLF',
        '',
        `python -c "open('a.ts','w')" réécrivait en CRLF`,
        'EOF',
        ')"'
      ].join(SAUT),
      // Fichier de notes écrit, puis un Python SANS RAPPORT avec ce fichier.
      ["cat > notes.md <<'E'", "open('a.ts','w').write(s)", 'E', 'python -c "print(1)"'].join(SAUT),
      // `<<-` : les tabulations de tête du corps et du terminateur sont ignorées.
      [`cat <<-'E' > notes.md`, `\tpython -c "open('a.ts','w')"`, '\tE'].join(SAUT),
      // Le terminateur `PY` n'est pas le lanceur `py` : aucun Python n'est lancé ici.
      ["cat > notes.md <<'PY'", 'x', 'PY', `echo "open('a.ts','w')" >> notes.md`].join(SAUT)
    ])('laisse passer un heredoc de simple texte : %s', (commande) => {
      expect(refusEcriturePythonCrlf(commande)).toBeUndefined()
    })

    it.each([
      // Python lit le heredoc dans le même tube.
      ["cat <<'E' | python -", "open('a.ts','w').write(s)", 'E'].join(SAUT),
      // Vécu (rejeu du 2026-10-01) : Python lancé après le mot-clé `do`, terminateur `PY`.
      [
        'T=$(cat tache.txt)',
        `for f in a b c x; do python - "$f" <<'PY'`,
        'import sys',
        "open(f'prompt-{f}.txt','w',encoding='utf-8').write(p)",
        'PY',
        'done'
      ].join(SAUT),
      ['if true; then', `  python -c "open('a.ts','w').write('x')"`, 'fi'].join(SAUT),
      // Un shell lit le heredoc : il lance Python.
      ["bash <<'E'", `python -c "open('a.ts','w').write('x')"`, 'E'].join(SAUT),
      // Le fichier écrit est ensuite exécuté : par Python, par un shell, ou directement.
      [
        "tee /tmp/m.py > /dev/null <<'E'",
        "open('a.ts','w').write(s)",
        'E',
        'python3 /tmp/m.py'
      ].join(SAUT),
      [
        "cat > /tmp/s.sh <<'E'",
        `python -c "open('a.ts','w').write('x')"`,
        'E',
        'bash /tmp/s.sh'
      ].join(SAUT),
      ["cat > m.py <<'E'", "open('a.ts','w').write(s)", 'E', 'chmod +x m.py; ./m.py'].join(SAUT),
      // `<<E` entre guillemets sans terminateur : ce n'est pas un heredoc, le code Python reste lu.
      `python -c "s='<<E'; open('a.ts','w').write(s)"`,
      // … y compris quand le code Python vient sur les lignes SUIVANTES.
      ['grep -c "<<E" notes.md', `python -c "open('a.ts','w').write('x')"`].join(SAUT)
    ])('refuse quand le heredoc est du code exécuté : %s', (commande) => {
      expect(refusEcriturePythonCrlf(commande)).toBeTruthy()
    })
  })

  it('est câblé aux DEUX points d’exécution : le hook du CLI et la commande run interne', () => {
    const src = (p: string): string => readFileSync(join(__dirname, p), 'utf8')
    // Le hook lui PASSE le découpage des heredocs : un appel direct ne survit pas à la sérialisation.
    expect(src('./garde-git-destructeur.ts')).toMatch(
      /refusEcriturePythonCrlf\(cmd, decouperHeredocs\)/
    )
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
    // Un heredoc de simple texte passe aussi par le script sérialisé (conv-770, 2026-10-01).
    const texte = [
      `cat > sonde.cjs <<'EOF'`,
      `const cmd = ["cd /d/AutoWinOS; python - <<'E'", "open(p,'w').write(s)", 'E']`,
      'EOF',
      'node sonde.cjs'
    ].join(SAUT)
    expect(sortie(texte)).toBe('')
  })
})
