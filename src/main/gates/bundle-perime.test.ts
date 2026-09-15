import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleEstLeCodeExecute, mesureBundlePerime } from './bundle-perime'

/** Le processus de test tourne depuis les sources : on simule un lancement par le bundle. */
const ARGV_BUNDLE = ['node', '/depot/out/main/index.js']

function depotFactice(bundleSec: number, sourceSec: number): string {
  const racine = mkdtempSync(join(tmpdir(), 'aw-bundle-'))
  mkdirSync(join(racine, 'out/main'), { recursive: true })
  mkdirSync(join(racine, 'src/main/gates'), { recursive: true })
  writeFileSync(join(racine, 'out/main/index.js'), '// bundle')
  writeFileSync(join(racine, 'src/main/gates/stopgate.ts'), '// source')
  utimesSync(join(racine, 'out/main/index.js'), bundleSec, bundleSec)
  utimesSync(join(racine, 'src/main/gates/stopgate.ts'), sourceSec, sourceSec)
  return racine
}

describe('mesureBundlePerime', () => {
  it('voit la source plus recente que le bundle (cas conv-539 : bundle 11:06, correctifs 11:31)', () => {
    const m = mesureBundlePerime(depotFactice(1_000_000, 2_000_000), undefined, ARGV_BUNDLE)
    expect(m).toBeDefined()
    expect(m!.sourceMs).toBeGreaterThan(m!.bundleMs)
  })

  it('voit le bundle a jour', () => {
    const m = mesureBundlePerime(depotFactice(2_000_000, 1_000_000), undefined, ARGV_BUNDLE)
    expect(m!.sourceMs).toBeLessThan(m!.bundleMs)
  })

  it('rend undefined sans bundle plutot que d inventer un blocage', () => {
    expect(mesureBundlePerime(mkdtempSync(join(tmpdir(), 'aw-vide-')), undefined, ARGV_BUNDLE)).toBeUndefined()
  })
})

/**
 * LE BRANCHEMENT EST TESTE, PAS SEULEMENT LA FONCTION.
 *
 * Objection du juge, conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb (reparation 15) :
 * « Le branchement de la mesure de code perime (orchestrator.ts) n'est couvert par aucun test :
 * seule la fonction mesureBundlePerime l'est. Rien ne garantit que l'appel reste en place. »
 * Sans ce test, retirer la ligne `bundlePerime:` du seul site d'appel laisse la suite verte et
 * la boucle de reparation redevient aveugle au code perime.
 */
describe('branchement au site d appel (orchestrator)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'orchestrator.ts'),
    'utf8'
  )

  it('passe la mesure a arretDeLaReparation', () => {
    const debut = source.indexOf('deciderDuPassage({')
    expect(debut).toBeGreaterThan(-1)
    const fin = source.indexOf('})', debut)
    const appel = source.slice(debut, fin)
    expect(appel).toContain('bundlePerime: mesureBundlePerime(')
  })
})

/**
 * conv-540, tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 : une reparation de ce tour a corrige le
 * controle final DANS `src/main/hooks/default-gate-hooks.ts` (lecture de la ligne `fix-ok` sur le
 * disque, commit a5d02ef8). Ce fichier ne figurait pas dans les sources surveillees : une reparation
 * qui ne touche que lui laissait la mesure de peremption MUETTE, alors que le bundle execute ne
 * contenait pas le correctif. C'est la moitie manquante du garde-fou anti-boucle.
 */
describe('sources surveillees du controle final', () => {
  it('compte les hooks du gate parmi les sources qui perimant le bundle', () => {
    const racine = mkdtempSync(join(tmpdir(), 'bundle-perime-hooks-'))
    mkdirSync(join(racine, 'out', 'main'), { recursive: true })
    mkdirSync(join(racine, 'src', 'main', 'hooks'), { recursive: true })
    const bundle = join(racine, 'out', 'main', 'index.js')
    writeFileSync(bundle, '// bundle')
    const hook = join(racine, 'src', 'main', 'hooks', 'default-gate-hooks.ts')
    writeFileSync(hook, '// correctif du controle final')
    utimesSync(bundle, new Date(1_000_000), new Date(1_000_000))
    utimesSync(hook, new Date(2_000_000), new Date(2_000_000))

    const mesure = mesureBundlePerime(racine, undefined, ARGV_BUNDLE)

    expect(mesure).toBeDefined()
    expect(mesure!.sourceMs).toBeGreaterThan(mesure!.bundleMs)
  })
})

