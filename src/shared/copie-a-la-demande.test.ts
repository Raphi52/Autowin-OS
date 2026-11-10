import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  cibleDEcritureDansLeDepot,
  copieAvantLEcriture,
  type AppelVuParLeControle,
  type IoCopieALaDemande
} from './copie-a-la-demande'

/**
 * LA COPIE S'OUVRE À LA PREMIÈRE ÉCRITURE DANS LE CODE. Rapport de défaut : un fil neuf ouvert par
 * « resume cette video » annonçait « Ce fil travaille maintenant dans sa propre copie », alors que
 * le tour n'écrivait rien dans le code. Ici, ce que le contrôle compte comme une écriture.
 */
const depot = path.resolve('/depot')
const ignores = [path.join(depot, 'node_modules'), path.join(depot, '.autowin-data')]
const io = {
  path,
  windows: false,
  estIgnore: (chemin: string) =>
    ignores.some((d) => chemin === d || chemin.startsWith(d + path.sep))
}
const appel = (
  outil: string,
  entree: Partial<AppelVuParLeControle> = {}
): AppelVuParLeControle => ({
  outil,
  chemin: '',
  shell: '',
  cwd: depot,
  ...entree
})
const cible = (a: AppelVuParLeControle): string | undefined =>
  cibleDEcritureDansLeDepot(a, depot, io)

describe('cibleDEcritureDansLeDepot — les outils d’édition', () => {
  it('une édition dans le code du dépôt est une écriture', () => {
    expect(cible(appel('Edit', { chemin: path.join(depot, 'src/a.ts') }))).toBe(
      path.join(depot, 'src/a.ts')
    )
    expect(cible(appel('Write', { chemin: 'src/neuf.ts' }))).toBe(path.join(depot, 'src/neuf.ts'))
  })

  it('hors du dépôt, ou dans ce que git ignore (données de l’app, dépendances) : rien à isoler', () => {
    expect(cible(appel('Write', { chemin: path.resolve('/tmp/resume.md') }))).toBeUndefined()
    expect(
      cible(appel('Write', { chemin: path.join(depot, '.autowin-data/autowin-os/x.json') }))
    ).toBeUndefined()
    expect(
      cible(appel('Edit', { chemin: path.join(depot, 'node_modules/a/index.js') }))
    ).toBeUndefined()
  })

  it('une lecture n’est jamais une écriture', () => {
    expect(cible(appel('Read', { chemin: path.join(depot, 'src/a.ts') }))).toBeUndefined()
    expect(cible(appel('Grep', { chemin: path.join(depot, 'src') }))).toBeUndefined()
  })
})

describe('cibleDEcritureDansLeDepot — le terminal', () => {
  it.each([
    ['git log --oneline -5 && git status --short'],
    ['grep -rn "copie" src | head -20'],
    ['sed -n 1,80p src/a.ts'],
    ['cat src/a.ts > /tmp/a.txt'],
    ['node scripts/transcrire.mjs https://exemple.test/video 2>&1'],
    ['npx vitest run src/a.test.ts'],
    ['npm run typecheck'],
    ['git stash list'],
    ['echo fini > /dev/null'],
    ['mkdir -p /tmp/sortie && cp src/a.ts /tmp/sortie/']
  ])('commande qui n’écrit pas dans le code : %s', (shell) => {
    expect(cible(appel('Bash', { shell }))).toBeUndefined()
  })

  it.each([
    ['echo x > src/a.ts', 'src/a.ts'],
    ["cat >> notes.md <<'EOF'", 'notes.md'],
    ['sed -i "s/a/b/" src/a.ts', 'src/a.ts'],
    ['rm -f src/vieux.ts', 'src/vieux.ts'],
    ['mv src/a.ts src/b.ts', 'src/a.ts'],
    ['cp /tmp/a.ts src/a.ts', 'src/a.ts'],
    ['git commit -m "fix" -- src/a.ts', '.'],
    ['git -C . add -A', '.'],
    ['npm install left-pad', 'package.json'],
    ['npx prettier --write src/a.ts', 'src/a.ts'],
    ['grep x src | tee rapport.txt', 'rapport.txt'],
    ['cd src && touch neuf.ts', 'src/neuf.ts']
  ])('commande qui écrit dans le code : %s', (shell, vise) => {
    expect(cible(appel('Bash', { shell }))).toBe(path.resolve(depot, vise))
  })

  it('PowerShell : les cmdlets d’écriture, chemin nommé ou en premier', () => {
    expect(cible(appel('PowerShell', { shell: 'Set-Content -Path src/a.ts -Value "x"' }))).toBe(
      path.join(depot, 'src/a.ts')
    )
    expect(
      cible(appel('PowerShell', { shell: 'New-Item -ItemType Directory -Path /tmp/x' }))
    ).toBeUndefined()
    expect(
      cible(appel('PowerShell', { shell: 'Get-Content src/a.ts | Select-String x' }))
    ).toBeUndefined()
  })

  it('une commande lancée depuis un dossier ignoré (la copie elle-même) n’écrit pas dans le code', () => {
    const copie = path.join(depot, '.autowin-data/autowin-os/copies-de-taches/conv-1')
    expect(cible(appel('Bash', { shell: 'git commit -am x', cwd: copie }))).toBeUndefined()
    expect(cible(appel('Bash', { shell: `cd "${copie}" && rm src/a.ts` }))).toBeUndefined()
  })

  it('après un `cd` vers un dossier illisible, un chemin relatif ne compte plus dans le code', () => {
    // Mesuré : `cd "$LOCALAPPDATA/Temp/essai" && mkdir -p .agents` ouvrait la copie pour rien.
    expect(
      cible(appel('Bash', { shell: 'cd "$LOCALAPPDATA/Temp/essai" && mkdir -p .agents' }))
    ).toBeUndefined()
    expect(cible(appel('Bash', { shell: 'cd "$AILLEURS" && git commit -am x' }))).toBeUndefined()
    expect(cible(appel('Bash', { shell: 'cd "$AILLEURS" && npm install' }))).toBeUndefined()
    // Un chemin complet reste lu, où que la commande tourne.
    expect(
      cible(appel('Bash', { shell: `cd "$AILLEURS" && rm ${path.join(depot, 'src/a.ts')}` }))
    ).toBe(path.join(depot, 'src/a.ts'))
  })

  it('une commande enveloppée (`bash -lc`, `powershell -Command`, `cmd /c`) est lue de l’intérieur', () => {
    expect(cible(appel('Bash', { shell: 'bash -lc "echo x > src/b.ts"' }))).toBe(
      path.join(depot, 'src/b.ts')
    )
    expect(
      cible(
        appel('Bash', {
          shell: 'powershell -NoProfile -Command "Set-Content -Path src/c.ts -Value x"'
        })
      )
    ).toBe(path.join(depot, 'src/c.ts'))
    expect(cible(appel('Bash', { shell: 'cmd /c del src\\a.ts' }))).toBeDefined()
    expect(cible(appel('Bash', { shell: 'bash -lc "git status && cat src/a.ts"' }))).toBeUndefined()
  })
})

