/**
 * LE CRASH QUI TUAIT LA SUITE ENTIERE — `vitest run` s'arretait sur exit 127, jamais sur un rouge.
 *
 * Symptome mesure le 2026-08-31 : `npx vitest run` s'interrompait en cours de route sur
 * `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72`, EXIT=127.
 * Aucun test rouge : le PROCESSUS mourait.
 *
 * Cause, isolee : `fs.watch` sur un dossier dont le chemin traverse un nom court 8.3 de Windows
 * (`C:\Users\RAPHAE~1.VIL\...` — la forme que rend `os.tmpdir()` sur ce poste, donc la racine de
 * TOUS les tests) fait aborter libuv. `workspace-mutation-evidence` y pose un watcher a chaque
 * fichier absent qu'il doit surveiller ; les tests git lourds en creaient en masse sous tmpdir.
 *
 * POURQUOI CE TEST TOURNE DANS UN PROCESSUS ENFANT. Un `abort()` C n'est pas une exception : le
 * verifier en direct ferait mourir le worker vitest au lieu de rendre un rouge lisible. L'enfant
 * absorbe le crash, et son CODE DE SORTIE est la preuve.
 *
 * FALSIFICATION incluse : le meme enfant, sur le chemin BRUT non canonicalise, doit crasher. Sans
 * ce second volet, un `realCanonique` devenu l'identite passerait au vert sans rien proteger.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { realCanonique } from './workspace-mutation-evidence'

/** Un dossier reel sous tmpdir, atteint par le chemin tel que `os.tmpdir()` le rend. */
const DOSSIER = join(tmpdir(), 'autowin-watch-8-3')

/** Surveille `cible`, y ecrit 5 fichiers, et rend le code de sortie du processus enfant. */
function codeSortieEnSurveillant(cible: string): number {
  const script = [
    "const { watch, writeFileSync } = require('node:fs');",
    "const { join } = require('node:path');",
    'const cible = process.argv[1];',
    'const w = watch(cible, { persistent: false }, () => {});',
    "w.on('error', () => {});",
    "for (let i = 0; i < 5; i++) writeFileSync(join(cible, 'f' + i + '.txt'), 'x');",
    'setTimeout(() => { w.close(); process.exit(0) }, 400)'
  ].join('\n')
  const enfant = spawnSync(process.execPath, ['-e', script, cible], {
    encoding: 'utf8',
    timeout: 30_000
  })
  return enfant.status ?? -1
}

afterAll(() => rmSync(DOSSIER, { recursive: true, force: true }))

describe('fs.watch et les noms courts 8.3 de Windows', () => {
  it.skipIf(process.platform !== 'win32')(
    'canonicalise le chemin AVANT de le surveiller, sinon libuv abort le processus',
    () => {
      rmSync(DOSSIER, { recursive: true, force: true })
      mkdirSync(DOSSIER, { recursive: true })

      const canonique = realCanonique(DOSSIER)
      expect(existsSync(canonique)).toBe(true)

      // VERT : la forme rendue par `realCanonique` survit toujours.
      expect(codeSortieEnSurveillant(canonique)).toBe(0)

      // ROUGE attendu — mais UNIQUEMENT si ce poste expose reellement une forme courte. Sur une
      // machine ou tmpdir est deja long, les deux chemins sont identiques : rien a falsifier, et
      // exiger un crash rendrait ce test faux ailleurs. On l'annonce au lieu de le supposer.
      const posteAvecNomCourt = canonique.toLowerCase() !== DOSSIER.toLowerCase()
      if (posteAvecNomCourt) {
        expect(codeSortieEnSurveillant(DOSSIER)).not.toBe(0)
      }
    }
  )

  it('rend un chemin encore ABSENT en rattachant son nom au parent canonique', () => {
    mkdirSync(DOSSIER, { recursive: true })
    const absent = join(DOSSIER, 'pas-encore-la.txt')
    expect(existsSync(absent)).toBe(false)
    const canonique = realCanonique(absent)
    expect(canonique.endsWith('pas-encore-la.txt')).toBe(true)
    expect(canonique.startsWith(realCanonique(DOSSIER))).toBe(true)
  })

  it('rend le chemin tel quel quand ni lui ni son parent n existent', () => {
    const nulle_part = join(DOSSIER, 'branche-absente', 'feuille.txt')
    expect(realCanonique(nulle_part)).toBe(nulle_part)
  })
})
