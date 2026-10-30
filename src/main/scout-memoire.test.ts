import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_PISTES_CONNUES,
  bilanDesChoix,
  blocPistesDejaConnues,
  dernierResultatParRun,
  facteursDesChoix,
  lireMemoireScout,
  noterChoixScout,
  noterPistesScout,
  pistesDejaConnues,
  pistesDejaLivrees,
  resultatsDesEvenements,
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
    // La sélection n'a pas touché l'ancien scout (« Écriture du cache » y serait « prise ») : il est
    // « ignoree » depuis l'arrivée de r1, sans aucun choix (piste 2 de conv-1033).
    expect(parRun('ancien').map(([, choix]) => choix)).toEqual(['ignoree', 'ignoree'])
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

  /*
   * PISTE 5 (conv-1033) — un scout réparé garde une ligne par VERSION de son tableau. Mesuré dans
   * `scout-pistes.json` le 21/10 : run-8e6410f195c5-1 = 93 lignes, 11 versions, dernier tableau de 9
   * lignes ; il fournissait 93 des pistes « jugées ». L'utilisateur n'a vu que le DERNIER tableau.
   * Entrée qui tue une correction fausse : X, Y, Z n'existent que dans la version 1. Dédoublonner par
   * (run, titre) les compterait encore « laissées » (8 jugées au lieu de 5).
   */
  it('un tableau refait ne compte que sa dernière version, celle que l’utilisateur a vue', () => {
    const chemin = fichier()
    const noter = (quand: string, ...titres: string[]): void =>
      noterPistesScout({
        depot: 'D:/w',
        texte: scout(...titres),
        run: 'r1',
        maintenant: quand,
        chemin
      })
    noter('2026-10-15T08:00:00Z', 'A', 'B', 'C', 'X', 'Y', 'Z')
    noter('2026-10-15T08:20:00Z', 'A', 'B', 'C', 'D', 'E')
    noterChoixScout({ depot: 'D:/w', demande: selection('A', 'B'), maintenant: 't', chemin })
    expect(bilanDesChoix({ depot: 'D:/w', chemin })).toMatch(
      /\(5 pistes jugées\) : 2 prises sur 5/u
    )
  })

  it('jumeau : deux runs distincts aux mêmes titres comptent chacun leur tableau', () => {
    const chemin = fichier()
    for (const run of ['r1', 'r2']) {
      noterPistesScout({ depot: 'D:/w', texte: scout('A', 'B', 'C'), run, maintenant: run, chemin })
      noterChoixScout({ depot: 'D:/w', demande: selection('A'), maintenant: run, chemin })
    }
    expect(bilanDesChoix({ depot: 'D:/w', chemin })).toMatch(
      /\(6 pistes jugées\) : 2 prises sur 6/u
    )
  })

  /*
   * PISTE 2 (conv-1033) — un scout dont rien n'est pris ne laissait AUCUNE trace : sans message de
   * sélection, `noterChoixScout` sort avant d'écrire. Mesuré le 21/10 : 6 runs scout sur 10 sans
   * aucun choix. Le scout SUIVANT du même dépôt le constate et le marque « ignoree ».
   * Entrée qui tue une correction fausse : la 2e version du MÊME run (une réparation) — marquer
   * « toute ligne sans choix » ferait d'un scout réparé un scout ignoré par lui-même.
   */
  it('un scout dont rien n’a été pris passe en « ignoree » quand le scout suivant arrive', () => {
    const chemin = fichier()
    const noter = (depot: string, run: string, quand: string, ...titres: string[]): void =>
      noterPistesScout({ depot, texte: scout(...titres), run, maintenant: quand, chemin })
    const choixDe = (run: string): Array<string | undefined> =>
      lireMemoireScout(chemin)
        .entrees.filter((e) => e.run === run)
        .map((e) => e.choix)
    noter('D:/w', 'r1', '2026-10-21T07:00:00Z', 'A', 'B')
    noter('D:/autre', 'r9', '2026-10-21T07:05:00Z', 'Q')
    noter('D:/w', 'r1', '2026-10-21T07:10:00Z', 'A', 'B', 'C')
    expect(choixDe('r1')).toEqual([undefined, undefined, undefined, undefined, undefined])
    noter('D:/w', 'r2', '2026-10-21T08:00:00Z', 'D')
    expect(choixDe('r1')).toEqual(['ignoree', 'ignoree', 'ignoree', 'ignoree', 'ignoree'])
    expect(choixDe('r2')).toEqual([undefined])
    expect(choixDe('r9')).toEqual([undefined])
  })

  it('jumeau : un scout déjà jugé garde ses choix, et une sélection tardive remplace « ignoree »', () => {
    const chemin = fichier()
    const noter = (run: string, quand: string, ...titres: string[]): void =>
      noterPistesScout({ depot: 'D:/w', texte: scout(...titres), run, maintenant: quand, chemin })
    const choixDe = (run: string): Array<string | undefined> =>
      lireMemoireScout(chemin)
        .entrees.filter((e) => e.run === run)
        .map((e) => e.choix)
    noter('r1', '2026-10-21T07:00:00Z', 'A', 'B')
    noterChoixScout({ depot: 'D:/w', demande: selection('A'), maintenant: 'm', chemin })
    noter('r2', '2026-10-21T08:00:00Z', 'C', 'D')
    expect(choixDe('r1')).toEqual(['prise', 'laissee'])
    noter('r3', '2026-10-21T09:00:00Z', 'E')
    expect(choixDe('r2')).toEqual(['ignoree', 'ignoree'])
    noterChoixScout({ depot: 'D:/w', demande: selection('D'), maintenant: 'm', chemin })
    expect(choixDe('r2')).toEqual(['laissee', 'prise'])
  })

  it('« ignoree » n’entre pas dans le taux de prise ; le bilan compte les scouts sans aucun choix', () => {
    const chemin = fichier()
    const tableau =
      ENTETE +
      '| 1 | 80 | 🔧 fix | A | p | a.ts:1 |\n| 2 | 70 | 🔧 fix | B | p | a.ts:1 |\n' +
      '| 3 | 60 | 🆕 new | C | p | x |\n| 4 | 40 | 🆕 new | D | p | x |\n| 5 | 30 | 🆕 new | E | p | x |\n'
    noterPistesScout({ depot: 'D:/w', texte: tableau, run: 'r1', maintenant: 't1', chemin })
    noterChoixScout({ depot: 'D:/w', demande: selection('A', 'C'), maintenant: 't2', chemin })
    noterPistesScout({
      depot: 'D:/w',
      texte: scout('F', 'G', 'H'),
      run: 'r2',
      maintenant: 't3',
      chemin
    })
    noterPistesScout({ depot: 'D:/w', texte: scout('I'), run: 'r3', maintenant: 't4', chemin })
    const bilan = bilanDesChoix({ depot: 'D:/w', chemin })
    expect(bilan).toMatch(/\(5 pistes jugées\) : 2 prises sur 5/u)
    expect(bilan).toMatch(/1 scout sans aucune piste prise/u)
  })

  /*
   * Les motifs « Pourquoi pas ? » DÉJÀ notés (piste 2, conv-1033). Le bouton qui les écrivait est
   * retiré (conv-1198), mais une mémoire existante en porte encore : le bilan les compte, la sélection
   * les garde. Une piste PRISE n'a pas été refusée : son motif n'est plus un refus.
   * Entrée qui tue une correction fausse : compter tous les motifs du dernier tableau.
   */
  it('un motif déjà noté compte comme refus, sauf sur une piste finalement prise', () => {
    const chemin = fichier()
    const tableau =
      ENTETE +
      '| 1 | 80 | 🔧 fix | A | p | a.ts:1 |\n| 2 | 70 | 🔧 fix | B | p | a.ts:1 |\n' +
      '| 3 | 60 | 🆕 new | C | p | x |\n| 4 | 40 | 🆕 new | D | p | x |\n| 5 | 30 | 🆕 new | E | p | x |\n'
    noterPistesScout({
      depot: 'D:/w',
      texte: tableau,
      run: 'r1',
      maintenant: '2026-10-21T08:00:00Z',
      chemin
    })
    // Une mémoire écrite avant le retrait du bouton : les motifs sont posés tels quels sur le disque.
    const motifs: Record<string, string> = { A: 'trop-petit', B: 'deja-fait', D: 'hors-sujet' }
    const memoire = lireMemoireScout(chemin)
    writeFileSync(
      chemin,
      JSON.stringify({
        entrees: memoire.entrees.map((e) =>
          motifs[e.titre] ? { ...e, motif: motifs[e.titre] } : e
        )
      })
    )
    noterChoixScout({ depot: 'D:/w', demande: selection('A', 'C'), maintenant: 't', chemin })
    // La sélection garde les motifs : elle ne réécrit que le choix.
    expect(
      lireMemoireScout(chemin).entrees.find((e) => e.run === 'r1' && e.titre === 'B')?.motif
    ).toBe('deja-fait')
    const bilan = bilanDesChoix({ depot: 'D:/w', chemin })
    expect(bilan).toMatch(/motifs des refus : 1 déjà fait, 1 hors sujet\b/u)
    expect(bilan).not.toMatch(/trop petit/u)
  })

  /*
   * PISTE 1 (conv-1033) — « prise » ne dit pas si le travail a abouti. L'app note DÉJÀ la fin de
   * chaque run (`OutcomeObservedV1`, `outcome-learning/events-v1.jsonl`) : la piste prise garde le
   * run qui l'a traitée, et le bilan lit son résultat là, sans second suivi.
   * Entrée qui tue une correction fausse : un run qui a DEUX résultats (une reprise). Le plus récent
   * fait foi ; lire le premier trouvé rendrait l'échec d'une tentative déjà réparée.
   */
  it('une piste prise garde le run qui l’a traitée, et le bilan dit combien ont été livrées', () => {
    const chemin = fichier()
    const tableau =
      ENTETE +
      '| 1 | 80 | 🔧 fix | A | p | a.ts:1 |\n| 2 | 70 | 🔧 fix | B | p | a.ts:1 |\n' +
      '| 3 | 60 | 🆕 new | C | p | x |\n| 4 | 40 | 🆕 new | D | p | x |\n| 5 | 30 | 🆕 new | E | p | x |\n'
    noterPistesScout({ depot: 'D:/w', texte: tableau, run: 'scout-1', maintenant: 't1', chemin })
    noterChoixScout({
      depot: 'D:/w',
      demande: selection('A', 'C'),
      maintenant: 't2',
      run: 'run-build',
      chemin
    })
    const traitees = lireMemoireScout(chemin).entrees.map((e) => [e.titre, e.traitePar])
    expect(traitees).toEqual([
      ['A', 'run-build'],
      ['B', undefined],
      ['C', 'run-build'],
      ['D', undefined],
      ['E', undefined]
    ])
    const resultats = dernierResultatParRun([
      {
        runId: 'run-build',
        createdAt: '2026-10-21T08:00:00Z',
        status: 'failed',
        terminalClass: 'defect'
      },
      {
        runId: 'run-build',
        createdAt: '2026-10-21T09:00:00Z',
        status: 'succeeded',
        terminalClass: 'delivered'
      },
      {
        runId: 'autre',
        createdAt: '2026-10-21T10:00:00Z',
        status: 'failed',
        terminalClass: 'defect'
      }
    ])
    expect(resultats.get('run-build')).toBe('delivered')
    const bilan = bilanDesChoix({
      depot: 'D:/w',
      chemin,
      resultatDuRun: (run) => resultats.get(run)
    })
    expect(bilan).toMatch(/prises traitées : 2 pistes dans 1 run fini : 1 livré, 0 en échec/u)
    const enEchec = bilanDesChoix({ depot: 'D:/w', chemin, resultatDuRun: () => 'defect' })
    expect(enEchec).toMatch(/prises traitées : 2 pistes dans 1 run fini : 0 livré, 1 en échec/u)
    // Sans lecteur de résultats (ou sans run connu), le bilan se tait sur la livraison.
    expect(bilanDesChoix({ depot: 'D:/w', chemin })).not.toMatch(/livré/u)
  })

  /*
   * « 1 LIVRÉE, 17 EN ÉCHEC » (conv-1341, 2026-10-30). Le bilan comptait une LIGNE par piste, alors
   * que le résultat est celui du run entier : sur la mémoire réelle, ces 18 lignes venaient de 4 runs
   * finis (5, 4 et 8 pistes pour les trois refusés du 22/10). Un scout l'a lu comme « vos pistes
   * n'aboutissent pas », alors que le travail de ces trois runs a été publié dans la journée.
   * Entrée qui tue une version fausse : deux runs de tailles très différentes, résultats opposés.
   */
  it('un run en échec compte pour UN run, quel que soit le nombre de pistes qu’il portait', () => {
    const chemin = fichier()
    const titres = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
    noterPistesScout({
      depot: 'D:/w',
      texte: scout(...titres),
      run: 's1',
      maintenant: 't1',
      chemin
    })
    const lot = (numero: number, ...prises: string[]): string =>
      `${selection(...prises)}\n\nLot ${numero} sur 2 de la sélection : les autres ailleurs.`
    noterChoixScout({
      depot: 'D:/w',
      demande: lot(1, ...titres.slice(0, 8)),
      maintenant: 't2',
      run: 'run-lourd',
      chemin
    })
    noterChoixScout({
      depot: 'D:/w',
      demande: lot(2, 'I'),
      maintenant: 't3',
      run: 'run-leger',
      chemin
    })
    const classes = { 'run-lourd': 'defect', 'run-leger': 'delivered' } as const
    const bilan = bilanDesChoix({
      depot: 'D:/w',
      chemin,
      resultatDuRun: (run) => classes[run as keyof typeof classes]
    })
    expect(bilan).toContain('prises traitées : 9 pistes dans 2 runs finis : 1 livré, 1 en échec')
    expect(bilan).not.toMatch(/8 en échec/u)
    // La ligne dit de quoi parle ce résultat : c'est elle qui avait été lue de travers.
    expect(bilan).toMatch(/résultat du run à sa clôture, pas de chaque piste/u)
  })

  it('le bilan dit combien de pistes prises n’ont aucun run suivi, au lieu de les taire', () => {
    const chemin = fichier()
    const titres = ['A', 'B', 'C', 'D', 'E', 'F']
    noterPistesScout({
      depot: 'D:/w',
      texte: scout(...titres),
      run: 's1',
      maintenant: 't1',
      chemin
    })
    noterChoixScout({
      depot: 'D:/w',
      demande: `${selection('A')}\n\nLot 1 sur 2 de la sélection : la suite ailleurs.`,
      maintenant: 't2',
      run: 'run-a',
      chemin
    })
    // Le lot 2 est traité dans le fil, sans run : l'app n'en a aucun résultat.
    noterChoixScout({
      depot: 'D:/w',
      demande: `${selection('B', 'C')}\n\nLot 2 sur 2 de la sélection : la suite ailleurs.`,
      maintenant: 't3',
      chemin
    })
    const bilan = bilanDesChoix({
      depot: 'D:/w',
      chemin,
      resultatDuRun: (run) => (run === 'run-a' ? 'delivered' : undefined)
    })
    expect(bilan).toMatch(/1 piste dans 1 run fini : 1 livré, 0 en échec/u)
    expect(bilan).toMatch(/2 pistes sans run suivi/u)
  })

  /*
   * LA SÉLECTION EST NOTÉE DEUX FOIS (conv-1341) : à son arrivée dans le fil, sans run, puis par le
   * run s'il y en a un. Rejouée sans run après un run, elle ne doit pas lui retirer sa piste.
   */
  it('une sélection renotée sans run garde le run qui a traité la piste', () => {
    const chemin = fichier()
    noterPistesScout({ depot: 'D:/w', texte: scout('A', 'B'), run: 's1', maintenant: 't1', chemin })
    const noter = (run?: string): void =>
      noterChoixScout({
        depot: 'D:/w',
        demande: selection('A'),
        maintenant: 't2',
        ...(run ? { run } : {}),
        chemin
      })
    noter()
    noter('run-build')
    noter()
    expect(lireMemoireScout(chemin).entrees.map((e) => [e.titre, e.choix, e.traitePar])).toEqual([
      ['A', 'prise', 'run-build'],
      ['B', 'laissee', undefined]
    ])
  })

  // Le journal de l'app mêle propositions, décisions et résultats : seuls les résultats comptent.
  it('lit les résultats dans les événements du journal de l’app, et rien d’autre', () => {
    const resultats = resultatsDesEvenements([
      { kind: 'proposal', value: { runId: 'x' } },
      {
        kind: 'outcome',
        value: {
          runId: 'run-a19492c9b620-1',
          createdAt: '2026-10-21T07:40:31.427Z',
          status: 'succeeded',
          terminalClass: 'delivered'
        }
      }
    ] as never)
    expect([...resultats]).toEqual([['run-a19492c9b620-1', 'delivered']])
  })

  it('jumeau : un résultat sans classe se lit sur son statut ; les pistes livrées sont rendues', () => {
    const resultats = dernierResultatParRun([
      { runId: 'a', createdAt: '2026-10-21T08:00:00Z', status: 'succeeded' },
      { runId: 'b', createdAt: '2026-10-21T08:00:00Z', status: 'failed' }
    ])
    expect(resultats.get('a')).toBe('delivered')
    expect(resultats.get('b')).toBe('indeterminate')
    const chemin = fichier()
    noterPistesScout({ depot: 'D:/w', texte: scout('A', 'B'), run: 's1', maintenant: 't1', chemin })
    noterChoixScout({ depot: 'D:/w', demande: selection('A'), maintenant: 't2', run: 'a', chemin })
    noterPistesScout({ depot: 'D:/w', texte: scout('C', 'D'), run: 's2', maintenant: 't3', chemin })
    noterChoixScout({ depot: 'D:/w', demande: selection('C'), maintenant: 't4', run: 'b', chemin })
    expect(
      pistesDejaLivrees({ depot: 'D:/w', chemin, resultatDuRun: (run) => resultats.get(run) })
    ).toEqual([{ titre: 'A', run: 'a' }])
  })

  /*
   * PISTE 6 (conv-1033) — les 11 premières pistes prises venaient des 15 et 16/10, d'une même séance
   * sur les animations, et pesaient autant qu'un choix d'hier. Un choix vieillit : son poids est
   * divisé par deux toutes les `DEMI_VIE_CHOIX_JOURS`.
   * Entrée qui tue une correction fausse : deux séances SYMÉTRIQUES (l'ancienne prend tous les fix,
   * la récente tous les new). Sans pondération, les taux s'égalisent et aucun facteur ne sort.
   */
  it('un choix ancien pèse moins qu’un choix récent dans le facteur de note', () => {
    const chemin = fichier()
    const tableau = (fix: string[], neufs: string[]): string =>
      ENTETE +
      [
        ...fix.map((t, i) => `| ${i + 1} | 70 | 🔧 fix | ${t} | p | a.ts:1 |`),
        ...neufs.map((t, i) => `| ${i + 4} | 70 | 🆕 new | ${t} | p | x |`)
      ].join('\n')
    noterPistesScout({
      depot: 'D:/w',
      texte: tableau(['A', 'B', 'C'], ['D', 'E', 'F']),
      run: 'ancien',
      maintenant: '2026-07-01T10:00:00Z',
      chemin
    })
    noterChoixScout({ depot: 'D:/w', demande: selection('A', 'B', 'C'), maintenant: 'm', chemin })
    noterPistesScout({
      depot: 'D:/w',
      texte: tableau(['G', 'H', 'I'], ['J', 'K', 'L']),
      run: 'recent',
      maintenant: '2026-10-20T10:00:00Z',
      chemin
    })
    noterChoixScout({ depot: 'D:/w', demande: selection('J', 'K', 'L'), maintenant: 'm', chemin })
    expect(facteursDesChoix({ depot: 'D:/w', chemin, maintenant: '2026-10-21T10:00:00Z' })).toEqual(
      { fix: 0.5, new: 1.5 }
    )
  })

  it('jumeau : deux séances du même jour pèsent pareil, les taux s’égalisent, aucun facteur', () => {
    const chemin = fichier()
    const tableau = (fix: string[], neufs: string[]): string =>
      ENTETE +
      [
        ...fix.map((t, i) => `| ${i + 1} | 70 | 🔧 fix | ${t} | p | a.ts:1 |`),
        ...neufs.map((t, i) => `| ${i + 4} | 70 | 🆕 new | ${t} | p | x |`)
      ].join('\n')
    noterPistesScout({
      depot: 'D:/w',
      texte: tableau(['A', 'B', 'C'], ['D', 'E', 'F']),
      run: 'matin',
      maintenant: '2026-10-21T08:00:00Z',
      chemin
    })
    noterChoixScout({ depot: 'D:/w', demande: selection('A', 'B', 'C'), maintenant: 'm', chemin })
    noterPistesScout({
      depot: 'D:/w',
      texte: tableau(['G', 'H', 'I'], ['J', 'K', 'L']),
      run: 'soir',
      maintenant: '2026-10-21T18:00:00Z',
      chemin
    })
    noterChoixScout({ depot: 'D:/w', demande: selection('J', 'K', 'L'), maintenant: 'm', chemin })
    expect(facteursDesChoix({ depot: 'D:/w', chemin, maintenant: '2026-10-21T18:00:00Z' })).toEqual(
      {}
    )
  })
})

