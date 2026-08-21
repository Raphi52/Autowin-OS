import { describe, expect, it } from 'vitest'
import { parseJsonl, recurrentPatterns, summary, type GateEvent } from './kaizen'

describe('parseJsonl', () => {
  it('parse des lignes JSON valides', () => {
    const text = '{"gate":"fix-gate","outcome":"block"}\n{"gate":"anti-flaky","outcome":"pass"}'
    const events = parseJsonl(text)
    expect(events).toEqual([
      { gate: 'fix-gate', outcome: 'block', file: undefined, session: undefined },
      { gate: 'anti-flaky', outcome: 'pass', file: undefined, session: undefined }
    ])
  })

  it('ignore les lignes vides et les lignes corrompues (non-JSON)', () => {
    const text = [
      '{"gate":"fix-gate","outcome":"block"}',
      '',
      '   ',
      "ceci n'est pas du JSON {{{",
      '{"gate":"anti-flaky","outcome":"pass"}'
    ].join('\n')

    const events = parseJsonl(text)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.gate)).toEqual(['fix-gate', 'anti-flaky'])
  })

  it('ignore les objets JSON valides mais sans gate/outcome exploitables', () => {
    const text = '{"foo":"bar"}\n{"gate":"fix-gate","outcome":"unknown-outcome"}'
    expect(parseJsonl(text)).toEqual([])
  })

  it('retourne [] pour un texte vide', () => {
    expect(parseJsonl('')).toEqual([])
  })
})

describe('summary', () => {
  it('compte les events par outcome', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'revert' },
      { gate: 'anti-flaky', outcome: 'pass' }
    ]
    expect(summary(events)).toEqual({ total: 4, blocks: 2, reverts: 1, passes: 1 })
  })

  it('retourne des zéros pour une liste vide', () => {
    expect(summary([])).toEqual({ total: 0, blocks: 0, reverts: 0, passes: 0 })
  })
})

describe('recurrentPatterns', () => {
  it('exclut un groupe sous le seuil (2 blocks < seuil 3)', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' }
    ]
    expect(recurrentPatterns(events, 3)).toEqual([])
  })

  it('inclut un groupe qui atteint le seuil (3 blocks >= seuil 3)', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' }
    ]
    const patterns = recurrentPatterns(events, 3)
    expect(patterns).toEqual([{ key: 'fix-gate', count: 3, gate: 'fix-gate', file: undefined }])
  })

  it('ne compte pas les pass, seulement block+revert', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'pass' },
      { gate: 'fix-gate', outcome: 'pass' },
      { gate: 'fix-gate', outcome: 'pass' },
      { gate: 'fix-gate', outcome: 'block' }
    ]
    expect(recurrentPatterns(events, 3)).toEqual([])
  })

  it('distingue le groupement par gate et par gate+file', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block', file: 'a.ts' },
      { gate: 'fix-gate', outcome: 'block', file: 'a.ts' },
      { gate: 'fix-gate', outcome: 'block', file: 'a.ts' },
      { gate: 'fix-gate', outcome: 'revert', file: 'b.ts' }
    ]
    const patterns = recurrentPatterns(events, 3)
    // gate seul: 4 (3 sur a.ts + 1 sur b.ts) ; gate+a.ts: 3 ; gate+b.ts: 1 (sous seuil)
    expect(patterns).toEqual([
      { key: 'fix-gate', count: 4, gate: 'fix-gate', file: undefined },
      { key: 'fix-gate::a.ts', count: 3, gate: 'fix-gate', file: 'a.ts' }
    ])
  })

  it('trie les patterns par count décroissant', () => {
    const events: GateEvent[] = [
      ...Array(3).fill({ gate: 'gate-a', outcome: 'block' }),
      ...Array(5).fill({ gate: 'gate-b', outcome: 'block' })
    ]
    const patterns = recurrentPatterns(events, 3)
    expect(patterns.map((p) => p.gate)).toEqual(['gate-b', 'gate-a'])
    expect(patterns.map((p) => p.count)).toEqual([5, 3])
  })

  it('retourne [] pour une liste vide', () => {
    expect(recurrentPatterns([])).toEqual([])
  })
})

/**
 * LA FORME REELLEMENT ECRITE SUR DISQUE — mesuree le 2026-08-21 sur les 535 lignes de
 * `~/.claude/gate-counters.jsonl`.
 *
 * Ces cas existent parce que `parseJsonl` retenait **0 ligne sur 535** du fichier reel : il exigeait
 * un champ `outcome` que AUCUN producteur n'ecrit, et ne tolerait pas le BOM de la premiere ligne.
 * Le tableau de bord kaizen affichait donc « aucun pattern recurrent » en permanence — non pas
 * parce qu'il n'y en avait pas, mais parce qu'il ne lisait rien. Un capteur qui rend zero ressemble
 * a une absence de probleme.
 *
 * Le contrat ci-dessous est COPIE des producteurs, pas devine :
 *   stop-gate.ps1:314        gate='stop'       + blocked=<compte>
 *   anti-flaky.ps1:54        gate='anti-flaky' + blocked=<compte>
 *   fix-gate.ps1:182         gate='fix-gate'   + AUCUN blocked (ecrit uniquement sur le refus)
 *   kaizen-revert-log.ps1:41 gate='revert'     + AUCUN blocked
 * Mesure sur le fichier : `blocked` ne vaut jamais 0 (valeurs 1 a 4), et `outcome` est absent des
 * 535 lignes. Donc chaque ligne presente EST une morsure.
 */
