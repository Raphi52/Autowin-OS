import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { carteDuFil } from './carte-du-fil'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'

/**
 * CARTE DU FIL (conv-1059, 2026-10-22) — le calcul PUR de la ligne de métro qui remplace le carnet.
 *
 * Les entrées qui font échouer une version fausse : une vérification RATÉE suivie d'une AUTRE qui
 * passe (conv-76 : `typecheck exit 1` puis `npm test exit 0` — le vert ne doit pas cacher le rouge) ;
 * la même commande rouge PUIS verte (la boucle normale : c'est prouvé) ; un tour fini SANS
 * vérification (jamais vert : auto-déclaré) ; un « go » (titré par la suite qu'il accepte, pas
 * « go ») ; un envoi du mode auto (titré par son prompt, pas par l'ancrage qui cite une autre
 * demande) ; une orientation (jamais une étape).
 */

const user = (content: string, ts: number, extra: Record<string, unknown> = {}): Msg =>
  ({ role: 'user', content, ts, messageId: `u${ts}`, ...extra }) as Msg

const asst = (ts: number, parts: unknown[], extra: Record<string, unknown> = {}): Msg =>
  ({
    role: 'assistant',
    status: 'completed',
    done: true,
    debutDuTour: ts,
    parts,
    ...extra
  }) as unknown as Msg

const texte = (text: string): unknown => ({ kind: 'text', text })
const verify = (command: string, exitCode: number): unknown => ({
  kind: 'action',
  name: 'verify',
  ok: true,
  data: { command, exitCode, ok: exitCode === 0 }
})

const CLOTURE = (recommande: string): string =>
  ['Réponse.', '', '✅ Fait', '1. une chose', '👉 Recommandé', recommande].join('\n')

describe('carteDuFil — une étape par demande', () => {
  it('saute les orientations et titre un « go » par la suite qu’il accepte', () => {
    const fil = [
      user('construis la carte du fil', 1_000),
      asst(1_100, [texte(CLOTURE('Lancer le juge sur la carte.'))]),
      user('ajoute aussi un repère', 1_150, { orientation: true }),
      user('go', 1_200),
      asst(1_300, [texte('fini')])
    ]
    const { etapes } = carteDuFil({ fil })
    expect(etapes.map((etape) => etape.titre)).toEqual([
      'construis la carte du fil',
      'Suite : Lancer le juge sur la carte.'
    ])
    expect(etapes.map((etape) => etape.rang)).toEqual([0, 3])
    expect(etapes[0].messageId).toBe('u1000')
  })

  it('un envoi du mode auto est titré par son prompt, pas par l’ancrage qui le suit', () => {
    const fil = [
      user(
        "Relance le test de ChatComposer.\n\n(Mode auto — dernière demande de l'utilisateur : « refais le chat ». Ce message n'a PAS été tapé.)",
        1_000
      ),
      asst(1_100, [texte('ok')])
    ]
    expect(carteDuFil({ fil }).etapes[0].titre).toBe('Relance le test de ChatComposer.')
  })
})

describe('carteDuFil — la couleur suit la PREUVE', () => {
  it('une vérification verte prouve l’étape', () => {
    const { etapes, prouvees, total } = carteDuFil({
      fil: [user('corrige', 1), asst(2, [verify('npm test', 0)])]
    })
    expect(etapes[0].statut).toBe('prouve')
    expect(etapes[0].constat).toBe('npm test → exit 0')
    expect([prouvees, total]).toEqual([1, 1])
  })

  it('la même commande rouge PUIS verte : prouvé (la boucle normale)', () => {
    const { etapes } = carteDuFil({
      fil: [user('corrige', 1), asst(2, [verify('npm test', 1), verify('npm test', 0)])]
    })
    expect(etapes[0].statut).toBe('prouve')
  })

  it('deux commandes DIFFÉRENTES, l’une rouge : refusé, le vert ne cache pas le rouge (conv-76)', () => {
    const { etapes } = carteDuFil({
      fil: [user('corrige', 1), asst(2, [verify('npm run typecheck', 1), verify('npm test', 0)])]
    })
    expect(etapes[0].statut).toBe('refuse')
    expect(etapes[0].constat).toBe('npm run typecheck → exit 1')
  })

  it('un contrôle final qui refuse le travail orchestré : refusé, avec son motif', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('construis', 1),
        asst(2, [
          {
            kind: 'action',
            name: 'orchestrate',
            ok: true,
            data: { gateBlocked: true, gateReasons: ['aucun test rouge avant le correctif'] }
          }
        ])
      ]
    })
    expect(etapes[0].statut).toBe('refuse')
    expect(etapes[0].constat).toContain('arrêté au contrôle final — aucun test rouge')
  })

  it('un tour fini sans aucune vérification n’est JAMAIS vert', () => {
    const { etapes, prouvees } = carteDuFil({
      fil: [user('explique', 1), asst(2, [texte('voilà')])]
    })
    expect(etapes[0].statut).toBe('sans-preuve')
    expect(prouvees).toBe(0)
  })

  it('un tour en échec ou arrêté : refusé', () => {
    const echec = carteDuFil({
      fil: [user('a', 1), asst(2, [texte('x')], { status: 'failed', error: 'quota épuisé' })]
    })
    expect(echec.etapes[0]).toMatchObject({
      statut: 'refuse',
      constat: 'tour en échec : quota épuisé'
    })
    const arrete = carteDuFil({ fil: [user('a', 1), asst(2, [], { status: 'cancelled' })] })
    expect(arrete.etapes[0]).toMatchObject({
      statut: 'refuse',
      constat: 'tour arrêté avant la fin'
    })
  })

  it('l’agent qui écrit lui-même « ⛔ Bloqué » : refusé', () => {
    const { etapes } = carteDuFil({
      fil: [user('a', 1), asst(2, [texte('⛔ Bloqué : le pont IPC manque.')])]
    })
    expect(etapes[0]).toMatchObject({
      statut: 'refuse',
      constat: '⛔ Bloqué : le pont IPC manque.'
    })
  })

  it('un tour qui tourne, ou une demande sans réponse au bout du fil : en cours', () => {
    const tourne = carteDuFil({
      fil: [user('a', 1), asst(2, [], { status: 'streaming', done: false })]
    })
    expect(tourne.etapes[0].statut).toBe('en-cours')
    expect(carteDuFil({ fil: [user('a', 1)] }).etapes[0].statut).toBe('en-cours')
  })
})