describe('cibleDEcritureDansLeDepot — chemins à la Git Bash sous Windows', () => {
  it('`/d/depot/src/a.ts` vise `D:\\depot\\src\\a.ts`', () => {
    const w = path.win32
    const ioWin = { path: w, windows: true, estIgnore: () => false }
    expect(
      cibleDEcritureDansLeDepot(
        appel('Bash', { shell: 'echo x > /d/Depot/src/a.ts', cwd: 'C:\\ailleurs' }),
        'D:\\depot',
        ioWin
      )
    ).toBe('D:\\Depot\\src\\a.ts')
  })
})

/** Le contrôle et l'app, simulés : l'app répond quand le contrôle a posé sa demande. */
function banc(reponseDeLApp: unknown | ((demande: unknown) => unknown)) {
  const fichiers = new Map<string, unknown>()
  let horloge = 0
  const conf = { depot, demande: '/reglages/demande.json', reponse: '/reglages/reponse.json' }
  const io: IoCopieALaDemande = {
    lireJson: (p) => fichiers.get(p),
    ecrireJson: (p, v) => fichiers.set(p, v),
    attendre: (ms) => {
      horloge += ms
      const demande = fichiers.get(conf.demande)
      if (demande && !fichiers.has(conf.reponse) && reponseDeLApp !== undefined)
        fichiers.set(
          conf.reponse,
          typeof reponseDeLApp === 'function' ? reponseDeLApp(demande) : reponseDeLApp
        )
    },
    maintenant: () => horloge,
    cible,
    path
  }
  return { conf, io, fichiers }
}

describe('copieAvantLEcriture — l’échange avec l’app', () => {
  const copie = path.join(depot, '.autowin-data/autowin-os/copies-de-taches/conv-1')

  it('une lecture ne demande rien : aucune copie', () => {
    const { conf, io, fichiers } = banc({ ok: true, chemin: copie })
    expect(copieAvantLEcriture(appel('Bash', { shell: 'git status' }), conf, io)).toBeUndefined()
    expect(fichiers.has(conf.demande)).toBe(false)
  })

  it('la première écriture demande la copie, attend, puis renvoie l’agent dans la copie', () => {
    const { conf, io, fichiers } = banc({ ok: true, chemin: copie })
    const motif = copieAvantLEcriture(
      appel('Edit', { chemin: path.join(depot, 'src/a.ts') }),
      conf,
      io
    )
    expect(fichiers.get(conf.demande)).toMatchObject({ chemin: path.join(depot, 'src/a.ts') })
    expect(motif).toContain('ouverte juste avant cette première modification')
    expect(motif).toContain(path.join(copie, 'src/a.ts'))
  })

  it('copie déjà ouverte : une écriture dans le dossier partagé est renvoyée vers la copie, sans redemander', () => {
    const { conf, io, fichiers } = banc(undefined)
    fichiers.set(conf.reponse, { ok: true, chemin: copie })
    const motif = copieAvantLEcriture(appel('Bash', { shell: 'rm src/a.ts' }), conf, io)
    expect(motif).toContain(`cd "${copie}"`)
    expect(fichiers.has(conf.demande)).toBe(false)
    // L'écriture DANS la copie passe.
    expect(
      copieAvantLEcriture(appel('Edit', { chemin: path.join(copie, 'src/a.ts') }), conf, io)
    ).toBeUndefined()
  })

  it('ouverture refusée par l’app : le tour écrit dans le dossier partagé, comme avant', () => {
    const { conf, io } = banc({ ok: false, raison: 'pas un dépôt git' })
    expect(
      copieAvantLEcriture(appel('Write', { chemin: path.join(depot, 'a.md') }), conf, io)
    ).toBeUndefined()
  })

  it('l’app ne répond pas à temps : refus sans rien écrire, l’appel suivant relira la réponse', () => {
    const { conf, io } = banc(undefined)
    const motif = copieAvantLEcriture(
      appel('Write', { chemin: path.join(depot, 'a.md') }),
      { ...conf, attenteMs: 1_000 },
      io
    )
    expect(motif).toContain('pas encore prête')
  })
})
