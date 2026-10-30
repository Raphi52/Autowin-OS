import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bilanDesChoix,
  lireMemoireScout,
  noterChoixScout,
  noterPistesScout,
  type ClasseResultatRun
} from './scout-memoire'

/*
 * « 1 LIVRÉE, 17 EN ÉCHEC » REJOUÉ (conv-1341, 2026-10-30). Mêmes tailles que la mémoire réelle :
 * 3 runs refusés le 22/10 sur 5, 4 et 8 pistes, 1 run livré sur 1 piste. Une version qui recompte
 * par ligne rend 17 ; une qui oublie le dédoublonnage rend 18 runs.
 *
 * Les bords de la même ligne suivent : tout ce qui n'est pas un run fini (pas de run, run en cours)
 * ne doit ni gonfler le compte, ni faire apparaître une ligne qui ne dit rien.
 */
const DEPOT = 'D:/w'
const ENTETE = '| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n'

const tableau = (titres: readonly string[]): string =>
  ENTETE + titres.map((t, i) => `| ${i + 1} | 70 | 🔧 fix | ${t} | pourquoi | a.ts:1 |`).join('\n')

const selection = (titres: readonly string[], lot?: { numero: number; total: number }): string =>
  [
    `Traite ENSEMBLE ces ${titres.length} candidats issus du scout interne d'Autowin :`,
    '',
    ...titres.flatMap((t, i) => [
      `${i + 1}. **${t}** — pertinence 70/100`,
      '   Type : fix',
      `   Quoi : **${t}**`
    ]),
    '',
    ...(lot ? [`Lot ${lot.numero} sur ${lot.total} de la sélection : le reste ailleurs.`] : [])
  ].join('\n')

const memoireNeuve = (): string =>
  join(mkdtempSync(join(tmpdir(), 'autowin-bilan-par-run-')), 'scout-pistes.json')

function scoutDe(chemin: string, titres: readonly string[]): void {
  noterPistesScout({ depot: DEPOT, texte: tableau(titres), run: 's1', maintenant: 't1', chemin })
}

/** Découpe `titres` en lots de ces tailles, chacun porté par son run (`null` : traité sans run). */
function lots(
  chemin: string,
  titres: readonly string[],
  decoupe: ReadonlyArray<{ taille: number; run: string | null }>
): void {
  let debut = 0
  decoupe.forEach(({ taille, run }, rang) => {
    noterChoixScout({
      depot: DEPOT,
      demande: selection(titres.slice(debut, debut + taille), {
        numero: rang + 1,
        total: decoupe.length
      }),
      maintenant: `t${rang + 2}`,
      ...(run ? { run } : {}),
      chemin
    })
    debut += taille
  })
}

