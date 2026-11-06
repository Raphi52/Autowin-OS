import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { analyser } from './gc-scripts-inutilises.mjs'

/*
 * Les cas viennent de la passe du 06/11 (conv-1657) : un rapport d'archive qui faisait passer des
 * scripts morts pour branchés, un test Python lancé par npm qui a besoin d'un script que rien ne cite,
 * le mot « rendu » qui liait un test à `rendu.cjs`, et une sortie d'outil qui cite tous les noms.
 */
const JOUR = 86_400_000
const MAINTENANT = Date.UTC(2026, 10, 6, 8)

let depot
let traces

function ecrire(chemin, contenu = '') {
  const p = join(depot, chemin)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, contenu)
}

/** Une session d'agent qui lance `commandes`, datée de `ilYaJours`. */
function session(nom, ilYaJours, commandes, sortieOutil = '') {
  const lignes = commandes.map((c) =>
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: c } }] }
    })
  )
  if (sortieOutil)
    lignes.push(
      JSON.stringify({ type: 'user', toolUseResult: { stdout: sortieOutil }, command: sortieOutil })
    )
  const p = join(traces, nom + '.jsonl')
  writeFileSync(p, lignes.join('\n'))
  const t = (MAINTENANT - ilYaJours * JOUR) / 1000
  utimesSync(p, t, t)
}

/**
 * Tous les scripts ont 60 jours, sauf `jeunes` ; `modifies` porte un changement non commité.
 * `commites` : tout fichier de `scripts/` présent sur le disque compte comme commité il y a 60 jours.
 */
function git({ jeunes = [], modifies = [], commites = false } = {}) {
  return () => {
    const creation = new Map()
    if (commites)
      for (const nom of readdirSync(join(depot, 'scripts')))
        creation.set('scripts/' + nom, MAINTENANT - 60 * JOUR)
    const tous = [
      'scripts/branche.mjs',
      'scripts/appele.mjs',
      'scripts/mort.mjs',
      'scripts/mort.test.mjs',
      'scripts/archive.mjs',
      'scripts/scenario.py',
      'scripts/outil_test.py',
      'scripts/outil.py',
      'scripts/rendu.cjs',
      'scripts/autre.test.mjs',
      'scripts/souvent.mjs',
      'scripts/hier.mjs',
      'scripts/ancien.mjs',
      'scripts/jeune.mjs',
      'scripts/modifie.mjs'
    ]
    for (const c of tous) creation.set(c, MAINTENANT - (jeunes.includes(c) ? 3 : 60) * JOUR)
    return { creation, modifies: new Set(modifies) }
  }
}

beforeEach(() => {
  depot = mkdtempSync(join(tmpdir(), 'gc-scripts-'))
  traces = join(depot, '_traces')
  mkdirSync(traces)
  ecrire(
    'package.json',
    JSON.stringify({
      scripts: { a: 'node scripts/branche.mjs', b: 'python scripts/outil_test.py' }
    })
  )
  ecrire('scripts/branche.mjs', "import './appele.mjs'")
  ecrire('scripts/appele.mjs')
  ecrire('scripts/mort.mjs')
  ecrire('scripts/mort.test.mjs', "import { x } from './mort.mjs'")
  ecrire('scripts/archive.mjs')
  ecrire('entreprise/x/archives/docs/residus.md', 'Morts : scripts/archive.mjs')
  ecrire('scripts/outil.py')
  ecrire('scripts/outil_test.py', "from outil import f\nrun('scenario.py')")
  ecrire('scripts/scenario.py')
  ecrire('scripts/rendu.cjs')
  ecrire('scripts/autre.test.mjs', "// le rendu de la page\nimport './mort.mjs'")
  ecrire('scripts/souvent.mjs')
  ecrire('scripts/hier.mjs')
  ecrire('scripts/ancien.mjs')
  ecrire('scripts/jeune.mjs')
  ecrire('scripts/modifie.mjs')
  session(
    's1',
    20,
    ['node scripts/ancien.mjs', 'node scripts/souvent.mjs'],
    'scripts/mort.mjs scripts/rendu.cjs'
  )
  session('s2', 10, ['node scripts/souvent.mjs'])
  session('s3', 9, ['node --no-warnings scripts\\souvent.mjs --x'])
  session('s4', 2, ['node scripts/hier.mjs'])
  session('vieille', 45, ['node scripts/mort.mjs', 'node scripts/mort.mjs'])
})

