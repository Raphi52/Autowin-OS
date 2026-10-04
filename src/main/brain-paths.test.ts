// fix-ok: chemins, variables et marqueur propres à un employeur écrits en dur (mesuré par grep) ; neutralisés, anciens noms lus en secours (tests rouge→vert).
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sharedBrainOrigin,
  sharedBrainPort,
  sharedBrainRoot,
  sharedBrainStateRoot,
  sharedBrainTooling,
  teamWorkspaces,
  DEFAULT_TEAM_WORKSPACES,
  defaultBrainRoot,
  lireReglage
} from './brain-paths'

/**
 * Ces chemins etaient ecrits en dur dans QUATRE fichiers du main process (audit 2026-07-29). Ce que
 * ces tests figent : la source est UNIQUE, chaque valeur reste SURCHARGEABLE sous son nom historique,
 * et le residu `C:\Nouveau dossier` — qui trainait dans une liste blanche ANTI-TRAVERSAL — ne revient
 * jamais.
 */
describe('brain-paths — source unique et surchargeable', () => {
  it('sans reglage : aucun partage d’entreprise, un dossier LOCAL propre a Autowin', () => {
    expect(sharedBrainRoot({})).toBe(defaultBrainRoot({}))
    expect(sharedBrainRoot({ LOCALAPPDATA: 'L' })).toBe(join('L', 'AutowinBrain', 'brain'))
    expect(sharedBrainRoot({ LOCALAPPDATA: 'L' })).not.toMatch(/^[\\/]{2}/)
    expect(sharedBrainOrigin({})).toBe('http://127.0.0.1:8765')
  })

  it('respecte les noms de variables HISTORIQUES (les renommer serait une regression silencieuse)', () => {
    expect(sharedBrainRoot({ AMITEL_BRAIN_ROOT: 'D:\\brain' })).toBe('D:\\brain')
    expect(sharedBrainOrigin({ AMITEL_BRAIN_ORIGIN: 'http://localhost:9000' })).toBe(
      'http://localhost:9000'
    )
    expect(sharedBrainTooling({ AUTOWIN_BRAIN_TOOLING: 'D:\\t' })).toBe('D:\\t')
  })

  it('refuse une origine Brain distante avant tout envoi de token ou requête', () => {
    expect(() =>
      sharedBrainOrigin({ AMITEL_BRAIN_ORIGIN: 'https://remote.example.invalid:9443' })
    ).toThrow(/loopback/)
  })

  it('le tooling SUIT la racine du Brain — avant, les deux litteraux pouvaient diverger', () => {
    // Le partage fournit les donnees, jamais du code executable.
    expect(sharedBrainTooling({ AMITEL_BRAIN_ROOT: 'D:\\brain', LOCALAPPDATA: 'C:\\Local' })).toBe(
      'C:\\Local\\AmitelBrain\\tooling'
    )
    expect(sharedBrainStateRoot({ LOCALAPPDATA: 'C:\\Local' })).toBe('C:\\Local\\AmitelBrain')
    expect(sharedBrainTooling({ AMITEL_BRAIN_ROOT: 'D:\\brain', AUTOWIN_BRAIN_TOOLING: 'E:\\t' })).toBe(
      'E:\\t'
    )
    expect(sharedBrainTooling({ AMITEL_BRAIN_ROOT: '\\\\nas1\\brain' })).toBe('')
  })

  it('une valeur VIDE ou en espaces ne masque pas le defaut', () => {
    // Piege classique : `AMITEL_BRAIN_ROOT=` (vide) faisait rendre '' avec un `??`, donc un chemin
    // relatif silencieux. On retombe sur le defaut.
    expect(sharedBrainRoot({ AMITEL_BRAIN_ROOT: '' })).toBe(defaultBrainRoot({}))
    expect(sharedBrainRoot({ AMITEL_BRAIN_ROOT: '   ' })).toBe(defaultBrainRoot({}))
  })

  it('les workspaces sont surchargeables en liste, et NE CONTIENNENT PLUS le residu de bricolage', () => {
    expect(teamWorkspaces({})).toEqual([...DEFAULT_TEAM_WORKSPACES])
    expect(teamWorkspaces({})).not.toContain('C:\\Nouveau dossier')
    expect(DEFAULT_TEAM_WORKSPACES).not.toContain('C:\\Nouveau dossier')
    expect(teamWorkspaces({ AUTOWIN_AMITEL_WORKSPACES: 'D:\\a ; D:\\b' })).toEqual([
      'D:\\a',
      'D:\\b'
    ])
  })

  it('aucun workspace d’equipe n’est autorise d’office (liste vide par defaut)', () => {
    expect(DEFAULT_TEAM_WORKSPACES).toEqual([])
    expect(teamWorkspaces({})).toEqual([])
  })

  it('une liste de workspaces vide ou faite de separateurs retombe sur le defaut', () => {
    expect(teamWorkspaces({ AUTOWIN_AMITEL_WORKSPACES: '  ;  ;' })).toEqual([
      ...DEFAULT_TEAM_WORKSPACES
    ])
  })
})

