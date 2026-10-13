import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_PISTES_CONNUES,
  bilanDesChoix,
  blocPistesDejaConnues,
  facteursDesChoix,
  lireMemoireScout,
  noterChoixScout,
  noterPistesScout,
  pistesDejaConnues,
  titresChoisisDansLaDemande
} from './scout-memoire'
// fix-ok: les scouts du chat ne laissaient aucune trace relisible (RUN.md garde 2 lignes du tableau) ;
// ce test tombe si l'historique n'est plus ecrit, borne a 60 ou lu sans pistes ecartees.

const ENTETE = '| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n'
const scout = (...titres: string[]): string =>
  ENTETE + titres.map((t, i) => `| ${i + 1} | 70 | 🔧 fix | ${t} | pourquoi | a.ts:1 |`).join('\n')

const fichier = (): string =>
  join(mkdtempSync(join(tmpdir(), 'autowin-memoire-')), 'scout-pistes.json')

/*
 * conv-616 et conv-624, à 2 h 37 d'écart, sur le même sujet : 3 pistes sur 8 reprises (écriture du
 * cache, tri des conversations, préfixe du juge), relu dans leurs traces le 30/09. Le stock de la
 * veille gardait déjà ses pistes, écartées comprises — mais seuls les scouts de la veille le lisaient,
 * et les scouts du chat n'y écrivent jamais.
 */
describe('mémoire des pistes déjà proposées par un scout', () => {
  it('note les titres du tableau et les rend pour le même dépôt, le plus récent d abord', () => {
    const chemin = fichier()
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: scout('Écriture du cache'),
      run: 'r1',
      maintenant: '2026-09-01T10:00:00Z',
      chemin
    })
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: scout('Tri des conversations'),
      run: 'r2',
      maintenant: '2026-09-01T12:20:00Z',
      chemin
    })
    expect(pistesDejaConnues({ depot: 'D:/AutoWinOS', chemin })).toEqual([
      'Tri des conversations',
      'Écriture du cache'
    ])
  })

  it('le même dépôt se reconnaît malgré la casse et les barres obliques', () => {
    const chemin = fichier()
    noterPistesScout({
      depot: 'D:\\AutoWinOS\\',
      texte: scout('Préfixe du juge'),
      run: 'r1',
      maintenant: '2026-09-01T10:00:00Z',
      chemin
    })
    expect(pistesDejaConnues({ depot: 'd:/autowinos', chemin })).toEqual(['Préfixe du juge'])
  })

  it('un scout sur un autre dépôt ne reçoit pas ces titres', () => {
    const chemin = fichier()
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: scout('Écriture du cache'),
      run: 'r1',
      maintenant: '2026-09-01T10:00:00Z',
      chemin
    })
    expect(pistesDejaConnues({ depot: 'D:/ContosoV3Desktop', chemin })).toEqual([])
  })

  it('exclut les pistes du run en cours : une réparation ne se voit pas interdire sa propre liste', () => {
    const chemin = fichier()
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: scout('Ancienne'),
      run: 'r1',
      maintenant: '2026-09-01T10:00:00Z',
      chemin
    })
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: scout('De ce run'),
      run: 'r2',
      maintenant: '2026-09-01T11:00:00Z',
      chemin
    })
    expect(pistesDejaConnues({ depot: 'D:/AutoWinOS', sauf: 'r2', chemin })).toEqual(['Ancienne'])
  })

  it('ajoute le stock de la veille, écartées comprises, sans doublon', () => {
    const chemin = fichier()
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: scout('Écriture du cache'),
      run: 'r1',
      maintenant: '2026-09-01T10:00:00Z',
      chemin
    })
    const connues = pistesDejaConnues({
      depot: 'D:/AutoWinOS',
      chemin,
      stockVeille: ['écriture du cache', 'Centre de reprise (écartée)']
    })
    expect(connues).toEqual(['Écriture du cache', 'Centre de reprise (écartée)'])
  })

  it(`garde au plus ${MAX_PISTES_CONNUES} titres, les plus récents, doublons retirés`, () => {
    const chemin = fichier()
    for (let i = 0; i < 70; i++) {
      const minute = String(i).padStart(2, '0')
      noterPistesScout({
        depot: 'D:/AutoWinOS',
        texte: scout(`Piste ${i}`, 'Toujours la même'),
        run: `r${i}`,
        maintenant: `2026-09-01T10:${minute}:00Z`,
        chemin
      })
    }
    const connues = pistesDejaConnues({ depot: 'D:/AutoWinOS', chemin })
    expect(connues).toHaveLength(MAX_PISTES_CONNUES)
    expect(connues[0]).toBe('Piste 69')
    expect(connues.filter((t) => t === 'Toujours la même')).toHaveLength(1)
  })

  it('historique absent ou illisible : aucune piste, aucune erreur', () => {
    const absent = fichier()
    expect(pistesDejaConnues({ depot: 'D:/AutoWinOS', chemin: absent })).toEqual([])
    const corrompu = fichier()
    writeFileSync(corrompu, '{ pas du json')
    expect(lireMemoireScout(corrompu).entrees).toEqual([])
    expect(() =>
      noterPistesScout({
        depot: 'D:/AutoWinOS',
        texte: scout('X'),
        run: 'r',
        maintenant: '2026-09-01T10:00:00Z',
        chemin: corrompu
      })
    ).not.toThrow()
  })

  it('une sortie sans tableau ne note rien', () => {
    const chemin = fichier()
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: 'aucune piste défendable\n\nSUITE: fin',
      run: 'r',
      maintenant: '2026-09-01T10:00:00Z',
      chemin
    })
    expect(lireMemoireScout(chemin).entrees).toEqual([])
  })

  it('le bloc de consigne liste les titres, et rien quand la liste est vide', () => {
    expect(blocPistesDejaConnues([])).toBe('')
    const bloc = blocPistesDejaConnues(['Écriture du cache'])
    expect(bloc).toMatch(/DÉJÀ PROPOSÉ/u)
    expect(bloc).toContain('- Écriture du cache')
  })
})

