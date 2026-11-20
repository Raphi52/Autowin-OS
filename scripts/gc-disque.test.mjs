import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  balayer,
  corbeilleDuDisque,
  corbeillesConnues,
  depotEtDonnees,
  familleDe,
  inventorier,
  protegeDuDepot
} from './gc-disque.mjs'

/*
 * Tout se joue dans un poste jetable : dépôt, données, temporaire et dossier personnel factices.
 * Les noms reprennent ce que la mesure du 07/11 a trouvé sur un vrai poste (`.autowin-tmp/conv-…`,
 * `Audit/headless-instances/…`, `Outlook Logging`, `artifacts/`, sessions `*.jsonl`).
 */
const SCRIPT = fileURLToPath(new URL('./gc-disque.mjs', import.meta.url))
const MAINTENANT = new Date(2026, 10, 7, 8, 0, 0).getTime()
const JOUR = 86_400_000

let poste
let ctx
let ignores

function fichier(chemin, ageJours, contenu = 'x') {
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, contenu)
  const quand = new Date(MAINTENANT - ageJours * JOUR)
  utimesSync(chemin, quand, quand)
}

const chemins = (liste) => liste.map((c) => c.chemin)

beforeEach(() => {
  poste = mkdtempSync(join(tmpdir(), 'autowin-gc-disque-'))
  const depot = join(poste, 'depot')
  const donnees = join(depot, '.autowin-data')
  mkdirSync(join(donnees, 'autowin-os'), { recursive: true })
  ignores = []
  ctx = {
    depot,
    donnees,
    temp: join(poste, 'Temp'),
    home: join(poste, 'home'),
    maintenant: MAINTENANT,
    ignoresGit: () => ignores,
    seuilAVerifier: 0,
    seuilLourd: 1,
    seuilCroissance: 5
  }
})