/*
 * conv-339 : un /scout sur les humains de l'Accueil (« ultra quali comme dans Cyberpunk ») a reçu
 * 60 titres « DÉJÀ PROPOSÉ » — outils, serveurs MCP, navigateur, coffre de mots de passe —, dont 25
 * en « (ex-#N) » redisant un titre déjà listé. La fixture est le bloc RÉEL de sa consigne
 * (prompt-observability, tour b6150a1a), un titre par ligne, le plus récent d'abord.
 */
describe('pistes déjà proposées : seulement celles qui touchent la demande, sans doublons', () => {
  const titresReels = readFileSync(
    join(__dirname, '__fixtures__', 'scout-conv-339-deja-propose.txt'),
    'utf8'
  )
    .split('\n')
    .filter(Boolean)
  const memoire = (titres: readonly string[]): string => {
    const chemin = fichier()
    titres.forEach((titre, i) =>
      noterPistesScout({
        depot: 'D:/Autowin',
        texte: scout(titre.replace(/\|/gu, '/')),
        run: `r${i}`,
        maintenant: `2026-10-${String(18 - Math.floor(i / 10)).padStart(2, '0')}T10:${String(59 - (i % 10)).padStart(2, '0')}:00Z`,
        chemin
      })
    )
    return chemin
  }
  const DEMANDE_CONV_339 =
    "comment améliorer les humains pour qu'ils soient ultra quali comme dans le jeu cyberpunk?"
  const outillage = /mcp|outil|navigateur|mot de passe|bureau caché|garde-fou/iu

  it('la demande de conv-339 ne reçoit plus les titres sur les outils, MCP et le navigateur', () => {
    const chemin = memoire(titresReels)
    expect(titresReels.filter((t) => outillage.test(t)).length).toBeGreaterThan(15)
    const connues = pistesDejaConnues({ depot: 'D:/Autowin', chemin, demande: DEMANDE_CONV_339 })
    expect(connues.filter((t) => outillage.test(t))).toEqual([])
  })

  it('jumeau : une demande sur les serveurs d’outils MCP les reçoit toujours', () => {
    const chemin = memoire(titresReels)
    const connues = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin,
      demande: '/scout quels serveurs d’outils MCP brancher au chat ?'
    })
    expect(connues).toContain("**Brancher tes propres serveurs d'outils (MCP) au chat.**")
    expect(connues.filter((t) => /mcp/iu.test(t)).length).toBeGreaterThan(0)
  })

  it('une demande sans sujet (« /scout améliore Autowin ») garde tous les titres récents, comme avant', () => {
    const chemin = memoire(titresReels)
    const sansDemande = pistesDejaConnues({ depot: 'D:/Autowin', chemin })
    const generique = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin,
      demande: '/scout améliore Autowin'
    })
    expect(generique).toEqual(sansDemande)
  })

  it('un titre redit avec « (ex-#N) » ne revient pas une deuxième fois', () => {
    const chemin = memoire(titresReels)
    const connues = pistesDejaConnues({ depot: 'D:/Autowin', chemin })
    expect(connues.filter((t) => /mot de passe tapé dans le chat/iu.test(t))).toHaveLength(1)
    expect(connues.filter((t) => /Envoyer ou chercher un message Teams/iu.test(t))).toHaveLength(1)
  })

  it('une reformulation (« Une peau moins plastique ») est un doublon ; deux pistes voisines restent deux', () => {
    const chemin = memoire([
      'Peau moins « plastique »',
      'Reflets des néons sur les passants',
      'Une peau moins « plastique »',
      'Passants absents du reflet du sol mouillé',
      'Des visages vivants : clignement des yeux, regard'
    ])
    const connues = pistesDejaConnues({ depot: 'D:/Autowin', chemin })
    expect(connues).toEqual([
      'Peau moins « plastique »',
      'Reflets des néons sur les passants',
      'Passants absents du reflet du sol mouillé',
      'Des visages vivants : clignement des yeux, regard'
    ])
  })
})

