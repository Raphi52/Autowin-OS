import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { POINTS_AVANT_LANCEMENT, verifierProtocole } from './arena-protocole-check.mjs'
import { cheminJournal, noterDuel } from './arena-duel.mjs'

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

  const tache = 'TACHE (identique pour tous) :\najoute --depuis a scripts/rendement-sonde.mjs\n'
  writeFileSync(join(bench, 'tache.txt'), tache)
  const couts = { a: 0.6365555, b: 0.3490945, c: 0.52714, x: 0.506905 }
  // Les minutes et les tours du tableau du RUN.md ci-dessous viennent de CES chiffres (P8).
  const durees = { a: 114000, b: 48000, c: 78000, x: 96000 }
  const tours = { a: 13, b: 10, c: 13, x: 13 }
  for (const bras of ARMS) {
    writeFileSync(
      join(bench, `prompt-${bras}.txt`),
      bras === 'x'
        ? `${tache}\nWORKFLOW IMPOSE (x) : appel nu — aucune skill, aucune consigne de phase.\n`
        : `${tache}\nWORKFLOW IMPOSE (${bras}) : ...\n`
    )
    writeFileSync(
      join(bench, `out-${bras}.json`),
      JSON.stringify({
        session_id: `sess-${bras}`,
        total_cost_usd: couts[bras],
        num_turns: tours[bras],
        duration_ms: durees[bras]
      })
    )
  }
  writeFileSync(
    join(bench, 'out-judge.json'),
    JSON.stringify({
      session_id: 'sess-judge',
      total_cost_usd: 0.515,
      is_error: false,
      result: 'GAGNANT : bras B. Ecart au temoin A : -45 % de cout.'
    })
  )
  writeFileSync(
    join(bench, 'prompt-judge.txt'),
    '/judge les quatre livrables ANONYMISES du banc (bras A/B/C/X).\n'
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
| réflexe en tête de SKILL.md | formulation | −40 % de $ | 0,3 $ | moyen | 3,0 | B |
| grep + édition directe | profondeur | −1 reprise | 0,5 $ | bas | 2,4 | C |
| appel nu, aucune skill | prémisse cassée | −50 % de tours | 0,5 $ | haut | 1,1 | X |
| fan-out 3 agents | parallélisme | −30 % de minutes | 0,9 $ | haut | 0,8 | non |
| brain_query d'abord | contexte | −1 tour | 0,4 $ | bas | 0,7 | non |

## Banc
Critère **rouge constaté avant le lancement**, sortie collée :

\`\`\`
$ node check.mjs scripts/rendement-sonde.mjs
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

**Critère binaire** : le livrable signale-t-il les scripts vivants mais cassés ?
**Preuve** : \`powershell -NoProfile -File scripts/assert-package-content.ps1\` -> exit 1

**Discrimination** : 3/4 bras ont passé le critère.
Écart hors bruit : A est le seul bras dont le livrable porte la preuve REJOUÉE ; les perdants la déclarent sans l'exécuter.
AUTOWIN_LESSON_V1: {"outcome":"success","title":"A gagne","body":"Δ = 0,29 $ contre A"}

## Variantes de texte

| bras | fichier | levier | hypothese de comportement |
|---|---|---|---|
| bras B | skills/arena/SKILL.md | regle remontee en tete | verifie avant de conclure |
`
  )
  mkdirSync(join(bench, 'variantes'), { recursive: true })
  writeFileSync(
    join(bench, 'variantes', 'b.diff'),
    [
      '--- a/skills/arena/SKILL.md',
      '+++ b/skills/arena/SKILL.md',
      '+reflexe remonte en tete',
      ''
    ].join('\n')
  )
  // Un banc CONFORME est aussi JOURNALISE : ses 4 bras sont dans arena-duels.jsonl (P15).
  const verdicts = { a: 'gagnant', b: 'perdant', c: 'perdant', x: 'perdant' }
  for (const bras of ARMS)
    noterDuel(
      {
        tache: tache.trim(),
        workflow: `workflow ${bras}`,
        bras,
        dureeMs: durees[bras],
        coutUsd: couts[bras],
        verdict: verdicts[bras],
        banc: bench
      },
      racine
    )

  return { racine, bench, run, copies }
}

