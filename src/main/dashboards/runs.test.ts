import { describe, expect, it } from 'vitest'
import { isBlocked, parseRun } from './runs'
import { mentionDEtatDuRun } from '../../shared/run-blocked'

const OPEN_RUN = `status: open
regime: standard

## Besoin
- [x] Étape 1 faite
- [ ] Étape 2 pas faite
- [ ] Étape 3 pas faite

## Journal
[2026-07-18T10:00:00] Démarrage
[2026-07-18T10:05:00] Progression
pas un event

## Défauts
<!-- rien pour l'instant -->
`

const GREEN_PARTIAL_RUN = `status: green
regime: critical

## Besoin
- [x] Étape 1
- [ ] Étape 2

## Journal
[2026-07-18T11:00:00] Clôture

## Défauts
`

const GREEN_FULL_RUN = `status: green
regime: disposable

## Besoin
- [x] Étape 1
- [x] Étape 2

## Journal
[2026-07-18T12:00:00] Clôture verte

## Défauts
`

const RUN_WITH_DEFAUTS = `status: red

## Besoin
- [ ] Étape unique

## Journal
[2026-07-18T13:00:00] Échec détecté

## Défauts
Défaut A : timeout sur X
Défaut B : mauvaise valeur Y
`

describe('parseRun', () => {
  it('lit status, regime, DoD, journal et défauts sur un run open', () => {
    const s = parseRun(OPEN_RUN, 'test-run-1')
    expect(s.status).toBe('open')
    expect(s.regime).toBe('standard')
    expect(s.dodTotal).toBe(3)
    expect(s.dodChecked).toBe(1)
    expect(s.journalEvents).toBe(2)
    expect(s.defauts).toBe(0)
    expect(s.subject).toBe('test-run-1')
  })

  it('défaut status = unknown si absent', () => {
    const s = parseRun('## Besoin\n- [ ] x\n')
    expect(s.status).toBe('unknown')
    expect(s.regime).toBeUndefined()
  })

  it('compte les défauts non vides sous ## Défauts', () => {
    const s = parseRun(RUN_WITH_DEFAUTS)
    expect(s.status).toBe('red')
    expect(s.defauts).toBe(2)
    expect(s.journalEvents).toBe(1)
    expect(s.dodTotal).toBe(1)
    expect(s.dodChecked).toBe(0)
  })

  it('ignore les commentaires sous ## Défauts', () => {
    const s = parseRun(GREEN_PARTIAL_RUN)
    expect(s.defauts).toBe(0)
  })

  it('borne la section ## Besoin au prochain heading', () => {
    const s = parseRun(GREEN_FULL_RUN)
    expect(s.dodTotal).toBe(2)
    expect(s.dodChecked).toBe(2)
  })
})