const titresNumerotes = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Piste ${String(i + 1).padStart(2, '0')}`)

const bilan = (chemin: string, classes: Partial<Record<string, ClasseResultatRun>>): string =>
  bilanDesChoix({ depot: DEPOT, chemin, resultatDuRun: (run) => classes[run] })

describe('bilan des pistes prises — compté par run fini', () => {
  it('rejoue le cas mesuré : 5, 4 et 8 pistes refusées, 1 livrée, soit 4 runs et non 18', () => {
    const chemin = memoireNeuve()
    const titres = titresNumerotes(18)
    scoutDe(chemin, titres)
    lots(chemin, titres, [
      { taille: 5, run: 'refuse-a' },
      { taille: 4, run: 'refuse-b' },
      { taille: 8, run: 'refuse-c' },
      { taille: 1, run: 'livre' }
    ])
    const texte = bilan(chemin, {
      'refuse-a': 'defect',
      'refuse-b': 'defect',
      'refuse-c': 'defect',
      livre: 'delivered'
    })
    expect(texte).toContain('prises traitées : 18 pistes dans 4 runs finis : 1 livré, 3 en échec')
    expect(texte).toContain('résultat du run à sa clôture, pas de chaque piste')
    expect(texte).not.toMatch(/17 en échec/u)
  })

  it('une seule piste dans un seul run s’écrit au singulier', () => {
    const chemin = memoireNeuve()
    const titres = titresNumerotes(5)
    scoutDe(chemin, titres)
    lots(chemin, titres, [
      { taille: 1, run: 'seul' },
      { taille: 4, run: null }
    ])
    expect(bilan(chemin, { seul: 'delivered' })).toContain(
      'prises traitées : 1 piste dans 1 run fini : 1 livré, 0 en échec'
    )
  })

  it('aucun run fini : aucune ligne, même s’il existe des pistes sans run', () => {
    const chemin = memoireNeuve()
    const titres = titresNumerotes(5)
    scoutDe(chemin, titres)
    lots(chemin, titres, [
      { taille: 2, run: null },
      { taille: 3, run: null }
    ])
    const texte = bilan(chemin, {})
    // Le bilan existe : c'est bien la ligne qui se tait, pas lui.
    expect(texte).toContain('TES CHOIX RÉELS')
    expect(texte).not.toMatch(/prises traitées|sans run suivi/u)
  })

  it('un run en cours n’est ni compté ni classé « sans run », contrairement à une piste sans run', () => {
    const chemin = memoireNeuve()
    const titres = titresNumerotes(6)
    scoutDe(chemin, titres)
    lots(chemin, titres, [
      { taille: 1, run: 'fini' },
      { taille: 3, run: 'en-cours' },
      { taille: 2, run: null }
    ])
    const texte = bilan(chemin, { fini: 'delivered' })
    expect(texte).toContain('1 piste dans 1 run fini : 1 livré, 0 en échec')
    expect(texte).toContain('2 pistes sans run suivi')
    expect(texte).not.toMatch(/3 pistes/u)
  })

  it('une autre classe de résultat se dit « interrompu », ni livré ni en échec', () => {
    const chemin = memoireNeuve()
    const titres = titresNumerotes(6)
    scoutDe(chemin, titres)
    lots(chemin, titres, [
      { taille: 2, run: 'quota' },
      { taille: 3, run: 'stop' },
      { taille: 1, run: 'defaut' }
    ])
    expect(bilan(chemin, { quota: 'external', stop: 'external', defaut: 'defect' })).toContain(
      '6 pistes dans 3 runs finis : 0 livré, 1 en échec, 2 interrompus'
    )
    const unSeul = memoireNeuve()
    scoutDe(unSeul, titres)
    lots(unSeul, titres, [
      { taille: 5, run: 'quota' },
      { taille: 1, run: null }
    ])
    expect(bilan(unSeul, { quota: 'external' })).toContain(
      '5 pistes dans 1 run fini : 0 livré, 0 en échec, 1 interrompu'
    )
  })
})

describe('sélection notée sans run — ce qui ne doit rien écrire', () => {
  const noterSansRun = (demande: string, chemin: string): void =>
    noterChoixScout({ depot: DEPOT, demande, maintenant: 't2', chemin })

  it('une demande vide, libre ou aux titres inconnus laisse la mémoire intacte', () => {
    const chemin = memoireNeuve()
    scoutDe(chemin, ['Connue', 'Autre'])
    const avant = readFileSync(chemin, 'utf8')
    noterSansRun('', chemin)
    noterSansRun('corrige le bouton', chemin)
    noterSansRun(selection(['Titre jamais proposé']), chemin)
    expect(readFileSync(chemin, 'utf8')).toBe(avant)
  })

  it('le jumeau : un titre connu est bien noté, et le renoter ne change plus rien', () => {
    const chemin = memoireNeuve()
    scoutDe(chemin, ['Connue', 'Autre'])
    noterSansRun(selection(['Connue']), chemin)
    const note = readFileSync(chemin, 'utf8')
    expect(lireMemoireScout(chemin).entrees.map((e) => [e.titre, e.choix])).toEqual([
      ['Connue', 'prise'],
      ['Autre', 'laissee']
    ])
    noterSansRun(selection(['Connue']), chemin)
    expect(readFileSync(chemin, 'utf8')).toBe(note)
  })

  it('une mémoire absente n’est pas créée', () => {
    const chemin = memoireNeuve()
    noterSansRun(selection(['Connue']), chemin)
    expect(existsSync(chemin)).toBe(false)
  })

  it.each([
    ['corrompue', '{ pas du json'],
    ['mal typée', '{"entrees": 12}']
  ])('une mémoire %s se lit vide et reste telle quelle sur le disque', (_cas, contenu) => {
    const chemin = memoireNeuve()
    writeFileSync(chemin, contenu)
    noterSansRun(selection(['Connue']), chemin)
    expect(readFileSync(chemin, 'utf8')).toBe(contenu)
  })
})
