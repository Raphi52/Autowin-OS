import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertDepotJetable,
  PREFIXE_FIXTURE_ORCHESTRATION,
  roleDeLAppel,
  scenarioDemande,
  creerDepotJetable,
  FICHIER_ECRIT_PAR_LA_FIXTURE,
  MARQUEUR_DEPOT_JETABLE,
  preuveDeLaMutation,
  preuveExecutableDeLEcriture,
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
  /*
   * LE DISTANT MANQUANT A ETE TROUVE EN JOUANT LE RUN, pas en lisant le code : le premier
   * lancement reel s'est arrete sur « Lancement bloque : le distant origin est absent ». Le depot
   * REEL en a un, donc rien ne l'avait revele.
   */
  it('pose un distant origin local, pour qu’un run puisse publier', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    const distant = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: racine,
      encoding: 'utf8'
    }).trim()
    expect(distant).toContain('-origin.git')
    expect(existsSync(distant)).toBe(true)
    // La branche y est POUSSEE : un origin vide ne repond pas a la question « ou publier ».
    const distantes = execFileSync('git', ['branch', '-r'], { cwd: racine, encoding: 'utf8' })
    expect(distantes).toContain('origin/main')
  })

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

describe('déclencheur du scénario', () => {
  const isolee = ['electron', '--isolated-test-instance']

  it('reconnaît le scénario nominal dans une instance isolée', () => {
    expect(scenarioDemande(`${PREFIXE_FIXTURE_ORCHESTRATION} nominal`, isolee)).toBe('nominal')
  })

  /*
   * LA PORTE NE DOIT PAS EXISTER EN PRODUCTION. Hors instance isolée le préfixe est ignoré — sans
   * erreur : une erreur signalerait justement que la porte est là.
   */
  it('ignore le préfixe hors instance isolée', () => {
    expect(scenarioDemande(`${PREFIXE_FIXTURE_ORCHESTRATION} nominal`, ['electron'])).toBeUndefined()
  })

  it('laisse passer une tâche ordinaire', () => {
    expect(scenarioDemande('Corrige le bandeau de démarrage', isolee)).toBeUndefined()
  })

  /*
   * UN SCÉNARIO INCONNU LÈVE. Un préfixe mal orthographié qui retomberait en silence sur un vrai
   * run payant serait le pire des résultats.
   */
  it('lève sur un scénario inconnu plutôt que de lancer un run payant', () => {
    expect(() => scenarioDemande(`${PREFIXE_FIXTURE_ORCHESTRATION} nominl`, isolee)).toThrow(
      /scénario inconnu/
    )
  })

  it('traduit le rôle nommé par l’orchestrateur', () => {
    expect(roleDeLAppel('judge')).toBe('judge')
    expect(roleDeLAppel('orchestrator')).toBe('orchestrator')
    expect(roleDeLAppel('build')).toBe('sous-agent')
  })
})

describe('preuve exécutable', () => {
  /*
   * ELLE DOIT ÊTRE VRAIE, PAS DÉCLARÉE.
   *
   * La porte `done-without-proof` refuse le vert sans « au moins une preuve d'exécution ok ». La
   * tentation serait un `ok: true` de complaisance : ce serait neutraliser une porte — et fabriquer
   * le faux vert exact que ce chantier combat. On exécute donc une vraie commande et on rapporte son
   * vrai résultat. Ces deux tests le vérifient dans les DEUX sens.
   */
  it('rend ok quand le fichier a réellement été écrit', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    writeFileSync(join(racine, FICHIER_ECRIT_PAR_LA_FIXTURE), 'écrit', 'utf8')
    const preuve = preuveExecutableDeLEcriture(racine)
    expect(preuve.ok).toBe(true)
    expect(preuve.kind).toBe('verification')
    expect(preuve.command).toContain('git status')
    expect(preuve.exitCode).toBe(0)
  })

  it('rend NON ok quand rien n’a été écrit — l’oracle est falsifiable', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    const preuve = preuveExecutableDeLEcriture(racine)
    expect(preuve.ok).toBe(false)
    expect(preuve.summary).toContain('ABSENT')
  })
})

describe('preuve de la mutation', () => {
  /*
   * DEUX PREUVES SONT EXIGÉES, PAS UNE. `evidenceSatisfiesTask` demande une preuve de MUTATION ET
   * une de VÉRIFICATION : « une lecture n'atteste pas que la mutation est correcte ». La fixture
   * rend donc les deux — et les deux sont vraies.
   */
  it('atteste l’écriture quand le fichier est là', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    writeFileSync(join(racine, FICHIER_ECRIT_PAR_LA_FIXTURE), 'écrit', 'utf8')
    const preuve = preuveDeLaMutation(racine)
    expect(preuve.ok).toBe(true)
    expect(preuve.kind).toBe('mutation')
    expect(preuve.path).toBe(FICHIER_ECRIT_PAR_LA_FIXTURE)
  })

  it('rend NON ok si le fichier n’existe pas — elle ne se croit pas sur parole', () => {
    const racine = creerDepotJetable(join(dossierTemporaire(), 'depot'))
    expect(preuveDeLaMutation(racine).ok).toBe(false)
  })
})