/*
 * Piste 7 de conv-890 : « une note ajustée sur ce que tu choisis vraiment ». Le chat n'enregistrait
 * AUCUN choix de piste — seule la veille garde un statut (`veille/candidats.ts`). Or le choix arrive
 * déjà au processus principal : c'est la tâche du run suivant, au format fixe de
 * `redigerPromptWorkflowSelection` (« Traite ENSEMBLE ces N candidats… », une ligne « Quoi : » par
 * piste prise). Il est donc noté là, et le bilan revient au scout suivant.
 */
describe('choix réels des pistes : prises, laissées, et le bilan rendu au scout', () => {
  const selection = (...titres: string[]): string =>
    [
      titres.length > 1
        ? `Traite ENSEMBLE ces ${titres.length} candidats issus du scout interne d'Autowin :`
        : `Traite ce candidat issu du scout interne d'Autowin :`,
      '',
      ...titres.flatMap((t, i) => [
        `${i + 1}. **${t}** — pertinence 70/100`,
        '   Type : fix',
        `   Quoi : **${t}**`
      ]),
      '',
      'Commence par relire chaque ancrage…'
    ].join('\n')

  it('lit les pistes prises dans le message de sélection, et rien dans une demande libre', () => {
    expect(titresChoisisDansLaDemande(selection('Écriture du cache', 'Tri instable'))).toEqual([
      'Écriture du cache',
      'Tri instable'
    ])
    expect(titresChoisisDansLaDemande(selection('Préfixe du juge'))).toEqual(['Préfixe du juge'])
    expect(titresChoisisDansLaDemande('améliore le cache, Quoi : rien')).toEqual([])
    expect(titresChoisisDansLaDemande('')).toEqual([])
  })

  it('marque prises et laissées sur le DERNIER scout qui les proposait, pas sur un autre dépôt', () => {
    const chemin = fichier()
    const noter = (depot: string, run: string, quand: string, ...titres: string[]): void =>
      noterPistesScout({ depot, texte: scout(...titres), run, maintenant: quand, chemin })
    noter('D:/AutoWinOS', 'ancien', '2026-09-01T08:00:00Z', 'Écriture du cache', 'Vieux reste')
    noter('D:/AutoWinOS', 'r1', '2026-09-01T10:00:00Z', 'Écriture du cache', 'Tri instable', 'Logs')
    noter('D:/Autre', 'r9', '2026-09-01T11:00:00Z', 'Écriture du cache')
    noterChoixScout({
      depot: 'd:\\autowinos',
      demande: selection('Écriture du cache', 'Tri instable'),
      maintenant: '2026-09-01T10:30:00Z',
      chemin
    })
    const parRun = (run: string): Array<[string, string | undefined]> =>
      lireMemoireScout(chemin)
        .entrees.filter((e) => e.run === run)
        .map((e) => [e.titre, e.choix])
    expect(parRun('r1')).toEqual([
      ['Écriture du cache', 'prise'],
      ['Tri instable', 'prise'],
      ['Logs', 'laissee']
    ])
    expect(parRun('ancien').every(([, choix]) => choix === undefined)).toBe(true)
    expect(parRun('r9').every(([, choix]) => choix === undefined)).toBe(true)
  })

  it('une sélection sans scout connu, ou une demande libre, n’écrit rien', () => {
    const chemin = fichier()
    noterChoixScout({ depot: 'D:/x', demande: selection('Inconnue'), maintenant: 'm', chemin })
    noterChoixScout({ depot: 'D:/x', demande: 'bonjour', maintenant: 'm', chemin })
    expect(lireMemoireScout(chemin).entrees).toEqual([])
  })

  it('le bilan des choix n’apparaît qu’à partir de 5 pistes jugées, avec les notes réelles', () => {
    const chemin = fichier()
    const tableau =
      ENTETE +
      '| 1 | 80 | 🔧 fix | A | p | a.ts:1 |\n| 2 | 70 | 🔧 fix | B | p | a.ts:1 |\n' +
      '| 3 | 60 | 🆕 new | C | p | x |\n| 4 | 40 | 🆕 new | D | p | x |\n'
    noterPistesScout({ depot: 'D:/w', texte: tableau, run: 'r1', maintenant: 't1', chemin })
    noterChoixScout({ depot: 'D:/w', demande: selection('A', 'C'), maintenant: 't2', chemin })
    expect(bilanDesChoix({ depot: 'D:/w', chemin })).toBe('')
    noterPistesScout({
      depot: 'D:/w',
      texte: ENTETE + '| 1 | 90 | 🔧 fix | E | p | a.ts:1 |\n',
      run: 'r2',
      maintenant: 't3',
      chemin
    })
    noterChoixScout({ depot: 'D:/w', demande: selection('E'), maintenant: 't4', chemin })
    const bilan = bilanDesChoix({ depot: 'D:/w', chemin })
    // 5 pistes jugées : A, C, E prises (80, 60, 90 → 77) ; B, D laissées (70, 40 → 55).
    expect(bilan).toMatch(/3 prises sur 5/u)
    expect(bilan).toMatch(/prises 77/u)
    expect(bilan).toMatch(/laissées 55/u)
    expect(bilan).toMatch(/🔧 fix 2\/3/u)
    expect(bilan).toMatch(/🆕 new 1\/2/u)
  })

  // fix-ok: rouge avant (facteursDesChoix absent) ; la note restait l’avis du modèle.
  // Piste 7 de conv-890, à la lettre : la NOTE elle-même suit ce que l'utilisateur prend, type par type.
  const septPistes =
    ENTETE +
    '| 1 | 80 | 🔧 fix | A | p | a.ts:1 |\n| 2 | 80 | 🔧 fix | B | p | a.ts:1 |\n' +
    '| 3 | 80 | 🔧 fix | C | p | a.ts:1 |\n| 4 | 80 | 🔧 fix | D | p | a.ts:1 |\n' +
    '| 5 | 60 | 🆕 new | E | p | x |\n| 6 | 60 | 🆕 new | F | p | x |\n| 7 | 60 | 🆕 new | G | p | x |\n'

  it('le facteur d’un type = son taux de prise lissé, rapporté au taux global', () => {
    const chemin = fichier()
    noterPistesScout({ depot: 'D:/w', texte: septPistes, run: 'r1', maintenant: 't1', chemin })
    expect(facteursDesChoix({ depot: 'D:/w', chemin })).toEqual({})
    noterChoixScout({
      depot: 'D:/w',
      demande: selection('A', 'E', 'F', 'G'),
      maintenant: 't2',
      chemin
    })
    // fix 1/4, new 3/3, global 4/7 ; lissés (+1/+2) : 2/6, 4/5, 5/9 → fix ×0,6, new ×1,44.
    expect(facteursDesChoix({ depot: 'D:/w', chemin })).toEqual({ fix: 0.6, new: 1.44 })
    expect(facteursDesChoix({ depot: 'D:/autre', chemin })).toEqual({})
  })

  it('tout pris (ou rien) : les choix ne départagent rien, aucun facteur', () => {
    const chemin = fichier()
    noterPistesScout({ depot: 'D:/w', texte: septPistes, run: 'r1', maintenant: 't1', chemin })
    noterChoixScout({
      depot: 'D:/w',
      demande: selection('A', 'B', 'C', 'D', 'E', 'F', 'G'),
      maintenant: 't2',
      chemin
    })
    expect(facteursDesChoix({ depot: 'D:/w', chemin })).toEqual({})
  })
})
