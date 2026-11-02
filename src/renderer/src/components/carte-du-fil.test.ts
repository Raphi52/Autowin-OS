import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { carteDuFil, quaisDe, type EtapeCarte } from './carte-du-fil'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import { MARQUE_REPRISE_APRES_QUOTA } from '../../../shared/reprise-quota'

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

/**
 * LE MESSAGE ENTIER POUR LA FICHE DU BOARD (conv-1278, 2026-10-29) : « je veux pouvoir voir les
 * messages en entier quand j'ouvre le détail ». Entrées qui font échouer une version fausse : un
 * message de plusieurs lignes (le titre n'en garde qu'une), une ligne de plus de 240 caractères (la
 * borne de l'ancrage du mode auto), un journal collé de plusieurs pages (borné), un « go » (son texte
 * est la suite qu'il accepte, pas « go »), un message court (aucun doublon du titre).
 */
describe('carteDuFil — le texte entier de chaque demande', () => {
  it('garde toutes les lignes et tout le texte d’un message long', () => {
    const premiere = `/maj La mise à jour est bloquée : ${'« la tentative a été annulée » '.repeat(10)}`
    const message = `${premiere}\n\nDétail :\n- ligne deux\n- ligne trois`
    const { etapes } = carteDuFil({ fil: [user(message, 1), asst(2, [texte('ok')])] })
    expect(etapes[0].titre).toHaveLength(120)
    expect(etapes[0].texte).toBe(message.trim())
  })

  it('un message court d’une ligne n’a pas de texte en double du titre', () => {
    const { etapes } = carteDuFil({ fil: [user('corrige le bouton', 1), asst(2, [texte('ok')])] })
    expect(etapes[0].titre).toBe('corrige le bouton')
    expect(etapes[0].texte).toBeUndefined()
  })

  it('un journal collé de plusieurs pages est borné', () => {
    const journal = 'erreur au démarrage\n'.repeat(500)
    const { etapes } = carteDuFil({ fil: [user(journal, 1), asst(2, [texte('ok')])] })
    expect(etapes[0].texte?.length).toBeLessThanOrEqual(4001)
    expect(etapes[0].texte?.endsWith('…')).toBe(true)
  })

  it('un « go » a pour texte la suite qu’il accepte, entière', () => {
    const suite = `Lancer le juge sur la carte ${'et sur la fiche '.repeat(12)}`.trim()
    const fil = [
      user('construis la carte', 1),
      asst(2, [texte(CLOTURE(suite))]),
      user('go', 3),
      asst(4, [texte('fini')])
    ]
    expect(carteDuFil({ fil }).etapes[1].texte).toBe(`Suite : ${suite}`)
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

  it('« ⚠️ Non résolu » au milieu d’une réponse : refusé, la seule ligne qui le porte en constat', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('a', 1),
        asst(2, [texte('Résumé du tour.\n- ⚠️ Non résolu : le test reste rouge.\nFin.')])
      ]
    })
    expect(etapes[0]).toMatchObject({
      statut: 'refuse',
      constat: '⚠️ Non résolu : le test reste rouge.'
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

// LE BILAN DE L'EN-TÊTE (« Tout ensemble », /draft conv-1088, 2026-10-22) : une couleur = un compte,
// et le coût du fil n'additionne que les coûts CONNUS — l'étape à venir ne compte nulle part.
describe('carteDuFil — le bilan de l’en-tête', () => {
  it('compte chaque couleur et additionne les seuls coûts connus', () => {
    const carte = carteDuFil({
      fil: [
        user('prouve-moi', 1),
        asst(2, [verify('npm test', 0)], { coutUsd: 1.25 }),
        user('refuse', 3),
        asst(4, [texte('x')], { status: 'failed', error: 'quota', coutUsd: 0.5 }),
        user('explique', 5),
        asst(6, [texte(CLOTURE('Relancer le juge.'))]),
        user('continue', 7),
        asst(8, [], { status: 'streaming', done: false })
      ]
    })
    expect(carte).toMatchObject({
      prouvees: 1,
      refusees: 1,
      sansPreuve: 1,
      enCours: 1,
      total: 4,
      coutConnuUsd: 1.75
    })
  })

  it('les quais alternent haut/bas, sans quai avant le compactage, le repère toujours en bas', () => {
    const etape = (cle: string, horsMemoire = false): EtapeCarte =>
      ({ cle, horsMemoire }) as EtapeCarte
    const etapes = [etape('a', true), etape('b', true), etape('c'), etape('d'), etape('e')]
    expect(quaisDe(etapes, null)).toEqual([null, null, 'haut', 'bas', 'haut'])
    expect(quaisDe(etapes, 'c')).toEqual([null, null, 'bas', 'haut', 'bas'])
    expect(quaisDe(etapes, 'd')).toEqual([null, null, 'haut', 'bas', 'haut'])
    expect(quaisDe(etapes, 'a')).toEqual([null, null, 'haut', 'bas', 'haut'])
  })

  it('le quai garde un titre court, la fiche reçoit le titre ENTIER', () => {
    const longue = `fais compter comme preuve ${'les tests du terminal '.repeat(8)}fin`
    const { etapes } = carteDuFil({ fil: [user(longue, 1), asst(2, [texte('ok')])] })
    expect(etapes[0].titre).toHaveLength(120)
    expect(etapes[0].titre.endsWith('…')).toBe(true)
    expect(etapes[0].titreEntier).toBe(longue.trim())
  })

  it('aucun coût connu : pas de coût, jamais un zéro', () => {
    const carte = carteDuFil({ fil: [user('explique', 1), asst(2, [texte('voilà')])] })
    expect(carte.coutConnuUsd).toBeUndefined()
    expect(carte.sansPreuve).toBe(1)
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

/**
 * TESTS LANCÉS DANS LE TERMINAL DE L'AGENT (conv-1059, 2026-10-22). Le tour « vazy » de conv-1038
 * affichait 295/295 tests verts, joués par l'agent dans son propre terminal : sans leur code de
 * sortie, la carte le montrait « sans preuve ». Le tour garde maintenant ces codes
 * (`testsDuTerminal`) ; la carte les lit avec la MÊME règle que les `verify` : une commande = une
 * clé, la dernière issue compte, deux commandes différentes ne se rachètent pas (conv-76) — y
 * compris d'une source à l'autre.
 *
 * fix-ok: mesuré le 01/11 sur les vraies conversations : 96 demandes de code refusées par un test,
 * 17 rachetées par un vert plus récent qui les couvre. Le reste garde son rouge.
 */
describe('carteDuFil — les tests lancés dans le terminal de l’agent', () => {
  const terminal = (commande: string, codeDeSortie: number, at: number): unknown => ({
    commande,
    codeDeSortie,
    at
  })

  it('un test passé dans le terminal prouve l’étape, avec son code de sortie', () => {
    const { etapes, prouvees } = carteDuFil({
      fil: [
        user('vazy', 1),
        asst(2, [texte('fini')], {
          testsDuTerminal: [terminal('npx vitest run src/a.test.ts', 0, 3)]
        })
      ]
    })
    expect(etapes[0].statut).toBe('prouve')
    expect(etapes[0].constat).toBe('npx vitest run src/a.test.ts → exit 0')
    expect(prouvees).toBe(1)
  })

  it('un test rouge dans le terminal : refusé, même si un `verify` différent passe ensuite', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [{ ...(verify('npm test', 0) as object), at: 5 }], {
          testsDuTerminal: [terminal('npm run typecheck', 2, 3)]
        })
      ]
    })
    expect(etapes[0].statut).toBe('refuse')
    expect(etapes[0].constat).toBe('npm run typecheck → exit 2')
  })

  it('la même commande rouge PUIS verte dans le terminal : prouvé', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('fini')], {
          testsDuTerminal: [
            terminal('npx vitest run a.test.ts', 1, 3),
            terminal('npx vitest run a.test.ts', 0, 4)
          ]
        })
      ]
    })
    expect(etapes[0].statut).toBe('prouve')
  })

  it('un rouge rejoué vert dans une commande plus large : prouvé (conv-1423)', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('fini')], {
          testsDuTerminal: [
            terminal('npx vitest run a.test.ts', 1, 3),
            terminal('npx vitest run a.test.ts b.test.ts', 0, 4)
          ]
        })
      ]
    })
    expect(etapes[0].statut).toBe('prouve')
    expect(etapes[0].constat).toBe('npx vitest run a.test.ts b.test.ts → exit 0')
  })

  it('jumeau : un vert sur une partie seulement laisse le rouge', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('fini')], {
          testsDuTerminal: [
            terminal('npx vitest run a.test.ts b.test.ts', 1, 3),
            terminal('npx vitest run a.test.ts', 0, 4)
          ]
        })
      ]
    })
    expect(etapes[0].statut).toBe('refuse')
  })

  it('un vert complet joué par `verify` rachète un rouge du terminal, d’une réponse à l’autre', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('j’y retourne')], {
          testsDuTerminal: [terminal('npx vitest run a.test.ts', 1, 3)]
        }),
        asst(5, [verify('npx vitest run', 0)])
      ]
    })
    expect(etapes[0].statut).toBe('prouve')
  })

  /* Objection du contrôle final (conv-1423) : la voie proposée par la relance laissait « Bloqué ». */
  it('un `verify` sur le fichier de test rachète le rouge du terminal, avec son vrai libellé', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('j’y retourne')], {
          testsDuTerminal: [terminal('npx vitest run src/a.test.ts', 1, 3)]
        }),
        asst(5, [verify('npm run test:unit -- src/a.test.ts', 0)])
      ]
    })
    expect(etapes[0].statut).toBe('prouve')
  })

  it('un `verify` sur un autre fichier de test ne rachète rien', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('j’y retourne')], {
          testsDuTerminal: [terminal('npx vitest run src/a.test.ts', 1, 3)]
        }),
        asst(5, [verify('npm run test:unit -- src/b.test.ts', 0)])
      ]
    })
    expect(etapes[0].statut).toBe('refuse')
  })

  /* Objection du contrôle final (conv-1423) : un `cd` perdu donnait « Fait » à tort sur le Board. */
  describe('un test lancé après un changement de dossier', () => {
    const ailleurs = (commande: string, codeDeSortie: number, at: number, cd: string): unknown => ({
      commande,
      codeDeSortie,
      at,
      changementDeDossier: cd
    })
    const statut = (...tests: unknown[]): { statut: string; constat: string } => {
      const { etapes } = carteDuFil({
        fil: [user('corrige', 1), asst(2, [texte('fini')], { testsDuTerminal: tests })]
      })
      return etapes[0]
    }

    it('ne rachète pas un rouge du dossier courant', () => {
      const etape = statut(
        terminal('npx vitest run src/main/a.test.ts', 1, 3),
        ailleurs('npm test', 0, 4, 'cd ../autre-projet')
      )
      expect(etape.statut).toBe('refuse')
      expect(etape.constat).toBe('npx vitest run src/main/a.test.ts → exit 1')
    })

    it('le Board dit où un rouge a tourné', () => {
      expect(statut(ailleurs('npm test', 1, 3, 'cd ../autre')).constat).toBe(
        'cd ../autre && npm test → exit 1'
      )
    })

    it('même commande, autre dossier : le rouge reste', () => {
      expect(
        statut(terminal('npm test', 1, 3), ailleurs('npm test', 0, 4, 'cd ../autre')).statut
      ).toBe('refuse')
    })

    it('rouge ailleurs : un vert du dossier courant ne le rachète pas', () => {
      expect(
        statut(
          ailleurs('npx vitest run a.test.ts', 1, 3, 'cd ../autre'),
          terminal('npm test', 0, 4)
        ).statut
      ).toBe('refuse')
    })

    it('jumeau : la même ligne rejouée dans le même dossier passe', () => {
      expect(
        statut(ailleurs('npm test', 1, 3, 'cd ../autre'), ailleurs('npm test', 0, 4, 'cd ../autre'))
          .statut
      ).toBe('prouve')
    })

    it('jumeau : un test seul après un `cd` prouve son étape, comme avant', () => {
      expect(statut(ailleurs('npm test', 0, 3, 'cd /d/Projet')).statut).toBe('prouve')
    })

    it('jumeau : sans `cd`, le vert plus large rachète toujours le rouge', () => {
      expect(
        statut(terminal('npx vitest run src/main/a.test.ts', 1, 3), terminal('npm test', 0, 4))
          .statut
      ).toBe('prouve')
    })
  })

  it('un vert ANTÉRIEUR au rouge ne rachète rien, même plus large', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('fini')], {
          testsDuTerminal: [
            terminal('npx vitest run', 0, 3),
            terminal('npx vitest run a.test.ts', 1, 4)
          ]
        })
      ]
    })
    expect(etapes[0].statut).toBe('refuse')
  })

  it('le constat d’une commande très longue reste borné et garde son code de sortie', () => {
    const longue = `npx vitest run ${'src/fichier.test.ts '.repeat(50).trim()}`
    expect(longue.length).toBeGreaterThan(900)
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [texte('fini')], { testsDuTerminal: [terminal(longue, 1, 3)] })
      ]
    })
    expect(etapes[0].statut).toBe('refuse')
    expect(etapes[0].constat.length).toBeLessThanOrEqual(320)
    expect(etapes[0].constat).toMatch(/… → exit 1$/u)
  })

  it('la reprise automatique après quota se lit comme une suite, pas comme une demande', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige a.ts', 1),
        asst(2, [texte('Je travaille')], { status: 'failed', error: 'session limit · resets 2am' }),
        user(`${MARQUE_REPRISE_APRES_QUOTA}\nReprends exactement.`, 3),
        asst(4, [texte('fini')], { testsDuTerminal: [terminal('npm test', 0, 5)] })
      ]
    })
    expect(etapes.map((etape) => etape.statut)).toEqual(['refuse', 'prouve'])
    expect(etapes[1].titre).not.toContain('Reprise automatique')
    expect(etapes[1].titre).toMatch(/^Suite/u)
  })

  it('l’ordre réel compte : le constat est la DERNIÈRE preuve, d’où qu’elle vienne', () => {
    const { etapes } = carteDuFil({
      fil: [
        user('corrige', 1),
        asst(2, [{ ...(verify('npm test', 0) as object), at: 9 }], {
          testsDuTerminal: [terminal('npx vitest run a.test.ts', 0, 4)]
        })
      ]
    })
    expect(etapes[0].constat).toBe('npm test → exit 0')
  })
})
