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
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { brainAffectationFile } from './brain-affectation'
import {
  enregistrerAffectationDepuisLeRendu,
  listerAffectations,
  retirerAffectationDepuisLeRendu
} from './brain-affectation-canaux'

// Le dossier de données est créé à l'import : les tables de cas (it.each) s'en servent avant le
// premier test. Chaque test repart d'un fichier d'affectations absent.
const dir = mkdtempSync(join(tmpdir(), 'autowin-affectation-canaux-'))
const env: NodeJS.ProcessEnv = { APPDATA: dir }
const fichier = brainAffectationFile(env) as string

beforeEach(() => {
  rmSync(fichier, { force: true })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Un dossier de travail absolu, sous le dossier temporaire du test. */
const projet = (nom: string): string => join(dir, nom)

describe('liste des affectations', () => {
  it('rend une liste vide, sans erreur, tant que rien n’est enregistré', () => {
    expect(listerAffectations(env)).toStrictEqual({ affectations: [] })
  })
})

describe('enregistrer une affectation', () => {
  it('enregistre le dossier et le rend dans la liste', () => {
    const rendu = enregistrerAffectationDepuisLeRendu(env, {
      cwd: projet('MonProjet'),
      brain: 'perso'
    })
    expect(rendu).toStrictEqual({
      affectations: [{ cwd: resolve(projet('MonProjet')), brain: 'perso' }]
    })
    expect(listerAffectations(env)).toStrictEqual(rendu)
  })

  it('remplace l’affectation du même dossier et garde les autres', () => {
    enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'equipe' })
    enregistrerAffectationDepuisLeRendu(env, { cwd: projet('b'), brain: 'equipe' })
    const rendu = enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'perso' })
    expect(rendu.erreur).toBeUndefined()
    expect(rendu.affectations).toHaveLength(2)
    expect(rendu.affectations).toContainEqual({ cwd: resolve(projet('a')), brain: 'perso' })
    expect(rendu.affectations).toContainEqual({ cwd: resolve(projet('b')), brain: 'equipe' })
  })

  it.each<[string, unknown, RegExp]>([
    [
      'un chemin relatif',
      { cwd: join('relatif', 'projet'), brain: 'equipe' },
      /Chemin absolu obligatoire/
    ],
    ['un Brain inconnu', { cwd: projet('x'), brain: 'tous' }, /Brain inconnu/],
    ['un Brain absent', { cwd: projet('x') }, /Brain inconnu/],
    ['un Brain qui n’est pas un texte', { cwd: projet('x'), brain: 1 }, /Brain inconnu/]
  ])('refuse %s, sans rien écrire', (_nom, entree, motif) => {
    const rendu = enregistrerAffectationDepuisLeRendu(env, entree)
    expect(rendu.erreur).toMatch(motif)
    expect(rendu.affectations).toStrictEqual([])
    expect(existsSync(fichier)).toBe(false)
  })

  it.each<[string, unknown]>([
    ['rien du tout', null],
    ['un simple texte', 'C:\\Projets\\x'],
    ['un dossier absent', { brain: 'equipe' }],
    ['un dossier qui n’est pas un texte', { cwd: 42, brain: 'equipe' }],
    ['un dossier en liste', { cwd: ['C:\\x'], brain: 'equipe' }]
  ])('refuse une entrée sans dossier de travail valable (%s)', (_nom, entree) => {
    const rendu = enregistrerAffectationDepuisLeRendu(env, entree)
    expect(rendu.erreur).toMatch(/Dossier de travail manquant/)
    expect(existsSync(fichier)).toBe(false)
  })

  it('refuse un chemin trop long, sans rien écrire', () => {
    const rendu = enregistrerAffectationDepuisLeRendu(env, {
      cwd: `C:\\${'a'.repeat(32767)}`,
      brain: 'equipe'
    })
    expect(rendu.erreur).toMatch(/trop long/)
    expect(existsSync(fichier)).toBe(false)
  })

  it('sans APPDATA, refuse avec une raison lisible sans lever d’exception', () => {
    const rendu = enregistrerAffectationDepuisLeRendu({}, { cwd: projet('x'), brain: 'equipe' })
    expect(rendu.erreur).toMatch(/APPDATA/)
    expect(rendu.affectations).toStrictEqual([])
  })
})

