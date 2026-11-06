import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copieDe, refusEcritureHorsCopie, sondeSysteme } from './garde-ecriture-hors-copie.mjs'

/*
 * Un fil qui travaille dans sa copie ne doit jamais écrire dans le dossier partagé en chemin complet :
 * l'app de dev tourne depuis ce dossier, et une écriture directe y entre sans passer par la porte.
 * Les chemins sont ceux du poste réel : la sonde fictive rejoue la disposition que git écrit pour un
 * dossier lié (`.git` = fichier `gitdir: …`, `commondir` = `../..`).
 */
const PARTAGE = 'D:\\AutoWinOS'
const COPIE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\retours-de-tour\\essai__conv-1-x-1'
const SONDE_PORTE = 'D:\\AutoWinOS\\sonde-porte.txt'
const AUTRE_COPIE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\worktrees\\abc\\agent__run-autre-1'

const egal = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const sondeFictive = {
  resoudre: sondeSysteme.resoudre,
  git(dossier) {
    if (egal(dossier, COPIE))
      return { texte: 'gitdir: D:/AutoWinOS/.git/worktrees/essai__conv-1-x-1\n' }
    // Copie d'un AUTRE projet, rangée chez nous : son dépôt principal est D:\AutreProjet.
    if (egal(dossier, AUTRE_COPIE))
      return { texte: 'gitdir: D:/AutreProjet/.git/worktrees/agent__run-autre-1\n' }
    if (egal(dossier, PARTAGE) || egal(dossier, 'D:\\AutreProjet')) return { dossier: true }
    return undefined
  },
  lire(fichier) {
    if (egal(fichier, 'D:\\AutoWinOS\\.git\\worktrees\\essai__conv-1-x-1\\commondir'))
      return '../..\n'
    if (egal(fichier, 'D:\\AutreProjet\\.git\\worktrees\\agent__run-autre-1\\commondir'))
      return '../..\n'
    return undefined
  }
}

const claude = (tool_name, tool_input, cwd = COPIE) =>
  refusEcritureHorsCopie(
    { hook_event_name: 'PreToolUse', tool_name, tool_input, cwd },
    sondeFictive
  )
const shell = (command, cwd = COPIE) => claude('Bash', { command }, cwd)

describe('copieDe — reconnaître une copie du dossier partagé', () => {
  it('un dossier lié rangé dans les données de l’app est une copie du dépôt principal', () => {
    const c = copieDe(COPIE, sondeFictive)
    expect(c && egal(c.partage, PARTAGE)).toBe(true)
    expect(c && egal(c.copie, COPIE)).toBe(true)
    // Un sous-dossier de la copie remonte jusqu'à elle.
    expect(copieDe(join(COPIE, 'src', 'main'), sondeFictive)?.copie).toBe(c?.copie)
  })

  it('le dépôt principal, un de ses sous-dossiers, un dossier sans git : pas une copie', () => {
    expect(copieDe(PARTAGE, sondeFictive)).toBeUndefined()
    expect(copieDe(join(PARTAGE, 'src'), sondeFictive)).toBeUndefined()
    expect(copieDe('C:\\tmp\\ailleurs', sondeFictive)).toBeUndefined()
  })

  it('la copie d’un autre projet, même rangée chez nous, est hors périmètre', () => {
    expect(copieDe(AUTRE_COPIE, sondeFictive)).toBeUndefined()
  })
})

