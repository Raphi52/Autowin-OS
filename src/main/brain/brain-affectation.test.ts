import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  brainAffectationFile,
  brainPourCwd,
  enregistrerAffectation,
  lireAffectations,
  retirerAffectation
} from './brain-affectation'
import type { QuelBrain } from './brain-reglage'

/**
 * Les affectations dossier de travail → Brain (lot 1). Chaque test a son APPDATA temporaire, passé
 * explicitement à chaque appel : aucun test ne lit ni n'écrit le vrai %APPDATA% du poste.
 */
const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'autowin-brain-affectation-'))
  dossiers.push(d)
  return d
}
/** Un poste : son APPDATA, où vit le fichier d'affectations. */
function poste(): NodeJS.ProcessEnv {
  return { APPDATA: join(temp(), 'Roaming') }
}
function fichierDuPoste(env: NodeJS.ProcessEnv): string {
  return brainAffectationFile(env)!
}
/** La même adresse, en majuscules et avec des `/` : elle doit désigner le même dossier. */
function variante(chemin: string): string {
  return chemin.toUpperCase().replace(/\\/g, '/')
}

describe('affectations dossier de travail → Brain', () => {
  it('vit dans APPDATA\\autowin-os, à côté de brain.json', () => {
    const env = poste()
    expect(fichierDuPoste(env)).toBe(join(env.APPDATA!, 'autowin-os', 'brain-affectations.json'))
    expect(brainAffectationFile({})).toBeUndefined()
  })

  it('fichier absent : aucune affectation, et rien ne bloque', () => {
    const env = poste()
    const dossier = join(temp(), 'projet')
    expect(lireAffectations(env)).toEqual([])
    expect(brainPourCwd(dossier, env)).toBeUndefined()
    expect(retirerAffectation(env, dossier)).toBe(false)
    expect(existsSync(fichierDuPoste(env))).toBe(false)
  })

  it('JSON cassé : aucune affectation, sans lever d’erreur', () => {
    const env = poste()
    mkdirSync(dirname(fichierDuPoste(env)), { recursive: true })
    writeFileSync(fichierDuPoste(env), '{ pas du JSON', 'utf8')
    const dossier = join(temp(), 'projet')
    expect(() => lireAffectations(env)).not.toThrow()
    expect(lireAffectations(env)).toEqual([])
    expect(brainPourCwd(dossier, env)).toBeUndefined()
  })

  it('écrire par-dessus un fichier cassé le met de côté : rien n’est effacé', () => {
    const env = poste()
    const fichier = fichierDuPoste(env)
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, '{ pas du JSON', 'utf8')
    const dossier = join(temp(), 'projet')

    enregistrerAffectation(env, dossier, 'perso')

    expect(lireAffectations(env)).toEqual([{ cwd: resolve(dossier), brain: 'perso' }])
    const mis = readdirSync(dirname(fichier)).filter((nom) =>
      nom.startsWith('brain-affectations.json.illisible-')
    )
    expect(mis).toHaveLength(1)
    expect(readFileSync(join(dirname(fichier), mis[0]!), 'utf8')).toBe('{ pas du JSON')
  })

  it('un BOM en tête de fichier ne le rend pas illisible', () => {
    const env = poste()
    const dossier = join(temp(), 'projet')
    mkdirSync(dirname(fichierDuPoste(env)), { recursive: true })
    const contenu = JSON.stringify({ affectations: [{ cwd: dossier, brain: 'equipe' }] })
    writeFileSync(fichierDuPoste(env), `${String.fromCharCode(0xfeff)}${contenu}`, 'utf8')
    expect(brainPourCwd(join(dossier, 'x'), env)).toBe('equipe')
  })

  it('une entrée invalide est ignorée seule ; pour un même dossier écrit deux fois, la dernière gagne', () => {
    const env = poste()
    const bon = join(temp(), 'bon')
    mkdirSync(dirname(fichierDuPoste(env)), { recursive: true })
    writeFileSync(
      fichierDuPoste(env),
      JSON.stringify({
        affectations: [
          { cwd: 'relatif/x', brain: 'perso' },
          { cwd: bon, brain: 'inconnu' },
          'pas un objet',
          { cwd: bon, brain: 'equipe' },
          { cwd: bon, brain: 'perso' }
        ]
      }),
      'utf8'
    )
    expect(lireAffectations(env)).toEqual([{ cwd: resolve(bon), brain: 'perso' }])
  })

  it('un sous-dossier suit son dossier assigné ; un frère au nom voisin ne le suit pas', () => {
    const env = poste()
    const parent = temp()
    const dossier = join(parent, 'BrainRotRoyale')
    enregistrerAffectation(env, dossier, 'perso')

    expect(brainPourCwd(dossier, env)).toBe('perso')
    expect(brainPourCwd(join(dossier, 'src', 'profond'), env)).toBe('perso')
    expect(brainPourCwd(join(parent, 'BrainRotRoyale-bis'), env)).toBeUndefined()
    expect(brainPourCwd(parent, env)).toBeUndefined()
  })

  it('la correspondance la plus longue gagne, quel que soit l’ordre d’enregistrement', () => {
    const racine = join(temp(), 'depot')
    const sous = join(racine, 'sous')
    const dansLOrdre = poste()
    enregistrerAffectation(dansLOrdre, racine, 'equipe')
    enregistrerAffectation(dansLOrdre, sous, 'perso')
    const dansLAutre = poste()
    enregistrerAffectation(dansLAutre, sous, 'perso')
    enregistrerAffectation(dansLAutre, racine, 'equipe')

    for (const env of [dansLOrdre, dansLAutre]) {
      expect(brainPourCwd(join(sous, 'x'), env)).toBe('perso')
      expect(brainPourCwd(join(racine, 'autre'), env)).toBe('equipe')
    }
  })

  it('casse et séparateurs ne comptent pas ; réenregistrer le même dossier remplace l’entrée', () => {
    const env = poste()
    const dossier = join(temp(), 'Projet')
    enregistrerAffectation(env, variante(dossier), 'perso')

    expect(brainPourCwd(dossier, env)).toBe('perso')
    expect(brainPourCwd(variante(join(dossier, 'Sous')), env)).toBe('perso')

    enregistrerAffectation(env, dossier, 'equipe')
    expect(lireAffectations(env)).toHaveLength(1)
    expect(brainPourCwd(variante(dossier), env)).toBe('equipe')
  })

  it('refuse un chemin relatif et un Brain inconnu, sans rien écrire', () => {
    const env = poste()
    const inconnu: string = 'autre'
    expect(() => enregistrerAffectation(env, 'projets/relatif', 'perso')).toThrow(/absolu/)
    expect(() => enregistrerAffectation(env, '  ', 'perso')).toThrow(/absolu/)
    expect(() => enregistrerAffectation(env, join(temp(), 'p'), inconnu as QuelBrain)).toThrow(
      /inconnu/
    )
    expect(() => retirerAffectation(env, 'projets/relatif')).toThrow(/absolu/)
    expect(brainPourCwd('projets/relatif', env)).toBeUndefined()
    expect(existsSync(fichierDuPoste(env))).toBe(false)
  })

  it('sans APPDATA : rien ne se lit, et l’écriture refuse au lieu d’écrire ailleurs', () => {
    const dossier = join(temp(), 'projet')
    expect(lireAffectations({})).toEqual([])
    expect(brainPourCwd(dossier, {})).toBeUndefined()
    expect(retirerAffectation({}, dossier)).toBe(false)
    expect(() => enregistrerAffectation({}, dossier, 'perso')).toThrow(/APPDATA/)
  })

  it('retire le dossier exact seulement : son parent et ses sous-dossiers gardent leur Brain', () => {
    const env = poste()
    const racine = join(temp(), 'depot')
    const sous = join(racine, 'sous')
    enregistrerAffectation(env, racine, 'equipe')
    enregistrerAffectation(env, sous, 'perso')

    expect(retirerAffectation(env, sous)).toBe(true)
    expect(brainPourCwd(join(sous, 'x'), env)).toBe('equipe')
    expect(retirerAffectation(env, sous)).toBe(false)

    expect(retirerAffectation(env, racine)).toBe(true)
    expect(lireAffectations(env)).toEqual([])
    expect(existsSync(fichierDuPoste(env))).toBe(false)
  })

  it('écrit {"affectations": [...]} par fichier temporaire renommé : aucun temporaire ne reste', () => {
    const env = poste()
    const dossier = join(temp(), 'projet')
    enregistrerAffectation(env, dossier, 'perso')

    const fichier = fichierDuPoste(env)
    expect(JSON.parse(readFileSync(fichier, 'utf8'))).toEqual({
      affectations: [{ cwd: resolve(dossier), brain: 'perso' }]
    })
    expect(readdirSync(dirname(fichier))).toEqual(['brain-affectations.json'])
  })
})