describe('inventorier — ce qui est candidat', () => {
  it('prend un brouillon de fil calme depuis 7 jours, garde celui qui a un fichier récent', () => {
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-1', 'rendu.png'), 10)
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-2', 'vieux.mp4'), 40)
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-2', 'script.py'), 2)

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats)).toEqual([join(ctx.depot, '.autowin-tmp', 'conv-1')])
    expect(bilan.candidats[0].familles).toEqual({ image: 1 })
  })

  it('prend une instance de capture calme, et jamais un environnement Python ni un cache', () => {
    fichier(join(ctx.depot, 'Audit', 'headless-instances', 'sonde-adf', 'Cookies'), 9)
    fichier(join(ctx.depot, 'Audit', 'headless-instances', 'chat-conv-9', 'Cookies'), 1)
    fichier(join(ctx.temp, 'brainvenv', 'pyvenv.cfg'), 90)
    fichier(join(ctx.temp, 'fastembed_cache', 'modele.onnx'), 90)

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats)).toEqual([
      join(ctx.depot, 'Audit', 'headless-instances', 'sonde-adf')
    ])
    expect(bilan.aVerifier.map((v) => v.motif)).toEqual(
      expect.arrayContaining([
        'environnement Python : servi sans être modifié',
        'cache : servi sans être modifié, se retélécharge'
      ])
    )
  })

  it('dans le temporaire de Windows : 30 jours de calme, et jamais le dossier claude', () => {
    fichier(join(ctx.temp, 'Outlook Logging', 'OUTLOOK-1.etl'), 46)
    fichier(join(ctx.temp, 'installeur.msi'), 31)
    fichier(join(ctx.temp, 'recent.txt'), 29)
    fichier(join(ctx.temp, 'claude', 'session', 'vieux.json'), 90)

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats).sort()).toEqual(
      [join(ctx.temp, 'Outlook Logging'), join(ctx.temp, 'installeur.msi')].sort()
    )
  })

  it('un dossier temporaire encore actif rend quand même ses vieux fichiers', () => {
    fichier(join(ctx.temp, 'Outlook Logging', 'OUTLOOK-sept.etl'), 46)
    fichier(join(ctx.temp, 'Outlook Logging', 'OUTLOOK-hier.etl'), 1)

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats)).toEqual([
      join(ctx.temp, 'Outlook Logging', 'OUTLOOK-sept.etl')
    ])
  })

  it('garde un brouillon qui porte une copie git, même enfouie', () => {
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-1332', 'preuve-note-845', '.git', 'HEAD'), 20)
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-1332', 'preuve-note-845', 'note.md'), 20)

    const bilan = inventorier(ctx)

    expect(bilan.candidats).toEqual([])
    expect(bilan.aVerifier).toContainEqual(
      expect.objectContaining({
        chemin: join(ctx.depot, '.autowin-tmp', 'conv-1332'),
        motif: 'copie git : son tri relève de /git'
      })
    )
  })

  it('un brouillon que git liste aussi n’est jugé qu’une fois, par sa propre zone', () => {
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-7', 'a.png'), 10)
    ignores = ['.autowin-tmp/', '.autowin-tmp/conv-7/']

    const bilan = inventorier(ctx)

    expect(bilan.candidats.map((c) => [c.zone, c.chemin])).toEqual([
      ['brouillons', join(ctx.depot, '.autowin-tmp', 'conv-7')]
    ])
  })

  it('les sessions Claude de plus de 30 jours, jamais les identités de claude-accounts', () => {
    const comptes = join(ctx.donnees, 'autowin-os', 'claude-accounts', 'compte-1')
    fichier(join(ctx.home, '.claude', 'projects', 'D--depot', 'a.jsonl'), 40)
    fichier(join(ctx.home, '.claude', 'projects', 'D--depot', 'b.jsonl'), 5)
    fichier(join(comptes, 'projects', 'D--depot', 'c.jsonl'), 31)
    fichier(join(comptes, '.credentials.json'), 200)

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats).sort()).toEqual(
      [
        join(ctx.home, '.claude', 'projects', 'D--depot', 'a.jsonl'),
        join(comptes, 'projects', 'D--depot', 'c.jsonl')
      ].sort()
    )
  })

  it('garde une vieille session qu’un fil du chat reprendra', () => {
    const projet = join(ctx.home, '.claude', 'projects', 'D--depot')
    fichier(join(projet, '6A71CBF9-f0ac-46a2-baa9-a0a4f7c56a55.jsonl'), 60)
    fichier(join(projet, '6a71cbf9-f0ac-46a2-baa9-a0a4f7c56a55', 'subagents', 'x.jsonl'), 60)
    fichier(join(projet, '4b287794-22b3-4a6d-9c60-5530171a35ce.jsonl'), 60)
    fichier(
      join(ctx.donnees, 'autowin-os', 'chat-sessions.json'),
      0,
      JSON.stringify({
        'conv-1': { key: 'claude:opus:default', sessionId: '6a71cbf9-f0ac-46a2-baa9-a0a4f7c56a55' }
      })
    )

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats)).toEqual([
      join(projet, '4b287794-22b3-4a6d-9c60-5530171a35ce.jsonl')
    ])
  })

  it('index des sessions illisible : aucune session jugée, et la sonde le dit', () => {
    fichier(join(ctx.home, '.claude', 'projects', 'D--depot', 'a.jsonl'), 60)
    fichier(join(ctx.donnees, 'autowin-os', 'chat-sessions.json'), 0, '{ tronqué')

    const bilan = inventorier(ctx)

    expect(bilan.candidats).toEqual([])
    expect(bilan.sondesEnEchec).toContainEqual(
      expect.objectContaining({
        zone: 'sessions-claude',
        motif: 'chat-sessions.json illisible : aucune session jugée'
      })
    )
  })

  it('dans le dépôt : les restes ignorés par git, sans les dossiers protégés ni les autres zones', () => {
    fichier(join(ctx.depot, 'electron.vite.config.1793474716496.mjs'), 20)
    fichier(join(ctx.depot, 'node_modules', 'paquet', 'index.js'), 400)
    fichier(join(ctx.depot, 'dist', 'Autowin.exe'), 400)
    fichier(join(ctx.depot, 'brain', 'tooling', 'index', 'x.bin'), 400)
    fichier(join(ctx.depot, 'Audit', 'draft-conv-1114', 'a.png'), 30)
    fichier(join(ctx.depot, 'Audit', 'headless-instances', 'vive', 'Cookies'), 1)
    fichier(join(ctx.depot, 'artifacts', 'vieille.png'), 30)
    fichier(join(ctx.depot, 'artifacts', 'du-jour.png'), 0)
    fichier(join(ctx.depot, 'bench', 'clone', '.git', 'HEAD'), 60)
    ignores = [
      '.autowin-data/',
      '.autowin-tmp/',
      'Audit/',
      'artifacts/',
      'bench/clone/',
      'brain/tooling/index/',
      'dist/',
      'electron.vite.config.1793474716496.mjs',
      'node_modules/',
      'tsconfig.node.tsbuildinfo'
    ]

    const bilan = inventorier(ctx)

    expect(chemins(bilan.candidats).sort()).toEqual(
      [
        join(ctx.depot, 'electron.vite.config.1793474716496.mjs'),
        join(ctx.depot, 'Audit', 'draft-conv-1114'),
        join(ctx.depot, 'artifacts', 'vieille.png')
      ].sort()
    )
    expect(bilan.aVerifier).toContainEqual(
      expect.objectContaining({
        chemin: join(ctx.depot, 'bench', 'clone'),
        motif: 'copie git : son tri relève de /git'
      })
    )
  })

  it('ne suit jamais une jonction, ni pour peser ni pour déplacer', () => {
    const cible = join(poste, 'ailleurs')
    fichier(join(cible, 'precieux.ts'), 90)
    mkdirSync(join(ctx.depot, '.autowin-tmp'), { recursive: true })
    symlinkSync(cible, join(ctx.depot, '.autowin-tmp', 'lien'), 'junction')

    const bilan = inventorier(ctx)

    expect(bilan.candidats).toEqual([])
  })

  it('git illisible : aucun reste du dépôt jugé, et la sonde le dit', () => {
    fichier(join(ctx.depot, 'vieux.log'), 90)
    ctx.ignoresGit = () => null

    const bilan = inventorier(ctx)

    expect(bilan.candidats).toEqual([])
    expect(bilan.sondesEnEchec).toContainEqual(
      expect.objectContaining({
        zone: 'restes-du-depot',
        motif: 'git illisible : aucun reste jugé'
      })
    )
  })
})

