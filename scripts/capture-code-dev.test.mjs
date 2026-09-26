import { describe, expect, it, vi } from 'vitest'
import {
  commandeLanceur,
  decouperArguments,
  estCopieDeTravail,
  lireEtatInstance,
  orphelinsAarreter,
  origineDevLocale,
  preparerCodeDev,
  trouverServeurDev
} from './avec-instance-headless.mjs'
import {
  argumentsInstanceDediee,
  avertissementInterface,
  interfaceCapturee,
  verdictCapture
} from './ui-capture.mjs'

/*
 * CAPTURE CACHEE DU CODE EN COURS (demande du 2026-09-26).
 *
 * Constat qui l'a motivee : `ui-capture.mjs` en fenetre cachee lancait TOUJOURS le binaire empaque
 * (dist/win-unpacked). Un changement d'interface non empaquete n'y apparaissait pas, et la capture
 * rendait pourtant `ok: true` — la preuve montrait l'ancienne interface. Il fallait passer par la
 * fenetre de l'utilisateur pour voir le code en cours.
 */

const EXE = 'D:/depot/node_modules/electron/dist/electron.exe'

describe('lanceur PowerShell : le code dev passe au demarrage, le meme programme a l arret', () => {
  it('demarre electron.exe sur le depot avec le serveur de dev', () => {
    const { args } = commandeLanceur({
      racine: 'D:/depot',
      action: 'Start',
      instanceId: 'preuve',
      port: 9300,
      executable: EXE,
      appPath: 'D:/depot',
      rendererUrl: 'http://localhost:5174'
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '-Executable',
        EXE,
        '-AppPath',
        'D:/depot',
        '-RendererUrl',
        'http://localhost:5174'
      ])
    )
  })

  it('arrete avec le MEME programme, sans parametres de demarrage', () => {
    const { args } = commandeLanceur({
      racine: 'D:/depot',
      action: 'Stop',
      instanceId: 'preuve',
      port: 9300,
      executable: EXE,
      appPath: 'D:/depot',
      rendererUrl: 'http://localhost:5174'
    })
    expect(args).toEqual(expect.arrayContaining(['-Executable', EXE]))
    expect(args).not.toContain('-AppPath')
    expect(args).not.toContain('-RendererUrl')
  })

  it('sans code dev, ne passe aucun programme : le binaire empaquete reste le defaut', () => {
    const { args } = commandeLanceur({
      racine: 'D:/depot',
      action: 'Start',
      instanceId: 'preuve',
      port: 9300
    })
    expect(args).not.toContain('-Executable')
    expect(args).not.toContain('-AppPath')
  })

  it('garde le programme de la fiche, pour pouvoir arreter une orpheline de code dev', () => {
    const fiche = lireEtatInstance(`{ "pid": 5, "port": 9301, "executable": "${EXE}" }`)
    expect(fiche).toEqual({ pid: 5, port: 9301, executable: EXE })
    const orphelines = orphelinsAarreter({
      fiches: [{ instanceId: 'preuve', fichier: 'f', ...fiche }],
      lireLanceur: () => 77,
      vivant: (pid) => pid === 5
    })
    expect(orphelines).toEqual([{ instanceId: 'preuve', port: 9301, executable: EXE }])
  })

  it('lit --code-dev et --renderer-url dans les options de l enrobage', () => {
    const lu = decouperArguments([
      '--instance-id',
      'x',
      '--code-dev',
      '--renderer-url',
      'http://127.0.0.1:5180',
      '--',
      'node',
      's.mjs'
    ])
    expect(lu.codeDev).toBe(true)
    expect(lu.rendererUrl).toBe('http://127.0.0.1:5180')
    expect(lu.enfant).toEqual(['node', 's.mjs'])
    expect(decouperArguments(['--', 'node', 's.mjs']).codeDev).toBe(false)
  })
})