describe('parseJsonl — la forme reellement ecrite par les hooks', () => {
  // Copiees VERBATIM du fichier reel (chemins conserves : ils portent les separateurs echappes).
  const LIGNE_STOP = '{"ts":"2026-06-10T10:30:01.4458356+02:00","gate":"stop","blocked":1}'
  const LIGNE_ANTI_FLAKY = '{"ts":"2026-06-10T10:32:08.0107420+02:00","gate":"anti-flaky","blocked":1}'
  const LIGNE_FIX_GATE =
    '{"gate":"fix-gate","edits":4,"file":"C:\\\\Users\\\\moi\\\\.claude\\\\hooks\\\\kaizen-detect.ps1","session":"5544b29d","ts":"2026-06-16T13:08:43.1909195+02:00"}'
  const LIGNE_REVERT =
    '{"gate":"revert","file":"C:\\\\Code\\\\LegacyDriver.cs","session":"ae4d3ceb","ts":"2026-06-16T15:34:22.4063909+02:00"}'

  /**
   * GARDE SUR LES DONNEES DE TEST elles-memes. Ces fixtures portent des chemins Windows, donc des
   * backslashes echappes. Lors de l'ecriture de ce fichier, un niveau d'echappement a ete mange et
   * `"C:\\Users"` est devenu `"C:\Users"` -- un echappement JSON invalide. Les deux cas
   * concernes sont alors tombes ROUGE en donnant exactement la meme trace qu'un parseur qui refuse
   * une ligne valide : « expected [] to have a length of 1 ». Une donnee de test illisible est
   * indistinguable d'un defaut du code teste, et c'est la pire espece de faux rouge -- suivi d'un
   * faux vert le jour ou on « corrige » le parseur pour qu'il avale n'importe quoi.
   */
  it('les fixtures sont du JSON valide -- sinon les cas suivants ne prouvent rien', () => {
    for (const ligne of [LIGNE_STOP, LIGNE_ANTI_FLAKY, LIGNE_FIX_GATE, LIGNE_REVERT]) {
      expect(() => JSON.parse(ligne), ligne).not.toThrow()
    }
  })

  it('retient une ligne de stop-gate, qui porte blocked et non outcome', () => {
    const events = parseJsonl(LIGNE_STOP)
    expect(events).toHaveLength(1)
    expect(events[0].gate).toBe('stop')
    expect(events[0].outcome).toBe('block')
  })

  // Ce cas garde un COMPORTEMENT observable (une ligne prefixee d'un BOM reste comptee), pas une
  // ligne de code : son sabotage -- retirer le strip explicite du BOM -- restait VERT, parce que
  // `trim()` suffit deja. Conserve a ce titre, et surtout PAS presente comme la preuve d'un
  // garde-fou anti-BOM qui n'existe pas.
  it('compte une ligne prefixee du BOM, garantie par trim() et non par un strip dedie', () => {
    const events = parseJsonl('\ufeff' + LIGNE_STOP + '\n' + LIGNE_ANTI_FLAKY)
    expect(events.map((e) => e.gate)).toEqual(['stop', 'anti-flaky'])
  })

  it("traite une ligne fix-gate sans blocked comme un blocage, car elle n'est ecrite que sur le refus", () => {
    const events = parseJsonl(LIGNE_FIX_GATE)
    expect(events).toHaveLength(1)
    expect(events[0].outcome).toBe('block')
    expect(events[0].file).toBe('C:\\Users\\moi\\.claude\\hooks\\kaizen-detect.ps1')
    expect(events[0].session).toBe('5544b29d')
  })

  it("reconnait un revert par son nom de gate, le seul endroit ou l'information vit", () => {
    const events = parseJsonl(LIGNE_REVERT)
    expect(events).toHaveLength(1)
    expect(events[0].outcome).toBe('revert')
  })

  it('compte une morsure par LIGNE, meme quand blocked vaut plus de 1', () => {
    // blocked=2 designe deux RUN fautifs dans UNE morsure, pas deux morsures.
    const events = parseJsonl('{"ts":"2026-06-10T10:30:01+02:00","gate":"stop","blocked":2}')
    expect(events).toHaveLength(1)
  })

  it('rejette encore un outcome PRESENT mais invalide — la tolerance ne vaut que pour son absence', () => {
    expect(parseJsonl('{"gate":"stop","outcome":"peut-etre"}')).toEqual([])
  })

  it('fait ressortir un pattern recurrent sur un extrait du fichier reel', () => {
    const extrait = '\ufeff' + [LIGNE_STOP, LIGNE_STOP, LIGNE_STOP, LIGNE_ANTI_FLAKY].join('\n')
    const patterns = recurrentPatterns(parseJsonl(extrait), 3)
    expect(patterns).toEqual([{ key: 'stop', count: 3, gate: 'stop', file: undefined }])
  })
})
