import { describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  archiverCartes,
  carteArchivee,
  lireArchive,
  lireCarteArchivee,
  pluginArchiveCartesGels,
  reprendreVerrouOrphelin
} from './gels-cartes-archive.mjs'
import { classerGels, rendreClassement, resoudreAppelant } from './gels-classement.mjs'

/*
 * Cas fondateur (conv-1055) : le gel du 2026-10-21 à 20:14 citait
 * `chunks/worktree-manager-HqcvLEtO.js`, et `out/main/chunks/` ne contenait plus que `CmgMSe9l`.
 * Ici, un bundle factice reconstruit APRÈS le gel : sans archive, la source est perdue.
 */
const carteVers = (source) =>
  JSON.stringify({ version: 3, sources: [source], names: [], mappings: 'AAAA' })

function construire(racine, { source, morceau = 'worktree-manager-AAAA1111', a }) {
  const main = join(racine, 'main')
  mkdirSync(join(main, 'chunks'), { recursive: true })
  const fichiers = [
    [join(main, 'index.js'), carteVers(`../../src/main/${source}-index.ts`)],
    [join(main, 'chunks', `${morceau}.js`), carteVers(`../../src/main/${source}-morceau.ts`)]
  ]
  for (const [js, carte] of fichiers) {
    writeFileSync(js, '// bundle\n')
    writeFileSync(`${js}.map`, carte)
    utimesSync(js, a, a)
    utimesSync(`${js}.map`, a, a)
  }
  return main
}

const dossiers = () => {
  const racine = mkdtempSync(join(tmpdir(), 'gels-cartes-'))
  return { out: join(racine, 'out'), archive: join(racine, 'gels-cartes') }
}

describe('archiverCartes — garder les cartes de chaque construction', () => {
  it('archive chaque carte sous son empreinte, datée par l’écriture du bundle', () => {
    const { out, archive } = dossiers()
    const a = new Date('2026-10-21T07:00:00Z')
    const main = construire(out, { source: 'v1', a })

    const r = archiverCartes({
      dossierMain: main,
      dossierArchive: archive,
      maintenantMs: a.valueOf()
    })

    expect(r).toEqual({ cartes: 2, nouvelles: 2, supprimees: 0 })
    const [entree] = lireArchive(archive)
    expect(entree.construitMs).toBe(a.valueOf())
    expect(Object.keys(entree.fichiers).sort()).toEqual([
      'chunks/worktree-manager-AAAA1111.js',
      'main/index.js'
    ])
    expect(lireCarteArchivee(archive, entree.fichiers['main/index.js']).sources).toEqual([
      '../../src/main/v1-index.ts'
    ])
  })

  it('une carte inchangée d’une construction à l’autre n’est stockée qu’une fois', () => {
    const { out, archive } = dossiers()
    const main = construire(out, { source: 'v1', a: new Date('2026-10-21T07:00:00Z') })
    archiverCartes({
      dossierMain: main,
      dossierArchive: archive,
      maintenantMs: Date.parse('2026-10-21T08:00:00Z')
    })
    construire(out, { source: 'v1', a: new Date('2026-10-21T09:00:00Z') })

    const r = archiverCartes({
      dossierMain: main,
      dossierArchive: archive,
      maintenantMs: Date.parse('2026-10-21T10:00:00Z')
    })

    expect(r.nouvelles).toBe(0)
    expect(lireArchive(archive)).toHaveLength(2)
    expect(readdirSync(archive).filter((n) => n.endsWith('.map.gz'))).toHaveLength(2)
  })

  it('rétention bornée : la plus vieille construction part, et ses cartes avec elle', () => {
    const { out, archive } = dossiers()
    const main = join(out, 'main')
    for (const [i, heure] of ['05', '06', '07'].entries()) {
      construire(out, {
        source: `v${i}`,
        morceau: `m-${i}`,
        a: new Date(`2026-10-21T${heure}:00:00Z`)
      })
      archiverCartes({
        dossierMain: main,
        dossierArchive: archive,
        maintenantMs: Date.parse('2026-10-21T08:00:00Z'),
        garderMax: 2
      })
    }
    const entrees = lireArchive(archive)
    expect(entrees.map((e) => new Date(e.construitMs).toISOString())).toEqual([
      '2026-10-21T06:00:00.000Z',
      '2026-10-21T07:00:00.000Z'
    ])
    const citees = new Set(entrees.flatMap((e) => Object.values(e.fichiers)))
    const restantes = readdirSync(archive)
      .filter((n) => n.endsWith('.map.gz'))
      .map((n) => n.replace('.map.gz', ''))
    expect(new Set(restantes)).toEqual(citees)
  })

  it('reprend le verrou ORPHELIN d’une construction tuée, puis le rend', () => {
    const { out, archive } = dossiers()
    const main = construire(out, { source: 'v1', a: new Date('2026-10-21T07:00:00Z') })
    mkdirSync(archive, { recursive: true })
    writeFileSync(join(archive, 'index.lock'), '')
    const ilYaDeuxMinutes = new Date(Date.now() - 120_000)
    utimesSync(join(archive, 'index.lock'), ilYaDeuxMinutes, ilYaDeuxMinutes)

    archiverCartes({ dossierMain: main, dossierArchive: archive })

    expect(lireArchive(archive)).toHaveLength(1)
    expect(existsSync(join(archive, 'index.lock'))).toBe(false)
  })

  /*
   * La course de la seconde revue (conv-1055) : B a vu l'orphelin, mais A l'a déjà retiré et posé
   * SON verrou quand B passe à l'acte. B tombe donc sur un verrou RÉCENT : il ne doit pas l'effacer.
   */
  it('ne vole pas un verrou VIVANT posé entre la lecture de sa date et sa reprise', () => {
    const { archive } = dossiers()
    mkdirSync(archive, { recursive: true })
    const verrou = join(archive, 'index.lock')
    writeFileSync(verrou, '')

    expect(reprendreVerrouOrphelin(verrou)).toBe(false)

    expect(existsSync(verrou)).toBe(true)
    expect(readdirSync(archive)).toEqual(['index.lock'])
  })

  it('retire un verrou vraiment ORPHELIN sans laisser sa copie déplacée', () => {
    const { archive } = dossiers()
    mkdirSync(archive, { recursive: true })
    const verrou = join(archive, 'index.lock')
    writeFileSync(verrou, '')
    const ilYaDeuxMinutes = new Date(Date.now() - 120_000)
    utimesSync(verrou, ilYaDeuxMinutes, ilYaDeuxMinutes)

    expect(reprendreVerrouOrphelin(verrou)).toBe(true)

    expect(readdirSync(archive)).toEqual([])
  })

  it('un dossier sans carte ne crée rien', () => {
    const { out, archive } = dossiers()
    expect(archiverCartes({ dossierMain: join(out, 'main'), dossierArchive: archive })).toEqual({
      cartes: 0,
      nouvelles: 0,
      supprimees: 0
    })
    expect(existsSync(archive)).toBe(false)
  })
})

