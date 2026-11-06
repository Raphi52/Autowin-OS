import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  analyserGel,
  condenser,
  lireProfils,
  nommerGelsParProfil,
  profilDuGel
} from './gels-profils.mjs'
import { principal } from './gels-classement.mjs'

const BUNDLE = 'file:///D:/AutoWinOS/out/main/index.js'

/*
 * Forme du gel réel du 2026-11-06 (27,6 s, profil pris par l'inspecteur) : la boucle porte 60 % du
 * temps propre, ses deux petites fonctions 30 %, le ramasse-miettes 10 %. Toutes passent par elle.
 */
function profilDuGelReel({ sansLigneSurLaBoucle = false } = {}) {
  const cf = (functionName, lineNumber, url = BUNDLE) => ({
    functionName,
    scriptId: '1',
    url,
    lineNumber,
    columnNumber: 0
  })
  const nodes = [
    { id: 1, callFrame: cf('(root)', -1, ''), children: [2, 6] },
    { id: 2, callFrame: cf('lireProprietairesDeFichiers', 57340), children: [3] },
    { id: 3, callFrame: cf('readCurrentPathOwners', 29389), children: [4] },
    {
      id: 4,
      // Boucle compilée avant le profileur : ni nom ni ligne (mesuré avec l'OSR de V8).
      callFrame: sansLigneSurLaBoucle ? cf('', -1) : cf('readCurrentPathGenerations', 29300),
      children: [5]
    },
    { id: 5, callFrame: cf('normalizedStoredPath', 29046) },
    { id: 6, callFrame: cf('(garbage collector)', -1, '') }
  ]
  const samples = [...Array(60).fill(4), ...Array(30).fill(5), ...Array(10).fill(6)]
  return { nodes, startTime: 0, endTime: 1e6, samples, timeDeltas: samples.map(() => 10_000) }
}

function dossierDeProfils(entrees) {
  const dir = mkdtempSync(join(tmpdir(), 'gels-profils-'))
  const dossier = join(dir, 'gels-profils')
  mkdirSync(dossier)
  for (const { ligne, profil, piles } of entrees) {
    writeFileSync(join(dossier, ligne.fichier), JSON.stringify(profil))
    if (piles) writeFileSync(join(dossier, ligne.piles), JSON.stringify({ piles }))
  }
  writeFileSync(
    join(dossier, 'index.jsonl'),
    entrees.map((e) => JSON.stringify(e.ligne)).join('\n') + '\nligne abîmée\n'
  )
  return { dir, dossier }
}

const GEL = { ts: '2026-11-06T09:45:01.000Z', blocageMs: 1000, operation: 'inconnu' }
const LIGNE = {
  schema: 'autowin.gel-profil/v1',
  debut: '2026-11-06T09:45:00.000Z',
  fin: '2026-11-06T09:45:01.000Z',
  fichier: 'p.cpuprofile'
}

describe('condenser — la forme des frames du journal', () => {
  it('ramène un chemin Windows ou une URL du bundle à main/… ou chunks/…', () => {
    expect(condenser('D:\\AutoWinOS\\out\\main\\index.js', 3, 4)).toBe('main/index.js:3:4')
    expect(condenser('file:///D:/AutoWinOS/out/main/chunks/x-1.js', 1, 2)).toBe('chunks/x-1.js:1:2')
    expect(condenser('node:internal/timers', 5, 6)).toBe('node:internal/timers:5:6')
  })
})

describe('profilDuGel — rapprochement par l heure', () => {
  const profils = [
    { debutMs: Date.parse('2026-11-06T09:44:00Z'), finMs: Date.parse('2026-11-06T09:44:30Z') },
    { debutMs: Date.parse('2026-11-06T09:44:55Z'), finMs: Date.parse('2026-11-06T09:45:02Z') }
  ]
  it('prend le profil qui couvre le gel', () => {
    expect(profilDuGel(GEL, profils)).toBe(profils[1])
  })
  it('refuse un profil qui ne voit que la queue du gel : il nommerait ce qui a suivi', () => {
    const queue = [
      { debutMs: Date.parse('2026-11-06T09:45:00.900Z'), finMs: Date.parse('2026-11-06T09:45:05Z') }
    ]
    expect(profilDuGel(GEL, queue)).toBeUndefined()
  })
})