describe('refusé : écrire D:\\AutoWinOS\\sonde-porte.txt depuis une copie', () => {
  it('par Edit, Write, MultiEdit et NotebookEdit (Claude)', () => {
    expect(claude('Edit', { file_path: SONDE_PORTE, old_string: '', new_string: 'x' })).toMatch(
      /Refusé/
    )
    expect(claude('Write', { file_path: SONDE_PORTE, content: 'x' })).toMatch(/Refusé/)
    expect(claude('MultiEdit', { file_path: SONDE_PORTE, edits: [] })).toMatch(/Refusé/)
    expect(claude('NotebookEdit', { notebook_path: 'D:\\AutoWinOS\\a.ipynb' })).toMatch(/Refusé/)
  })

  it('le refus dit où écrire à la place : le même chemin dans la copie', () => {
    const motif = claude('Write', { file_path: 'D:\\AutoWinOS\\src\\main\\x.ts', content: 'x' })
    expect(motif).toContain(join(COPIE, 'src', 'main', 'x.ts'))
  })

  it('par les outils de Grok (clés camelCase, `path` ou `file_path`)', () => {
    const grok = (toolName, toolInput) =>
      refusEcritureHorsCopie(
        { toolName, toolInput, cwd: COPIE, workspaceRoot: COPIE },
        sondeFictive
      )
    expect(grok('search_replace', { path: SONDE_PORTE, old_string: '', new_string: 'x' })).toMatch(
      /Refusé/
    )
    expect(grok('write', { file_path: SONDE_PORTE, content: 'x' })).toMatch(/Refusé/)
    expect(grok('run_terminal_command', { command: `Set-Content ${SONDE_PORTE} x` })).toMatch(
      /Refusé/
    )
  })

  it('par apply_patch (Codex), chemin absolu ou relatif qui sort de la copie', () => {
    const patch = (chemin) => `*** Begin Patch\n*** Add File: ${chemin}\n+x\n*** End Patch\n`
    expect(claude('apply_patch', { command: patch(SONDE_PORTE) })).toMatch(/Refusé/)
    expect(claude('apply_patch', { command: patch('..\\..\\..\\..\\sonde-porte.txt') })).toMatch(
      /Refusé/
    )
    expect(
      claude('apply_patch', {
        command:
          '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: D:/AutoWinOS/src/a.ts\n*** End Patch'
      })
    ).toMatch(/Refusé/)
  })

  it.each([
    ['redirection >', `echo x > ${SONDE_PORTE}`],
    ['redirection >> entre guillemets', 'echo x >> "D:/AutoWinOS/sonde-porte.txt"'],
    ['redirection collée, descripteur 1', `echo x 1>${SONDE_PORTE}`],
    ['redirection de toutes les sorties', `Write-Output x *> ${SONDE_PORTE}`],
    ['chemin Git Bash', 'echo x > /d/AutoWinOS/sonde-porte.txt'],
    ['Set-Content -Path', `Set-Content -Path ${SONDE_PORTE} -Value x`],
    ['Set-Content positionnel', `Set-Content ${SONDE_PORTE} x`],
    ['Add-Content', `Add-Content -LiteralPath '${SONDE_PORTE}' -Value x`],
    ['Out-File après un tube', `'x' | Out-File -FilePath '${SONDE_PORTE}' -Encoding utf8`],
    ['Out-File positionnel', `'x' | Out-File ${SONDE_PORTE}`],
    ['New-Item', `New-Item -ItemType File -Path ${SONDE_PORTE} -Force`],
    ['Tee-Object', `'x' | Tee-Object -FilePath ${SONDE_PORTE}`],
    ['tee -a', 'echo x | tee -a /d/AutoWinOS/sonde-porte.txt'],
    ['cp vers le dossier partagé', 'cp notes.txt D:/AutoWinOS/sonde-porte.txt'],
    ['cp -t', 'cp -t D:/AutoWinOS notes.txt'],
    ['copy de cmd', `copy /y notes.txt ${SONDE_PORTE}`],
    ['Copy-Item -Destination', `Copy-Item .\\notes.txt -Destination ${SONDE_PORTE}`],
    ['Copy-Item positionnel', `Copy-Item notes.txt ${SONDE_PORTE}`],
    ['mv vers le dossier partagé', `mv notes.txt ${SONDE_PORTE}`],
    ['Move-Item depuis le dossier partagé', 'Move-Item D:\\AutoWinOS\\README.md .\\README.md'],
    ['Rename-Item', 'Rename-Item D:\\AutoWinOS\\README.md LISEZMOI.md'],
    ['rm', `rm -f ${SONDE_PORTE}`],
    ['Remove-Item -Recurse -Force', 'Remove-Item -Recurse -Force D:\\AutoWinOS\\src'],
    ['del', `del /q ${SONDE_PORTE}`],
    ['touch', 'touch /d/AutoWinOS/sonde-porte.txt'],
    ['mkdir', 'mkdir -p D:/AutoWinOS/nouveau'],
    ['sed -i', "sed -i 's/a/b/' D:/AutoWinOS/package.json"],
    [
      'Invoke-WebRequest -OutFile',
      `Invoke-WebRequest https://exemple.test -OutFile ${SONDE_PORTE}`
    ],
    ['curl -o', `curl -s -o ${SONDE_PORTE} https://exemple.test`],
    ['dd of=', 'dd if=/dev/zero of=/d/AutoWinOS/sonde-porte.txt count=1'],
    ['[IO.File]::WriteAllText', `[IO.File]::WriteAllText('${SONDE_PORTE}', 'x')`],
    ['[System.IO.File]::Copy (destination)', `[System.IO.File]::Copy('a.txt', '${SONDE_PORTE}')`],
    [
      'node -e writeFileSync',
      `node -e "require('fs').writeFileSync('D:/AutoWinOS/sonde-porte.txt','x')"`
    ],
    ['python open(…, "w")', `python -c "open(r'${SONDE_PORTE}', 'w').write('x')"`],
    ['cd puis chemin relatif', 'cd /d/AutoWinOS && echo x > sonde-porte.txt'],
    ['Set-Location puis Set-Content', 'Set-Location D:\\AutoWinOS; Set-Content sonde-porte.txt x'],
    ['pushd puis copie', 'pushd D:\\AutoWinOS\r\ncopy ..\\x.txt sonde-porte.txt'],
    ['remontée relative hors de la copie', 'echo x > ..\\..\\..\\..\\sonde-porte.txt'],
    ['cmd /c', `cmd /c "echo x > ${SONDE_PORTE}"`],
    ['powershell -Command', `powershell -NoProfile -Command "Set-Content ${SONDE_PORTE} x"`],
    ['bash -c', "bash -c 'echo x > /d/AutoWinOS/sonde-porte.txt'"],
    ['après une commande anodine', `git status; echo x > ${SONDE_PORTE}`],
    ['appel par &', `& Set-Content ${SONDE_PORTE} x`],
    ['dossier de données imité (préfixe)', 'echo x > D:\\AutoWinOS\\.autowin-data-faux\\x.txt'],
    ['le .git du dossier partagé', 'echo x >> D:\\AutoWinOS\\.git\\config']
  ])('par le shell : %s', (_nom, commande) => {
    expect(shell(commande)).toMatch(/Refusé/)
  })

  it('par l’outil PowerShell et par Monitor de Claude', () => {
    expect(claude('PowerShell', { command: `Set-Content ${SONDE_PORTE} x` })).toMatch(/Refusé/)
    expect(claude('Monitor', { command: `echo x > ${SONDE_PORTE}` })).toMatch(/Refusé/)
  })
})