const point = (res, id) => res.points.find((p) => p.id === id)

describe('arena-protocole-check — contrôle déterministe du banc /arena', () => {
  /*
   * UN SECOND LANCEUR NE DOIT PAS MASQUER CELUI DES BRAS.
   *
   * Mesure du 2026-09-03 (banc « remontees des agents ») : le banc portait `lance.sh` (les quatre
   * bras) ET `lance-juge.sh` (le juge). Le controle prenait le PREMIER fichier `lance*` par ordre
   * alphabetique — celui du juge — et rendait P6 « 2 dossiers distincts pour 4 bras » plus P7
   * « lancement sequentiel » sur un banc ou les quatre bras etaient bel et bien partis ensemble.
   * Un faux RATE fait corriger ce qui marchait deja.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : revenir a un `readdirSync(bench).find(...)` qui retient
   * le premier nom rencontre au lieu de celui qui parle des quatre bras.
   */
  it('choisit le lanceur des QUATRE BRAS, meme si un autre lance*.sh le precede', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'lance-juge.sh'),
      ['#!/bin/sh', 'cd "/tmp/le-juge"', 'claude -p prompt-judge.txt > out-judge.json'].join('\n')
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    const p6 = res.points.find((p) => p.id === 'P6')
    const p7 = res.points.find((p) => p.id === 'P7')
    expect('P6 ' + p6.detail).toBe('P6 ok')
    expect('P7 ' + p7.detail).toBe('P7 ok')
  })

  it('un banc conforme passe tous les points lisibles', () => {
    const f = bancConforme()
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    const rates = res.points.filter((p) => !p.ok)
    expect(rates.map((p) => `${p.id} ${p.detail}`)).toEqual([])
    expect(res.ok).toBe(true)
    expect(res.jugements.length).toBeGreaterThanOrEqual(4)
  })

  /*
   * P9 NE PROUVE PAS SEULEMENT « quelqu'un d'autre a jugé » : il prouve que ce juge a bien reçu la
   * skill `judge`. Le JSON de sortie d'un appel ne liste pas les skills chargées — la seule preuve
   * lisible est le prompt envoyé au juge. Un banc qui improvise sa propre grille (banc `heal` du
   * 2026-09-06 : `judge-prompt.txt` réécrit à la main, sans jamais invoquer `/judge`) doit RATER.
   */
  it('P9 RATE quand le prompt du juge n_invoque pas la skill judge', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'prompt-judge.txt'),
      'Tu es JUGE EXTERNE. Voici ma grille maison : note de 1 a 10.\n'
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P9').ok).toBe(false)
    expect(point(res, 'P9').detail).toMatch(/n_invoque ni \/judge ni skills\/judge\/SKILL\.md/)
  })

  it('P9 RATE quand aucun prompt de juge n_est garde sur disque', () => {
    const f = bancConforme()
    rmSync(join(f.bench, 'prompt-judge.txt'))
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P9').ok).toBe(false)
    expect(point(res, 'P9').detail).toMatch(/rien ne prouve que la skill judge a ete chargee/)
  })

  it('P9 accepte l_autre nom de fichier utilise par les bancs reels (judge-prompt.txt)', () => {
    const f = bancConforme()
    rmSync(join(f.bench, 'prompt-judge.txt'))
    writeFileSync(join(f.bench, 'judge-prompt.txt'), 'Applique skills/judge/SKILL.md aux 4 bras.\n')
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect('P9 ' + point(res, 'P9').detail).toBe('P9 ok')
  })

  it('P9 RATE quand le juge n_a rendu AUCUN verdict (appel en erreur)', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'out-judge.json'),
      JSON.stringify({ session_id: 'sess-judge', is_error: true, result: '' })
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P9').ok).toBe(false)
    expect(point(res, 'P9').detail).toMatch(/aucun verdict rendu/)
  })

  it('P1 RATE quand la section Candidats scoutés manque', () => {
    const f = bancConforme()
    writeFileSync(f.run, '## Banc\nrien\n')
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
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
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P2').ok).toBe(false)
    expect(point(res, 'P2').detail).toMatch(/sortie collee/)
  })

  it('P3 RATE quand le critère n_a qu_un seul cas limite', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'check.mjs'),
      "check('C1 nominal', () => true)\ncheck('C2 nominal bis', () => true)\ncheck('C3 cas limite — fenetre vide', () => true)\n"
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P3').ok).toBe(false)
  })

  it('P8 RATE quand un chiffre du tableau ne colle pas au journal du bras', () => {
    const f = bancConforme()
    const run = readFileSync(f.run, 'utf8').replace('**0,349**', '**0,120**')
    writeFileSync(f.run, run)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P8').ok).toBe(false)
    expect(point(res, 'P8').detail).toMatch(/0,120|0\.12/)
  })

  it('P11 RATE quand 4/4 bras passent sans mention NON DISCRIMINANT', () => {
    const f = bancConforme()
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace('3/4 bras', '4/4 bras'))
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P11').ok).toBe(false)
  })

  it('P13 RATE quand les copies de travail des bras sont encore sur disque', () => {
    const f = bancConforme()
    mkdirSync(join(f.copies, 'a'), { recursive: true })
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P13').ok).toBe(false)
  })

  /*
   * Depuis la demande du 2026-09-05 (conv-305), B est TOUJOURS un bras de TEXTE : chaque banc doit
   * laisser le contenu des skills meilleur qu'avant. P16 le verifie, et la SEULE dispense est la
   * mention ecrite `B non-texte, motif : ...` — qui oblige a justifier au lieu de supposer.
   */
  it('P16 RATE quand B n_est pas un candidat de la famille formulation', () => {
    const f = bancConforme()
    writeFileSync(
      f.run,
      readFileSync(f.run, 'utf8').replace(
        '| réflexe en tête de SKILL.md | formulation |',
        '| fan-out 3 agents | parallélisme |'
      )
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P16').ok).toBe(false)
    expect(point(res, 'P16').detail).toMatch(/formulation/)
  })

  it('P16 est tenu quand le banc porte la dispense écrite `B non-texte, motif :`', () => {
    const f = bancConforme()
    writeFileSync(
      f.run,
      readFileSync(f.run, 'utf8').replace(
        '| réflexe en tête de SKILL.md | formulation |',
        '| fan-out 3 agents | parallélisme |'
      ) +
        ['', '', 'B non-texte, motif : aucun texte ne pilote cette tache.', ''].join(
          String.fromCharCode(10)
        )
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P16').ok).toBe(true)
  })

  /*
   * X est le PLANCHER de la mesure : la meme tache sans aucune skill. Un prompt de X qui cite de
   * l'outillage (`/heal`, `SKILL.md`, `skills/...`) n'est plus un appel nu, et le banc perd son
   * point de comparaison le plus important.
   */
  it('P17 RATE quand le prompt du bras X cite de l_outillage', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'prompt-x.txt'),
      ['TACHE', 'WORKFLOW IMPOSE (x) : applique skills/heal/SKILL.md', ''].join(
        String.fromCharCode(10)
      )
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P17').ok).toBe(false)
  })

  it('P17 RATE quand prompt-x.txt est absent', () => {
    const f = bancConforme()
    rmSync(join(f.bench, 'prompt-x.txt'))
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P17').ok).toBe(false)
  })
})

