import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifierProtocole } from './arena-protocole-check.mjs'

const ARMS = ['a', 'b', 'c', 'x']

/** Banc de reference CONFORME au protocole de skills/arena/SKILL.md. */
function bancConforme() {
  const racine = mkdtempSync(join(tmpdir(), 'arena-proto-'))
  const bench = join(racine, 'arena-bench')
  const copies = join(racine, 'worktrees-arena')
  mkdirSync(bench, { recursive: true })

  const tache = 'TACHE (identique pour tous) :\najoute --depuis a scripts/scout-rendement.mjs\n'
  writeFileSync(join(bench, 'tache.txt'), tache)
  const couts = { a: 0.6365555, b: 0.3490945, c: 0.52714, x: 0.506905 }
  for (const bras of ARMS) {
    writeFileSync(join(bench, `prompt-${bras}.txt`), `${tache}\nWORKFLOW IMPOSE (${bras}) : ...\n`)
    writeFileSync(
      join(bench, `out-${bras}.json`),
      JSON.stringify({ session_id: `sess-${bras}`, total_cost_usd: couts[bras], num_turns: 13 })
    )
  }
  writeFileSync(
    join(bench, 'out-judge.json'),
    JSON.stringify({ session_id: 'sess-judge', total_cost_usd: 0.515 })
  )
  writeFileSync(
    join(bench, 'lance.sh'),
    [
      '#!/bin/sh',
      `W="${copies}"`,
      'for a in a b c x; do',
      '  (',
      '    cd "$W/$a" || exit 1',
      '    claude -p "$(cat prompt-$a.txt)" > out-$a.json',
      '  ) &',
      'done',
      'wait',
      ''
    ].join('\n')
  )
  writeFileSync(
    join(bench, 'check.mjs'),
    [
      "check('C1 nominal : exit 0 et 109 conversations', () => true)",
      "check('C2 nominal : la date apparait dans le rapport', () => true)",
      "check('C3 cas limite — date absurde 2026-13-45 REFUSEE', () => true)",
      "check('C4 cas limite — fenetre vide : aucun plantage', () => true)",
      ''
    ].join('\n')
  )

  const run = join(racine, 'RUN.md')
  writeFileSync(
    run,
    `## Candidats scoutés

| candidat | famille | hypothèse mesurable | coût prévu | risque | score | retenu ? |
|---|---|---|---|---|---|---|
| pipeline complet | routage | témoin | 0,6 $ | bas | — | A |
| grep + édition directe | profondeur | −40 % de $ | 0,3 $ | moyen | 3,0 | B |
| preuve d'abord | preuve | −1 reprise | 0,5 $ | bas | 2,4 | C |
| lecture interdite | prémisse cassée | −50 % de tours | 0,5 $ | haut | 1,1 | X |
| fan-out 3 agents | parallélisme | −30 % de minutes | 0,9 $ | haut | 0,8 | non |
| brain_query d'abord | contexte | −1 tour | 0,4 $ | bas | 0,7 | non |

## Banc
Critère **rouge constaté avant le lancement**, sortie collée :

\`\`\`
$ node check.mjs scripts/scout-rendement.mjs
RATE C3 cas limite — date absurde 2026-13-45 REFUSEE — acceptée
RATE C4 cas limite — fenetre vide : aucun plantage — exit 1
CRITERE NON ATTEINT (code de sortie 1)
\`\`\`

| bras | workflow | critère atteint | $ mesuré | min | tours | défauts | verdict |
|---|---|---|---|---|---|---|---|
| A (témoin) | pipeline complet | oui | **0,637** | 1,9 | 13 | fenêtre vide | gagnant |
| B | grep direct | oui | **0,349** | 0,8 | 10 | dates absurdes | 3e |
| C | preuve d'abord | oui | **0,527** | 1,3 | 13 | filtre invisible | 2e |
| X (casse-prémisse) | lecture interdite | oui | **0,507** | 1,6 | 13 | garde morte | 4e |

**Discrimination** : 3/4 bras ont passé le critère.
AUTOWIN_LESSON_V1: {"outcome":"success","title":"A gagne","body":"Δ = 0,29 $ contre A"}
`
  )
  return { racine, bench, run, copies }
}

const point = (res, id) => res.points.find((p) => p.id === id)

describe('arena-protocole-check — contrôle déterministe du banc /arena', () => {
  it('un banc conforme passe tous les points lisibles', () => {
    const f = bancConforme()
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    const rates = res.points.filter((p) => !p.ok)
    expect(rates.map((p) => `${p.id} ${p.detail}`)).toEqual([])
    expect(res.ok).toBe(true)
    expect(res.jugements.length).toBeGreaterThanOrEqual(4)
    rmSync(f.racine, { recursive: true, force: true })
  })

  it('P1 RATE quand la section Candidats scoutés manque', () => {
    const f = bancConforme()
    writeFileSync(f.run, '## Banc\nrien\n')
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P1').ok).toBe(false)
    expect(res.ok).toBe(false)
    rmSync(f.racine, { recursive: true, force: true })
  })

  it('P2 RATE quand le rouge est affirmé en prose, sans sortie collée', () => {
    const f = bancConforme()
    const sansBloc = readFileSync(f.run, 'utf8').replace(
      /```[\s\S]*?```/,
      'le critère était rouge, promis (2 sur 5 en échec).'
    )
    writeFileSync(f.run, sansBloc)
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P2').ok).toBe(false)
    expect(point(res, 'P2').detail).toMatch(/sortie collee/)
    rmSync(f.racine, { recursive: true, force: true })
  })

  it('P3 RATE quand le critère n_a qu_un seul cas limite', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'check.mjs'),
      "check('C1 nominal', () => true)\ncheck('C2 nominal bis', () => true)\ncheck('C3 cas limite — fenetre vide', () => true)\n"
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P3').ok).toBe(false)
    rmSync(f.racine, { recursive: true, force: true })
  })

  it('P8 RATE quand un chiffre du tableau ne colle pas au journal du bras', () => {
    const f = bancConforme()
    const run = readFileSync(f.run, 'utf8').replace('**0,349**', '**0,120**')
    writeFileSync(f.run, run)
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P8').ok).toBe(false)
    expect(point(res, 'P8').detail).toMatch(/0,120|0\.12/)
    rmSync(f.racine, { recursive: true, force: true })
  })

  it('P11 RATE quand 4/4 bras passent sans mention NON DISCRIMINANT', () => {
    const f = bancConforme()
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace('3/4 bras', '4/4 bras'))
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P11').ok).toBe(false)
    rmSync(f.racine, { recursive: true, force: true })
  })

  it('P13 RATE quand les copies de travail des bras sont encore sur disque', () => {
    const f = bancConforme()
    mkdirSync(join(f.copies, 'a'), { recursive: true })
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P13').ok).toBe(false)
    rmSync(f.racine, { recursive: true, force: true })
  })
})
