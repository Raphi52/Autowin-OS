/**
 * GARDE-FOU : `fs.watch` ne s'appelle QUE par `surveiller-dossier.ts`, qui canonicalise le chemin.
 *
 * Récidive constatée le 2026-10-22 (contrôle final de conv-1056) : le correctif du 2026-08-31
 * (`realCanonique`) protégeait un seul veilleur ; un veilleur ajouté le 2026-10-19
 * (`store/surveillance-references-git.ts`) appelait `watch` en direct, et la suite entière
 * mourait en code 127 (`Assertion failed: !_wcsnicmp(filename, dir, dirlen)`, libuv) dès que
 * `os.tmpdir()` rendait un nom court 8.3. Ce test rend la récidive ROUGE au lieu d'un plantage.
 *
 * Le second volet rejoue le plantage dans un processus ENFANT (un `abort()` C tuerait le worker
 * vitest) : sur un dossier atteint par un nom court, `fs.watch` en direct aborte, la porte survit.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const RACINE_MAIN = resolve(__dirname)

function sourcesDuProcessusPrincipal(dossier: string): string[] {
  const fichiers: string[] = []
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) fichiers.push(...sourcesDuProcessusPrincipal(chemin))
    else if (/\.tsx?$/.test(nom) && !/\.test\.tsx?$|\.test-helpers?\.ts$/.test(nom))
      fichiers.push(chemin)
  }
  return fichiers
}

/** Le fichier appelle-t-il `fs.watch` sans passer par la porte ? */
function appelleWatchEnDirect(source: string): boolean {
  // `import { …, watch, … } from 'node:fs'` (ou 'fs') — `watchFile` n'est pas concerné.
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs['"]/g)) {
    if (/(^|[\s,])watch(\s+as\s+\w+)?\s*(,|$)/.test(m[1])) return true
  }
  // `fs.watch(` sur un import d'espace de noms.
  return /\bfs\.watch\s*\(/.test(source)
}

describe('fs.watch passe toujours par surveiller-dossier.ts', () => {
  it('aucun autre fichier de src/main n’importe `watch` de node:fs', () => {
    const fautifs = sourcesDuProcessusPrincipal(RACINE_MAIN)
      .filter((f) => appelleWatchEnDirect(readFileSync(f, 'utf8')))
      .map((f) => relative(RACINE_MAIN, f).replace(/\\/g, '/'))
    expect(fautifs).toEqual(['surveiller-dossier.ts'])
  })

  it('le détecteur reconnaît les formes d’appel direct (falsification)', () => {
    expect(appelleWatchEnDirect("import { readFileSync, watch } from 'node:fs'")).toBe(true)
    expect(appelleWatchEnDirect("import { watch as w } from 'fs'")).toBe(true)
    expect(appelleWatchEnDirect('fs.watch(dossier, () => {})')).toBe(true)
    expect(appelleWatchEnDirect("import { watchFile, type FSWatcher } from 'node:fs'")).toBe(false)
  })
})

const DOSSIER = join(tmpdir(), 'autowin-surveiller-dossier')
afterAll(() => rmSync(DOSSIER, { recursive: true, force: true }))

/**
 * L'ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA PORTE NE CANONICALISAIT PLUS : un dossier atteint par
 * son NOM COURT 8.3, fabriqué ici depuis sa forme longue (forme
 * `C:\Users\PRENOM~1.NOM\AppData\Local\Temp\AUTOWI~1`). Jamais présumé de `os.tmpdir()` : il ne rend
 * un nom court que si le nom d'utilisateur dépasse 8 caractères. Mesuré le 2026-10-22 (conv-1056),
 * porte réduite à `watch(chemin)` et `TEMP`/`TMP` en forme longue : l'ancienne version de ce test
 * passait au VERT (code 0), celle-ci passe au ROUGE sur l'assertion de libuv.
 */
function nomCourt(chemin: string): string {
  const r = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${chemin}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true
  })
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : chemin
}

/** Surveille `cible` dans un processus ENFANT, par `appel` (`watch` direct ou la porte). */
function surveillerDansUnEnfant(
  appel: 'watch' | 'surveillerDossier',
  cible: string
): SpawnSyncReturns<string> {
  const porte = pathToFileURL(resolve(__dirname, 'surveiller-dossier.ts')).href
  const script = [
    `import { surveillerDossier } from '${porte}'`,
    "import { watch, writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    'const cible = process.argv[1]',
    `const w = ${appel}(cible, { persistent: false }, () => {})`,
    "w.on('error', () => {})",
    "for (let i = 0; i < 5; i++) writeFileSync(join(cible, 'f' + i + '.txt'), 'x')",
    'setTimeout(() => { w.close(); process.exit(0) }, 400)'
  ].join('\n')
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script, cible],
    { encoding: 'utf8', timeout: 30_000 }
  )
}

describe('surveillerDossier sur un chemin court 8.3', () => {
  it.skipIf(process.platform !== 'win32')(
    'la porte survit (code 0) là où `fs.watch` en direct aborte sur la MÊME entrée',
    (ctx) => {
      rmSync(DOSSIER, { recursive: true, force: true })
      mkdirSync(DOSSIER, { recursive: true })
      const longue = realpathSync.native(DOSSIER)
      const courte = nomCourt(longue)
      ctx.skip(
        courte.toLowerCase() === longue.toLowerCase(),
        `aucun nom court 8.3 pour ${longue} : le défaut n'est pas reproductible sur ce volume`
      )

      // JUMEAU : la même entrée SANS la porte doit tuer l'enfant. Sinon le vert de la porte ne
      // prouverait rien. Un enfant qui échoue pour une autre raison (script cassé) reste ROUGE ;
      // seul un `fs.watch` qui survit proprement (libuv corrigé) rend le test sans objet.
      const direct = surveillerDansUnEnfant('watch', courte)
      if (!/Assertion failed/.test(direct.stderr)) {
        expect(direct.status, direct.stderr).toBe(0)
        ctx.skip(
          `fs.watch survit au nom court avec Node ${process.version} : porte non prouvée ici`
        )
      }

      const parLaPorte = surveillerDansUnEnfant('surveillerDossier', courte)
      expect(parLaPorte.stderr).not.toMatch(/Assertion failed/)
      expect(parLaPorte.status).toBe(0)
    }
  )
})