/**
 * Banc de FORMULATION (skills/arena/SKILL.md, etape « 2 bis ») : quand un bras retenu ne differe
 * QUE par le TEXTE d'une skill, la variante doit etre ECRITE sur disque. Sans elle, on ne sait pas
 * ce que le bras a lu, et le resultat n'est attribuable a aucun changement de formulation.
 */
describe('arena-protocole-check — P14 banc de formulation', () => {
  /** Le banc conforme est DEJA un banc de texte (B = formulation) : on en degrade des morceaux. */
  function bancFormulation({ section = true, diffs = ['b'] } = {}) {
    const f = bancConforme()
    if (!section)
      writeFileSync(
        f.run,
        readFileSync(f.run, 'utf8').replace('## Variantes de texte', '## Notes diverses')
      )
    if (!diffs.includes('b')) rmSync(join(f.bench, 'variantes', 'b.diff'))
    return f
  }

  it('passe quand la section et le diff du bras de formulation existent', () => {
    const f = bancFormulation()
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P14').detail).toBe('ok')
    expect(point(res, 'P14').ok).toBe(true)
  })

  it('RATE quand la section `## Variantes de texte` manque', () => {
    const f = bancFormulation({ section: false })
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P14').ok).toBe(false)
    expect(point(res, 'P14').detail).toMatch(/Variantes de texte/)
    expect(res.ok).toBe(false)
  })

  it('RATE quand le diff du bras est absent du disque', () => {
    const f = bancFormulation({ diffs: [] })
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P14').ok).toBe(false)
    expect(point(res, 'P14').detail).toMatch(/variantes\/b\.diff/)
  })

  it('RATE quand le diff existe mais est vide', () => {
    const f = bancFormulation({ diffs: [] })
    mkdirSync(join(f.bench, 'variantes'), { recursive: true })
    writeFileSync(join(f.bench, 'variantes', 'b.diff'), '   \n')
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P14').ok).toBe(false)
  })

  it('RATE quand aucun levier n_est nommé dans la section', () => {
    const f = bancFormulation()
    writeFileSync(
      f.run,
      readFileSync(f.run, 'utf8').replace('regle remontee en tete', 'autre chose')
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
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
    writeFileSync(f.run, `## Lancement\nsh lance.sh\n\n${md.slice(i)}\n\n${md.slice(0, i)}`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P1').ok).toBe(false)
    expect(point(res, 'P1').detail).toMatch(/apr[eè]s le lancement/i)
  })

  it('un banc conforme reste vert : les candidats sont bien avant', () => {
    const f = bancConforme()
    const md = readFileSync(f.run, 'utf8')
    writeFileSync(f.run, `${md}\n## Lancement\nsh lance.sh\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P1').ok).toBe(true)
  })
})

describe('P19 — un ecart SOUS LE BRUIT ne designe pas de gagnant', () => {
  /*
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : reduire le controle a la prose de la skill, ou
   * abaisser SEUIL_BRUIT sous l'ecart reellement mesure entre deux rejeux identiques (conv-312 :
   * durees +99 %, couts +70 %, verdict INVERSE sur le meme enonce).
   */
  const sansJustification = (f) =>
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace(/Écart hors bruit[^\n]*\n/, ''))

  it('RATE quand le gagnant ne devance les perdants que de moins de 30 % en cout ET en duree', () => {
    const f = bancConforme()
    sansJustification(f)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P19').ok).toBe(false)
    expect(point(res, 'P19').detail).toMatch(/sous 30 %/)
    expect(res.ok).toBe(false)
  })

  it('PASSE quand le RUN.md nomme la difference de QUALITE qui discrimine', () => {
    const f = bancConforme()
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect('P19 ' + point(res, 'P19').detail).toBe('P19 ok')
  })

  it('PASSE sans justification quand l_ecart de cout depasse largement le bruit', () => {
    const f = bancConforme()
    sansJustification(f)
    const lignes = readFileSync(cheminJournal(f.racine), 'utf8')
      .trim()
      .split('\n')
      .map((l) => {
        const d = JSON.parse(l)
        return JSON.stringify(d.verdict === 'gagnant' ? { ...d, coutUsd: 0.1 } : d)
      })
    writeFileSync(cheminJournal(f.racine), `${lignes.join('\n')}\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P19').ok).toBe(true)
  })

  it('PASSE quand aucun gagnant n_est declare : un banc non concluant echappe a la regle', () => {
    const f = bancConforme()
    sansJustification(f)
    const lignes = readFileSync(cheminJournal(f.racine), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.stringify({ ...JSON.parse(l), verdict: 'nul' }))
    writeFileSync(cheminJournal(f.racine), `${lignes.join('\n')}\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P19').ok).toBe(true)
  })
})

describe('P15 — le banc doit etre journalise dans arena-duels.jsonl', () => {
  it('RATE quand aucun bras n_est journalise (journal absent)', () => {
    const f = bancConforme()
    rmSync(cheminJournal(f.racine), { force: true })
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P15').ok).toBe(false)
    expect(point(res, 'P15').detail).toMatch(/aucun bras journalise/)
    expect(res.ok).toBe(false)
  })

  it('RATE quand seul le gagnant est journalise, en NOMMANT les bras manquants', () => {
    const f = bancConforme()
    const lignes = readFileSync(cheminJournal(f.racine), 'utf8').trim().split('\n')
    writeFileSync(cheminJournal(f.racine), `${lignes[0]}\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P15').ok).toBe(false)
    expect(point(res, 'P15').detail).toMatch(/b, c, x/)
  })

  it('RATE quand les lignes existent mais pour un AUTRE banc', () => {
    const f = bancConforme()
    const autres = readFileSync(cheminJournal(f.racine), 'utf8')
      .trim()
      .split('\n')
      .map((l) => {
        const d = JSON.parse(l)
        return JSON.stringify({
          ...d,
          banc: join(f.racine, 'autre-banc'),
          tache: 'une autre tache'
        })
      })
    writeFileSync(cheminJournal(f.racine), `${autres.join('\n')}\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P15').ok).toBe(false)
    expect(point(res, 'P15').detail).toMatch(/aucune ligne rattachee a ce banc/)
  })

  it('PASSE quand les 4 bras sont rattaches par l_enonce seul, sans champ banc', () => {
    const f = bancConforme()
    const sansBanc = readFileSync(cheminJournal(f.racine), 'utf8')
      .trim()
      .split('\n')
      .map((l) => {
        const { banc, ...reste } = JSON.parse(l)
        return JSON.stringify(reste)
      })
    writeFileSync(cheminJournal(f.racine), `${sansBanc.join('\n')}\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P15').ok).toBe(true)
  })

  it('un bras `casse` compte comme journalise : il a bien ete tranche', () => {
    const f = bancConforme()
    const lignes = readFileSync(cheminJournal(f.racine), 'utf8')
      .trim()
      .split('\n')
      .map((l) => {
        const d = JSON.parse(l)
        return JSON.stringify(d.bras === 'x' ? { ...d, verdict: 'casse' } : d)
      })
    writeFileSync(cheminJournal(f.racine), `${lignes.join('\n')}\n`)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P15').ok).toBe(true)
  })
})

describe('P18 — un banc non discriminant doit laisser de quoi le rejouer', () => {
  it('banc 3/4 : P18 ne s_applique pas', () => {
    const f = bancConforme()
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P18').ok).toBe(true)
  })

  it('banc 4/4 sans section `## Critère durci` : RATE (defaut du banc clean du 2026-09-05)', () => {
    const f = bancConforme()
    const md = readFileSync(f.run, 'utf8').replace(
      '**Discrimination** : 3/4 bras ont passé le critère.',
      '**Discrimination** : 4/4 bras ont passé le critère → banc NON DISCRIMINANT.'
    )
    writeFileSync(f.run, md)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P18').ok).toBe(false)
  })

  it('banc 4/4 avec l_assertion a ajouter nommee : OK', () => {
    const f = bancConforme()
    const md = `${readFileSync(f.run, 'utf8').replace(
      '**Discrimination** : 3/4 bras ont passé le critère.',
      '**Discrimination** : 4/4 bras ont passé le critère → banc NON DISCRIMINANT.'
    )}
## Critère durci
Assertion A7 a ajouter : refuser un rapport qui cite un fichier inexistant du depot.
`
    writeFileSync(f.run, md)
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P18').ok).toBe(true)
  })
})

describe('pre-vol — controler AVANT de payer les quatre bras', () => {
  it('ne rend que les points lisibles avant lancement', () => {
    const f = bancConforme()
    const res = verifierProtocole({
      run: f.run,
      bench: f.bench,
      racineDuels: f.racine,
      avantLancement: true
    })
    expect(res.points.map((p) => p.id)).toEqual(POINTS_AVANT_LANCEMENT)
    expect(res.avantLancement).toBe(true)
  })

  it('X non nu est refuse AVANT lancement (defaut des bancs residus et dogfood)', () => {
    const f = bancConforme()
    writeFileSync(
      join(f.bench, 'prompt-x.txt'),
      `${readFileSync(join(f.bench, 'prompt-x.txt'), 'utf8')}
lance /scout d_abord
`
    )
    const res = verifierProtocole({
      run: f.run,
      bench: f.bench,
      racineDuels: f.racine,
      avantLancement: true
    })
    expect(res.ok).toBe(false)
    expect(point(res, 'P17').ok).toBe(false)
  })
})

describe('P20 — critere BINAIRE declare avec sa preuve rejouable, AVANT le lancement', () => {
  const SANS_CRITERE = /\*\*Critère binaire\*\*[^\n]*\n/
  const SANS_PREUVE = /\*\*Preuve\*\*[^\n]*\n/

  it('est controle des le pre-vol, avec les autres points lisibles avant de payer', () => {
    expect(POINTS_AVANT_LANCEMENT).toContain('P20')
  })

  it('PASSE quand le RUN.md nomme le critere binaire ET une commande qui le rejoue', () => {
    const f = bancConforme()
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P20').ok).toBe(true)
  })

  it('RATE quand aucun critere binaire n est declare', () => {
    const f = bancConforme()
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace(SANS_CRITERE, ''))
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P20').ok).toBe(false)
    expect(point(res, 'P20').detail).toMatch(/binaire/i)
  })

  it('RATE une preuve en PROSE : sans commande rejouable, ce n est qu un avis', () => {
    const f = bancConforme()
    writeFileSync(
      f.run,
      readFileSync(f.run, 'utf8').replace(
        SANS_PREUVE,
        '**Preuve** : on verra bien en lisant les livrables.\n'
      )
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P20').ok).toBe(false)
    expect(point(res, 'P20').detail).toMatch(/commande|rejou/i)
  })

  it('RATE un critere binaire declare APRES le lancement : il ne mesure plus, il justifie', () => {
    const f = bancConforme()
    const sansCritere = readFileSync(f.run, 'utf8')
      .replace(SANS_CRITERE, '')
      .replace(SANS_PREUVE, '')
    writeFileSync(
      f.run,
      `${sansCritere}
Lancement des bras : claude -p "..." pour chacun des quatre prompts.

**Critère binaire** : le livrable signale-t-il les scripts vivants mais cassés ?
**Preuve** : \`node check.mjs\` -> exit 1
`
    )
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P20').ok).toBe(false)
    expect(point(res, 'P20').detail).toMatch(/APRES|apres/i)
  })
})

/**
 * P8 ne confrontait QUE la colonne `$` (scripts/arena-protocole-check.mjs:242) alors que le banc
 * exige QUATRE chiffres mesures (cout, minutes, tours, verdict). Minutes et tours pouvaient donc
 * etre inventes : le controle restait vert. Ces deux cas les rendent rouges.
 */
describe('P8 — les minutes et les tours sont mesures, pas racontes', () => {
  it('RATE quand la colonne min ne colle pas a duration_ms du bras', () => {
    const f = bancConforme()
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace('| 0,8 | 10 |', '| 0,2 | 10 |'))
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P8').ok).toBe(false)
    expect(point(res, 'P8').detail).toMatch(/min|duree|durée/i)
  })

  it('RATE quand la colonne tours ne colle pas a num_turns du bras', () => {
    const f = bancConforme()
    writeFileSync(f.run, readFileSync(f.run, 'utf8').replace('| 0,8 | 10 |', '| 0,8 | 3 |'))
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P8').ok).toBe(false)
    expect(point(res, 'P8').detail).toMatch(/tours/i)
  })
})

describe('P8 — duree lue dans statut.txt quand la sortie du bras ne porte pas duration_ms', () => {
  it('PASSE avec les seuls wall=NNs du lanceur, et RATE si le tableau les contredit', () => {
    const f = bancConforme()
    const sansDuree = { a: 114, b: 48, c: 78, x: 96 }
    for (const bras of ['a', 'b', 'c', 'x']) {
      const j = JSON.parse(readFileSync(join(f.bench, `out-${bras}.json`), 'utf8'))
      delete j.duration_ms
      writeFileSync(join(f.bench, `out-${bras}.json`), JSON.stringify(j))
    }
    writeFileSync(
      join(f.bench, 'statut.txt'),
      Object.entries(sansDuree)
        .map(([b, s]) => `${b} exit=0 wall=${s}s`)
        .join('\n') + '\n'
    )
    expect(
      point(verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine }), 'P8').ok
    ).toBe(true)

    writeFileSync(join(f.bench, 'statut.txt'), 'a exit=0 wall=114s\nb exit=0 wall=600s\n')
    const res = verifierProtocole({ run: f.run, bench: f.bench, racineDuels: f.racine })
    expect(point(res, 'P8').ok).toBe(false)
    expect(point(res, 'P8').detail).toMatch(/b: min tableau/)
  })
})
