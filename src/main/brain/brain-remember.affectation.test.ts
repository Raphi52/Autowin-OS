import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAutowinAppDataBase } from '../app/app-data'
import { AppCommandBus } from '../commands/commands'
import { ConversationStore } from '../store/conversations'
import { enregistrerAffectation } from './brain-affectation'
import { appliquerBrainReglage } from './brain-reglage'
import { brainPourRemember } from './brain-remember'

/**
 * LA NOTE SUIT LE DOSSIER DE TRAVAIL (plan « Affectation des dossiers de travail aux Brains », lot 2).
 *
 * `remember` sans `portee` range selon le Brain assigné au dossier de travail DU TOUR ; sans
 * affectation, comme avant : l'équipe. Une `portee` explicite garde la priorité. Un dossier assigné au
 * perso sans Brain perso réglé retombe sur l'équipe, et le résultat le DIT.
 *
 * `rememberFact` est espionné en laissant passer le vrai code, jeton vidé : aucun test ne part sur le
 * réseau. L'APPDATA est temporaire, comme dans commands.brain-perso.test.ts.
 */
const espion = vi.hoisted(() => ({
  appels: [] as Array<{ args: Record<string, unknown>; origin?: string }>
}))
vi.mock('./brain-remember', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./brain-remember')>()
  return {
    ...reel,
    rememberFact: (
      args: Record<string, unknown>,
      deps: Parameters<typeof reel.rememberFact>[1]
    ) => {
      espion.appels.push({ args, ...(deps?.origin ? { origin: deps.origin } : {}) })
      return reel.rememberFact(args, { ...deps, token: '' })
    }
  }
})

const dossiers: string[] = []
function temp(prefixe: string): string {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}

/** Dossier de travail assigné au Brain perso (dans les tests qui le demandent). */
let projet: string
/** Dossier de travail sans affectation. */
let autre: string

beforeEach(() => {
  const poste = temp('affectation-remember-')
  vi.stubEnv('APPDATA', join(poste, 'Roaming'))
  vi.stubEnv('LOCALAPPDATA', join(poste, 'Local'))
  vi.stubEnv('AUTOWIN_BRAIN_ORIGIN', 'http://127.0.0.1:8766')
  configureAutowinAppDataBase(temp('affectation-remember-data-'))
  projet = temp('projet-')
  autre = temp('autre-')
  espion.appels.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  configureAutowinAppDataBase(undefined)
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Règle un Brain perso sur un dossier existant. */
const reglerPerso = (): Promise<unknown> =>
  appliquerBrainReglage(
    { chemin: temp('brain-perso-') },
    { racineParDefaut: 'X:/jamais', quel: 'perso' }
  )

const assigner = (dossier: string, brain: 'equipe' | 'perso'): void => {
  enregistrerAffectation(process.env, dossier, brain)
}

const fait = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Recette du dimanche',
  fact: 'la pâte repose une nuit',
  type: 'domain',
  scope: 'autowin-os',
  source: 'session:affectation-test',
  ...extra
})

/**
 * Un `remember` lancé depuis un fil rangé sur le dossier `tour` : c'est LE dossier du tour, pour
 * `exec` (`dossierRangeSur`). Sans fil, `exec` retombe sur le dossier GLOBAL, quoi qu'on pose autour.
 */
let horloge = 1000
const rangerDepuis = (tour: string, args: Record<string, unknown>, global?: string) => {
  const conversations = new ConversationStore(() => horloge++)
  const fil = conversations.create({ title: 'fil', provider: 'claude' })
  conversations.rangerDansDossier(fil.id, tour)
  const bus = new AppCommandBus(
    {
      conversations,
      executionWorkspace: global,
      roles: { getBinding: () => ({ model: 'test' }) }
    } as never,
    () => {}
  )
  return bus.exec('remember', args, fil.id)
}

const donnees = (res: { data?: unknown }): Record<string, unknown> =>
  res.data as Record<string, unknown>