describe('inventorier — ce qui grossit et ce qui pèse', () => {
  it('signale un tas qui a grossi depuis la passe d’avant, même sans règle pour lui', () => {
    fichier(join(ctx.donnees, 'autowin-os', 'chat-artifacts', 'a.png'), 1, 'xx')
    inventorier(ctx)
    fichier(join(ctx.donnees, 'autowin-os', 'chat-artifacts', 'b.mp4'), 0, 'x'.repeat(10))

    const bilan = inventorier(ctx)

    expect(bilan.croissance).toEqual([
      expect.objectContaining({
        zone: 'donnees-autowin',
        chemin: join(ctx.donnees, 'autowin-os', 'chat-artifacts'),
        avant: 2,
        apres: 12
      })
    ])
    expect(existsSync(join(ctx.donnees, 'autowin-os', 'gc-inventaire.json'))).toBe(true)
  })

  it('pèse par type, sans compter deux fois une zone logée dans une autre', () => {
    const comptes = join(ctx.donnees, 'autowin-os', 'claude-accounts', 'compte-1')
    fichier(join(comptes, 'projects', 'p', 's.jsonl'), 1, 'x'.repeat(7))
    fichier(join(ctx.donnees, 'autowin-os', 'runs', 'RUN.md'), 1, 'x'.repeat(3))

    const bilan = inventorier(ctx)
    const zone = (id) => bilan.zones.find((z) => z.id === id)

    expect(zone('sessions-claude').familles).toEqual({ journal: 7 })
    expect(zone('donnees-autowin').familles).toEqual({ texte: 3 })
  })

  it('signale la place qu’un disque perd hors de toute zone suivie', () => {
    // Passe du 15/11 : D: avait perdu 13 Go en un jour, dans des copies d'agents posées à la racine
    // du disque, que le ménage ne pesait pas.
    const disque = parse(resolve(ctx.donnees)).root.toUpperCase()
    const espace = (libre) => [{ disque, libre, total: 1000 }]
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-1', 'a.txt'), 1, 'xxx')
    inventorier({ ...ctx, disques: espace(100) })
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-1', 'b.txt'), 1, 'xxxx')

    const bilan = inventorier({ ...ctx, disques: espace(80), seuilPerteHorsZones: 10 })

    expect(bilan.aVerifier).toContainEqual(
      expect.objectContaining({ chemin: disque, taille: 16, perdu: 20, prisParLesZones: 4 })
    )
  })

  it('nomme les gros fichiers écrits hors des zones, puis dit de combien ils ont grossi', () => {
    // Passe du 20/11 : C: avait perdu 16,8 Go en un jour, dont 12,8 hors des zones. Le cache mail de
    // Kerio (12,5 Go) et le disque de Docker (6,5 Go), dans AppData\Local, ont été trouvés à la main.
    const disque = parse(resolve(ctx.home)).root.toUpperCase()
    const espace = (libre) => [{ disque, libre, total: 1000 }]
    fichier(join(ctx.home, 'AppData', 'Local', 'Ancien', 'archive.bin'), 10, 'x'.repeat(40))
    inventorier({ ...ctx, disques: espace(100) })
    const cache = join(ctx.home, 'AppData', 'Local', 'Kerio', 'cache.FDB')
    fichier(cache, 0, 'x'.repeat(30))
    fichier(join(ctx.home, 'AppData', 'Local', 'Kerio', 'debug.log'), 0, 'x')
    // Pesé par sa zone : ni compté hors des zones, ni suspect.
    fichier(join(ctx.home, 'Downloads', 'installeur.exe'), 0, 'x'.repeat(50))

    const bilan = inventorier({ ...ctx, disques: espace(20), seuilPerteHorsZones: 10 })

    expect(bilan.aVerifier.find((v) => v.chemin === disque)?.suspects).toEqual([
      expect.objectContaining({ chemin: cache, taille: 30 })
    ])
    fichier(cache, 0, 'x'.repeat(45))
    const lendemain = inventorier({ ...ctx, disques: espace(5), seuilPerteHorsZones: 10 })
    expect(lendemain.croissance).toContainEqual(
      expect.objectContaining({ zone: 'temoin', chemin: cache, avant: 30, apres: 45 })
    )
    // Sa croissance explique la place perdue : pas de nouvelle alerte, ni de nouvelle recherche.
    expect(lendemain.aVerifier.filter((v) => v.chemin === disque)).toEqual([])
  })

  it('ne signale rien quand les zones expliquent la place perdue, ni quand un balayage les vide', () => {
    const disque = parse(resolve(ctx.donnees)).root.toUpperCase()
    const espace = (libre) => [{ disque, libre, total: 1000 }]
    const gros = join(ctx.depot, '.autowin-tmp', 'conv-1', 'a.txt')
    fichier(gros, 1, 'x'.repeat(30))
    inventorier({ ...ctx, disques: espace(100) })
    fichier(join(ctx.depot, '.autowin-tmp', 'conv-1', 'b.txt'), 1, 'x'.repeat(20))
    const expliquee = inventorier({ ...ctx, disques: espace(80), seuilPerteHorsZones: 10 })
    // Un balayage déplace hors des zones sans rendre de place : la zone fond, le disque ne bouge pas.
    rmSync(gros)
    const balayee = inventorier({ ...ctx, disques: espace(80), seuilPerteHorsZones: 10 })

    for (const bilan of [expliquee, balayee])
      expect(bilan.aVerifier.filter((v) => v.chemin === disque)).toEqual([])
  })

  it('ne dit « sans règle » que d’un tas lourd qu’aucune autre passe du /gc ne juge', () => {
    // Passes du 11 au 13/11 : la corbeille, runs/ et chat-artifacts/ revenaient chaque jour à côté
    // du seul vrai tas sans règle (quartier-3d).
    fichier(join(ctx.donnees, 'gc-corbeille', '2026-11-01', 'MANIFEST.txt'), 1, 'xx')
    fichier(join(ctx.donnees, 'tmp', 'a.txt'), 1, 'xx')
    for (const dossier of ['runs', 'chat-artifacts', 'run-stdout', 'cause-en-cours'])
      fichier(join(ctx.donnees, 'autowin-os', dossier, 'a.txt'), 1, 'xx')
    fichier(join(ctx.donnees, 'quartier-3d', 'travail', 'rendu.png'), 1, 'xx')
    fichier(join(ctx.donnees, 'autowin-os', 'tmp', 'a.txt'), 1, 'xx')

    const bilan = inventorier(ctx)
    const sansRegle = bilan.aVerifier.filter((v) => v.motif.includes('aucune règle'))

    expect(chemins(sansRegle).sort()).toEqual(
      [join(ctx.donnees, 'autowin-os', 'tmp'), join(ctx.donnees, 'quartier-3d')].sort()
    )
  })
})

