#!/usr/bin/env node
/**
 * Mesure les 6 bras du banc /arena SUR ARTEFACTS : je rejoue moi-meme chaque critere dans la
 * copie du bras, je lis cout/duree/tours dans son `out-<bras>.json`, et j'ecris son diff.
 * Aucune valeur ne vient du RAPPORT du bras.
 * Usage : node mesure.mjs   ->  tableau + .arena/mesures.json
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARENA = path.resolve(import.meta.dirname)
const BASE = 'C:/Sources/AutoWinOS/.autowin-data/autowin-os/worktrees/arena-6bras'
const BANCS = ['banc-watch', 'banc-couleurs', 'banc-garde-binaire']
const WF = { a: 'kit complet scout→frame→terrain→build→clean→judge', b: 'build direct + verification ciblee' }

const lignes = []
for (const banc of BANCS) {
  for (const bras of ['a', 'b']) {
    const copie = `${BASE}/${banc}-${bras}`
    const critere = spawnSync(process.execPath, [path.join(ARENA, banc, 'check.mjs'), copie], {
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 20 * 1024 * 1024
    })
    writeFileSync(path.join(ARENA, banc, `critere-${bras}.txt`), String(critere.stdout || '') + String(critere.stderr || ''))
    const diff = spawnSync('git', ['-C', copie, 'diff'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
    writeFileSync(path.join(ARENA, banc, `diff-${bras}.txt`), diff.stdout || '')
    const fichiers = spawnSync('git', ['-C', copie, 'diff', '--name-only'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)
    const nonSuivis = spawnSync('git', ['-C', copie, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim().split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3))
    const brut = path.join(ARENA, banc, `out-${bras}.json`)
    let json = null
    try { json = JSON.parse(readFileSync(brut, 'utf8')) } catch { json = null }
    const statut = existsSync(path.join(ARENA, banc, 'statut.txt')) ? readFileSync(path.join(ARENA, banc, 'statut.txt'), 'utf8') : ''
    const wall = (statut.split('\n').find((l) => l.startsWith(bras + ' ')) || '').match(/wall=(\d+)s/)
    lignes.push({
      banc,
      bras,
      workflow: WF[bras],
      critereExit: critere.status,
      critereAtteint: critere.status === 0,
      assertionsRatees: (String(critere.stdout || '').match(/^RATE/gm) || []).length,
      coutUsd: json?.total_cost_usd ?? null,
      dureeMs: json?.duration_ms ?? (wall ? Number(wall[1]) * 1000 : null),
      tours: json?.num_turns ?? null,
      erreurClaude: json?.is_error ?? null,
      fichiersTouches: fichiers,
      nonSuivis,
      testsTouches: fichiers.filter((f) => /test|check\.mjs|\.spec\./i.test(f))
    })
  }
}
writeFileSync(path.join(ARENA, 'mesures.json'), JSON.stringify(lignes, null, 2))
const fmt = (l) =>
  `${l.banc.padEnd(19)} ${l.bras}  critere=${l.critereAtteint ? 'ATTEINT' : 'RATE   '} (exit ${l.critereExit}, ${l.assertionsRatees} ratees)  cout=${l.coutUsd ?? '?'}  duree=${l.dureeMs ?? '?'}ms  tours=${l.tours ?? '?'}  fichiers=${l.fichiersTouches.length}${l.testsTouches.length ? `  TESTS TOUCHES: ${l.testsTouches.join(',')}` : ''}`
for (const l of lignes) console.log(fmt(l))
