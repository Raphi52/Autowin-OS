import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IDENTITE_NEUTRE,
  VARIABLE_IDENTITE,
  identiteBrain,
  lireIdentiteDuDepot,
  nomHistorique,
  normaliserIdentite,
  publierIdentiteEntreprise,
  racineDeLApplication,
  recopierNomsHistoriques
} from './identite-entreprise'
import { PROFIL_ACME, avecProfilAcme } from './identite-entreprise.test-helpers'

function depotAvecProfil(profil: unknown): string {
  const racine = mkdtempSync(join(tmpdir(), 'identite-'))
  mkdirSync(join(racine, 'entreprise', 'acme'), { recursive: true })
  writeFileSync(join(racine, 'entreprise', 'acme', 'identite.json'), JSON.stringify(profil))
  writeFileSync(join(racine, 'package.json'), '{}')
  return racine
}

describe('identite d entreprise', () => {
  const avant = process.env[VARIABLE_IDENTITE]
  afterEach(() => {
    if (avant === undefined) delete process.env[VARIABLE_IDENTITE]
    else process.env[VARIABLE_IDENTITE] = avant
  })

  it('neutre sans profil : aucun ancien nom, dossier et service neutres', () => {
    expect(identiteBrain({})).toEqual(IDENTITE_NEUTRE.brain)
    expect(nomHistorique('AUTOWIN_BRAIN_ROOT', {})).toBeUndefined()
  })

  it('un profil fournit les anciens noms, et l enfant les recoit en plus des neutres', () => {
    const env = avecProfilAcme()
    expect(nomHistorique('AUTOWIN_BRAIN_ROOT', env)).toBe('ACME_BRAIN_ROOT')
    const enfant: NodeJS.ProcessEnv = { AUTOWIN_BRAIN_PORT: '8766' }
    recopierNomsHistoriques(enfant, env)
    expect(enfant).toEqual({ AUTOWIN_BRAIN_PORT: '8766', ACME_BRAIN_PORT: '8766' })
    // Jumeau : sans profil, rien n'est recopie.
    const neutre: NodeJS.ProcessEnv = { AUTOWIN_BRAIN_PORT: '8766' }
    recopierNomsHistoriques(neutre, {})
    expect(neutre).toEqual({ AUTOWIN_BRAIN_PORT: '8766' })
  })

  it('un profil hostile ne peut ni injecter un chemin ni faire lire une variable arbitraire', () => {
    const identite = normaliserIdentite({
      application: { appId: 'pas un id', dossierEditeur: '..\\..' },
      brain: { service: '../x', dossierLocal: '..', variables: { AUTOWIN_BRAIN_ROOT: 'path' } }
    })
    expect(identite.brain).toEqual({ ...IDENTITE_NEUTRE.brain, variables: {} })
    expect(identite.application).toEqual({ appId: undefined, dossierEditeur: undefined })
  })

  it('publie le profil du depot ; le fichier prime sur une valeur heritee', () => {
    const racine = depotAvecProfil({ brain: { service: 'acme-brain' } })
    expect(lireIdentiteDuDepot(racine)).toContain('acme-brain')
    const env: NodeJS.ProcessEnv = { [VARIABLE_IDENTITE]: '{"brain":{"service":"vieux"}}' }
    publierIdentiteEntreprise(racine, env)
    expect(identiteBrain(env).service).toBe('acme-brain')
    // Sans profil sur disque, la valeur heritee reste.
    const vide = mkdtempSync(join(tmpdir(), 'identite-vide-'))
    const herite: NodeJS.ProcessEnv = { [VARIABLE_IDENTITE]: PROFIL_ACME }
    publierIdentiteEntreprise(vide, herite)
    expect(herite[VARIABLE_IDENTITE]).toBe(PROFIL_ACME)
  })

  it('trouve la racine de l application depuis un dossier profond (code construit)', () => {
    const racine = depotAvecProfil({})
    const profond = join(racine, 'out', 'main', 'chunks')
    mkdirSync(profond, { recursive: true })
    expect(racineDeLApplication(profond)).toBe(racine)
  })

  /*
   * DEFAUT VECU (2026-10-13) : `SHARED_BRAIN_ROOT` est calcule au CHARGEMENT de viz/fs-brains.ts,
   * avant toute instruction de index.ts. L'identite du processus doit donc se trouver toute seule a
   * la premiere lecture, sans attendre qu'on la publie.
   */
  it('la premiere lecture de l identite du processus publie le profil de l application', async () => {
    delete process.env[VARIABLE_IDENTITE]
    vi.resetModules()
    const module = await import('./identite-entreprise')
    const attendu = lireIdentiteDuDepot(racineDeLApplication() as string)
    module.identiteBrain()
    expect(process.env[VARIABLE_IDENTITE]).toBe(
      attendu === undefined ? undefined : JSON.stringify(JSON.parse(attendu))
    )
  })

  it('un env explicite ne declenche jamais la recherche sur disque', async () => {
    delete process.env[VARIABLE_IDENTITE]
    vi.resetModules()
    const module = await import('./identite-entreprise')
    expect(module.identiteBrain({})).toEqual(IDENTITE_NEUTRE.brain)
    expect(process.env[VARIABLE_IDENTITE]).toBeUndefined()
  })
})