describe('autorisé — les jumeaux des refus', () => {
  it('écrire dans la copie, en chemin complet ou relatif', () => {
    expect(
      claude('Write', { file_path: join(COPIE, 'sonde-porte.txt'), content: 'x' })
    ).toBeUndefined()
    expect(claude('Edit', { file_path: join(COPIE, 'src', 'a.ts') })).toBeUndefined()
    expect(shell('echo x > sonde-porte.txt')).toBeUndefined()
    expect(shell(`echo x > ${join(COPIE, 'sonde-porte.txt')}`)).toBeUndefined()
    expect(shell('Remove-Item -Recurse -Force .\\tmp')).toBeUndefined()
    expect(
      claude('apply_patch', {
        command: '*** Begin Patch\n*** Add File: src/a.ts\n+x\n*** End Patch'
      })
    ).toBeUndefined()
  })

  it('écrire sous D:\\AutoWinOS\\.autowin-data\\ (fiches des runs, données de l’app)', () => {
    const fiche = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\runs\\conv-1\\RUN.md'
    expect(claude('Write', { file_path: fiche, content: 'x' })).toBeUndefined()
    expect(shell(`echo x > ${fiche}`)).toBeUndefined()
    expect(shell(`Set-Content -Path ${fiche} -Value x`)).toBeUndefined()
  })

  it('toute écriture quand le dossier de travail EST D:\\AutoWinOS (ou un de ses sous-dossiers)', () => {
    for (const cwd of [PARTAGE, 'D:\\AutoWinOS\\src']) {
      expect(claude('Write', { file_path: SONDE_PORTE, content: 'x' }, cwd)).toBeUndefined()
      expect(claude('Edit', { file_path: SONDE_PORTE }, cwd)).toBeUndefined()
      expect(shell(`echo x > ${SONDE_PORTE}`, cwd)).toBeUndefined()
      expect(shell(`Set-Content ${SONDE_PORTE} x`, cwd)).toBeUndefined()
    }
  })

  it('lire le dossier partagé, ou en copier un fichier VERS la copie', () => {
    expect(claude('Read', { file_path: SONDE_PORTE })).toBeUndefined()
    expect(shell('cat D:/AutoWinOS/package.json > package.copie.json')).toBeUndefined()
    expect(shell('Get-Content D:\\AutoWinOS\\package.json | Out-File .\\p.json')).toBeUndefined()
    expect(shell('cp D:/AutoWinOS/package.json ./package.json')).toBeUndefined()
    expect(shell('Copy-Item D:\\AutoWinOS\\a.txt -Destination .\\a.txt')).toBeUndefined()
    expect(shell('ls D:\\AutoWinOS > liste.txt 2>&1')).toBeUndefined()
    expect(shell('git -C D:\\AutoWinOS status --porcelain 2>$null')).toBeUndefined()
    expect(shell(`Set-Content -Path .\\note.txt -Value '${SONDE_PORTE}'`)).toBeUndefined()
    // `-Path` ne vaut écriture que pour une commande qui écrit.
    expect(shell('Get-Content -Path D:\\AutoWinOS\\package.json')).toBeUndefined()
    expect(shell('Select-String -Path:D:\\AutoWinOS\\README.md -Pattern x')).toBeUndefined()
  })

  it('du texte qui ressemble à une écriture : entre guillemets, ou dans le corps d’un here-doc', () => {
    expect(shell(`echo "voir > ${SONDE_PORTE}"`)).toBeUndefined()
    expect(
      shell(`cat <<'EOF' > notes.txt\ncp a ${SONDE_PORTE}\necho x > ${SONDE_PORTE}\nEOF\necho fini`)
    ).toBeUndefined()
    expect(shell(`$t = @"\necho x > ${SONDE_PORTE}\n"@ | Set-Content .\\notes.txt`)).toBeUndefined()
    // Un fichier de code écrit DANS la copie peut citer le dossier partagé : c'est son contenu.
    expect(
      shell("cat > a.mjs <<'EOF'\nfs.writeFileSync('D:/AutoWinOS/sonde-porte.txt', 'x')\nEOF")
    ).toBeUndefined()
  })

  it('le corps d’un here-doc ne cache pas l’écriture qui le suit', () => {
    expect(shell(`cat <<'EOF' > notes.txt\nrien\nEOF\necho x > ${SONDE_PORTE}`)).toMatch(/Refusé/)
    expect(shell(`@"\nx\n"@ | Set-Content ${SONDE_PORTE}`)).toMatch(/Refusé/)
  })

  it('un dossier voisin qui commence pareil n’est pas le dossier partagé', () => {
    expect(shell('echo x > D:\\AutoWinOSX\\sonde-porte.txt')).toBeUndefined()
  })

  it('un chemin qu’on ne sait pas résoudre (variable, ~) ne fait pas refuser', () => {
    expect(shell('echo x > $env:TEMP\\a.txt')).toBeUndefined()
    expect(shell('cd $dossier && echo x > sonde-porte.txt')).toBeUndefined()
    expect(shell('echo x > ~/a.txt')).toBeUndefined()
  })

  it('la copie d’un autre projet écrit dans son dépôt comme avant', () => {
    expect(
      claude('Write', { file_path: 'D:\\AutreProjet\\a.cs', content: 'x' }, AUTRE_COPIE)
    ).toBeUndefined()
  })

  it('une entrée sans outil, sans dossier ou sans chemin ne fait rien', () => {
    expect(refusEcritureHorsCopie({}, sondeFictive)).toBeUndefined()
    expect(
      refusEcritureHorsCopie(
        { tool_name: 'Write', tool_input: { file_path: SONDE_PORTE } },
        sondeFictive
      )
    ).toBeUndefined()
    expect(claude('Write', {})).toBeUndefined()
  })
})

