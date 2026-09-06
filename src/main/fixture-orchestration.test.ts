import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertDepotJetable,
  creerDepotJetable,
  FICHIER_ECRIT_PAR_LA_FIXTURE,
  MARQUEUR_DEPOT_JETABLE,
  reponseFixtureNominale
} from './fixture-orchestration'
import { lireVerdictJuge } from './orchestrator'

const aNettoyer: string[] = []
const dossierTemporaire = (): string => {
  const chemin = mkdtempSync(join(tmpdir(), 'fixture-orch-'))
  aNettoyer.push(chemin)
  return chemin
}
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop() as string, { recursive: true, force: true })
})

describe('dépôt jetable de la fixture d’orchestration', () => {
  it('crée un vrai dépôt git, avec son marqueur et un commit de base', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    expect(existsSync(join(racine, '.git'))).toBe(true)
    expect(existsSync(join(racine, MARQUEUR_DEPOT_JETABLE))).toBe(true)
    // Un dépôt sans commit n'a pas de HEAD : le balayage des bureaux n'aurait rien à comparer.
    const tete = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: racine,
      encoding: 'utf8'
    })
    expect(tete.trim()).toMatch(/^[0-9a-f]{7,40}$/)
  })

  /*
   * IDEMPOTENCE : un run interrompu ne doit pas perdre ce qu'il observait. Rappelée sur un dépôt
   * déjà créé, la fabrique le rend tel quel — elle ne réinitialise pas.
   */
  it('rappelée sur un dépôt déjà créé, elle le conserve', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    writeFileSync(join(racine, 'travail-en-cours.txt'), 'observation en cours', 'utf8')
    creerDepotJetable(racine)
    expect(existsSync(join(racine, 'travail-en-cours.txt'))).toBe(true)
  })
})

describe('garde-fou du plan de travail', () => {
  /*
   * LE CAS QUI JUSTIFIE TOUT LE GARDE-FOU.
   *
   * Le plan de travail se résout en cascade et retombe, en avant-dernier recours, sur le dépôt git
   * du dossier de l'exécutable — donc sur le dépôt RÉEL pour un paquet. Un dépôt git ordinaire doit
   * donc être REFUSÉ : « c'est un dépôt git » ne prouve rien, seul le marqueur posé par la fixture
   * le fait.
   */
  it('refuse un dépôt git ordinaire, qui n’est pas le sien', () => {
    const racine = join(dossierTemporaire(), 'depot-reel')
    mkdirSync(racine, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: racine, stdio: 'ignore' })
    expect(() => assertDepotJetable(racine)).toThrow(/pas un dépôt jetable/)
  })

  it('refuse un plan de travail vide', () => {
    expect(() => assertDepotJetable('')).toThrow(/aucun plan de travail/)
  })

  /* Le marqueur SEUL ne suffit pas : un dossier marqué mais sans git ne se comporte pas en dépôt. */
  it('refuse un dossier marqué qui n’est pas un dépôt git', () => {
    const racine = dossierTemporaire()
    writeFileSync(join(racine, MARQUEUR_DEPOT_JETABLE), 'marque', 'utf8')
    expect(() => assertDepotJetable(racine)).toThrow(/pas un dépôt git/)
  })

  it('accepte le dépôt jetable qu’elle vient de créer', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    expect(() => assertDepotJetable(racine)).not.toThrow()
  })
})

describe('scénario nominal', () => {
  /*
   * LE VERDICT DOIT PASSER PAR LE VRAI LECTEUR, pas par une comparaison de chaînes ici. Si le
   * contrat du juge change, ce test doit tomber — c'est tout son intérêt.
   */
  it('le juge rend une forme que le lecteur de verdict accepte', () => {
    expect(lireVerdictJuge(reponseFixtureNominale('judge'))).toBe(true)
  })

  /*
   * SANS ÉCRITURE, LA PREUVE SERAIT VIDE. Le balayage ne supprime une copie de travail que si son
   * arborescence est VIDE : une fixture qui n'écrit rien emprunte le chemin trivial, et la sonde
   * des trois conversations serait verte par construction.
   */
  it('le sous-agent écrit un fichier reconnaissable', () => {
    const reponse = reponseFixtureNominale('sous-agent')
    expect(reponse).toContain('edit_file')
    expect(reponse).toContain(FICHIER_ECRIT_PAR_LA_FIXTURE)
  })

  it('l’orchestrateur clôt sans réclamer un tour de plus', () => {
    expect(reponseFixtureNominale('orchestrator')).not.toContain('<cmd>')
  })
})