describe('isBlocked', () => {
  it('true sur open avec DoD partielle', () => {
    expect(isBlocked(parseRun(OPEN_RUN))).toBe(true)
  })

  it('true sur green avec DoD incomplète', () => {
    expect(isBlocked(parseRun(GREEN_PARTIAL_RUN))).toBe(true)
  })

  it('false sur green avec DoD pleine', () => {
    expect(isBlocked(parseRun(GREEN_FULL_RUN))).toBe(false)
  })

  it('true sur red même DoD pleine', () => {
    const redFull = `status: red\n\n## Besoin\n- [x] a\n`
    expect(isBlocked(parseRun(redFull))).toBe(true)
  })

  /**
   * VOCABULAIRE FOSSILE. 101 RUN.md portent `status: succeeded` et 7 `failed` — des statuts
   * qu'aucun code n'écrit plus (mesuré le 2026-08-18 sur la racine dev). La LECTURE doit être
   * juste sans qu'un octet d'historique ne bouge : `succeeded` hérite EXACTEMENT du traitement de
   * `green`, condition de DoD comprise ; `failed` reste bloqué comme `red`.
   *
   * Le second cas est LE discriminant : il prouve qu'on n'a pas ouvert à `succeeded` une exception
   * contournant la règle de DoD. Il est le symétrique exact du `green` partiel ci-dessus.
   */
  it('false sur succeeded avec DoD pleine — clos au même titre que green', () => {
    expect(isBlocked(parseRun(`status: succeeded\n\n## Besoin\n- [x] a\n- [x] b\n`))).toBe(false)
  })

  it('true sur succeeded avec DoD INCOMPLÈTE — aucune exception à la règle de DoD', () => {
    expect(isBlocked(parseRun(`status: succeeded\n\n## Besoin\n- [x] a\n- [ ] b\n`))).toBe(true)
  })

  it('true sur failed même DoD pleine — un échec reste un échec, comme red', () => {
    expect(isBlocked(parseRun(`status: failed\n\n## Besoin\n- [x] a\n`))).toBe(true)
  })

  /**
   * INTERROMPU (piste 4, conv-1070) : Stop, quota ou panne en face. Le travail n'a pas échoué, il
   * s'est arrêté avant sa fin — sa DoD est donc forcément incomplète, et c'est exactement ce qui
   * le gardait « bloqué ». L'entrée qui ferait échouer ce test si le correctif était faux : la
   * MÊME DoD sous `status: red`, qui doit rester bloquée (jumeau ci-dessous).
   */
  it('false sur interrupted, même DoD incomplète : ni échec ni bloqué', () => {
    const interrompu = parseRun(`status: interrupted\n\n## Besoin\n- [ ] a\n`)
    expect(interrompu.status).toBe('interrupted')
    expect(isBlocked(interrompu)).toBe(false)
  })

  it('true sur red avec la même DoD : l’exception ne vaut que pour interrupted', () => {
    expect(isBlocked(parseRun(`status: red\n\n## Besoin\n- [ ] a\n`))).toBe(true)
  })

  it('true sur un statut voisin mal écrit (interrompu) : illisible reste visible', () => {
    const illisible = parseRun(`status: interrompu\n\n## Besoin\n- [ ] a\n`)
    expect(illisible.status).toBe('unknown')
    expect(isBlocked(illisible)).toBe(true)
  })

  it('true sur pending et running : figés depuis des semaines = abandonnés', () => {
    expect(isBlocked(parseRun(`status: pending\n\n## Besoin\n- [x] a\n`))).toBe(true)
    expect(isBlocked(parseRun(`status: running\n\n## Besoin\n- [x] a\n`))).toBe(true)
  })

  it('true sur un statut illisible : un RUN.md corrompu reste visible', () => {
    expect(isBlocked(parseRun(`status: CORROMPU\n\n## Besoin\n- [x] a\n`))).toBe(true)
  })
})

/**
 * CE QUE LE RAIL DE L'OBSERVATOIRE ÉCRIT À CÔTÉ DU STATUT (piste 4, conv-1070). Un run interrompu
 * ne dit plus « bloqué » : il dit qu'on peut le relancer. L'entrée qui ferait échouer ce test si le
 * correctif était faux : un `red` à DoD incomplète, qui doit garder « bloqué ».
 */
describe('mentionDEtatDuRun', () => {
  it('interrompu → relançable, jamais bloqué', () => {
    expect(mentionDEtatDuRun(parseRun(`status: interrupted\n\n## Besoin\n- [ ] a\n`))).toBe(
      'interrompu, relançable'
    )
  })
  it('red → bloqué ; green complet → rien', () => {
    expect(mentionDEtatDuRun(parseRun(`status: red\n\n## Besoin\n- [ ] a\n`))).toBe('bloqué')
    expect(mentionDEtatDuRun(parseRun(`status: green\n\n## Besoin\n- [x] a\n`))).toBe('')
  })
  it('red ancien coupé par le Stop (avant status: interrupted) → relançable aussi (conv-1069)', () => {
    const stop =
      "[2026-10-22] Orchestration en échec: Error: verdict — appel du rôle judge INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat) · last-event=none"
    const md = `status: red\n\n## Besoin\n- [ ] a\n\n## Journal\n${stop}\n`
    expect(mentionDEtatDuRun(parseRun(md))).toBe('interrompu, relançable')
  })
})