describe('pluginArchiveCartesGels — seul le bundle que l’app charge est archivé', () => {
  const contexte = {
    warn: (m) => {
      throw new Error(m)
    }
  }

  it('archive la sortie out/main de la racine', () => {
    const racine = mkdtempSync(join(tmpdir(), 'gels-plugin-'))
    const main = construire(join(racine, 'out'), {
      source: 'v1',
      a: new Date('2026-10-21T07:00:00Z')
    })
    const archive = join(racine, 'archive')
    pluginArchiveCartesGels({ racine, dossierArchive: archive }).writeBundle.call(contexte, {
      dir: main
    })
    expect(lireArchive(archive)).toHaveLength(1)
  })

  it('n’archive PAS une construction écrite ailleurs (--outDir) : elle n’a jamais tourné', () => {
    const racine = mkdtempSync(join(tmpdir(), 'gels-plugin-'))
    const ailleurs = construire(join(racine, 'autre-sortie'), { source: 'v1', a: new Date() })
    const archive = join(racine, 'archive')
    pluginArchiveCartesGels({ racine, dossierArchive: archive }).writeBundle.call(contexte, {
      dir: ailleurs
    })
    expect(existsSync(archive)).toBe(false)
  })
})

describe('carteArchivee — le code qui TOURNAIT au chargement', () => {
  const entrees = [
    { construitMs: 100, fichiers: { 'main/index.js': 'aaa', 'chunks/x.js': 'xxx' } },
    { construitMs: 200, fichiers: { 'main/index.js': 'bbb' } }
  ]

  it('prend la dernière construction écrite au plus tard au chargement', () => {
    expect(carteArchivee(entrees, 'main/index.js', 150)).toEqual({
      empreinte: 'aaa',
      construitMs: 100
    })
    expect(carteArchivee(entrees, 'main/index.js', 200)).toEqual({
      empreinte: 'bbb',
      construitMs: 200
    })
  })

  it('ne remonte pas à une construction plus ancienne pour un morceau absent de celle qui tournait', () => {
    expect(carteArchivee(entrees, 'chunks/x.js', 250)).toBeUndefined()
  })

  it('rien avant la première construction archivée, ni sans instant', () => {
    expect(carteArchivee(entrees, 'main/index.js', 50)).toBeUndefined()
    expect(carteArchivee(entrees, 'main/index.js', undefined)).toBeUndefined()
  })
})

