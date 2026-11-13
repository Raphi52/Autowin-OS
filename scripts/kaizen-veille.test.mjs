import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  chargerLesOutils,
  estRecadrage,
  formeDuGeste,
  lecteurDErreurs,
  jourParis,
  normaliserCause,
  refusDeLaFiche,
  releverLaJournee,
  releverLaPeriode
} from './kaizen-veille.mjs'

const T = (iso) => Date.parse(iso)

describe('relevé des ratés de la veille', () => {
  it('reconnaît un recadrage, pas une demande ordinaire', () => {
    for (const t of [
      'ça marche toujours pas',
      'pk ca met 0 caractere transmis?',
      'non, pas ça',
      "j'ai dit le bouton du haut"
    ])
      expect(estRecadrage(t)).toBe(true)
    for (const t of ['ajoute un tri par date dans le rail', 'go', 'pousse sur main'])
      expect(estRecadrage(t)).toBe(false)
  })

  it('range les instants par jour de Paris, minuit compris', () => {
    expect(jourParis('2026-11-07T22:30:00Z')).toBe('2026-11-07')
    expect(jourParis('2026-11-07T23:30:00Z')).toBe('2026-11-08')
  })

  it('classe les fils par gravité et ne garde que le dernier état d’une demande', () => {
    const r = releverLaJournee('2026-11-07', {
      saisies: [
        { ts: T('2026-11-07T09:00:00Z'), conversationId: 'conv-1', texte: 'ajoute le bouton' },
        { ts: T('2026-11-07T09:10:00Z'), conversationId: 'conv-1', texte: 'ça marche pas' },
        { ts: T('2026-11-07T10:00:00Z'), conversationId: 'conv-2', texte: 'fais le rapport' },
        { ts: T('2026-11-06T10:00:00Z'), conversationId: 'conv-3', texte: 'toujours pas' }
      ],
      demandes: [
        {
          ts: 1,
          demandeLe: T('2026-11-07T10:00:00Z'),
          messageId: 'm2',
          conversationId: 'conv-2',
          etat: 'refuse',
          constat: 'arrêté'
        },
        {
          ts: 2,
          demandeLe: T('2026-11-07T10:00:00Z'),
          messageId: 'm2',
          conversationId: 'conv-2',
          etat: 'prouve'
        },
        {
          ts: 1,
          demandeLe: T('2026-11-07T09:00:00Z'),
          messageId: 'm1',
          conversationId: 'conv-1',
          etat: 'refuse',
          constat: 'contrôle final'
        }
      ],
      verdicts: [{ ts: '2026-11-07T11:00:00Z', conversationId: 'conv-2', verdict: 'red' }],
      couts: [],
      gels: [
        { ts: '2026-11-07T12:00:00Z', blocageMs: 2500 },
        { ts: '2026-11-07T12:01:00Z', blocageMs: 900 }
      ]
    })
    expect(r.fils.map((f) => [f.conversationId, f.score])).toEqual([
      ['conv-1', 6],
      ['conv-2', 2]
    ])
    expect(r.fils[1].refus).toEqual([])
    expect(r.totaux.gels).toBe(1)
    expect(r.filsActifs).toBe(2)
  })

  it('lit la raison d’un refus dans la fiche, sans son coût', () => {
    expect(
      normaliserCause('arrêté au contrôle final — intégration locale non terminée · 6,89 $')
    ).toBe('arrêté au contrôle final — intégration locale non terminée')
    const fiche = [
      'Résultat (2026-11-06 21:10 UTC) : prouvé — une question t’attend',
      'Résultat (2026-11-06 22:30 UTC) : refusé — tour arrêté avant la fin',
      'Résultat (2026-11-07 08:00 UTC) : refusé — arrêté au contrôle final — x · 7,31 $'
    ].join('\n')
    expect(refusDeLaFiche(fiche)).toEqual([
      { jour: '2026-11-06', instant: T('2026-11-06T22:30:00Z'), cause: 'tour arrêté avant la fin' },
      {
        jour: '2026-11-07',
        instant: T('2026-11-07T08:00:00Z'),
        cause: 'arrêté au contrôle final — x'
      }
    ])
  })

  it('compte une cause qui revient dans plusieurs fils avant une cause répétée dans un seul', () => {
    const refus = (messageId, conversationId, fiche) => ({
      ts: 1,
      demandeLe: T('2026-11-06T10:00:00Z'),
      messageId,
      conversationId,
      etat: 'refuse',
      fiche
    })
    const fiches = {
      'a/RUN.md':
        'Résultat (2026-11-06 10:00 UTC) : refusé — intégration locale non terminée · 1 $',
      'b/RUN.md':
        'Résultat (2026-11-07 10:00 UTC) : refusé — intégration locale non terminée · 2 $',
      'c/RUN.md': [
        'Résultat (2026-11-06 10:00 UTC) : refusé — échec déjà déclaré',
        'Résultat (2026-11-06 11:00 UTC) : refusé — échec déjà déclaré',
        'Résultat (2026-11-06 12:00 UTC) : refusé — échec déjà déclaré'
      ].join('\n')
    }
    const r = releverLaPeriode(
      { du: '2026-11-06', au: '2026-11-07' },
      {
        saisies: [],
        demandes: [
          refus('m1', 'conv-1', 'a/RUN.md'),
          refus('m2', 'conv-2', 'b/RUN.md'),
          refus('m3', 'conv-3', 'c/RUN.md')
        ],
        verdicts: [],
        couts: [],
        gels: []
      },
      (f) => fiches[f]
    )
    expect(r.causes).toEqual([
      { cause: 'intégration locale non terminée', fois: 2, fils: ['conv-1', 'conv-2'] },
      { cause: 'échec déjà déclaré', fois: 3, fils: ['conv-3'] }
    ])
    // Sur le seul 06/11, le refus du 07 sort de la période.
    const seul = releverLaJournee(
      '2026-11-06',
      {
        saisies: [],
        demandes: [refus('m2', 'conv-2', 'b/RUN.md')],
        verdicts: [],
        couts: [],
        gels: []
      },
      (f) => fiches[f]
    )
    expect(seul.causes).toEqual([
      { cause: 'raison non écrite dans la fiche', fois: 1, fils: ['conv-2'] }
    ])
  })

  describe('interruptions : la fiche coupe la raison avant la vraie cause', () => {
    const ERREUR_LIMITE =
      "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your 5-hour limit · resets 12:50pm (Europe/Paris)"
    const ERREUR_PANNE =
      "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5-5) : spawn claude ENOENT"
    const COUPEE =
      "échec : Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie\n• claude (claude-opus-5-5) : Claude a interrompu l…"
    const ligne = (h) => `Résultat (2026-11-05 ${h} UTC) : refusé — ${COUPEE.replace(/\n/g, ' ')}`
    const demande = (messageId, conversationId, fiche) => ({
      ts: 1,
      demandeLe: T('2026-11-05T08:00:00Z'),
      messageId,
      conversationId,
      etat: 'refuse',
      constat: COUPEE,
      fiche
    })
    const traces = (demandes) => ({ saisies: [], demandes, verdicts: [], couts: [], gels: [] })
    const fiches = { 'a/RUN.md': ligne('07:59'), 'b/RUN.md': ligne('09:26') }
    // Faux classeur : ce test vérifie le RELEVÉ ; la vraie fonction est éprouvée plus bas.
    const classer = (e) => (e.includes('5-hour limit') ? 'limite-d-usage' : undefined)
    const erreurs = { 'conv-1': ERREUR_LIMITE, 'conv-2': ERREUR_PANNE }
    const lireErreur = ({ conversationId }) => erreurs[conversationId]

    it('sort la limite d’usage des causes de refus, et garde la vraie panne', () => {
      const demandes = [demande('m1', 'conv-1', 'a/RUN.md'), demande('m2', 'conv-2', 'b/RUN.md')]
      const r = releverLaPeriode(
        { du: '2026-11-05', au: '2026-11-05' },
        traces(demandes),
        (f) => fiches[f],
        { lireErreur, classer }
      )
      expect(r.interruptions).toEqual([{ motif: 'limite-d-usage', fois: 1, fils: ['conv-1'] }])
      expect(r.causes.map((c) => [c.cause.slice(0, 20), c.fils])).toEqual([
        ['échec : Fan-out buil', ['conv-2']]
      ])
      expect(r.totaux.interruptions).toBe(1)
      // La demande interrompue ne pèse plus dans le fil ; la vraie panne, oui.
      expect(r.fils.map((f) => f.conversationId)).toEqual(['conv-2'])
      expect(r.totaux.refus).toBe(1)
    })

    it('sans lecteur d’erreur, tout reste une cause de refus (comme avant)', () => {
      const r = releverLaPeriode(
        { du: '2026-11-05', au: '2026-11-05' },
        traces([demande('m1', 'conv-1', 'a/RUN.md'), demande('m2', 'conv-2', 'b/RUN.md')]),
        (f) => fiches[f]
      )
      expect(r.interruptions).toEqual([])
      expect(r.causes[0].fois).toBe(2)
    })

    it('relit l’erreur complète dans le journal de tour, même notée des heures après', () => {
      const dossier = mkdtempSync(join(tmpdir(), 'kaizen-veille-'))
      mkdirSync(join(dossier, 'turn-journals', 'conv-1'), { recursive: true })
      const at = T('2026-11-05T07:59:50Z')
      writeFileSync(
        join(dossier, 'turn-journals', 'conv-1', 't.jsonl'),
        [
          JSON.stringify({ kind: 'result', ok: true, data: 'autre', at }),
          JSON.stringify({
            kind: 'result',
            ok: false,
            name: 'orchestrate',
            data: ERREUR_PANNE,
            at
          }),
          JSON.stringify({
            kind: 'result',
            ok: false,
            name: 'orchestrate',
            data: ERREUR_LIMITE,
            at
          })
        ].join('\n')
      )
      const debut =
        "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie • claude (claude-opus-5-5) : Claude a interrompu l"
      const lire = lecteurDErreurs(dossier)
      expect(lire({ conversationId: 'conv-1', instant: T('2026-11-05T09:26:00Z'), debut })).toBe(
        ERREUR_LIMITE
      )
      expect(lire({ conversationId: 'conv-9', instant: at, debut })).toBeUndefined()
    })

    it('reconnaît avec la vraie interruptionSansDefaut, sans recopier ses motifs', async () => {
      const { classer: vraie } = await chargerLesOutils()
      expect(vraie).toBeTypeOf('function')
      expect(vraie(ERREUR_LIMITE)).toBe('limite-d-usage')
      expect(vraie(ERREUR_PANNE)).toBeUndefined()
      const r = releverLaPeriode(
        { du: '2026-11-05', au: '2026-11-05' },
        traces([demande('m1', 'conv-1', 'a/RUN.md'), demande('m2', 'conv-2', 'b/RUN.md')]),
        (f) => fiches[f],
        { lireErreur, classer: vraie }
      )
      expect(r.interruptions.map((i) => i.motif)).toEqual(['limite-d-usage'])
      expect(r.causes).toHaveLength(1)
    })
  })
  describe('gestes répétés : le même texte court tapé dans plusieurs fils', () => {
    const saisie = (iso, conversationId, texte, extra = {}) => ({
      schema: 'autowin.saisie/v1',
      ts: T(iso),
      conversationId,
      texte,
      voie: 'message',
      ...extra
    })
    const traces = (saisies) => ({ saisies, demandes: [], verdicts: [], couts: [], gels: [] })
    const AUTO =
      "Pourquoi tu t'arrêtes ? (Mode auto — dernière demande de l'utilisateur : « ajoute le tri ».)"

    it('ramène les variantes d’un même geste à une seule forme', () => {
      expect(formeDuGeste(' /Git. ')).toBe('/git')
      expect(formeDuGeste('/check conv-1790')).toBe(formeDuGeste('/check conv-1812'))
      expect(formeDuGeste('x'.repeat(121))).toBeUndefined()
      expect(formeDuGeste('...')).toBeUndefined()
    })

    it('compte un geste vu 5 fois sur les 7 derniers jours, sans les envois du mode auto', () => {
      const r = releverLaJournee(
        '2026-11-12',
        traces([
          // 5 « /git » dans la semaine, dont un le premier jour de la fenêtre.
          saisie('2026-11-06T09:00:00Z', 'conv-1', '/git'),
          saisie('2026-11-08T09:00:00Z', 'conv-2', '/Git'),
          saisie('2026-11-10T09:00:00Z', 'conv-2', '/git.'),
          saisie('2026-11-11T09:00:00Z', 'conv-3', '/git'),
          saisie('2026-11-12T09:00:00Z', 'nouvelle-conversation', '/git'),
          // Hors fenêtre (8 jours avant) : ne compte pas.
          saisie('2026-11-05T09:00:00Z', 'conv-4', 'reprend'),
          ...['conv-1', 'conv-2', 'conv-3', 'conv-5'].map((c) =>
            saisie('2026-11-09T09:00:00Z', c, 'reprend')
          ),
          // Un cinquième « reprend », mais envoyé par le mode auto : ce n'est pas un geste tapé.
          saisie('2026-11-09T10:00:00Z', 'conv-6', 'reprend', { origine: 'mode-auto' }),
          ...[1, 2, 3, 4, 5].map((i) => saisie(`2026-11-1${i % 3}T08:00:00Z`, 'conv-7', AUTO))
        ]),
        undefined,
        { estEnvoiAuto: (t) => t.includes('(Mode auto — ') }
      )
      expect(r.gestesDu).toBe('2026-11-06')
      expect(r.gestes).toEqual([{ geste: '/git', fois: 5, fils: ['conv-1', 'conv-2', 'conv-3'] }])
    })

    it('élargit la fenêtre à toute la période quand elle dépasse 7 jours', () => {
      const r = releverLaPeriode(
        { du: '2026-11-01', au: '2026-11-12' },
        traces([1, 2, 3, 4, 5].map((j) => saisie(`2026-11-0${j}T09:00:00Z`, 'conv-1', 'vazy')))
      )
      expect(r.gestesDu).toBe('2026-11-01')
      expect(r.gestes.map((g) => [g.geste, g.fois])).toEqual([['vazy', 5]])
    })

    it('ne prend pas l’envoi du mode auto pour un recadrage de l’utilisateur', () => {
      const r = releverLaJournee(
        '2026-11-10',
        traces([
          saisie('2026-11-10T08:00:00Z', 'conv-1', AUTO),
          saisie('2026-11-10T09:00:00Z', 'conv-1', 'pourquoi', { origine: 'mode-auto' }),
          saisie('2026-11-10T10:00:00Z', 'conv-2', 'pourquoi ça marche pas')
        ]),
        undefined,
        { estEnvoiAuto: (t) => t.includes('(Mode auto — ') }
      )
      expect(r.fils.map((f) => [f.conversationId, f.recadrage.length])).toEqual([['conv-2', 1]])
    })

    it('masque une clé collée, avec la vraie rédaction et la vraie signature du mode auto', async () => {
      const { rediger, estEnvoiAuto } = await chargerLesOutils()
      expect(rediger).toBeTypeOf('function')
      expect(estEnvoiAuto(AUTO)).toBe(true)
      const cle = 'sk-or-v1-FAUXFAUXFAUXFAUXFAUXFAUXFAUXFAUX'
      const r = releverLaJournee(
        '2026-11-10',
        traces([
          ...[1, 2, 3, 4, 5].map((h) => saisie(`2026-11-10T0${h}:00:00Z`, 'conv-1', cle)),
          saisie('2026-11-10T08:00:00Z', 'conv-1', `ça marche pas avec ${cle}`)
        ]),
        undefined,
        { estEnvoiAuto, rediger }
      )
      const sortie = JSON.stringify(r)
      expect(sortie).not.toContain('FAUXFAUX')
      expect(r.gestes).toEqual([{ geste: '[REDACTED]', fois: 5, fils: ['conv-1'] }])
      expect(r.fils[0].recadrage[0]).toContain('[REDACTED]')
    })
  })
})