/**
 * conv-539, tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb (20 reparations refusees) : la liste des
 * sources du gate etait tenue A LA MAIN. Un fichier du controle final absent de cette liste rendait
 * la mesure MUETTE alors que le bundle execute ne contenait pas le correctif — c'est exactement le
 * defaut deja paye une fois (commentaire fix-ok de conv-540 dans bundle-perime.ts). La liste est
 * desormais DERIVEE des dossiers du controle final : un nouveau fichier y compte sans edition.
 */
describe('sources du gate derivees, pas tenues a la main', () => {
  it('voit un fichier de gate qui ne figure dans aucune liste', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-bundle-neuf-'))
    mkdirSync(join(racine, 'out/main'), { recursive: true })
    mkdirSync(join(racine, 'src/main/gates'), { recursive: true })
    writeFileSync(join(racine, 'out/main/index.js'), '// bundle')
    writeFileSync(join(racine, 'src/main/gates/stopgate.ts'), '// source')
    writeFileSync(join(racine, 'src/main/gates/tout-neuf.ts'), '// gate ajoute apres coup')
    utimesSync(join(racine, 'out/main/index.js'), 2_000_000, 2_000_000)
    utimesSync(join(racine, 'src/main/gates/stopgate.ts'), 1_000_000, 1_000_000)
    utimesSync(join(racine, 'src/main/gates/tout-neuf.ts'), 3_000_000, 3_000_000)
    const m = mesureBundlePerime(racine, undefined, ARGV_BUNDLE)
    expect(m).toBeDefined()
    expect(m!.sourceMs).toBeGreaterThan(m!.bundleMs)
  })

  it('ignore les fichiers de test : les modifier ne perime pas le bundle', () => {
    const racine = mkdtempSync(join(tmpdir(), 'aw-bundle-test-'))
    mkdirSync(join(racine, 'out/main'), { recursive: true })
    mkdirSync(join(racine, 'src/main/gates'), { recursive: true })
    writeFileSync(join(racine, 'out/main/index.js'), '// bundle')
    writeFileSync(join(racine, 'src/main/gates/stopgate.ts'), '// source')
    writeFileSync(join(racine, 'src/main/gates/stopgate.test.ts'), '// test')
    utimesSync(join(racine, 'out/main/index.js'), 2_000_000, 2_000_000)
    utimesSync(join(racine, 'src/main/gates/stopgate.ts'), 1_000_000, 1_000_000)
    utimesSync(join(racine, 'src/main/gates/stopgate.test.ts'), 3_000_000, 3_000_000)
    const m = mesureBundlePerime(racine, undefined, ARGV_BUNDLE)
    expect(m!.sourceMs).toBeLessThan(m!.bundleMs)
  })
})

/**
 * conv-540, tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f : 7 tests d'orchestrateur rouges parce que la
 * mesure lisait le bundle du depot REEL alors que le processus tourne depuis les sources. Un bundle
 * plus vieux que les sources arretait toute reprise — en test comme en `npm run dev`.
 */
describe('la mesure ne mord que si le bundle est le code execute', () => {
  it('reste muette quand le processus tourne depuis les sources', () => {
    expect(mesureBundlePerime(depotFactice(1_000_000, 2_000_000), undefined, ['node', 'vitest'])).toBeUndefined()
  })

  it('reconnait un lancement par le bundle, separateur Windows compris', () => {
    expect(bundleEstLeCodeExecute(['electron', String.raw`D:\AutoWinOS\out\main\index.js`])).toBe(true)
    expect(bundleEstLeCodeExecute(['node', '/x/node_modules/vitest/dist/cli.js'])).toBe(false)
  })
})