describe('retirer une affectation', () => {
  it('retire le dossier exact et laisse les autres en place', () => {
    enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'perso' })
    enregistrerAffectationDepuisLeRendu(env, { cwd: projet('b'), brain: 'equipe' })
    const rendu = retirerAffectationDepuisLeRendu(env, { cwd: projet('a') })
    expect(rendu).toStrictEqual({
      affectations: [{ cwd: resolve(projet('b')), brain: 'equipe' }]
    })
  })

  it('un dossier sans affectation n’est pas un refus : la liste ne bouge pas', () => {
    enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'perso' })
    const rendu = retirerAffectationDepuisLeRendu(env, { cwd: projet('zzz') })
    expect(rendu.erreur).toBeUndefined()
    expect(rendu.affectations).toHaveLength(1)
  })

  it.each<[string, unknown, RegExp]>([
    ['une entrée vide', undefined, /Dossier de travail manquant/],
    ['un dossier qui n’est pas un texte', { cwd: 7 }, /Dossier de travail manquant/],
    ['un chemin relatif', { cwd: join('relatif', 'x') }, /Chemin absolu obligatoire/]
  ])('refuse %s avec une raison lisible, et ne retire rien', (_nom, entree, motif) => {
    enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'perso' })
    const rendu = retirerAffectationDepuisLeRendu(env, entree)
    expect(rendu.erreur).toMatch(motif)
    expect(rendu.affectations).toHaveLength(1)
  })
})

describe('fichier illisible', () => {
  const CASSE = '{ pas du json'
  const casser = (): void => {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, CASSE, 'utf8')
  }
  /** Les fichiers mis de côté dans le dossier de données. */
  const misDeCote = (): string[] =>
    readdirSync(dirname(fichier)).filter((nom) => nom.includes('.illisible-'))

  beforeEach(() => {
    if (!existsSync(dirname(fichier))) return
    for (const nom of misDeCote()) rmSync(join(dirname(fichier), nom), { force: true })
  })

  it('à la lecture : la liste est vide et la réponse dit que le fichier est illisible', () => {
    casser()
    const rendu = listerAffectations(env)
    expect(rendu.affectations).toStrictEqual([])
    expect(rendu.erreur).toMatch(/brain-affectations\.json est présent mais illisible/)
    expect(readFileSync(fichier, 'utf8')).toBe(CASSE)
  })

  it('au retrait : le fichier n’est pas réécrit et la réponse dit qu’il est illisible', () => {
    casser()
    const rendu = retirerAffectationDepuisLeRendu(env, { cwd: projet('a') })
    expect(rendu.affectations).toStrictEqual([])
    expect(rendu.erreur).toMatch(/brain-affectations\.json est présent mais illisible/)
    expect(readFileSync(fichier, 'utf8')).toBe(CASSE)
    expect(misDeCote()).toStrictEqual([])
  })

  it('à l’enregistrement : la réponse nomme le fichier mis de côté, et l’affectation est écrite', () => {
    casser()
    const rendu = enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'perso' })
    expect(rendu.affectations).toStrictEqual([{ cwd: resolve(projet('a')), brain: 'perso' }])
    const cote = misDeCote()
    expect(cote).toHaveLength(1)
    expect(cote[0]).toMatch(/^brain-affectations\.json\.illisible-\d+$/)
    expect(rendu.erreur).toContain(cote[0])
    expect(rendu.erreur).toMatch(/mis de côté/)
    // Ce que contenait le fichier illisible reste retrouvable sous ce nom.
    expect(readFileSync(join(dirname(fichier), cote[0]), 'utf8')).toBe(CASSE)
    // Le fichier neuf se lit : l'état suivant n'a plus rien à signaler.
    expect(listerAffectations(env)).toStrictEqual({ affectations: rendu.affectations })
  })

  it('une demande refusée garde sa raison et signale aussi le fichier illisible', () => {
    casser()
    const rendu = enregistrerAffectationDepuisLeRendu(env, { cwd: projet('a'), brain: 'tous' })
    expect(rendu.erreur).toMatch(/Brain inconnu/)
    expect(rendu.erreur).toMatch(/présent mais illisible/)
    expect(readFileSync(fichier, 'utf8')).toBe(CASSE)
  })
})