describe('balayer', () => {
  it('déplace dans la corbeille du disque avec sa ligne de manifeste, et ne supprime rien', () => {
    const brouillon = join(ctx.depot, '.autowin-tmp', 'conv-1')
    fichier(join(brouillon, 'rendu.png'), 10, 'image')
    const { candidats } = inventorier(ctx)

    const balayage = balayer(candidats, ctx)

    expect(existsSync(brouillon)).toBe(false)
    expect(balayage.deplaces).toHaveLength(1)
    const arrivee = balayage.deplaces[0].vers
    expect(readFileSync(join(arrivee, 'rendu.png'), 'utf8')).toBe('image')
    expect(arrivee.startsWith(join(ctx.donnees, 'gc-corbeille', '2026-11-07'))).toBe(true)
    const manifeste = readFileSync(
      join(ctx.donnees, 'gc-corbeille', '2026-11-07', 'MANIFEST.txt'),
      'utf8'
    )
    expect(manifeste).toContain(brouillon)
    expect(manifeste).toContain('brouillons : rien de modifié depuis 10 j (seuil 7 j)')
  })

  it('dit pour chaque corbeille si la purge supprimera sans demander', () => {
    ctx.localAppData = join(poste, 'Local')
    fichier(join(ctx.donnees, 'autowin-os', 'gc-purge-auto.json'), 0, '\uFEFF{"enabled": true}')
    fichier(
      join(poste, 'Local', 'autowin-gc', 'autowin-os', 'gc-purge-auto.json'),
      0,
      '{"enabled": "oui"}'
    )

    expect(corbeillesConnues(ctx).map((c) => c.accordDonne)).toEqual([true, false])
  })

  it('laisse en place un reste dont le disque n’a pas de corbeille', () => {
    const ailleurs = { ...ctx, donnees: 'Q:\\donnees', localAppData: undefined }
    expect(corbeilleDuDisque('C:\\Temp\\x', ailleurs)).toBeNull()
    expect(
      corbeilleDuDisque('C:\\Temp\\x', {
        ...ailleurs,
        localAppData: 'C:\\Users\\u\\AppData\\Local'
      })
    ).toBe(join('C:\\Users\\u\\AppData\\Local', 'autowin-gc', 'gc-corbeille'))

    const balayage = balayer(
      [{ chemin: 'R:\\perdu', taille: 1, zone: 'temp-windows', motif: 'x' }],
      ailleurs
    )

    expect(balayage.echecs).toEqual([
      { chemin: 'R:\\perdu', motif: 'aucune corbeille sur ce disque : laissé en place' }
    ])
  })
})

