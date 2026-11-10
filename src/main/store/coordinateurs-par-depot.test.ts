import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CoordinateursParDepot } from './coordinateurs-par-depot'

describe('un gestionnaire de copies par dépôt', () => {
  let racine: string
  let principal: string
  let autre: string
  let ouverts: string[]
  let registre: CoordinateursParDepot<string>

  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'coordinateurs-par-depot-'))
    principal = join(racine, 'principal')
    autre = join(racine, 'autre')
    for (const depot of [principal, autre]) mkdirSync(join(depot, '.git'), { recursive: true })
    ouverts = []
    registre = new CoordinateursParDepot(
      { depot: principal, coordinateur: () => 'principal' },
      (depot) => {
        ouverts.push(depot)
        return `ouvert:${depot}`
      }
    )
  })

  afterEach(() => rmSync(racine, { recursive: true, force: true }))

  it('sans dossier, ou sur le dossier principal, rend le gestionnaire principal', () => {
    mkdirSync(join(principal, 'src'))
    expect(registre.pour()).toBe('principal')
    expect(registre.pour(principal)).toBe('principal')
    expect(registre.pour(join(principal, 'src'))).toBe('principal')
    expect(ouverts).toEqual([])
    expect(registre.plusieurs()).toBe(false)
  })

  it('un fil rangé sur un autre dépôt reçoit le gestionnaire de CE dépôt, ouvert une seule fois', () => {
    mkdirSync(join(autre, 'src'))
    expect(registre.pour(autre)).toBe(`ouvert:${autre}`)
    expect(registre.pour(join(autre, 'src'))).toBe(`ouvert:${autre}`)
    expect(ouverts).toEqual([autre])
    expect(registre.tous()).toEqual(['principal', `ouvert:${autre}`])
    expect(registre.plusieurs()).toBe(true)
  })

  it("la copie liée d'un dépôt rend le gestionnaire du dépôt d'origine", () => {
    const copie = join(racine, 'copie-du-fil')
    mkdirSync(join(autre, '.git', 'worktrees', 'fil'), { recursive: true })
    writeFileSync(join(autre, '.git', 'worktrees', 'fil', 'commondir'), '../..\n')
    mkdirSync(copie, { recursive: true })
    writeFileSync(join(copie, '.git'), `gitdir: ${join(autre, '.git', 'worktrees', 'fil')}\n`)
    expect(registre.pour(copie)).toBe(`ouvert:${autre}`)
  })

  it("un échec d'ouverture n'est pas gardé : le run suivant réessaie le même dépôt", () => {
    mkdirSync(join(autre, 'src'))
    let tentatives = 0
    const registreQuiEchoueUneFois = new CoordinateursParDepot<string>(
      { depot: principal, coordinateur: () => 'principal' },
      (depot) => {
        tentatives += 1
        return tentatives === 1 ? undefined : `ouvert:${depot}`
      }
    )
    expect(registreQuiEchoueUneFois.pour(autre)).toBeUndefined()
    expect(registreQuiEchoueUneFois.pour(autre)).toBe(`ouvert:${autre}`)
    expect(registreQuiEchoueUneFois.pour(autre)).toBe(`ouvert:${autre}`)
    expect(tentatives).toBe(2)
  })

  it("un dossier hors de tout dépôt n'a aucun gestionnaire, jamais celui du dossier principal", () => {
    const horsDepot = join(racine, 'documents')
    mkdirSync(horsDepot)
    expect(registre.pour(horsDepot)).toBeUndefined()
    expect(registre.plusieurs()).toBe(false)
  })
})