describe('gels-classement + archive — un gel ancien garde sa source après reconstruction', () => {
  const GEL = '2026-10-21T20:14:30.651Z'
  const DEMARRAGE = Date.parse('2026-10-21T14:27:34.195Z')

  const prepare = () => {
    const { out, archive } = dossiers()
    // Construction chargée par le démarrage de 14:27, archivée par le build.
    const main = construire(out, {
      source: 'charge',
      morceau: 'worktree-manager-HqcvLEtO',
      a: new Date('2026-10-21T14:20:00Z')
    })
    archiverCartes({
      dossierMain: main,
      dossierArchive: archive,
      maintenantMs: Date.parse('2026-10-21T14:21:00Z')
    })
    // Reconstruction le lendemain : `index.js.map` réécrit sous le même nom, morceau renommé.
    rmMorceau(main, 'worktree-manager-HqcvLEtO')
    construire(out, {
      source: 'reconstruit',
      morceau: 'worktree-manager-CmgMSe9l',
      a: new Date('2026-10-22T07:10:00Z')
    })
    archiverCartes({
      dossierMain: main,
      dossierArchive: archive,
      maintenantMs: Date.parse('2026-10-22T07:11:00Z')
    })
    return { out, archive }
  }

  it('remonte le morceau disparu ET index.js réécrit vers la construction qui tournait', () => {
    const { out, archive } = prepare()
    const r = resoudreAppelant('main/index.js:1:1 < chunks/worktree-manager-HqcvLEtO.js:1:1', {
      racineOut: out,
      gelTs: GEL,
      demarrageMs: DEMARRAGE,
      archive: { dossier: archive, entrees: lireArchive(archive) }
    })
    expect(r).toEqual({
      sources: ['src/main/charge-index.ts:1', 'src/main/charge-morceau.ts:1'],
      carte: 'archivee'
    })
  })

  it('sans archive, le même gel reste « (non résolu) » — le défaut d’origine', () => {
    const { out } = prepare()
    const r = resoudreAppelant('main/index.js:1:1 < chunks/worktree-manager-HqcvLEtO.js:1:1', {
      racineOut: out,
      gelTs: GEL,
      demarrageMs: DEMARRAGE
    })
    expect(r.carte).toBe('posterieure-au-gel')
  })

  it('sans démarrage connu, l’archive n’est PAS consultée : rien ne prouve que le code a tourné', () => {
    const { out, archive } = prepare()
    const r = resoudreAppelant('main/index.js:1:1', {
      racineOut: out,
      gelTs: GEL,
      archive: { dossier: archive, entrees: lireArchive(archive) }
    })
    expect(r.carte).toBe('posterieure-au-gel')
  })

  it('le classement rendu affiche la source et la carte archivée', () => {
    const { out, archive } = prepare()
    const gel = {
      ts: GEL,
      blocageMs: 94730,
      operation: 'execFileSync git status',
      cause: 'entree-sortie-bloquante',
      accumulation: [
        {
          operation: 'execFileSync git status',
          cumulMs: 60147,
          appels: 1,
          appelant: 'main/index.js:1:1 < chunks/worktree-manager-HqcvLEtO.js:1:1'
        }
      ]
    }
    const demarrage = {
      ts: '2026-10-21T14:27:34.195Z',
      blocageMs: 0,
      operation: 'detecteur:demarre',
      temoin: 'demarrage'
    }
    const texte = rendreClassement(classerGels([demarrage, gel]), {
      racineOut: out,
      archive: { dossier: archive, entrees: lireArchive(archive) }
    })
    expect(texte).toContain('`src/main/charge-index.ts:1` < `src/main/charge-morceau.ts:1`')
    expect(texte).toContain('| archivee |')
    expect(texte).not.toContain('(non résolu)')
  })
})

function rmMorceau(main, nom) {
  for (const f of [`${nom}.js`, `${nom}.js.map`]) rmSync(join(main, 'chunks', f), { force: true })
}