describe('trouverServeurDev : l adresse du serveur de dev, jamais devinee', () => {
  const sansFenetre = { lirePortFenetreDev: () => undefined, listerPages: vi.fn() }

  it('prend d abord l adresse imposee, reduite a son origine', async () => {
    expect(
      await trouverServeurDev({ explicite: 'http://localhost:5199/#x', env: {}, ...sansFenetre })
    ).toEqual({ rendererUrl: 'http://localhost:5199', source: '--renderer-url' })
  })

  it('refuse une adresse imposee qui n est pas locale', async () => {
    const r = await trouverServeurDev({ explicite: 'https://exemple.fr', env: {}, ...sansFenetre })
    expect(r.erreur).toMatch(/refusee/)
  })

  it('reprend ELECTRON_RENDERER_URL heritee de l app de dev', async () => {
    expect(
      await trouverServeurDev({
        env: { ELECTRON_RENDERER_URL: 'http://localhost:5174' },
        ...sansFenetre
      })
    ).toEqual({ rendererUrl: 'http://localhost:5174', source: 'ELECTRON_RENDERER_URL' })
  })

  it('lit sinon l adresse de la page de la fenetre de dev ouverte', async () => {
    const r = await trouverServeurDev({
      env: {},
      lirePortFenetreDev: () => 9225,
      listerPages: async () => [
        { type: 'service_worker', url: 'http://localhost:5174/sw.js' },
        { type: 'page', url: 'http://localhost:5174/#view=chat' }
      ]
    })
    expect(r).toEqual({ rendererUrl: 'http://localhost:5174', source: 'fenetre de dev (CDP 9225)' })
  })

  it('une fenetre empaquetee (file://) n est pas un serveur de dev : echec qui nomme les sondes', async () => {
    const r = await trouverServeurDev({
      env: {},
      lirePortFenetreDev: () => 9225,
      listerPages: async () => [{ type: 'page', url: 'file:///C:/app/index.html' }]
    })
    expect(r.erreur).toMatch(/ELECTRON_RENDERER_URL absente/)
    expect(r.erreur).toMatch(/sans page servie/)
  })

  it('n accepte que localhost et 127.0.0.1 en http(s)', () => {
    expect(origineDevLocale('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173')
    expect(origineDevLocale('http://192.168.1.2:5173')).toBeUndefined()
    expect(origineDevLocale('file:///x')).toBeUndefined()
    expect(origineDevLocale('pas une url')).toBeUndefined()
  })
})

describe('preparerCodeDev : une copie de travail d agent est reconstruite, puis lancee sur SES fichiers', () => {
  // Le serveur de dev sert le depot PRINCIPAL, jamais la copie : il ne peut pas montrer les
  // changements de l'agent. On reconstruit donc la copie et l'instance lance son propre `out/`.
  const COPIE = 'D:/depot/.autowin-data/autowin-os/worktrees/5a94/agent__run-1'
  const base = {
    racine: COPIE,
    env: { ELECTRON_RENDERER_URL: 'http://localhost:5174' },
    existe: () => true,
    // `node_modules` d'une copie est un LIEN : c'est le chemin REEL qui doit partir au lanceur.
    resoudreLien: () => 'D:/depot/node_modules/electron/dist/electron.exe',
    dateFichier: () => '2026-09-26T12:00:00.000Z',
    lirePortFenetreDev: () => undefined,
    listerPages: vi.fn()
  }

  it('reconstruit la copie et lance ses fichiers, sans serveur de dev', async () => {
    const construire = vi.fn(() => true)
    const sonderServeur = vi.fn(async () => true)
    const r = await preparerCodeDev({ ...base, construire, sonderServeur })
    expect(construire).toHaveBeenCalledWith(COPIE)
    expect(sonderServeur).not.toHaveBeenCalled()
    expect(r).toEqual({
      executable: 'D:/depot/node_modules/electron/dist/electron.exe',
      appPath: COPIE,
      source: 'copie de travail reconstruite',
      mainConstruitLe: '2026-09-26T12:00:00.000Z'
    })
    expect(r).not.toHaveProperty('rendererUrl')
  })

  it('une reconstruction ratee est un echec nomme, jamais un lancement de l ancien code', async () => {
    const r = await preparerCodeDev({
      ...base,
      construire: () => 'code 1\nerror TS2304',
      sonderServeur: vi.fn()
    })
    expect(r.erreur).toMatch(/reconstruction de la copie de travail echouee : code 1/)
    expect(r).not.toHaveProperty('executable')
  })

  it('reconnait une copie de travail, pas le depot principal', () => {
    expect(
      estCopieDeTravail(String.raw`D:\AutoWinOS\.autowin-data\autowin-os\worktrees\x\agent__run-1`)
    ).toBe(true)
    expect(estCopieDeTravail('D:/AutoWinOS')).toBe(false)
    expect(estCopieDeTravail('D:/projets/worktrees/AutoWinOS')).toBe(false)
  })
})

describe('preparerCodeDev : aucun repli silencieux sur le binaire empaquete', () => {
  const base = {
    racine: 'D:/depot',
    env: { ELECTRON_RENDERER_URL: 'http://localhost:5174' },
    lirePortFenetreDev: () => undefined,
    listerPages: vi.fn(),
    resoudreLien: (chemin) => chemin,
    construire: vi.fn(() => 'le depot principal ne doit jamais etre reconstruit'),
    dateFichier: () => '2026-09-26T08:00:00.000Z'
  }

  it('rend electron.exe, le depot et le serveur quand tout est la', async () => {
    const r = await preparerCodeDev({
      ...base,
      existe: () => true,
      sonderServeur: async () => true
    })
    expect(r).toEqual({
      executable: expect.stringMatching(/node_modules[\\/]electron[\\/]dist[\\/]electron\.exe$/),
      appPath: 'D:/depot',
      rendererUrl: 'http://localhost:5174',
      source: 'ELECTRON_RENDERER_URL',
      mainConstruitLe: '2026-09-26T08:00:00.000Z'
    })
  })

  it('echoue en nommant electron.exe absent', async () => {
    const r = await preparerCodeDev({
      ...base,
      existe: () => false,
      sonderServeur: async () => true
    })
    expect(r.erreur).toMatch(/electron\.exe du depot introuvable/)
  })

  it('echoue si le process principal n a jamais ete construit', async () => {
    const r = await preparerCodeDev({
      ...base,
      existe: (chemin) => !/out[\\/]main/.test(chemin),
      sonderServeur: async () => true
    })
    expect(r.erreur).toMatch(/process principal non construit/)
  })

  it('echoue si le serveur de dev ne repond pas', async () => {
    const r = await preparerCodeDev({
      ...base,
      existe: () => true,
      sonderServeur: async () => 'fetch failed'
    })
    expect(r.erreur).toMatch(/injoignable \(fetch failed\)/)
  })
})

describe('ui-capture : la capture dit d ou vient l interface', () => {
  it('passe --code-dev et l adresse a l enrobage, et le garde pour l enfant', () => {
    const args = argumentsInstanceDediee(
      ['--view', 'chat', '--code-dev', '--renderer-url', 'http://localhost:5174'],
      { enrobage: 'E', script: 'S', instanceId: 'ui-capture-1' }
    )
    const separateur = args.indexOf('--')
    expect(args.slice(0, separateur)).toEqual([
      'E',
      '--instance-id',
      'ui-capture-1',
      '--code-dev',
      '--renderer-url',
      'http://localhost:5174'
    ])
    expect(args.slice(separateur + 1)).toContain('--code-dev')
  })

  it('sans --code-dev, l enrobage ne recoit aucune option de code dev', () => {
    const args = argumentsInstanceDediee(['--view', 'chat'], {
      enrobage: 'E',
      script: 'S',
      instanceId: 'i'
    })
    expect(args.slice(0, args.indexOf('--'))).toEqual(['E', '--instance-id', 'i'])
  })

  it('classe la page : serveur de dev, code construit de la copie, application empaquetee', () => {
    expect(interfaceCapturee('http://localhost:5174/#view=chat')).toEqual({
      source: 'code-dev',
      origine: 'http://localhost:5174'
    })
    const copie = 'D:/depot/.autowin-data/autowin-os/worktrees/5a94/agent__run-1'
    expect(
      interfaceCapturee(
        'file:///D:/depot/.autowin-data/autowin-os/worktrees/5a94/agent__run-1/out/renderer/index.html?instance=test',
        copie
      )
    ).toEqual({ source: 'code-construit', racine: expect.stringMatching(/agent__run-1$/) })
    // Le binaire empaquete porte AUSSI un `out/renderer`, mais dans son app.asar : pas celui de la copie.
    expect(
      interfaceCapturee(
        'file:///D:/depot/dist/win-unpacked/resources/app.asar/out/renderer/index.html',
        copie
      )
    ).toEqual({ source: 'application-empaquetee' })
    expect(interfaceCapturee('file:///D:/app/resources/index.html')).toEqual({
      source: 'application-empaquetee'
    })
    expect(interfaceCapturee(undefined)).toEqual({ source: 'inconnue' })
  })

  it('--code-dev sur une page construite est un echec nomme, pas une capture verte', () => {
    const mesures = {
      vue: 'chat',
      destinationActive: 'chat',
      longueurTexte: 5000,
      elements: 500,
      octetsPng: 200_000
    }
    expect(verdictCapture({ ...mesures, interfaceCapturee: { source: 'code-dev' } }).ok).toBe(true)
    const refus = verdictCapture({
      ...mesures,
      codeDevExige: true,
      interfaceCapturee: { source: 'application-empaquetee' }
    })
    expect(refus.ok).toBe(false)
    expect(refus.echecs).toContain('code-dev-non-servi(application-empaquetee)')
    expect(
      verdictCapture({
        ...mesures,
        codeDevExige: true,
        interfaceCapturee: { source: 'code-construit', racine: 'D:/copie' }
      }).ok
    ).toBe(true)
    expect(
      verdictCapture({
        ...mesures,
        codeDevExige: true,
        interfaceCapturee: { source: 'code-dev', origine: 'http://localhost:5174' }
      }).ok
    ).toBe(true)
  })

  it('previent quand la capture vient de l application construite alors qu un serveur de dev tourne', () => {
    const env = { ELECTRON_RENDERER_URL: 'http://localhost:5174' }
    expect(avertissementInterface({ source: 'application-empaquetee' }, env).avertissement).toMatch(
      /ajoute --code-dev/
    )
    expect(avertissementInterface({ source: 'code-dev' }, env)).toEqual({})
    expect(avertissementInterface({ source: 'application-empaquetee' }, {})).toEqual({})
  })
})