/**
 * NOMS NEUTRES (2026-10-04) : `AUTOWIN_BRAIN_*` / `AUTOWIN_WORKSPACES` priment ; les noms historiques
 * `AMITEL_BRAIN_*` / `AUTOWIN_AMITEL_WORKSPACES` restent lus en secours, sans rien changer aux postes
 * qui les ont deja poses.
 */
describe('brain-paths — noms de reglage neutres, anciens noms en secours', () => {
  it('le nom neutre gagne quand les deux sont poses', () => {
    expect(sharedBrainRoot({ AUTOWIN_BRAIN_ROOT: 'D:\\neuf', AMITEL_BRAIN_ROOT: 'D:\\ancien' })).toBe(
      'D:\\neuf'
    )
    expect(
      sharedBrainOrigin({
        AUTOWIN_BRAIN_ORIGIN: 'http://127.0.0.1:9001',
        AMITEL_BRAIN_ORIGIN: 'http://127.0.0.1:9002'
      })
    ).toBe('http://127.0.0.1:9001')
    expect(sharedBrainPort({ AUTOWIN_BRAIN_PORT: '9003', AMITEL_BRAIN_PORT: '9004' })).toBe('9003')
    expect(
      teamWorkspaces({ AUTOWIN_WORKSPACES: 'D:\\neuf', AUTOWIN_AMITEL_WORKSPACES: 'D:\\ancien' })
    ).toEqual(['D:\\neuf'])
  })

  it('le nom historique seul marche toujours (usage actuel inchange)', () => {
    expect(sharedBrainRoot({ AMITEL_BRAIN_ROOT: 'D:\\ancien' })).toBe('D:\\ancien')
    expect(sharedBrainPort({ AMITEL_BRAIN_PORT: '9004' })).toBe('9004')
    expect(teamWorkspaces({ AUTOWIN_AMITEL_WORKSPACES: 'D:\\ancien' })).toEqual(['D:\\ancien'])
  })

  it('un nom neutre vide ou blanc compte comme absent : le nom historique prend le relais', () => {
    expect(sharedBrainRoot({ AUTOWIN_BRAIN_ROOT: '  ', AMITEL_BRAIN_ROOT: 'D:\\ancien' })).toBe(
      'D:\\ancien'
    )
    expect(lireReglage({ A: '', B: ' ' }, 'A', 'B')).toBeUndefined()
    expect(lireReglage({}, 'A', 'B')).toBeUndefined()
  })

  it('les doublons et les entrees vides de la liste de workspaces sont ignores', () => {
    expect(teamWorkspaces({ AUTOWIN_WORKSPACES: 'D:\\a;;D:\\a; ;D:\\b' })).toEqual(['D:\\a', 'D:\\b'])
  })
})