describe('carteDuFil — l’étape à venir', () => {
  it('la suite recommandée par la dernière clôture devient une étape « à venir »', () => {
    const { etapes, total } = carteDuFil({
      fil: [user('a', 1), asst(2, [texte(CLOTURE('Lancer le juge sur la carte.'))])]
    })
    expect(etapes.at(-1)).toMatchObject({
      cle: 'a-venir',
      rang: null,
      cible: 1,
      statut: 'a-venir',
      titre: 'Lancer le juge sur la carte.'
    })
    expect(total).toBe(1)
  })

  it('aucune étape à venir quand l’agent dit qu’il n’y a plus de suite, ou pendant un tour', () => {
    const fini = carteDuFil({
      fil: [user('a', 1), asst(2, [texte(CLOTURE('Aucune suite : le travail est livré.'))])]
    })
    expect(fini.etapes.some((etape) => etape.statut === 'a-venir')).toBe(false)
    const enCours = carteDuFil({
      fil: [
        user('a', 1),
        asst(2, [texte(CLOTURE('Lancer le juge.'))]),
        user('b', 3),
        asst(4, [], { status: 'streaming', done: false })
      ]
    })
    expect(enCours.etapes.some((etape) => etape.statut === 'a-venir')).toBe(false)
  })
})

describe('carteDuFil — « tu étais là »', () => {
  const fil = [
    user('a', 1_000),
    asst(1_100, [texte('x')]),
    user('b', 2_000),
    asst(2_100, [texte('y')]),
    user('c', 3_000),
    asst(3_100, [texte('z')])
  ]

  it('le repère se pose sur la dernière étape partie avant ton passage, la suite est nouvelle', () => {
    const carte = carteDuFil({ fil, vueA: 2_050 })
    expect(carte.tuEtaisLa).toBe(carte.etapes[1].cle)
    expect(carte.etapes.map((etape) => etape.nouvelle)).toEqual([false, true, true])
  })

  it('fil déjà vu, ou rien de neuf depuis : aucun repère', () => {
    expect(carteDuFil({ fil }).tuEtaisLa).toBeNull()
    expect(carteDuFil({ fil, vueA: 9_000 }).tuEtaisLa).toBeNull()
  })
})

describe('carteDuFil — compactage et fichiers', () => {
  it('les étapes d’avant le compactage sont hors de la mémoire de l’agent', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('a', 1),
        asst(2, [texte('x')]),
        user(COMPACT_REQUEST, 3),
        asst(4, [texte('Résumé : on construit la carte.')]),
        user('b', 5),
        asst(6, [texte('y')])
      ]
    })
    expect(etapes.map((etape) => [etape.titre, etape.horsMemoire, etape.compactage])).toEqual([
      ['a', true, false],
      ['Compactage du fil', false, true],
      ['b', false, false]
    ])
  })

  it('chaque fichier touché rejoint l’étape pendant laquelle il a été écrit', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('a', 1_000),
        asst(1_100, [texte('x')]),
        user('b', 2_000),
        asst(2_100, [texte('y')])
      ],
      traces: [
        { timestamp: new Date(1_500).toISOString(), paths: ['src/a.ts'] },
        { timestamp: new Date(2_500).toISOString(), paths: ['src/b.ts', 'src/a.ts'] }
      ]
    })
    expect(etapes.map((etape) => etape.fichiers)).toEqual([['src/a.ts'], ['src/b.ts', 'src/a.ts']])
  })
})