describe('outils', () => {
  it('range les fichiers par type', () => {
    expect(familleDe('a.PNG')).toBe('image')
    expect(familleDe('b.mp4')).toBe('video-son')
    expect(familleDe('c.md')).toBe('texte')
    expect(familleDe('d.ps1')).toBe('script')
    expect(familleDe('e.etl')).toBe('journal')
    expect(familleDe('Cookies')).toBe('cache-sans-extension')
  })

  it('protège les dossiers construits ou propres du dépôt', () => {
    for (const rel of [
      'dist/',
      'out/',
      'node_modules/',
      'src/node_modules/',
      'entreprise/',
      'brain/x/',
      '.env.local'
    ])
      expect(protegeDuDepot(rel)).toBe(true)
    for (const rel of [
      'artifacts/',
      '.arena/banc-roblox/',
      'electron.vite.config.1.mjs',
      'scripts/__pycache__/'
    ])
      expect(protegeDuDepot(rel)).toBe(false)
  })

  it('depuis une copie de travail logée dans .autowin-data, vise le dépôt qui la porte', () => {
    const copie = join(
      'D:\\AutoWinOS',
      '.autowin-data',
      'autowin-os',
      'retours-de-tour',
      'essai',
      'scripts'
    )
    expect(depotEtDonnees(copie)).toEqual({
      depot: 'D:\\AutoWinOS',
      donnees: join('D:\\AutoWinOS', '.autowin-data')
    })
    expect(depotEtDonnees('D:\\AutoWinOS\\scripts').depot).toBe(join('D:\\AutoWinOS'))
  })

  it('refuse une option inconnue avec le code 2', () => {
    const sortie = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--supprimer'], {
      encoding: 'utf8'
    })
    expect(sortie.status).toBe(2)
  })
})
