import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autowinAppDataRoot, configureAutowinAppDataBase } from './app-data'
import { likelySecretShape } from './brain-remember'
import { AppCommandBus } from './commands'
import { nomUtilisateurCourant } from './identite-utilisateur'
import { DOSSIER_PROFILS, nomDeFichierDuCompte } from './profil-utilisateur'

/**
 * `remember` de type `preference` → PROFIL LOCAL, jamais le Brain partagé (conv-1098, 2026-10-22,
 * demande de l'utilisateur). Les notes `preference` du Brain n'ont aucun champ « à qui » : le goût
 * d'une personne était servi à toute l'équipe.
 *
 * La preuve « aucun dépôt au Brain » porte sur `rememberFact`, le SEUL chemin du bus vers le Brain
 * (`commands.ts`, cas 'remember') : on l'espionne en laissant passer le vrai code, jeton vidé pour
 * qu'aucun test ne parte sur le réseau. Témoin : un `lesson` l'appelle toujours.
 */
const espion = vi.hoisted(() => ({ appels: [] as Array<Record<string, unknown>> }))
vi.mock('./brain-remember', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./brain-remember')>()
  return {
    ...reel,
    rememberFact: (
      args: Record<string, unknown>,
      deps: Parameters<typeof reel.rememberFact>[1]
    ) => {
      espion.appels.push(args)
      return reel.rememberFact(args, { ...deps, token: '' })
    }
  }
})

let racine: string
const bus = (): AppCommandBus =>
  new AppCommandBus({ roles: { getBinding: () => ({ model: 'test' }) } } as never, () => {})
const cheminDuProfil = (): string =>
  join(autowinAppDataRoot(), DOSSIER_PROFILS, `${nomDeFichierDuCompte(nomUtilisateurCourant())}.md`)
const preference = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Ton',
  fact: 'pas de jargon',
  type: 'preference',
  scope: 'global',
  source: 'session:test',
  ...extra
})

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'remember-preference-'))
  configureAutowinAppDataBase(racine)
  espion.appels.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

describe('remember type preference → profil local, aucun dépôt au Brain', () => {
  it('écrit « titre — fait » dans le profil du compte, sans jamais appeler le Brain', async () => {
    expect(nomUtilisateurCourant()).not.toBe('')
    const reseau = vi.spyOn(globalThis, 'fetch')
    const res = await bus().exec('remember', preference())
    expect(res.ok).toBe(true)
    expect(readFileSync(cheminDuProfil(), 'utf8')).toBe('- Ton — pas de jargon\n')
    expect(espion.appels).toHaveLength(0)
    expect(reseau).not.toHaveBeenCalled()
    const data = res.data as Record<string, unknown>
    expect(data).toMatchObject({ stored: true, destination: 'profil' })
    expect(String(data.detail)).toContain(cheminDuProfil())
    expect(String(data.detail)).toMatch(/\b\d+ \/ 2000 octets/)
  })

  it('même préférence deux fois : une seule ligne, toujours sans Brain', async () => {
    await bus().exec('remember', preference())
    const res = await bus().exec('remember', preference())
    expect(readFileSync(cheminDuProfil(), 'utf8')).toBe('- Ton — pas de jargon\n')
    expect((res.data as Record<string, unknown>).stored).toBe(true)
    expect(String((res.data as Record<string, unknown>).detail)).toMatch(/déjà/)
    expect(espion.appels).toHaveLength(0)
  })

  it('profil plein : refus qui dit que rien n’a été retenu, fichier intact, aucun repli vers le Brain', async () => {
    const chemin = cheminDuProfil()
    mkdirSync(dirname(chemin), { recursive: true })
    writeFileSync(chemin, `- ${'a'.repeat(1990)}\n`)
    const avant = readFileSync(chemin)
    const res = await bus().exec('remember', preference())
    const data = res.data as Record<string, unknown>
    expect(data.stored).toBe(false)
    expect(String(data.detail)).toMatch(/rien n’a été retenu.*profil plein/)
    expect(readFileSync(chemin).equals(avant)).toBe(true)
    expect(espion.appels).toHaveLength(0)
  })

  it('préférence qui porte un secret : refusée, rien écrit, aucun dépôt', async () => {
    const fait = 'utilise password=Zx9qWm2LpR7tY4vB pour la base'
    expect(likelySecretShape(fait)).toBeDefined()
    const res = await bus().exec('remember', preference({ fact: fait }))
    expect((res.data as Record<string, unknown>).stored).toBe(false)
    expect(existsSync(cheminDuProfil())).toBe(false)
    expect(espion.appels).toHaveLength(0)
  })

  it('témoin : les autres types passent toujours par le Brain, et pas par le profil', async () => {
    await bus().exec('remember', preference({ type: 'lesson', title: 'Leçon', fact: 'un fait' }))
    expect(espion.appels).toHaveLength(1)
    expect(existsSync(cheminDuProfil())).toBe(false)
  })
})