/*
 * Objection du juge sur la correction précédente (conv-339) : filtrées sur les seuls mots de la
 * demande, les pistes du scout PRÉCÉDENT sur les humains disparaissaient — 1 titre gardé sur 9
 * (« Humains filmés en volume ») ; « Peau moins plastique », « Visages vivants », les passants, les
 * ombres, la foule ne disent pas « humains ». Le prochain scout sur le sujet les aurait reproposés.
 * La fixture est le run RÉEL de ce scout (`scout-pistes.json`, run-f085fcccbb82-1, ses 27 titres).
 * fix-ok: rejeu sur la mémoire réelle du 19/10, demande de conv-339 : 1 titre sur les humains rendu
 * au lieu des 9 pistes de run-f085fcccbb82-1, faute de lire le sujet au niveau du run.
 */
describe('pistes déjà proposées : le scout précédent sur le même sujet reste interdit en entier', () => {
  const lire = (nom: string): string[] =>
    readFileSync(join(__dirname, '__fixtures__', nom), 'utf8')
      .split('\n')
      .filter(Boolean)
  const DEMANDE_CONV_339 =
    "comment améliorer les humains pour qu'ils soient ultra quali comme dans le jeu cyberpunk?"
  const noterRun = (chemin: string, run: string, quand: string, titres: readonly string[]): void =>
    noterPistesScout({
      depot: 'D:/Autowin',
      texte: scout(...titres.map((t) => t.replace(/\|/gu, '/'))),
      run,
      maintenant: quand,
      chemin
    })
  /*
   * Le scout de conv-339 a rendu 3 versions de son tableau de 9 lignes (scout-pistes.json réel) :
   * chaque version est notée à part, comme `noterPistesScout` le fait en production.
   */
  const VERSIONS_F085 = [
    '2026-10-18T22:23:30.413Z',
    '2026-10-18T22:26:45.491Z',
    '2026-10-18T22:31:53.823Z'
  ]
  const noterVersions = (
    chemin: string,
    run: string,
    quand: readonly string[],
    titres: readonly string[]
  ): void => {
    const parTableau = Math.ceil(titres.length / quand.length)
    quand.forEach((q, i) =>
      noterRun(chemin, run, q, titres.slice(i * parTableau, (i + 1) * parTableau))
    )
  }

  it('la demande de conv-339 reçoit les pistes du scout précédent sur les humains, pas celles des outils', () => {
    const chemin = fichier()
    noterRun(
      chemin,
      'run-b83811373741-1',
      '2026-10-10T21:38:01Z',
      lire('scout-conv-339-deja-propose.txt')
    )
    noterVersions(
      chemin,
      'run-f085fcccbb82-1',
      VERSIONS_F085,
      lire('scout-conv-339-pistes-du-run.txt')
    )
    const connues = pistesDejaConnues({ depot: 'D:/Autowin', chemin, demande: DEMANDE_CONV_339 })
    for (const piste of [
      /peau moins/iu,
      /visages vivants/iu,
      /reflets? des néons/iu,
      /reflet du sol mouillé/iu,
      /ombres sont des taches/iu,
      /disparaître toute la foule/iu,
      /humains filmés en volume/iu
    ])
      expect(connues.filter((t) => piste.test(t))).toHaveLength(1)
    expect(
      connues.filter((t) => /mcp|outil|navigateur|mot de passe|bureau caché/iu.test(t))
    ).toEqual([])
  })

  /*
   * Même borne, des deux côtés : 10 runs, donc un mot de la demande désigne des runs entiers s'il
   * apparaît dans 2 runs au plus (un sur cinq). « foule » est dans 2 runs : tous leurs titres
   * reviennent. « chat » est dans 3 runs : seuls les titres qui disent « chat » reviennent.
   */
  const dixRuns = (): string => {
    const chemin = fichier()
    const runs: string[][] = [
      ['La foule disparaît sans message', 'Peau moins plastique'],
      ['Une foule plus dense le soir', 'Visages vivants'],
      ['Le chat perd le brouillon', 'Brouillon effacé au rechargement'],
      ['Le chat recolle en bas', 'Barre de défilement qui saute'],
      ['Le chat oublie le modèle choisi', 'Sélecteur de modèle remis à zéro'],
      ['Cache des conversations'],
      ['Tri des conversations'],
      ['Préfixe du juge'],
      ['Écriture du journal'],
      ['Thème blanc trop pâle']
    ]
    runs.forEach((titres, i) => noterRun(chemin, `r${i}`, `2026-10-1${i}T10:00:00Z`, titres))
    return chemin
  }

  it('un mot rare (« foule », 2 runs sur 10) fait revenir tous les titres de ces runs', () => {
    const connues = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin: dixRuns(),
      demande: '/scout rends la foule plus réaliste'
    })
    expect([...connues].sort()).toEqual(
      [
        'La foule disparaît sans message',
        'Peau moins plastique',
        'Une foule plus dense le soir',
        'Visages vivants'
      ].sort()
    )
  })

  it('jumeau : un mot courant (« chat », 3 runs sur 10) ne fait revenir que les titres qui le disent', () => {
    const connues = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin: dixRuns(),
      demande: '/scout rends le chat plus fiable'
    })
    expect([...connues].sort()).toEqual(
      [
        'Le chat oublie le modèle choisi',
        'Le chat perd le brouillon',
        'Le chat recolle en bas'
      ].sort()
    )
  })

  /*
   * Sur la mémoire réelle, « `load_graph` est héritée » faisait revenir les 57 titres du scout sur les
   * outils pour une demande sur le graphe du chat. Un nom de code ne désigne pas son run ; le même mot
   * en clair, si.
   */
  it('un mot cité seulement dans un nom de code (`load_graph`) ne fait pas revenir son run ; en clair, si', () => {
    const chemin = dixRuns()
    noterRun(chemin, 'r-outils', '2026-10-20T10:00:00Z', [
      '`load_graph` est héritée et ne sert plus',
      'Coffre de connexions'
    ])
    noterRun(chemin, 'r-graphe', '2026-10-21T10:00:00Z', [
      'Le graphe recharge toute la trace',
      'Une ligne abîmée rend la vue indisponible'
    ])
    const connues = pistesDejaConnues({ depot: 'D:/Autowin', chemin, demande: '/scout le graphe' })
    expect([...connues].sort()).toEqual(
      [
        '`load_graph` est héritée et ne sert plus',
        'Le graphe recharge toute la trace',
        'Une ligne abîmée rend la vue indisponible'
      ].sort()
    )
  })

  /*
   * UN GRAND TABLEAU N'A PAS UN SUJET (objection du juge, 19/10). Le scout run-b83811373741-1 a rendu
   * des tableaux de 5, 25 et 27 lignes sur des sujets sans lien : outils, navigateur, Teams, coffre,
   * téléphone. « téléphone » n'y est que dans 2 titres, et faisait revenir les 57 : 49 titres pour
   * « prévenir sur mon téléphone quand un travail est fini ».
   * fix-ok: rejeu de pistesDejaConnues sur scout-pistes.json réel : 49, 31 et 31 titres rendus pour
   * les trois demandes du juge, dont tout run-b83811373741-1 ramené par un seul mot rare.
   */
  const lireTableaux = (nom: string): { quand: string; titres: string[] }[] => {
    const tableaux: { quand: string; titres: string[] }[] = []
    for (const ligne of lire(nom)) {
      if (ligne.startsWith('--- ')) tableaux.push({ quand: ligne.slice(4), titres: [] })
      else tableaux[tableaux.length - 1]!.titres.push(ligne)
    }
    return tableaux
  }
  const memoireReelle = (): string => {
    const chemin = fichier()
    for (const { quand, titres } of lireTableaux('scout-b83811373741-tables.txt'))
      noterRun(chemin, 'run-b83811373741-1', quand, titres)
    noterVersions(
      chemin,
      'run-f085fcccbb82-1',
      VERSIONS_F085,
      lire('scout-conv-339-pistes-du-run.txt')
    )
    return chemin
  }

  it.each([
    [
      'prévenir sur mon téléphone quand un travail est fini',
      /t[ée]l[ée]phone|pr[ée]ven|travail|fini/iu
    ],
    ['améliore les notifications Teams et Outlook', /notification|teams|outlook/iu],
    ['le coffre de connexions', /coffre|connexion/iu]
  ])(
    '« %s » : un tableau de plus de 12 lignes ne revient pas en entier',
    (demande, ditLaDemande) => {
      const connues = pistesDejaConnues({ depot: 'D:/Autowin', chemin: memoireReelle(), demande })
      expect(connues.length).toBeGreaterThan(0)
      expect(connues.filter((t) => !ditLaDemande.test(t))).toEqual([])
    }
  )

  it('jumeau : sur la même mémoire, les 3 tableaux de 9 lignes sur les humains reviennent en entier', () => {
    const connues = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin: memoireReelle(),
      demande: DEMANDE_CONV_339
    })
    for (const piste of [/peau moins/iu, /visages vivants/iu, /ombres sont des taches/iu])
      expect(connues.filter((t) => piste.test(t))).toHaveLength(1)
  })

  /* La borne, des deux côtés : un tableau de 12 lignes revient en entier, un de 13 non. */
  const unTableauDe = (lignes: number): string => {
    const chemin = fichier()
    const autres = [
      'Peau moins plastique',
      'Visages vivants',
      'Ombres rondes peintes',
      'Textures réduites',
      'Reflets des néons',
      'Sol mouillé sans miroir',
      'Pluie trop régulière',
      'Rames du métro figées',
      'Brouillard uniforme',
      'Enseignes sans clignement',
      'Voitures trop lentes',
      'Vapeur des bouches absente'
    ]
    const titres = ['La foule disparaît sans message', ...autres.slice(0, lignes - 1)]
    noterRun(chemin, 'r-foule', '2026-10-10T10:00:00Z', titres)
    ;[
      'Préfixe du juge',
      'Tri des conversations',
      'Écriture du journal',
      'Thème blanc trop pâle'
    ].forEach((titre, i) => noterRun(chemin, `r${i}`, `2026-10-1${i + 1}T10:00:00Z`, [titre]))
    return chemin
  }

  it('un tableau de 12 lignes est un sujet : ses 12 titres reviennent', () => {
    const connues = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin: unTableauDe(12),
      demande: '/scout la foule'
    })
    expect(connues).toHaveLength(12)
  })

  it('jumeau : un tableau de 13 lignes ne revient que par ses titres qui disent « foule »', () => {
    const connues = pistesDejaConnues({
      depot: 'D:/Autowin',
      chemin: unTableauDe(13),
      demande: '/scout la foule'
    })
    expect(connues).toEqual(['La foule disparaît sans message'])
  })
})