const lancer = (options = {}) =>
  analyser({ depot, dossiersTraces: [traces], maintenant: MAINTENANT, git: git(options) })
const chemins = (liste) => liste.map((x) => x.chemin)

describe('gc-scripts-inutilises', () => {
  it('garde ce qu’une racine ou un script branché appelle', () => {
    const { inutilises } = lancer()
    expect(chemins(inutilises)).not.toContain('scripts/branche.mjs')
    expect(chemins(inutilises)).not.toContain('scripts/appele.mjs')
  })

  it('une archive cite sans brancher', () => {
    expect(chemins(lancer().inutilises)).toContain('scripts/archive.mjs')
  })

  it('un test lancé par npm garde en vie le script qu’il exécute', () => {
    const { inutilises } = lancer()
    expect(chemins(inutilises)).not.toContain('scripts/scenario.py')
    expect(chemins(inutilises)).not.toContain('scripts/outil.py')
  })

  it('un script mort part avec ses tests, liés par l’import et jamais par un mot', () => {
    const { inutilises } = lancer()
    const mort = inutilises.find((x) => x.chemin === 'scripts/mort.mjs')
    expect(mort.tests).toEqual(['scripts/autre.test.mjs', 'scripts/mort.test.mjs'])
    expect(inutilises.find((x) => x.chemin === 'scripts/rendu.cjs').tests).toEqual([])
  })

  it('seules les commandes comptent, et seulement dans la fenêtre', () => {
    const { inutilises, gardes } = lancer()
    // Cités par une sortie d'outil (s1) et lancés il y a 45 jours : jamais lancés pour la règle.
    expect(inutilises.find((x) => x.chemin === 'scripts/mort.mjs').lancements).toBe(0)
    expect(inutilises.find((x) => x.chemin === 'scripts/ancien.mjs').lancements).toBe(1)
    expect(gardes.find((x) => x.chemin === 'scripts/souvent.mjs').motif).toBe(
      'lancé dans 3 sessions'
    )
    expect(gardes.find((x) => x.chemin === 'scripts/hier.mjs').motif).toBe(
      'lancé il y a moins de 7 jours'
    )
  })

  it('ne juge ni un script jeune ni un script en cours de modification', () => {
    const { gardes } = lancer({ jeunes: ['scripts/jeune.mjs'], modifies: ['scripts/modifie.mjs'] })
    expect(gardes.find((x) => x.chemin === 'scripts/jeune.mjs').motif).toBe(
      'créé il y a moins de 14 jours'
    )
    expect(gardes.find((x) => x.chemin === 'scripts/modifie.mjs').motif).toBe(
      'modifié ou jamais commité'
    )
  })

  it('un test partagé avec un script gardé garde aussi le script mort', () => {
    const { inutilises, gardes } = lancer({ modifies: ['scripts/archive.mjs'] })
    ecrire('scripts/autre.test.mjs', "import './mort.mjs'\nimport './archive.mjs'")
    const apres = analyser({
      depot,
      dossiersTraces: [traces],
      maintenant: MAINTENANT,
      git: git({ modifies: ['scripts/archive.mjs'] })
    })
    expect(chemins(inutilises)).toContain('scripts/mort.mjs')
    expect(chemins(gardes)).toContain('scripts/archive.mjs')
    expect(apres.gardes.find((x) => x.chemin === 'scripts/mort.mjs').motif).toMatch(
      /autre\.test\.mjs/
    )
  })

  it('une mention dans un commentaire ne branche pas, et se signale pour être retirée avec lui', () => {
    // Cas réel : trois commentaires `fix-ok … derogations-lint` de `src/renderer/` gardaient en vie
    // `scripts/derogations-lint.mjs` après sa suppression demandée.
    ecrire(
      'src/vue.tsx',
      [
        '// fix-ok: mesuré par scripts/commente-ligne.mjs',
        '/**',
        ' * fix-ok: 9 alertes mesurées (scripts/commente-bloc.mjs)',
        ' */',
        "const url = 'https://exemple.fr'; lancer('scripts/chaine.mjs')",
        'faire() // scripts/fin-de-ligne.mjs'
      ].join('\n')
    )
    ecrire('src/outil.py', '# python scripts/commente-diese.py\nrun("scripts/appel.py")')
    ecrire('.githooks/pre-push', '#!/bin/sh\n# voir scripts/commente-hook.mjs\n')
    ecrire('src/outil.ps1', '<#\n  scripts/commente-ps.ps1\n#>\n& node scripts/appel-ps.mjs')
    for (const s of [
      'commente-ligne.mjs',
      'commente-bloc.mjs',
      'chaine.mjs',
      'fin-de-ligne.mjs',
      'commente-diese.py',
      'appel.py',
      'commente-hook.mjs',
      'commente-ps.ps1',
      'appel-ps.mjs'
    ])
      ecrire('scripts/' + s)
    const { inutilises, gardes } = lancer({ commites: true })
    const morts = chemins(inutilises)
    for (const s of [
      'commente-ligne.mjs',
      'commente-bloc.mjs',
      'commente-diese.py',
      'commente-hook.mjs',
      'commente-ps.ps1'
    ])
      expect(morts).toContain('scripts/' + s)
    // Un `//` dans une chaîne n'ouvre pas de commentaire ; une fin de ligne commentée reste comptée :
    // dans le doute, le détecteur garde.
    for (const s of ['chaine.mjs', 'fin-de-ligne.mjs', 'appel.py', 'appel-ps.mjs'])
      expect([...morts, ...chemins(gardes)]).not.toContain('scripts/' + s)
    expect(inutilises.find((x) => x.chemin === 'scripts/commente-bloc.mjs').aussiCiteDans).toEqual([
      'src/vue.tsx'
    ])
  })

  it('un script gardé garde ce qu’il appelle, et `tests/` branche', () => {
    // Cas réels du 06/11, démasqués quand les commentaires ont cessé de brancher :
    // `cdp-accueil-3d-proof.mjs` (gardé) exécute `mesure-pixels-allumes.py`, et
    // `tests/smoke-p0.ps1` lance `live-claude.mjs`.
    ecrire('scripts/preuve.mjs', "spawn('python', ['scripts/mesure.py'])")
    ecrire('scripts/mesure.py', 'import sys\nrun("scripts/sous-mesure.mjs")')
    ecrire('scripts/sous-mesure.mjs')
    ecrire('tests/smoke.ps1', '& npx tsx scripts/live.mjs')
    ecrire('scripts/live.mjs')
    session('s5', 3, ['node scripts/preuve.mjs'])
    const { inutilises, gardes } = lancer({ commites: true })
    expect(gardes.find((x) => x.chemin === 'scripts/mesure.py').motif).toBe(
      'appelé par scripts/preuve.mjs, gardé'
    )
    expect(gardes.find((x) => x.chemin === 'scripts/sous-mesure.mjs').motif).toBe(
      'appelé par scripts/mesure.py, gardé'
    )
    expect([...chemins(inutilises), ...chemins(gardes)]).not.toContain('scripts/live.mjs')
  })

  it('sans aucune trace lue, refuse de juger plutôt que de tout condamner', () => {
    expect(() =>
      analyser({
        depot,
        dossiersTraces: [join(depot, 'absent')],
        maintenant: MAINTENANT,
        git: git()
      })
    ).toThrow(/aucune trace/)
  })
})