describe('brainPourRemember — quel Brain reçoit la note', () => {
  it('sans affectation ni portée : l’équipe, comme avant', () => {
    expect(brainPourRemember(undefined, projet)).toEqual({ brain: 'equipe', repli: false })
    expect(brainPourRemember(undefined, undefined)).toEqual({ brain: 'equipe', repli: false })
  })

  it('dossier assigné au perso, Brain perso réglé : le perso', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    expect(brainPourRemember(undefined, projet)).toEqual({ brain: 'perso', repli: false })
  })

  it('un sous-dossier du dossier assigné en hérite', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    expect(brainPourRemember(undefined, join(projet, 'src', 'main'))).toEqual({
      brain: 'perso',
      repli: false
    })
  })

  it('dossier assigné à l’équipe, Brain perso réglé : l’équipe', async () => {
    await reglerPerso()
    assigner(projet, 'equipe')
    expect(brainPourRemember(undefined, projet)).toEqual({ brain: 'equipe', repli: false })
  })

  it('une portée explicite `equipe` l’emporte sur une affectation perso', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    expect(brainPourRemember('equipe', projet)).toEqual({ brain: 'equipe', repli: false })
  })

  it('une portée explicite `perso` l’emporte sur une affectation équipe', async () => {
    await reglerPerso()
    assigner(projet, 'equipe')
    expect(brainPourRemember('perso', projet)).toEqual({ brain: 'perso', repli: false })
  })

  it('une portée hors `equipe`/`perso` compte comme absente : l’affectation décide', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    expect(brainPourRemember('privé', projet)).toEqual({ brain: 'perso', repli: false })
  })

  it('affectation perso sans Brain perso réglé : repli sur l’équipe, signalé', () => {
    assigner(projet, 'perso')
    expect(brainPourRemember(undefined, projet)).toEqual({ brain: 'equipe', repli: true })
  })

  it('portée explicite `perso` sans Brain perso réglé : pas de repli, le refus reste à l’appelant', () => {
    assigner(projet, 'equipe')
    expect(brainPourRemember('perso', projet)).toEqual({ brain: 'perso', repli: false })
  })
})

describe('remember — la note suit le dossier de travail du tour', () => {
  it('sans portée, dossier assigné au perso : rangée dans le Brain perso', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    const res = await rangerDepuis(projet, fait())
    expect(espion.appels).toHaveLength(1)
    expect(espion.appels[0].origin).toBe('http://127.0.0.1:8775')
    expect(donnees(res).rangement).toBe('Brain perso')
  })

  it('sans portée, dossier sans affectation : Brain d’équipe, même Brain perso réglé', async () => {
    await reglerPerso()
    const res = await rangerDepuis(autre, fait())
    expect(espion.appels).toHaveLength(1)
    expect(espion.appels[0].origin).toBeUndefined()
    expect(donnees(res).rangement).toBe('Brain d’équipe')
  })

  it('le dossier DU TOUR décide, pas le dossier global', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    // Le dossier global (autre) n’est pas assigné ; le dossier du tour (projet) l’est.
    const res = await rangerDepuis(projet, fait(), autre)
    expect(espion.appels[0].origin).toBe('http://127.0.0.1:8775')
    expect(donnees(res).rangement).toBe('Brain perso')
  })

  it('un dossier global assigné au perso ne déplace pas la note d’un autre dossier de tour', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    // Le dossier global (projet) est assigné au perso ; le tour, lui, vient de `autre`.
    const res = await rangerDepuis(autre, fait(), projet)
    expect(espion.appels[0].origin).toBeUndefined()
    expect(donnees(res).rangement).toBe('Brain d’équipe')
  })

  it('portée explicite `equipe` : l’équipe, même dans un dossier assigné au perso', async () => {
    await reglerPerso()
    assigner(projet, 'perso')
    const res = await rangerDepuis(projet, fait({ portee: 'equipe' }))
    expect(espion.appels[0].origin).toBeUndefined()
    expect(donnees(res).rangement).toBe('Brain d’équipe')
  })

  it('portée explicite `perso` : le perso, même dans un dossier assigné à l’équipe', async () => {
    await reglerPerso()
    assigner(projet, 'equipe')
    const res = await rangerDepuis(projet, fait({ portee: 'perso' }))
    expect(espion.appels[0].origin).toBe('http://127.0.0.1:8775')
    expect(donnees(res).rangement).toBe('Brain perso')
  })

  it('portée explicite `perso` sans Brain perso réglé : refus existant, rien envoyé, pas de repli', async () => {
    assigner(projet, 'equipe')
    const res = await rangerDepuis(projet, fait({ portee: 'perso' }))
    expect(donnees(res).stored).toBe(false)
    expect(donnees(res).rangement).toBe('rien')
    expect(espion.appels).toHaveLength(0)
  })

  it('affectation perso sans Brain perso réglé : rangée dans l’équipe, et le repli est dit', async () => {
    assigner(projet, 'perso')
    const res = await rangerDepuis(projet, fait())
    const data = donnees(res)
    // Jamais au port perso, et le résultat ne prétend pas le contraire.
    expect(espion.appels).toHaveLength(1)
    expect(espion.appels[0].origin).toBeUndefined()
    expect(String(data.rangement)).toMatch(/Brain d’équipe \(repli : aucun Brain perso réglé\)/u)
    expect(String(data.detail)).toMatch(
      /ce dossier est assigné au Brain perso, mais aucun Brain perso n’est réglé/u
    )
    expect(String(data.detail)).toContain('Réglages › Diagnostic › Brain perso')
  })
})
