import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  racineDepot,
  cheminDepot,
  cheminArtefact,
  cheminAudit,
  cheminDevToolsPort
} from './racine-depot.mjs'

const DOSSIER_SCRIPTS = resolve(import.meta.dirname ?? '.', '.')

afterEach(() => {
  delete process.env.AUTOWIN_RACINE
  delete process.env.AUTOWIN_DATA_DIR
})

describe('racine-depot — ancrage LOCAL des sondes', () => {
  it('trouve la racine du depot par son package.json, pas par un chemin de machine', () => {
    const racine = racineDepot()
    expect(existsSync(join(racine, 'package.json'))).toBe(true)
    expect(existsSync(join(racine, 'scripts', 'racine-depot.mjs'))).toBe(true)
  })

  it('ancre artifacts/ et Audit/ SOUS cette racine', () => {
    const racine = racineDepot()
    expect(cheminArtefact('x.png')).toBe(join(racine, 'artifacts', 'x.png'))
    expect(cheminAudit('a', 'b.png')).toBe(join(racine, 'Audit', 'a', 'b.png'))
    expect(cheminDepot('artifacts')).toBe(join(racine, 'artifacts'))
  })

  it('AUTOWIN_RACINE passe devant la remontee', () => {
    process.env.AUTOWIN_RACINE = join('D:', sep, 'ailleurs')
    expect(racineDepot()).toBe(resolve(join('D:', sep, 'ailleurs')))
  })

  it('AUTOWIN_DATA_DIR passe devant pour le port DevTools', () => {
    process.env.AUTOWIN_DATA_DIR = join('D:', sep, 'data')
    expect(cheminDevToolsPort()).toBe(resolve(join('D:', sep, 'data'), 'DevToolsActivePort'))
    delete process.env.AUTOWIN_DATA_DIR
    expect(cheminDevToolsPort()).toBe(
      join(racineDepot(), '.autowin-data', 'autowin-os', 'DevToolsActivePort')
    )
  })

  /*
   * LE point de ce fichier. Mesure du 2026-09-06 : 28 chemins `C:/Amitel/Autowin OS/...` codes en
   * dur dans 20 sondes de `scripts/`. Cette installation n'existe plus — les 7 lanceurs qui s'y
   * rendaient sont morts et ont ete supprimes. Toute reintroduction doit RATER ici.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : recoder un chemin absolu de machine dans une sonde.
   */
  it('aucune sonde de scripts/ ne code en dur un chemin de machine', () => {
    const fautifs = []
    for (const nom of readdirSync(DOSSIER_SCRIPTS)) {
      if (!/\.(mjs|ts|ps1|py)$/.test(nom)) continue
      if (nom === 'racine-depot.test.mjs') continue
      const texte = readFileSync(join(DOSSIER_SCRIPTS, nom), 'utf8')
      texte.split('\n').forEach((ligne, i) => {
        const nu = ligne.trimStart()
        // La PROSE garde le droit de raconter le defaut : seul le CODE est vise, donc le chemin
        // entre guillemets (chaine JS ou PowerShell), hors ligne de commentaire.
        const commentaire = nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('#')
        if (!commentaire && /['"`]C:[\\/]{1,2}Amitel/i.test(ligne)) fautifs.push(`${nom}:${i + 1}`)
      })
    }
    expect(fautifs).toEqual([])
  })
})
