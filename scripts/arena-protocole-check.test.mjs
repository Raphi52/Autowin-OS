import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifierProtocole } from './arena-protocole-check.mjs'

const ARMS = ['a', 'b', 'c', 'x']

/** Dossiers temporaires a retirer, meme si un test echoue en cours de route. */
const aNettoyer = []
afterEach(() => {
  while (aNettoyer.length) rmSync(aNettoyer.pop(), { recursive: true, force: true })
})

/** Banc de reference CONFORME au protocole de skills/arena/SKILL.md. */
function bancConforme() {
  const racine = mkdtempSync(join(tmpdir(), 'arena-proto-'))
  aNettoyer.push(racine)
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
  })

  it('P1 RATE quand la section Candidats scoutés manque', () => {
    const f = bancConforme()
    writeFileSync(f.run, '## Banc\nrien\n')
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P1').ok).toBe(false)
    expect(res.ok).toBe(false)
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
  })

  it('P3 RATE quand le critère n_a qu_un seul cas limite', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'check.mjs'),
      "check('C1 nominal', () => true)\ncheck('C2 nominal bis', () => true)\ncheck('C3 cas limite — fenetre vide', () => true)\n"
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P3').ok).toBe(false)
  })

  it('P8 RATE quand un chiffre du tableau ne colle pas au journal du bras', () => {
    const f = bancConforme()
    const run = readFileSync(f.run, 'utf8').replace('**0,349**', '**0,120**')
    writeFileSync(f.run, run)
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P8').ok).toBe(false)
    expect(point(res, 'P8').detail).toMatch(/0,120|0\.12/)
  })

  it('P11 RATE quand 4/4 bras passent sans mention NON DISCRIMINANT', () => {
    const f = bancConforme()
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace('3/4 bras', '4/4 bras'))
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P11').ok).toBe(false)
  })

  it('P13 RATE quand les copies de travail des bras sont encore sur disque', () => {
    const f = bancConforme()
    mkdirSync(join(f.copies, 'a'), { recursive: true })
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P13').ok).toBe(false)
  })

  it('P14 est sans objet (OK) sur un banc de workflow qui ne teste aucun texte', () => {
    const f = bancConforme()
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P14').ok).toBe(true)
  })
})

/**
 * Banc de FORMULATION (skills/arena/SKILL.md, etape « 2 bis ») : quand un bras retenu ne differe
 * QUE par le TEXTE d'une skill, la variante doit etre ECRITE sur disque. Sans elle, on ne sait pas
 * ce que le bras a lu, et le resultat n'est attribuable a aucun changement de formulation.
 */
describe('arena-protocole-check — P14 banc de formulation', () => {
  /** Le banc conforme, converti en banc de texte : B devient un candidat de formulation. */
  function bancFormulation({ section = true, diffs = ['b'] } = {}) {
    const f = bancConforme()
    let md = readFileSync(f.run, 'utf8').replace(
      '| grep + édition directe | profondeur | −40 % de $ | 0,3 $ | moyen | 3,0 | B |',
      '| skill réécrite en réflexes | formulation | −2 tours | 0,3 $ | moyen | 3,0 | B |'
    )
    if (section) {
      md += [
        '',
        '## Variantes de texte',
        '',
        '| bras | fichier | levier | hypothèse de comportement |',
        '|---|---|---|---|',
        '| B | skills/build/SKILL.md | règle remontée en tête | vérifie avant de conclure |',
        ''
      ].join('\n')
    }
    writeFileSync(f.run, md)
    mkdirSync(join(f.bench, 'variantes'), { recursive: true })
    for (const bras of diffs)
      writeFileSync(join(f.bench, 'variantes', `${bras}.diff`), '-ancien texte\n+nouveau texte\n')
    return f
  }

  it('passe quand la section et le diff du bras de formulation existent', () => {
    const f = bancFormulation()
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P14').detail).toBe('ok')
    expect(point(res, 'P14').ok).toBe(true)
  })

  it('RATE quand la section `## Variantes de texte` manque', () => {
    const f = bancFormulation({ section: false })
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P14').ok).toBe(false)
    expect(point(res, 'P14').detail).toMatch(/Variantes de texte/)
    expect(res.ok).toBe(false)
  })

  it('RATE quand le diff du bras est absent du disque', () => {
    const f = bancFormulation({ diffs: [] })
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P14').ok).toBe(false)
    expect(point(res, 'P14').detail).toMatch(/variantes\/b\.diff/)
  })

  it('RATE quand le diff existe mais est vide', () => {
    const f = bancFormulation({ diffs: [] })
    mkdirSync(join(f.bench, 'variantes'), { recursive: true })
    writeFileSync(join(f.bench, 'variantes', 'b.diff'), '   \n')
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P14').ok).toBe(false)
  })

  it('RATE quand aucun levier n_est nommé dans la section', () => {
    const f = bancFormulation()
    writeFileSync(
      f.run,
      readFileSync(f.run, 'utf8').replace('règle remontée en tête', 'texte différent')
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P14').ok).toBe(false)
    expect(point(res, 'P14').detail).toMatch(/levier/)
  })
})

/**
 * OBJECTION DU JUGE, conv-158 (2026-09-03, turnId e0697674-fb4a-4f79-a6a0-565be7e07998) :
 * « Le tableau `## Candidats scoutés` a été écrit APRÈS la commande de lancement, alors que la
 * procédure exige l'inverse. Le contrôle ne sait pas voir l'ordre (P1 ne teste que la présence) :
 * le point P1 est donc OK sans que la règle soit vraiment tenue. »
 *
 * Un point vert sur une règle non tenue est un faux vert : P1 lit desormais aussi l'ORDRE.
 */
describe('arena-protocole-check — P1 lit aussi l_ORDRE (conv-158)', () => {
  it('P1 RATE quand les candidats sont ecrits APRES le lancement', () => {
    const f = bancConforme()
    const md = readFileSync(f.run, 'utf8')
    const i = md.indexOf('## Banc')
    writeFileSync(
      f.run,
      `## Lancement\nsh lance.sh\n\n${md.slice(i)}\n\n${md.slice(0, i)}`
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P1').ok).toBe(false)
    expect(point(res, 'P1').detail).toMatch(/apr[eè]s le lancement/i)
  })

  it('un banc conforme reste vert : les candidats sont bien avant', () => {
    const f = bancConforme()
    const md = readFileSync(f.run, 'utf8')
    writeFileSync(f.run, `${md}\n## Lancement\nsh lance.sh\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench })
    expect(point(res, 'P1').ok).toBe(true)
  })
})
