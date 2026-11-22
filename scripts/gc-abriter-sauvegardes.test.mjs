import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { purgerLesCorbeilles } from './gc-purger-corbeilles.mjs'

/*
 * La corbeille du 07/11 (conv-1798, 22/11) : des bacs à sable de tests balayés dans %TEMP%, dont les
 * `conversations.json*` bloquaient la purge de 12,4 Go. Après la mise à l'abri, la purge la propose ;
 * la sauvegarde est intacte ailleurs, et rien d'autre n'a bougé.
 */
const SCRIPT = fileURLToPath(new URL('./gc-abriter-sauvegardes.mjs', import.meta.url))
const JOUR = '2026-11-07'

let racine
let corbeille
let sauvegardes

beforeEach(() => {
  const donnees = mkdtempSync(join(tmpdir(), 'autowin-gc-abri-'))
  racine = join(donnees, 'gc-corbeille')
  corbeille = join(racine, JOUR)
  sauvegardes = join(donnees, 'sauvegardes')
  mkdirSync(join(donnees, 'autowin-os'), { recursive: true })
  ecrire('MANIFEST.txt', 'C:\\Temp\\real717\tC\\Temp\\real717\t12\tmotif\n')
  ecrire('C/Temp/real717/conversations.json', '[{"id":"conv-1"}]')
  ecrire('C/Temp/real717/conversations.json.journal.jsonl', '{"op":"upsert"}\n')
  ecrire('C/Temp/awtest7/app-data/autowin-os/conversations.json', '[]')
  ecrire('C/Temp/ud/app-data/autowin-os/conversations.json.archive/conv-2.json', '{"id":"conv-2"}')
  ecrire('C/Temp/ud/app-data/autowin-os/reglages.json.pre-remake', 'avant')
  ecrire('C/Temp/real717/capture.png', 'image')
})

function ecrire(chemin, contenu) {
  mkdirSync(dirname(join(corbeille, chemin)), { recursive: true })
  writeFileSync(join(corbeille, chemin), contenu)
}

function lancer(...args) {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, sortie: r.stdout, erreur: r.stderr }
}

const purge = () => purgerLesCorbeilles({ racine, maintenant: new Date(2026, 10, 22, 8, 0, 0) })

describe('gc-abriter-sauvegardes', () => {
  it('rend la corbeille purgeable et garde chaque sauvegarde, octet pour octet', () => {
    expect(purge().gardees[0].motif).toMatch(/sauvegarde à trier/u)

    const r = lancer('--corbeille', corbeille, '--vers', sauvegardes)
    expect(r.code, r.erreur).toBe(0)
    const bilan = JSON.parse(r.sortie)
    expect(bilan.abrites.map((a) => a.chemin.replaceAll('\\', '/')).sort()).toEqual([
      'C/Temp/awtest7/app-data/autowin-os/conversations.json',
      'C/Temp/real717/conversations.json',
      'C/Temp/real717/conversations.json.journal.jsonl',
      'C/Temp/ud/app-data/autowin-os/conversations.json.archive/conv-2.json',
      'C/Temp/ud/app-data/autowin-os/reglages.json.pre-remake'
    ])
    const abri = join(sauvegardes, `gc-corbeille-${JOUR}`)
    expect(readFileSync(join(abri, 'C/Temp/real717/conversations.json'), 'utf8')).toBe(
      '[{"id":"conv-1"}]'
    )
    expect(
      readFileSync(
        join(abri, 'C/Temp/ud/app-data/autowin-os/conversations.json.archive/conv-2.json'),
        'utf8'
      )
    ).toBe('{"id":"conv-2"}')
    expect(readFileSync(join(abri, 'ORIGINE.txt'), 'utf8')).toMatch(/real717/u)

    expect(existsSync(join(corbeille, 'C/Temp/real717/conversations.json'))).toBe(false)
    expect(
      existsSync(join(corbeille, 'C/Temp/ud/app-data/autowin-os/conversations.json.archive'))
    ).toBe(false)
    expect(existsSync(join(corbeille, 'C/Temp/real717/capture.png'))).toBe(true)
    expect(existsSync(join(corbeille, 'MANIFEST.txt'))).toBe(true)

    const apres = purge()
    expect(apres.gardees).toEqual([])
    expect(apres.aPurger.map((c) => c.nom)).toEqual([JOUR])
  })

  it('refuse une deuxième passe sur la même destination, sans rien bouger', () => {
    mkdirSync(join(sauvegardes, `gc-corbeille-${JOUR}`), { recursive: true })
    const r = lancer('--corbeille', corbeille, '--vers', sauvegardes)
    expect(r.code).toBe(2)
    expect(existsSync(join(corbeille, 'C/Temp/real717/conversations.json'))).toBe(true)
  })

  it.each([
    ['sans --vers', () => ['--corbeille', corbeille]],
    ['chemin relatif', () => ['--corbeille', 'gc-corbeille/2026-11-07', '--vers', sauvegardes]],
    ['pas une corbeille datée', () => ['--corbeille', racine, '--vers', sauvegardes]]
  ])('refuse %s (code 2)', (_cas, args) => {
    const r = lancer(...args())
    expect(r.code).toBe(2)
    expect(existsSync(join(corbeille, 'C/Temp/real717/conversations.json'))).toBe(true)
  })

  it('refuse un lien dans une sauvegarde et ne retire rien', () => {
    const cible = mkdtempSync(join(tmpdir(), 'autowin-gc-abri-cible-'))
    writeFileSync(join(cible, 'precieux.txt'), 'ne pas toucher')
    symlinkSync(
      cible,
      join(corbeille, 'C/Temp/ud/app-data/autowin-os/conversations.json.archive/lien'),
      'junction'
    )
    const r = lancer('--corbeille', corbeille, '--vers', sauvegardes)
    expect(r.code).toBe(2)
    expect(existsSync(join(cible, 'precieux.txt'))).toBe(true)
    expect(existsSync(join(corbeille, 'C/Temp/real717/conversations.json'))).toBe(true)
    expect(existsSync(join(sauvegardes, `gc-corbeille-${JOUR}`))).toBe(false)
  })
})