/*
 * LE SCRIPT TEL QUE LES OUTILS LE LANCENT : JSON sur l'entrée, refus structuré sur la sortie, dans une
 * vraie disposition git (dépôt, puis `git worktree add` sous ses données d'app).
 */
const SCRIPT = fileURLToPath(new URL('./garde-ecriture-hors-copie.mjs', import.meta.url))

async function lancer(entree, brut) {
  // Sans CLAUDE_PROJECT_DIR ni rien du fil qui joue la suite : seul le JSON décide.
  const env = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR
  const p = spawn(process.execPath, [SCRIPT], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', (d) => (out += d))
  p.stdin.end(brut ?? JSON.stringify(entree))
  const [code] = await once(p, 'close')
  return { code, out }
}

describe('le script lancé comme un contrôle « avant outil »', () => {
  let racine
  let depot
  let copie
  beforeAll(() => {
    // fix-ok: mesuré — sous Windows, tmpdir() rend le dossier personnel en nom court 8.3 alors que
    // git écrit le nom long dans `.git` : les deux ne se comparaient pas. Le poste réel donne
    // D:\AutoWinOS des deux côtés ; le banc prend le chemin réel pour jouer le même cas.
    racine = realpathSync.native(mkdtempSync(join(tmpdir(), 'garde-ecriture-')))
    depot = join(racine, 'depot')
    mkdirSync(depot)
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: depot, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`)
    }
    git('init', '-q')
    git(
      '-c',
      'user.email=banc@local',
      '-c',
      'user.name=banc',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'base'
    )
    copie = join(depot, '.autowin-data', 'autowin-os', 'retours-de-tour', 'essai__conv-1-x-1')
    git('worktree', 'add', '-q', '--detach', copie)
  })
  afterAll(() => {
    if (racine) rmSync(racine, { recursive: true, force: true })
  })

  it('la sonde réelle reconnaît une copie faite par git worktree add', () => {
    const c = copieDe(copie, sondeSysteme)
    expect(c && egal(c.partage, depot)).toBe(true)
    expect(copieDe(depot, sondeSysteme)).toBeUndefined()
  })

  it('Write vers le dossier partagé depuis la copie : refus au format PreToolUse', async () => {
    const { code, out } = await lancer({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(depot, 'sonde-porte.txt'), content: 'x' },
      cwd: copie
    })
    expect(code).toBe(0)
    const r = JSON.parse(out)
    expect(r.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny'
    })
    expect(r.hookSpecificOutput.permissionDecisionReason).toMatch(/Refusé/)
  })

  it('entrée de Grok (toolName/toolInput, workspaceRoot) : même refus', async () => {
    const { out } = await lancer({
      hookEventName: 'pre_tool_use',
      toolName: 'run_terminal_command',
      toolInput: { command: `echo x > "${join(depot, 'sonde-porte.txt')}"` },
      cwd: copie,
      workspaceRoot: copie
    })
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('les jumeaux : depuis le dépôt lui-même, ou dans la copie, rien n’est écrit sur la sortie', async () => {
    const depuisLeDepot = await lancer({
      tool_name: 'Write',
      tool_input: { file_path: join(depot, 'sonde-porte.txt') },
      cwd: depot
    })
    expect(depuisLeDepot).toEqual({ code: 0, out: '' })
    const dansLaCopie = await lancer({
      tool_name: 'Bash',
      tool_input: { command: 'echo x > sonde-porte.txt' },
      cwd: copie
    })
    expect(dansLaCopie).toEqual({ code: 0, out: '' })
  })

  it('un BOM en tête est toléré ; un JSON illisible laisse passer sans planter', async () => {
    const avecBom = await lancer(
      null,
      `\uFEFF${JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(depot, 'a.txt') }, cwd: copie })}`
    )
    expect(JSON.parse(avecBom.out).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(await lancer(null, '{pas du json')).toEqual({ code: 0, out: '' })
  })
})