/**
 * DEFAUT VECU (conv-8, 2026-09-03) : le service a jour ecoutait 8766 et le processus principal
 * interrogeait 8765 — son defaut — parce que l'origine ne vivait que dans la variable d'un shell.
 * Chaque lecture du savoir rendait « indisponible » en 15 ms. Persister la variable N'A PAS suffi :
 * l'app relancee a herite de l'ancien environnement et a demarre un SECOND serveur sur 8765.
 *
 * ENTREE QUI FAIT ECHOUER CES TESTS SI LA CORRECTION EST FAUSSE : une installation dont le
 * `config.json` porte 8766 et un environnement TOTALEMENT muet. Une resolution qui ne lit que
 * l'environnement retombe sur 8765 et les deux premiers tests tombent rouges.
 */
describe('origine du Brain — le port vient de l installation, pas d un shell', () => {
  const avecInstallation = (config: Record<string, unknown>): NodeJS.ProcessEnv => {
    const localAppData = mkdtempSync(join(tmpdir(), 'brain-origine-'))
    mkdirSync(join(localAppData, 'AmitelBrain'), { recursive: true })
    writeFileSync(join(localAppData, 'AmitelBrain', 'config.json'), JSON.stringify(config))
    installations.push(localAppData)
    return { LOCALAPPDATA: localAppData }
  }
  const installations: string[] = []
  afterAll(() => {
    for (const dir of installations) rmSync(dir, { recursive: true, force: true })
  })

  it('lit `origin` du config.json quand l environnement est muet', () => {
    const env = avecInstallation({ origin: 'http://127.0.0.1:8766' })
    expect(sharedBrainOrigin(env)).toBe('http://127.0.0.1:8766')
    expect(sharedBrainPort(env)).toBe('8766')
  })

  it('accepte `port` comme raccourci', () => {
    expect(sharedBrainOrigin(avecInstallation({ port: 8790 }))).toBe('http://127.0.0.1:8790')
    expect(sharedBrainOrigin(avecInstallation({ port: '8791' }))).toBe('http://127.0.0.1:8791')
  })

  it('l environnement reste PRIORITAIRE sur l installation', () => {
    const env = avecInstallation({ origin: 'http://127.0.0.1:8766' })
    expect(sharedBrainOrigin({ ...env, AMITEL_BRAIN_ORIGIN: 'http://127.0.0.1:8700' })).toBe(
      'http://127.0.0.1:8700'
    )
    expect(sharedBrainOrigin({ ...env, AMITEL_BRAIN_PORT: '8701' })).toBe('http://127.0.0.1:8701')
  })

  it('une valeur ILLISIBLE retombe sur le defaut plutot que de faire echouer la lecture', () => {
    expect(sharedBrainOrigin(avecInstallation({ port: 'huit-mille' }))).toBe(
      'http://127.0.0.1:8765'
    )
    expect(sharedBrainOrigin(avecInstallation({ port: 99999 }))).toBe('http://127.0.0.1:8765')
  })

  it('une origine NON loopback est refusee — jamais une adresse distante en silence', () => {
    expect(() => sharedBrainOrigin(avecInstallation({ origin: 'http://10.0.0.9:8766' }))).toThrow(
      /loopback/i
    )
  })
})

/**
 * BRAIN PROPRE A AUTOWIN — constate le 2026-09-25 (conv-3). Sur un poste qui heberge AUSSI un Brain
 * personnel, l'installateur de celui-ci pose `AMITEL_BRAIN_ROOT` dans les variables UTILISATEUR :
 * Autowin en heritait, et ses lecons (`remember`, POST /ingest) partaient dans le Brain personnel.
 * `%LOCALAPPDATA%\AutowinBrain\config.json` donne a Autowin son propre Brain ; absent, rien ne change.
 */