/**
 * UN ARRÊT N'EST PAS UN ÉCHEC (conv-1069, candidat 8 du scout). Le 2026-10-22, la liste « Runs
 * en cours/bloqués » servie à chaque tour portait 15 entrées, dont des runs coupés par le bouton
 * Stop ou par le quota : rien à réparer dans le code, mais le chat les lisait comme du travail en
 * échec. Les lignes de clôture ci-dessous sont RECOPIÉES des RUN.md réels de conv-1058 et conv-1056.
 *
 * L'entrée qui ferait échouer ces tests si la correction était fausse : un run rouge pour une VRAIE
 * raison dont le journal CITE le texte d'un quota ou du Stop ailleurs que dans sa ligne de clôture
 * (`citeSansEtreArrete`) — une reconnaissance par simple recherche de texte le cacherait.
 */
describe('isBlocked — runs arrêtés par Stop ou suspendus par le quota', () => {
  const STOP =
    "[2026-10-22] Orchestration en échec: Error: verdict — appel du rôle judge INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat) · last-event=none · stderr=none. Ce n'est pas une panne : ni claude ni le binding du rôle ne sont en cause."
  const QUOTA =
    "[2026-10-22] Orchestration en échec: Error: Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie · • claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your session limit · resets 11:30am (Europe/Paris)"
  const DEFAUT =
    '[2026-10-22] Orchestration en échec: Error: TypeError: cannot read properties of undefined'
  const rouge = (journal: string, dod = '- [ ] critère pas atteint'): string =>
    `status: red\nregime: standard\n\n## Besoin\n${dod}\n\n## Journal\n${journal}\n`

  it('un run coupé par le Stop du chat est « annulé », pas bloqué — même DoD incomplète', () => {
    const resume = parseRun(rouge(STOP))
    expect(resume.interruption).toBe('stop')
    expect(isBlocked(resume)).toBe(false)
  })

  it('un run coupé par le quota est « suspendu », pas bloqué', () => {
    const resume = parseRun(rouge(QUOTA))
    expect(resume.interruption).toBe('quota')
    expect(isBlocked(resume)).toBe(false)
  })

  it('JUMEAU : un vrai échec reste bloqué', () => {
    const resume = parseRun(rouge(DEFAUT))
    expect(resume.interruption).toBeUndefined()
    expect(isBlocked(resume)).toBe(true)
  })

  it('JUMEAU : le texte du Stop ou du quota CITÉ hors de la ligne de clôture ne compte pas', () => {
    const citeSansEtreArrete = rouge(
      `[2026-10-22] Gate refusé : preuve absente\n[2026-10-22] build : j'ai lu « You've hit your session limit · resets 1pm » et « [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat) » dans un vieux journal`
    )
    expect(parseRun(citeSansEtreArrete).interruption).toBeUndefined()
    expect(isBlocked(parseRun(citeSansEtreArrete))).toBe(true)
  })

  it('JUMEAU : seule la clôture la PLUS RÉCENTE compte (la clôture s’insère en tête du journal)', () => {
    // Suspendu par le quota, repris, puis tombé sur un vrai défaut : c'est un échec.
    expect(isBlocked(parseRun(rouge(`${DEFAUT}\n${QUOTA}`)))).toBe(true)
    // L'inverse : un échec ancien, puis la reprise coupée par le Stop.
    expect(isBlocked(parseRun(rouge(`${STOP}\n${DEFAUT}`)))).toBe(false)
  })

  it('JUMEAU : un run OUVERT ou vert n’est jamais requalifié par une vieille ligne de clôture', () => {
    const ouvert = parseRun(rouge(STOP).replace('status: red', 'status: open'))
    expect(ouvert.interruption).toBeUndefined()
    expect(isBlocked(ouvert)).toBe(true)
  })

  it('JUMEAU : en parallèle, un modèle coupé par le quota AVANT le Stop d’un autre reste suspendu, pas annulé', () => {
    const mixte =
      "[2026-10-22] Orchestration en échec: Error: Fan-out build : aucun modèle n'a produit de sortie · • claude (opus) : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat) · • codex (gpt) : You've hit your weekly limit · resets 5am (Europe/Paris)"
    expect(parseRun(rouge(mixte)).interruption).toBe('quota')
  })
})
