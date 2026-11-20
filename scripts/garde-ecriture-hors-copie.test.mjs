import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTOWIN_APP_DATA_DIR } from '../src/shared/app-identity'
import {
  copieDe,
  DOSSIER_DES_DONNEES,
  refusALaRacineDesCopies,
  refusALaRacineDesDonnees,
  refusALaRacineDuDisque,
  refusEcritureHorsCopie,
  refusNomReserve,
  sondeSysteme
} from './garde-ecriture-hors-copie.mjs'

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

  it('un chemin que git ignore (entreprise/) : la porte ne le rapatrierait jamais', () => {
    const PROPRE = 'D:\\AutoWinOS\\entreprise\\societe\\scripts\\mesure.py'
    const MUET = 'D:\\AutoWinOS\\muet.txt'
    const avecGit = {
      ...sondeFictive,
      ignore: (depot, chemin) =>
        !egal(depot, PARTAGE)
          ? false
          : egal(chemin, MUET)
            ? undefined
            : chemin.toLowerCase().startsWith('d:\\autowinos\\entreprise\\')
    }
    const via = (tool_name, tool_input) =>
      refusEcritureHorsCopie({ tool_name, tool_input, cwd: COPIE }, avecGit)
    expect(via('Edit', { file_path: PROPRE })).toBeUndefined()
    expect(via('Bash', { command: `echo x > ${PROPRE}` })).toBeUndefined()
    // Suivi par git, ou git muet : c'est du code, il passe par la copie.
    expect(via('Edit', { file_path: SONDE_PORTE })).toMatch(/Refusé/)
    expect(via('Write', { file_path: MUET, content: 'x' })).toMatch(/Refusé/)
    // Une seule cible suivie suffit à refuser la commande.
    expect(via('Bash', { command: `cp a ${PROPRE} && echo x > ${SONDE_PORTE}` })).toMatch(/Refusé/)
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
 * RIEN DE NEUF À LA RACINE D'UN DISQUE. Relevé du 18/11 : les lots de deux plans, qui travaillaient
 * déjà chacun dans une copie que l'app ouvre et retire, y ont créé à la main une soixantaine de copies
 * git (`git worktree add D:\Projet-it4-lot1 …`, consigne écrite par leur chef) et des centaines de
 * journaux (`> D:\Projet-it4-lot12-banc-1.log`, `D:\tmp-juge-lot9\`). Personne ne les range.
 * Les commandes ci-dessous rejouent ces gestes depuis le dossier réel d'un lot : la copie d'un AUTRE
 * projet rangée sous nos données, que la garde d'écriture hors copie laisse passer.
 */
describe('refusALaRacineDuDisque — rien de neuf à la racine d’un disque', () => {
  const LOT = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-taches\\run-2488591041a7-1'
  const EXISTANTS = ['D:\\Projet', 'D:\\AutoWinOS', 'C:\\Users', 'D:\\vieux.log']
  const sondeRacine = {
    ...sondeFictive,
    existe: (chemin) => EXISTANTS.some((e) => egal(e, chemin))
  }
  const appel = (tool_name, tool_input, cwd = LOT) =>
    refusALaRacineDuDisque(
      { hook_event_name: 'PreToolUse', tool_name, tool_input, cwd },
      sondeRacine
    )
  const sh = (command, cwd) => appel('Bash', { command }, cwd)

  it.each([
    [
      'copie git d’un lot (la consigne du chef)',
      'git worktree add D:/Projet-it4-lot1 -b it4-lot1-cr main'
    ],
    [
      'copie git relative, après cd',
      'cd D:/Projet && git worktree add ../Projet-it3-lot5-avant 1ada470'
    ],
    ['copie git avec -C et -b', 'git -C D:/Projet worktree add -b lot2 D:\\Projet-lot2 main'],
    [
      'copie git avec -c et --detach',
      'git -c core.longpaths=true worktree add --detach D:/Projet-lot3'
    ],
    ['journal d’un banc', 'lune run bancs > D:/Projet-it4-lot12-banc-1.log 2>&1'],
    ['dossier temporaire d’un juge', 'mkdir -p D:/tmp-juge-lot9/E'],
    ['photo copiée', 'cp zoom.png D:/lot7-zoom-tel.png'],
    ['Set-Content', 'Set-Content D:\\tmp-enseignes.txt x'],
    ['Out-File après un tube', "'x' | Out-File -FilePath D:\\filet-chef-a08e15c.txt"]
  ])('refusé par le shell : %s', (_nom, commande) => {
    const motif = sh(commande)
    expect(motif).toMatch(/Refusé/)
    expect(motif).toMatch(/racine/)
  })

  it('refusé par Write et Edit (Claude) et par apply_patch (Codex)', () => {
    expect(appel('Write', { file_path: 'D:\\tmp-lot15-filet.txt', content: 'x' })).toMatch(/Refusé/)
    expect(appel('Edit', { file_path: 'D:/tmp-lot9/b.txt' })).toMatch(/Refusé/)
    expect(
      appel('apply_patch', {
        command: '*** Begin Patch\n*** Add File: D:/tmp-x/a.txt\n+x\n*** End Patch'
      })
    ).toMatch(/Refusé/)
  })

  it('le refus dit où écrire à la place : le dossier temporaire, et la copie de comparaison dedans', () => {
    const motif = sh('git worktree add D:/Projet-it4-lot1 main')
    expect(motif).toContain('D:\\Projet-it4-lot1')
    expect(motif).toContain('$TEMP')
    expect(motif).toContain('git worktree remove')
    expect(motif).toContain('AUTOWIN_DEMANDE_UTILISATEUR=1')
  })

  it.each([
    ['dans un dossier de premier niveau qui existe', 'echo x > D:/Projet/notes.txt'],
    ['supprimer un fichier déjà à la racine', 'rm -f D:/vieux.log'],
    ['copie de comparaison dans le dossier temporaire', 'git worktree add "$TEMP/avant" main'],
    [
      'copie de comparaison sous un dossier existant',
      'git worktree add C:\\Users\\x\\Temp\\avant main'
    ],
    [
      'copie sous les données d’Autowin',
      'git worktree add D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches/avant main'
    ],
    ['lister ou retirer des copies', 'git worktree list; git worktree remove D:/Projet-lot2'],
    [
      'un clone que l’utilisateur demande sur D:\\',
      'git clone https://exemple.test/x.git D:/NouveauProjet'
    ],
    ['lire la racine', 'ls D:/ > liste.txt'],
    [
      'demande nommée de l’utilisateur (Bash)',
      'AUTOWIN_DEMANDE_UTILISATEUR=1 git worktree add D:/wt-export Feature/export'
    ],
    [
      'demande nommée de l’utilisateur (PowerShell)',
      '$env:AUTOWIN_DEMANDE_UTILISATEUR=1; Copy-Item rapport.zip D:\\rapport.zip'
    ]
  ])('autorisé : %s', (_nom, commande) => {
    expect(sh(commande)).toBeUndefined()
  })

  /*
   * Sous Git Bash (l'outil Bash de Claude), `/dev/null` est le périphérique nul et `/tmp` le dossier
   * temporaire : un chemin `/x` qui n'est pas une lettre de disque n'est PAS à la racine du disque
   * courant. Refusé le 18/11 : `… 2>/dev/null` lu comme la création de `D:\dev`.
   */
  it.each([
    ['jeter les erreurs', 'git status --short 2>/dev/null | head -30'],
    ['jeter toute la sortie', 'npm ls > /dev/null 2>&1'],
    ['écrire dans le /tmp de Git Bash', 'mkdir -p /tmp/essai && echo x > /tmp/essai/a.txt'],
    ['bash -c imbriqué', 'bash -c "grep -r x . 2>/dev/null"']
  ])('autorisé sous Git Bash : %s', (_nom, commande) => {
    expect(sh(commande)).toBeUndefined()
  })

  it('sous PowerShell, `/essai` reste la racine du disque courant : refusé', () => {
    expect(appel('PowerShell', { command: 'mkdir /essai' })).toMatch(/Refusé.*D:\\essai/)
    expect(sh('powershell -Command "New-Item -ItemType Directory /essai"')).toMatch(/D:\\essai/)
    // Une lettre de disque sous Git Bash reste lue comme telle.
    expect(sh('mkdir -p /d/tmp-lot9 2>/dev/null')).toMatch(/D:\\tmp-lot9/)
  })

  it('sans sonde d’existence, ni outil, ni dossier : rien n’est refusé', () => {
    expect(
      refusALaRacineDuDisque(
        { tool_name: 'Write', tool_input: { file_path: 'D:\\x.log' }, cwd: LOT },
        sondeFictive
      )
    ).toBeUndefined()
    expect(refusALaRacineDuDisque({}, sondeRacine)).toBeUndefined()
    expect(
      refusALaRacineDuDisque(
        { tool_name: 'Write', tool_input: { file_path: 'D:\\x.log' } },
        sondeRacine
      )
    ).toBeUndefined()
  })

  it('la garde d’écriture hors copie voit aussi une copie git créée dans le dossier partagé', () => {
    expect(shell('git worktree add D:/AutoWinOS/copie-avant main')).toMatch(/Refusé/)
    expect(
      shell('git worktree add D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches/avant main')
    ).toBeUndefined()
  })
})

/*
 * RIEN DE NEUF À LA RACINE DES COPIES. Relevé du 20/11 : à côté des copies que l'app y range, neuf
 * fichiers et une copie git faite à la main traînaient depuis le 10/11, laissés par deux agents qui
 * prenaient le dossier parent de leur copie pour un brouillon. Les commandes ci-dessous sont les leurs,
 * relevées dans leurs journaux de session : un fil qui fait une copie de preuve et y écrit ses journaux
 * en `..`, et une exécution qui range sa capture d'écran dans le dossier nommé par une variable.
 */
describe('refusALaRacineDesCopies — la racine des copies n’appartient qu’à l’app', () => {
  const RACINE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os\\copies-de-taches'
  const PREUVE = `${RACINE}\\preuve-e7f8967a6`
  const RUN = `${RACINE}\\run-a11c09dae62e-1`
  const EXISTANTS = [RACINE, `${RACINE}\\conv-1780`, RUN, 'D:\\AutoWinOS', PREUVE]
  const sondeCopies = {
    ...sondeFictive,
    existe: (chemin) => EXISTANTS.some((e) => egal(e, chemin))
  }
  const appel = (tool_name, tool_input, cwd) =>
    refusALaRacineDesCopies({ tool_name, tool_input, cwd }, sondeCopies)
  const sh = (command, cwd = 'D:\\AutoWinOS') => appel('Bash', { command }, cwd)

  it.each([
    [
      'la copie de preuve faite à la main',
      'git worktree add --detach .autowin-data/autowin-os/copies-de-taches/preuve-a1b2c3 a1b2c3 2>&1 | tail -2',
      undefined,
      'preuve-a1b2c3'
    ],
    [
      'les journaux de preuve écrits en ..',
      'cd /d/AutoWinOS/.autowin-data/autowin-os/copies-de-taches/preuve-e7f8967a6 && npx vitest run --reporter=dot > ../preuve-e7-vitest.log 2>&1',
      undefined,
      'preuve-e7-vitest.log'
    ],
    [
      'la capture rangée par une variable',
      'cd "D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches/run-a11c09dae62e-1" && OUT="D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches" && timeout 590 node scripts/ui-capture.mjs --view chat --code-dev --out "$OUT/capture-liste-chat.png" > "$OUT/sortie-capture.json"',
      undefined,
      'sortie-capture.json'
    ],
    [
      'la même capture, par --out seul',
      'OUT="D:/AutoWinOS/.autowin-data/autowin-os/copies-de-taches"; node scripts/ui-capture.mjs --out "${OUT}/capture-liste-chat.png"',
      RUN,
      'capture-liste-chat.png'
    ],
    [
      'une variable PowerShell',
      'powershell -Command "$o = \'..\'; Set-Content -Path $o\\journal.log -Value x"',
      RUN,
      'journal.log'
    ],
    [
      'une capture de bureau caché par -Output, sous PowerShell',
      'powershell -NoProfile -File scripts/hdesk-observe.ps1 -InstanceId x -Output ../vue.png',
      RUN,
      'vue.png'
    ]
  ])('refusé : %s', (_cas, commande, cwd, nom) => {
    const motif = sh(commande, cwd)
    expect(motif).toMatch(/Refusé : cet appel créerait .*copies-de-taches/u)
    expect(motif).toContain(nom)
    expect(motif).toMatch(/\$TEMP/u)
  })

  it('refusé : par Write, un fichier posé à côté de la copie', () => {
    expect(appel('Write', { file_path: '../notes.md', content: 'x' }, RUN)).toMatch(
      /Refusé.*notes\.md/u
    )
  })

  it.each([
    ['écrire dans sa propre copie', 'echo x > ../run-a11c09dae62e-1/sortie.log', RUN],
    ['écrire au fond de sa copie', 'node scripts/ui-capture.mjs --out captures/a.png', RUN],
    ['écrire dans le dossier temporaire', 'npx vitest run > "$TEMP/preuve.log" 2>&1', RUN],
    ['retirer une copie existante', 'git worktree remove --force ../preuve-e7f8967a6', RUN],
    ['lire la racine', 'ls -la .. && cat ../conv-1780/AGENTS.md', RUN],
    [
      'l’utilisateur a demandé cet emplacement',
      'AUTOWIN_DEMANDE_UTILISATEUR=1 echo x > ../demande.txt',
      RUN
    ],
    ['un sous-dossier qui porte le même nom ailleurs', 'echo x > copies-de-taches/a.txt', RUN]
  ])('autorisé : %s', (_cas, commande, cwd) => {
    expect(sh(commande, cwd)).toBeUndefined()
  })
})

/*
 * LA RACINE DES DONNÉES DE L'APP. Relevé du 20/11 : vingt et un journaux de preuve de lots
 * (`captures-lot8-*.log`, `judge-lot8-*.log`, `juge-lot2-*.log`) et un correctif mis de côté
 * (`conv-1783-masquer-decoches.patch`) y traînaient depuis dix à douze jours. L'app écrit ses propres
 * fichiers sans passer par la garde ; un agent, lui, crée parfois à la main un réglage de l'app
 * (`navigateur-sites.json`) : seuls journaux, correctifs et captures sont refusés.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un de ces journaux qui passe ; un réglage `.json` ou `.md`
 * refusé ; un refus sous un sous-dossier, sur un fichier existant ou hors du dossier de l'app.
 */
describe('refusALaRacineDesDonnees — ni journal, ni correctif, ni capture à la racine des données', () => {
  const RACINE = 'D:\\AutoWinOS\\.autowin-data\\autowin-os'
  const COPIE_1783 = `${RACINE}\\copies-de-taches\\conv-1783`
  const EXISTANTS = ['D:\\AutoWinOS', RACINE, `${RACINE}\\crash.log`, `${RACINE}\\runs`, COPIE_1783]
  const sondeDonnees = {
    ...sondeFictive,
    existe: (chemin) => EXISTANTS.some((e) => egal(e, chemin))
  }
  const appel = (tool_name, tool_input, cwd = 'D:\\AutoWinOS') =>
    refusALaRacineDesDonnees({ tool_name, tool_input, cwd }, sondeDonnees)
  const sh = (command, cwd) => appel('Bash', { command }, cwd)

  it.each([
    [
      'le journal de preuve d’un lot',
      'npx vitest run src/main/runs/run-autoclose.test.ts > .autowin-data/autowin-os/captures-lot8-red-autoclose.log 2>&1',
      undefined,
      'captures-lot8-red-autoclose.log'
    ],
    [
      'le typage du juge, en chemin Git Bash, depuis une copie',
      'npm run typecheck > /d/AutoWinOS/.autowin-data/autowin-os/judge-lot8-typecheck.log 2>&1',
      COPIE,
      'judge-lot8-typecheck.log'
    ],
    [
      'le correctif mis de côté en ../..',
      'git diff > ../../conv-1783-masquer-decoches.patch',
      COPIE_1783,
      'conv-1783-masquer-decoches.patch'
    ],
    [
      'une capture par --out',
      'node scripts/ui-capture.mjs --code-dev --out .autowin-data/autowin-os/capture-chat.png',
      undefined,
      'capture-chat.png'
    ],
    [
      'une sortie par Out-File, sous PowerShell',
      'powershell -Command "npm test | Out-File D:\\AutoWinOS\\.autowin-data\\autowin-os\\suite.log"',
      undefined,
      'suite.log'
    ]
  ])('refusé : %s', (_cas, commande, cwd, nom) => {
    const motif = sh(commande, cwd)
    expect(motif).toMatch(/Refusé : cet appel créerait .*à la racine des données de l'app/u)
    expect(motif).toContain(nom)
    expect(motif).toMatch(/\$TEMP/u)
  })

  it('refusé : par Write, des notes en .txt', () => {
    expect(appel('Write', { file_path: `${RACINE}\\notes-lot9.txt`, content: 'x' })).toMatch(
      /Refusé.*notes-lot9\.txt/u
    )
  })

  it.each([
    ['compléter un journal que l’app tient déjà', 'echo x >> .autowin-data/autowin-os/crash.log'],
    ['écrire sous un sous-dossier', 'echo x > .autowin-data/autowin-os/runs/r1/preuve.log'],
    ['écrire dans le dossier temporaire', 'npx vitest run > "$TEMP/preuve.log" 2>&1'],
    ['lire la racine', 'ls .autowin-data/autowin-os && cat .autowin-data/autowin-os/crash.log'],
    [
      'l’utilisateur a demandé cet emplacement',
      'AUTOWIN_DEMANDE_UTILISATEUR=1 echo x > .autowin-data/autowin-os/demande.log'
    ],
    ['un dossier du même nom hors des données', 'echo x > docs/autowin-os/a.log']
  ])('autorisé : %s', (_cas, commande) => {
    expect(sh(commande)).toBeUndefined()
  })

  it.each([
    ['un réglage de l’app créé à la main', `${RACINE}\\navigateur-sites.json`],
    ['la mémoire de tête', `${RACINE}\\memoire-de-tete.md`]
  ])('autorisé : par Write, %s', (_cas, file_path) => {
    expect(appel('Write', { file_path, content: '{}' })).toBeUndefined()
  })

  it('le dossier surveillé est celui que l’app nomme (src/shared/app-identity.ts)', () => {
    expect(DOSSIER_DES_DONNEES).toBe(AUTOWIN_APP_DATA_DIR)
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

  it('vraie sonde : une entrée neuve à la racine du disque est refusée, le dossier temporaire passe', async () => {
    const absent = `${racine.slice(0, 2)}\\garde-racine-${process.pid}-${Date.now()}\\banc.log`
    const refus = await lancer({
      tool_name: 'Bash',
      tool_input: { command: `echo x > "${absent}"` },
      cwd: copie
    })
    expect(JSON.parse(refus.out).hookSpecificOutput.permissionDecisionReason).toMatch(/racine/)
    const dansLeTemporaire = await lancer({
      tool_name: 'Bash',
      tool_input: { command: `echo x > "${join(racine, 'banc.log')}"` },
      cwd: copie
    })
    expect(dansLeTemporaire).toEqual({ code: 0, out: '' })
  })

  it('vraie sonde : un journal neuf à la racine des données est refusé, un réglage .json passe', async () => {
    const donnees = join(depot, '.autowin-data', 'autowin-os')
    const refus = await lancer({
      tool_name: 'Bash',
      tool_input: { command: `npm test > "${join(donnees, 'banc-lot9.log')}" 2>&1` },
      cwd: copie
    })
    expect(JSON.parse(refus.out).hookSpecificOutput.permissionDecisionReason).toMatch(
      /racine des données de l'app/
    )
    const reglage = await lancer({
      tool_name: 'Write',
      tool_input: { file_path: join(donnees, 'navigateur-sites.json'), content: '{}' },
      cwd: copie
    })
    expect(reglage).toEqual({ code: 0, out: '' })
  })

  it('un BOM en tête est toléré ; un JSON illisible laisse passer sans planter', async () => {
    const avecBom = await lancer(
      null,
      `\uFEFF${JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(depot, 'a.txt') }, cwd: copie })}`
    )
    expect(JSON.parse(avecBom.out).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(await lancer(null, '{pas du json')).toEqual({ code: 0, out: '' })
  })

  it('un chemin que git ignore dans le dépôt passe ; git muet hors d’un dépôt : undefined', async () => {
    writeFileSync(join(depot, '.gitignore'), '/entreprise/\n')
    const propre = join(depot, 'entreprise', 'societe', 'mesure.py')
    expect(sondeSysteme.ignore(depot, propre)).toBe(true)
    expect(sondeSysteme.ignore(depot, join(depot, 'sonde-porte.txt'))).toBe(false)
    expect(sondeSysteme.ignore(racine, join(racine, 'x.txt'))).toBeUndefined()
    const { code, out } = await lancer({
      tool_name: 'Write',
      tool_input: { file_path: propre, content: 'x' },
      cwd: copie
    })
    expect({ code, out }).toEqual({ code: 0, out: '' })
  })
})

/*
 * LE NOM RÉSERVÉ SE REFUSE À L'ÉCRITURE. Cas réel du 2026-11-19 : un agent a laissé un terme réservé
 * dans un commentaire de test ; le crochet de commit l'a refusé à la fin du tour, l'envoi du fil est
 * resté bloqué sans que le fichier soit nommé. Même cause dans quatre autres fils en trois jours. Le
 * terme est FICTIF, posé par le profil du dépôt de test ; les règles sont celles du vrai module, recopié.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : le terme écrit dans un fichier suivi qui passe ; le terme recopié
 * dans le motif du refus ; un refus sur `entreprise/`, un fichier ignoré, un texte propre ou un autre projet.
 */
describe('refusNomReserve — un nom réservé ne s’écrit pas dans un fichier suivi', () => {
  const TERME = 'zorglubfictif'
  let depot
  let autreProjet
  beforeAll(() => {
    const racine = realpathSync.native(mkdtempSync(join(tmpdir(), 'garde-nom-')))
    depot = join(racine, 'autowin')
    autreProjet = join(racine, 'projet')
    for (const d of [depot, autreProjet]) {
      mkdirSync(d)
      spawnSync('git', ['init', '-q'], { cwd: d })
    }
    mkdirSync(join(depot, 'scripts'))
    writeFileSync(
      join(depot, 'scripts', 'identite-entreprise.mjs'),
      readFileSync(join(dirname(SCRIPT), 'identite-entreprise.mjs'))
    )
    mkdirSync(join(depot, 'entreprise', 'acmecorp'), { recursive: true })
    writeFileSync(
      join(depot, 'entreprise', 'acmecorp', 'identite.json'),
      JSON.stringify({ termesInterdits: [{ motif: TERME }] })
    )
    writeFileSync(join(depot, '.gitignore'), '/entreprise/\n/journal/\n')
  })

  const ecrire = (fichier, content, dossier = depot) =>
    refusNomReserve({
      tool_name: 'Write',
      tool_input: { file_path: fichier, content },
      cwd: dossier
    })

  it('refusé : le terme dans un fichier suivi, ligne nommée et passage masqué', async () => {
    const motif = await ecrire(
      join(depot, 'scripts', 'outil.test.mjs'),
      `// en-tête\n// Cas réel : D:\\${TERME}, 51 commits\n`
    )
    expect(motif).toMatch(/Refusé : ce texte porte un nom ou un terme réservé/u)
    expect(motif).toContain('scripts/outil.test.mjs')
    expect(motif).toContain('Ligne 2 du texte écrit')
    expect(motif).toContain('Cas réel : D:\\«…», 51 commits')
    expect(motif).not.toContain(TERME)
  })

  it('refusé : le nom du profil (casse ignorée) apporté par une retouche', async () => {
    const motif = await refusNomReserve({
      tool_name: 'Edit',
      tool_input: {
        file_path: join(depot, 'src', 'x.ts'),
        old_string: 'a',
        new_string: 'chez AcmeCorp'
      },
      cwd: depot
    })
    expect(motif).toContain('chez «…»')
    expect(motif?.toLowerCase()).not.toContain('acmecorp')
  })

  it.each([
    ['un texte propre', () => ecrire(join(depot, 'src', 'x.ts'), 'export const x = 1\n')],
    ['le profil lui-même', () => ecrire(join(depot, 'entreprise', 'acmecorp', 'n.md'), TERME)],
    ['les données de l’app', () => ecrire(join(depot, '.autowin-data', 'note.md'), TERME)],
    ['un fichier ignoré', () => ecrire(join(depot, 'journal', 'j.log'), TERME)],
    ['un autre projet', () => ecrire(join(autreProjet, 'a.ts'), TERME, autreProjet)],
    [
      'une retouche qui RETIRE le terme',
      () =>
        refusNomReserve({
          tool_name: 'Edit',
          tool_input: { file_path: join(depot, 'a.ts'), old_string: TERME, new_string: 'un dépôt' },
          cwd: depot
        })
    ],
    [
      'un outil de lecture',
      () =>
        refusNomReserve({
          tool_name: 'Read',
          tool_input: { file_path: join(depot, 'a.ts') },
          cwd: depot
        })
    ]
  ])('passe : %s', async (_cas, appel) => {
    expect(await appel()).toBeUndefined()
  })

  it('le script lancé comme contrôle « avant outil » refuse l’écriture', async () => {
    const { code, out } = await lancer({
      tool_name: 'Write',
      tool_input: { file_path: join(depot, 'src', 'y.ts'), content: `const t = '${TERME}'` },
      cwd: depot
    })
    expect(code).toBe(0)
    const sortie = JSON.parse(out).hookSpecificOutput
    expect(sortie.permissionDecision).toBe('deny')
    expect(sortie.permissionDecisionReason).not.toContain(TERME)
  })

  /**
   * LE SHELL ÉCRIT AUSSI. Sans ces cas, `echo … > fichier` ou un `sed -i` posait le terme sans que la garde
   * le lise, et seul le commit de fin de tour le refusait. Chaque forme claire où le texte posé est écrit
   * dans la commande est lue ; une sortie inconnue (`grep … > f`, un script lancé) ne l'est pas.
   */
  const commande = (tool_name, command, dossier = depot) =>
    refusNomReserve({ tool_name, tool_input: { command }, cwd: dossier })
  const bash = (command, dossier) => commande('Bash', command, dossier)
  const ps = (command) => commande('PowerShell', command)
  const enAvant = () => depot.split('\\').join('/')

  it.each([
    ['echo vers un fichier', () => bash(`echo "// ${TERME}" > scripts/a.mjs`), 'scripts/a.mjs'],
    ['printf en ajout', () => bash(`printf '%s\\n' 'x ${TERME}' >> src/b.ts`), 'src/b.ts'],
    [
      'un here-doc',
      () => bash(`cat > src/c.ts <<'EOF'\nconst a = 1\nconst t = '${TERME}'\nEOF`),
      'src/c.ts'
    ],
    ['un here-doc passé à tee', () => bash(`cat <<EOF | tee src/d.ts\n${TERME}\nEOF`), 'src/d.ts'],
    ['Set-Content -Value', () => ps(`Set-Content -Path src/e.ts -Value '${TERME}'`), 'src/e.ts'],
    ['une chaîne passée à Out-File', () => ps(`'${TERME}' | Out-File src/f.ts`), 'src/f.ts'],
    [
      'une here-string passée à Set-Content',
      () => ps(`@"\nligne\n${TERME}\n"@ | Set-Content src/g.ts`),
      'src/g.ts'
    ],
    ['Add-Content positionnel', () => ps(`Add-Content src/h.ts "${TERME}"`), 'src/h.ts'],
    ['le remplacement d’un sed -i', () => bash(`sed -i 's/x/${TERME}/g' src/i.ts`), 'src/i.ts'],
    ['une ligne ajoutée par sed -i', () => bash(`sed -i '3a ${TERME}' src/i2.ts`), 'src/i2.ts'],
    [
      'writeFileSync de node -e',
      () => bash(`node -e "require('fs').writeFileSync('${enAvant()}/src/j.ts', '${TERME}')"`),
      'src/j.ts'
    ],
    [
      'node lu dans un here-doc',
      () =>
        bash(
          `node <<'EOF'\nrequire('fs').writeFileSync('${enAvant()}/src/j2.ts', '${TERME}')\nEOF`
        ),
      'src/j2.ts'
    ],
    [
      'WriteAllText de .NET',
      () => ps(`[IO.File]::WriteAllText('${enAvant()}/src/k.ts', '${TERME}')`),
      'src/k.ts'
    ],
    [
      'un correctif apply_patch de Codex',
      () =>
        refusNomReserve({
          tool_name: 'apply_patch',
          tool_input: {
            command: `*** Begin Patch\n*** Add File: src/l.ts\n+const a = 1\n+// ${TERME}\n*** End Patch\n`
          },
          cwd: depot
        }),
      'src/l.ts'
    ],
    ['un bash -c imbriqué', () => bash(`bash -c "echo ${TERME} > src/m.ts"`), 'src/m.ts'],
    ['après cd', () => bash(`cd src && echo ${TERME} > n.ts`), 'src/n.ts']
  ])('refusé par le shell : %s', async (_cas, appel, fichier) => {
    const motif = await appel()
    expect(motif).toMatch(/Refusé : ce texte porte un nom ou un terme réservé/u)
    expect(motif).toContain(fichier)
    expect(motif).toContain('«…»')
    expect(motif).not.toContain(TERME)
  })

  it('refusé par le shell : la ligne du here-doc est nommée', async () => {
    const motif = await bash(`cat > src/c.ts <<'EOF'\nconst a = 1\nconst t = '${TERME}'\nEOF`)
    expect(motif).toContain('Ligne 2 du texte écrit')
    expect(motif).toContain("const t = '«…»'")
  })

  it.each([
    ['un sed qui RETIRE le terme', () => bash(`sed -i 's/${TERME}/un dépôt/g' src/a.ts`)],
    ['un sed qui supprime ses lignes', () => bash(`sed -i '/${TERME}/d' src/a.ts`)],
    ['une sortie inconnue (grep -v)', () => bash(`grep -v ${TERME} src/a.ts > src/a2.ts`)],
    ['une simple recherche', () => bash(`git log --grep=${TERME} --oneline`)],
    ['un echo sans fichier', () => bash(`echo ${TERME}`)],
    ['un texte propre', () => bash(`echo propre > src/a.ts`)],
    ['vers le profil', () => bash(`echo ${TERME} > entreprise/acmecorp/n.md`)],
    ['vers un fichier ignoré', () => bash(`echo ${TERME} > journal/j.log`)],
    ['vers le dossier temporaire', () => bash(`echo ${TERME} > /tmp/x.txt`)],
    ['dans un autre projet', () => bash(`echo ${TERME} > a.ts`, autreProjet)],
    ['une lecture PowerShell', () => ps(`Get-Content src/a.ts | Select-String ${TERME}`)],
    ['une copie (contenu non lu)', () => bash(`cp src/a.ts src/b.ts`)]
  ])('passe par le shell : %s', async (_cas, appel) => {
    expect(await appel()).toBeUndefined()
  })

  it('le script lancé comme contrôle « avant outil » refuse aussi la commande', async () => {
    const { code, out } = await lancer({
      tool_name: 'Bash',
      tool_input: { command: `echo '${TERME}' > src/z.ts` },
      cwd: depot
    })
    expect(code).toBe(0)
    const sortie = JSON.parse(out).hookSpecificOutput
    expect(sortie.permissionDecision).toBe('deny')
    expect(sortie.permissionDecisionReason).toContain('src/z.ts')
    expect(sortie.permissionDecisionReason).not.toContain(TERME)
  })
})