describe('Brain propre a Autowin — il prime sur la racine heritee d un autre Brain', () => {
  const postes: string[] = []
  afterAll(() => {
    for (const dir of postes) rmSync(dir, { recursive: true, force: true })
  })
  const poste = (autowin?: Record<string, unknown>): NodeJS.ProcessEnv => {
    const localAppData = mkdtempSync(join(tmpdir(), 'brain-autowin-'))
    postes.push(localAppData)
    mkdirSync(join(localAppData, 'AmitelBrain'), { recursive: true })
    writeFileSync(
      join(localAppData, 'AmitelBrain', 'config.json'),
      JSON.stringify({ brain_root: 'C:\\Perso\\Hermes-Brain' })
    )
    if (autowin) {
      mkdirSync(join(localAppData, 'AutowinBrain'), { recursive: true })
      writeFileSync(join(localAppData, 'AutowinBrain', 'config.json'), JSON.stringify(autowin))
    }
    return { LOCALAPPDATA: localAppData, AMITEL_BRAIN_ROOT: 'C:\\Perso\\Hermes-Brain' }
  }

  it('sa racine, son etat et son port priment sur AMITEL_BRAIN_ROOT herite', () => {
    const env = poste({ brain_root: 'C:\\Perso\\Autowin-Brain', port: 8766 })
    expect(sharedBrainRoot(env)).toBe('C:\\Perso\\Autowin-Brain')
    expect(sharedBrainStateRoot(env)).toBe(join(env.LOCALAPPDATA as string, 'AutowinBrain'))
    expect(sharedBrainOrigin(env)).toBe('http://127.0.0.1:8766')
  })

  it('sans ce dossier, rien ne change : la variable historique decide', () => {
    const env = poste()
    expect(sharedBrainRoot(env)).toBe('C:\\Perso\\Hermes-Brain')
    expect(sharedBrainStateRoot(env)).toBe(join(env.LOCALAPPDATA as string, 'AmitelBrain'))
    expect(sharedBrainOrigin(env)).toBe('http://127.0.0.1:8765')
  })

  it('une configuration SANS racine n est pas un Brain : elle ne detourne rien', () => {
    const env = poste({ port: 8766 })
    expect(sharedBrainRoot(env)).toBe('C:\\Perso\\Hermes-Brain')
    expect(sharedBrainStateRoot(env)).toBe(join(env.LOCALAPPDATA as string, 'AmitelBrain'))
  })

  it('seule la variable qui REPETE l installation partagee est ecartee : un choix explicite garde la main', () => {
    // L'installateur du Brain personnel pose AMITEL_BRAIN_ROOT = son propre brain_root. Toute AUTRE
    // valeur a ete choisie pour ce process (un test, un lancement dedie) : elle prime, comme avant.
    const env: NodeJS.ProcessEnv = {
      ...poste({ brain_root: 'C:\\Perso\\Autowin-Brain', port: 8766 }),
      AMITEL_BRAIN_ROOT: 'D:\\autre'
    }
    expect(sharedBrainRoot(env)).toBe('D:\\autre')
    expect(sharedBrainStateRoot(env)).toBe(join(env.LOCALAPPDATA as string, 'AmitelBrain'))
    // Meme racine partagee ecrite autrement (barres, casse) : c'est toujours l'heritage, ecarte.
    const echo = { ...env, AMITEL_BRAIN_ROOT: 'c:/perso/hermes-brain' }
    expect(sharedBrainRoot(echo)).toBe('C:\\Perso\\Autowin-Brain')
    // Aucune variable : le Brain d'Autowin s'applique.
    const muet: NodeJS.ProcessEnv = { ...env }
    delete muet.AMITEL_BRAIN_ROOT
    expect(sharedBrainRoot(muet)).toBe('C:\\Perso\\Autowin-Brain')
  })

  it('AUTOWIN_BRAIN_STATE_ROOT explicite garde la main, avec sa regle d origine', () => {
    const env = {
      ...poste({ brain_root: 'C:\\Perso\\Autowin-Brain' }),
      AUTOWIN_BRAIN_STATE_ROOT: 'E:\\etat'
    }
    expect(sharedBrainStateRoot(env)).toBe('E:\\etat')
    expect(sharedBrainRoot(env)).toBe('C:\\Perso\\Hermes-Brain')
  })
})