describe('analyserGel — la fonction qui tenait la fenêtre', () => {
  it('nomme la fonction la plus profonde présente dans la majorité, pas la pile exacte la plus fréquente', () => {
    const { dossier } = dossierDeProfils([{ ligne: LIGNE, profil: profilDuGelReel() }])
    const [entree] = lireProfils(dossier)
    const analyse = analyserGel(GEL, entree)
    expect(analyse.source).toBe('profil')
    expect(analyse.fonction).toBe('readCurrentPathGenerations')
    // 60 + 30 échantillons passent par elle, sur 100 : le ramasse-miettes n'est pas du code.
    expect(analyse.part).toBeCloseTo(0.9)
    expect(analyse.appelant).toBe(
      'main/index.js:29301:1 < main/index.js:29390:1 < main/index.js:57341:1'
    )
    expect(analyse.profil.ramasseMiettes).toBeCloseTo(0.1)
    expect(analyse.profil.tete[0].fonction).toBe('readCurrentPathGenerations main/index.js:29301:1')
  })

  it('profil seul et boucle sans ligne : retombe sur l appelant nommé, jamais sur une frame vide', () => {
    const { dossier } = dossierDeProfils([
      { ligne: LIGNE, profil: profilDuGelReel({ sansLigneSurLaBoucle: true }) }
    ])
    const analyse = analyserGel(GEL, lireProfils(dossier)[0])
    expect(analyse.fonction).toBe('readCurrentPathOwners')
    expect(analyse.appelant.startsWith('main/index.js:29390:1')).toBe(true)
  })

  it('les relevés de pile priment : ils nomment la boucle que le profil laisse sans nom', () => {
    // Deux sous-appels à 25 % chacun : une égalité qui ne doit nommer ni l'un ni l'autre.
    const pile = (feuille, ligne) => ({
      a: '2026-11-06T09:45:00.500Z',
      frames: [
        ...(feuille ? [`${feuille} D:\\AutoWinOS\\out\\main\\index.js:${ligne}:3`] : []),
        'readCurrentPathGenerations D:\\AutoWinOS\\out\\main\\index.js:29320:9',
        'readCurrentPathOwners D:\\AutoWinOS\\out\\main\\index.js:29392:5',
        'lireProprietairesDeFichiers D:\\AutoWinOS\\out\\main\\index.js:57345:2',
        'processTicksAndRejections node:internal/process/task_queues:105:5'
      ]
    })
    const piles = [
      pile(),
      pile(),
      pile('workspaceTracePathKey', 29050),
      pile('normalizedStoredPath', 29047)
    ]
    const { dossier } = dossierDeProfils([
      {
        ligne: { ...LIGNE, piles: 'p.piles.json' },
        profil: profilDuGelReel({ sansLigneSurLaBoucle: true }),
        piles
      }
    ])
    const analyse = analyserGel(GEL, lireProfils(dossier)[0])
    expect(analyse.source).toBe('piles')
    expect(analyse.releves).toBe(4)
    expect(analyse.fonction).toBe('readCurrentPathGenerations')
    expect(analyse.part).toBe(1)
    expect(analyse.appelant).toBe(
      'main/index.js:29320:9 < main/index.js:29392:5 < main/index.js:57345:2'
    )
  })
})

describe('classement — un gel « inconnu » prend le nom de sa fonction', () => {
  it('le journal à côté de gels-profils/ rend la section et renomme l opération', () => {
    const { dir } = dossierDeProfils([{ ligne: LIGNE, profil: profilDuGelReel() }])
    writeFileSync(
      join(dir, 'gels.jsonl'),
      JSON.stringify({ ...GEL, blocageMs: 12_000, ts: '2026-11-06T09:45:01Z' }) + '\n'
    )
    // Le profil couvre la dernière seconde d'un gel de 12 s : moins d'un tiers, il ne nomme rien.
    const sansNom = []
    principal(
      ['--journal', join(dir, 'gels.jsonl'), '--depuis', '2026-11-06T00:00:00Z', '--out', dir],
      (l) => sansNom.push(l)
    )
    expect(sansNom.join('\n')).not.toContain('profil: ')

    writeFileSync(join(dir, 'gels.jsonl'), JSON.stringify({ ...GEL, blocageMs: 10_000 }) + '\n')
    writeFileSync(
      join(dir, 'gels-profils', 'index.jsonl'),
      JSON.stringify({ ...LIGNE, debut: '2026-11-06T09:44:51.000Z' }) + '\n'
    )
    const lignes = []
    const code = principal(
      ['--journal', join(dir, 'gels.jsonl'), '--depuis', '2026-11-06T00:00:00Z', '--out', dir],
      (l) => lignes.push(l)
    )
    const texte = lignes.join('\n')
    expect(code).toBe(0)
    expect(texte).toContain('| `profil: readCurrentPathGenerations` | 1 |')
    expect(texte).toContain('### Gels longs — la fonction qui tenait la fenêtre (profil CPU)')
    // Sans carte à côté du bundle de test, la source le DIT au lieu d'inventer une ligne.
    expect(texte).toContain('(carte absente)')
  })

  it('un gel court n est pas rapproché : seuls les gels de 10 s et plus ont un profil', () => {
    const profils = [
      { debutMs: Date.parse(LIGNE.debut), finMs: Date.parse(LIGNE.fin), fichier: 'x', dossier: '.' }
    ]
    expect(nommerGelsParProfil([GEL], profils)).toEqual([])
  })
})
