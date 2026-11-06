import { describe, expect, it, vi } from 'vitest'
import {
  messageDeCommit,
  publierSansTour,
  redacteurDeCommit,
  refusDAppartenance,
  titreDuModele,
  type DepsSansTour
} from './git-apres-fil-sans-tour'
import type { ProprietaireDeFichier } from '../fichiers/proprietaire-fichier'
import type { GitRunner } from '../runs/run-autoclose'

/** Un fichier écrit seul, diff encore le sien : il part. */
function fichier(partiel: Partial<ProprietaireDeFichier> = {}): ProprietaireDeFichier {
  return {
    chemin: 'src/a.ts',
    nonCommite: true,
    fils: [{ conversation: 'conv-1', le: '2026-11-05T06:00:00Z', toi: true, diffInchange: true }],
    copiesDeRun: [],
    amont: { commits: [] },
    resume: '',
    ...partiel
  }
}

function deps(partiel: Partial<DepsSansTour> = {}) {
  const appels: string[][] = []
  const runGit: GitRunner = async (args) => {
    appels.push(args)
    return args[0] === 'ls-files' ? 'src/a.ts\n' : args[0] === 'diff' ? '+ligne' : ''
  }
  const commiter = vi.fn<DepsSansTour['commiter']>(async (message, fichiers, git) => {
    await git(['commit', '--only', '-m', message, '--', ...fichiers], 'D:/depot')
    await git(['push', 'origin', 'abc:main'], 'D:/depot', { env: { ALLOW_MAIN_PUSH: '1' } })
    return { status: 'pushed', branch: 'main', files: fichiers.length, mode: 'direct' }
  })
  const rediger = vi.fn<DepsSansTour['rediger']>(async () => 'fix(chat): le bouton revient')
  const d: DepsSansTour = {
    repo: 'D:/depot',
    runGit,
    proprietaires: async (chemins) => ({
      fichiers: chemins.map((chemin) => fichier({ chemin })),
      copiesDeRunLues: 0,
      copiesDeRunIllisibles: 0
    }),
    typer: async () => ({ statut: 'sans-objet' }),
    verifier: async () => ({ statut: 'vert', commande: 'vitest', testsJoues: 3 }),
    rediger,
    commiter,
    ...partiel
  }
  return { d, appels, commiter, rediger }
}

const passe = { fil: 'conv-1', fichiers: ['src/a.ts'], fils: ['conv-1'], travaux: 0 }

describe('refusDAppartenance — ce qui ne part pas sans tri par contenu', () => {
  const fils = new Set(['conv-1'])
  it('laisse partir un fichier écrit par le seul fil de la passe', () => {
    expect(refusDAppartenance(fichier(), fils)).toBeUndefined()
  })
  it('retient un fichier aussi touché par un autre fil, même si le diff est le nôtre', () => {
    const f = fichier({
      fils: [
        { conversation: 'conv-1', le: '2', toi: true, diffInchange: true },
        { conversation: 'conv-8', le: '1', toi: false, diffInchange: false }
      ]
    })
    expect(refusDAppartenance(f, fils)).toBe('aussi touché par conv-8')
  })
  it('retient un fichier sans fil tracé, retouché hors fil, en copie de run ou changé en amont', () => {
    expect(refusDAppartenance(fichier({ fils: [] }), fils)).toContain('aucun fil')
    expect(
      refusDAppartenance(
        fichier({ fils: [{ conversation: 'conv-1', le: '1', toi: true, diffInchange: false }] }),
        fils
      )
    ).toContain('hors de tout fil')
    expect(
      refusDAppartenance(fichier({ copiesDeRun: [{ run: 'run-x', etat: 'non commité' }] }), fils)
    ).toContain('run-x')
    expect(refusDAppartenance(fichier({ amont: { commits: ['abc x'] } }), fils)).toContain(
      'en amont'
    )
  })
})

describe('titreDuModele — la forme exigée par AGENTS.md, sinon rien', () => {
  it('garde un titre conforme et retire un numéro de fil glissé par le modèle', () => {
    expect(titreDuModele('fix(chat): le bouton revient')).toBe('fix(chat): le bouton revient')
    expect(titreDuModele('`feat(git): publie sans tour (conv-12)`\n')).toBe(
      'feat(git): publie sans tour'
    )
  })
  it('refuse une réponse bavarde, vide ou trop longue', () => {
    expect(titreDuModele('Voici le message : fix(chat): x')).toBeUndefined()
    expect(titreDuModele('')).toBeUndefined()
    expect(titreDuModele(`fix(chat): ${'x'.repeat(120)}`)).toBeUndefined()
  })
  it('met chaque fil dans sa parenthèse, que commitsPublies retrouve', () => {
    expect(messageDeCommit('fix(chat): x', ['conv-1', 'conv-2'])).toBe(
      'fix(chat): x (conv-1) (conv-2)'
    )
  })
})

describe('publierSansTour', () => {
  it('commite et pousse avec le titre du petit modèle, et rend les lignes git vraiment lancées', async () => {
    const { d, commiter, rediger } = deps()
    const issue = await publierSansTour(d, passe)
    expect(issue).toMatchObject({ publie: true, aTrier: [], notes: [] })
    expect(commiter.mock.calls[0]![0]).toBe('fix(chat): le bouton revient (conv-1)')
    expect(commiter.mock.calls[0]![1]).toEqual(['src/a.ts'])
    expect(rediger.mock.calls[0]![0]).toContain('+ligne')
    expect(issue.lignesShell).toEqual([
      'git commit --only -m "fix(chat): le bouton revient (conv-1)" -- src/a.ts',
      'ALLOW_MAIN_PUSH=1 git push origin abc:main'
    ])
  })

  it('tout ou rien : un fichier d’un autre fil retient la passe entière, sans commit', async () => {
    const { d, commiter, rediger } = deps({
      proprietaires: async () => ({
        fichiers: [
          fichier(),
          fichier({
            chemin: 'src/b.ts',
            fils: [{ conversation: 'conv-8', le: '1', toi: false, diffInchange: true }]
          })
        ],
        copiesDeRunLues: 0,
        copiesDeRunIllisibles: 0
      })
    })
    const issue = await publierSansTour(d, { ...passe, fichiers: ['src/a.ts', 'src/b.ts'] })
    expect(issue.publie).toBe(false)
    expect(issue.aTrier).toEqual(['src/b.ts : aussi touché par conv-8'])
    expect(commiter).not.toHaveBeenCalled()
    expect(rediger).not.toHaveBeenCalled()
  })

  it('rouge = rien ne part, et la raison est dite', async () => {
    const typage = deps({
      typer: async () => ({
        statut: 'echec',
        projets: [],
        commande: 'tsc',
        erreurs: ['a.ts: TS2304']
      })
    })
    expect((await publierSansTour(typage.d, passe)).aTrier[0]).toContain('typage rouge')
    expect(typage.commiter).not.toHaveBeenCalled()
    const tests = deps({
      verifier: async () => ({
        statut: 'echec',
        commande: 'vitest',
        detail: '1 rouge',
        testsEnEchec: ['a.test.ts']
      })
    })
    expect((await publierSansTour(tests.d, passe)).aTrier[0]).toContain('tests rouges')
    expect(tests.commiter).not.toHaveBeenCalled()
  })

  it('petit modèle en panne ou hors format : titre de secours, et le bandeau le dit', async () => {
    const { d, commiter } = deps({
      rediger: async () => {
        throw new Error('quota')
      }
    })
    const issue = await publierSansTour(d, passe)
    expect(issue.publie).toBe(true)
    expect(commiter.mock.calls[0]![0]).toBe('chore(publication): travail terminé du fil (conv-1)')
    expect(issue.notes[0]).toContain('quota')
  })

  it('un fichier déjà commité n’a plus rien à publier', async () => {
    const { d, commiter } = deps({
      proprietaires: async () => ({
        fichiers: [fichier({ nonCommite: false })],
        copiesDeRunLues: 0,
        copiesDeRunIllisibles: 0
      })
    })
    expect(await publierSansTour(d, passe)).toEqual({
      publie: false,
      lignesShell: [],
      notes: [],
      aTrier: []
    })
    expect(commiter).not.toHaveBeenCalled()
  })

  it('les travaux d’agents ne se reprennent jamais seuls : ils vont à la note', async () => {
    const { d } = deps()
    const issue = await publierSansTour(d, { ...passe, fichiers: [], travaux: 2 })
    expect(issue.aTrier[0]).toContain('2 travail(s) d’agent')
  })

  it('un plan : chaque lot auteur dans sa parenthèse', async () => {
    const { d, commiter } = deps({
      proprietaires: async () => ({
        fichiers: [
          fichier({ fils: [{ conversation: 'conv-2', le: '2', toi: false, diffInchange: true }] }),
          fichier({
            chemin: 'src/b.ts',
            fils: [{ conversation: 'conv-3', le: '2', toi: false, diffInchange: true }]
          })
        ],
        copiesDeRunLues: 0,
        copiesDeRunIllisibles: 0
      })
    })
    await publierSansTour(d, {
      fil: 'conv-1',
      fichiers: ['src/a.ts', 'src/b.ts'],
      fils: ['conv-1', 'conv-2', 'conv-3'],
      travaux: 0
    })
    expect(commiter.mock.calls[0]![0]).toBe('fix(chat): le bouton revient (conv-2) (conv-3)')
  })

  /*
   * VRAI CAS (05/11/2026) : la découpe de `commands.ts` en `commands/*.ts` — 18 fichiers —
   * est écrite par UN script, en une seconde, à 08:13:00 (07:13:00 UTC). Aucun fil ne les a écrits
   * avec un outil : des fils les ont seulement VUS changer, à la
   * comparaison de fin de tour (`vueParComparaison`, conversation-file-trace-spool.ts). Le refus
   * « aussi touché par conv-1575, conv-1577 » était juste, mais il partait en note `/git`
   * Qui n'avait rien écrit : un tour entier payé pour conclure « rien à publier ».
   */
  const decoupeDeCommands = [
    'src/main/commands/commands.ts',
    'src/main/commands/application.ts',
    'src/main/commands/conversations.ts',
    'src/main/commands/orchestration.ts',
    'src/main/skills/skill-routing.phases-canoniques.test.ts',
    'src/renderer/src/components/chat-auto-mode.ts',
    'src/shared/garde-git-destructeur.ts',
    'src/shared/orchestration-outcome.ts',
    'src/main/commands/arguments.ts',
    'src/main/commands/instantanes.ts',
    'src/main/commands/navigateur-terminal.ts',
    'src/main/commands/orchestration-entrees.ts',
    'src/main/commands/publication.ts',
    'src/main/commands/refus.ts',
    'src/main/commands/rejeu.ts',
    'src/main/commands/skills.ts',
    'src/main/commands/types.ts',
    'src/renderer/src/components/chat-auto-mode.prochaine-demande.test.ts'
  ]
  const vuAFinDeTour = (conversation: string, toi = false) => ({
    conversation,
    le: '2026-11-05T07:13:00.000Z',
    toi,
    diffInchange: true,
    vuSeulement: true as const
  })
  const vusParTroisFils = (chemins: string[]) =>
    chemins.map((chemin) =>
      fichier({
        chemin,
        fils: [
          vuAFinDeTour('conv-1587', true),
          vuAFinDeTour('conv-1577'),
          vuAFinDeTour('conv-1575')
        ]
      })
    )
  const passeDe1587 = {
    fil: 'conv-1587',
    fichiers: decoupeDeCommands,
    fils: ['conv-1587'],
    travaux: 0
  }

  it('pas de note /git pour un fil qui a seulement VU changer les fichiers d’un script (conv-1587)', async () => {
    const typer = vi.fn<DepsSansTour['typer']>(async () => ({ statut: 'sans-objet' }))
    const { d, commiter, rediger } = deps({
      typer,
      proprietaires: async (chemins) => ({
        fichiers: vusParTroisFils(chemins),
        copiesDeRunLues: 8,
        copiesDeRunIllisibles: 0
      })
    })

    const issue = await publierSansTour(d, passeDe1587)

    // aTrier vide = `git-apres-fil.ts` n'annonce aucune note `/git` dans le fil.
    expect(issue).toEqual({ publie: false, lignesShell: [], notes: [], aTrier: [] })
    expect(typer).not.toHaveBeenCalled()
    expect(rediger).not.toHaveBeenCalled()
    expect(commiter).not.toHaveBeenCalled()
  })

  it('garde la note /git quand le fil a VRAIMENT écrit un fichier qu’un autre fil touche aussi', async () => {
    const { d, commiter } = deps({
      proprietaires: async (chemins) => {
        const fichiers = vusParTroisFils(chemins)
        // a écrit ce fichier-là avec un outil (Edit/Write) : c'est son travail.
        fichiers[0] = fichier({
          chemin: fichiers[0]!.chemin,
          fils: [
            {
              conversation: 'conv-1587',
              le: '2026-11-05T07:14:00.000Z',
              toi: true,
              diffInchange: true
            },
            vuAFinDeTour('conv-1575')
          ]
        })
        return { fichiers, copiesDeRunLues: 0, copiesDeRunIllisibles: 0 }
      }
    })

    const issue = await publierSansTour(d, passeDe1587)

    expect(issue.aTrier).toEqual(['src/main/commands/commands.ts : aussi touché par conv-1575'])
    expect(commiter).not.toHaveBeenCalled()
  })

  it('publie toujours ce qu’un fil a seul vu naître : une commande qui écrit sans nommer le fichier', async () => {
    const { d, commiter } = deps({
      proprietaires: async (chemins) => ({
        fichiers: chemins.map((chemin) =>
          fichier({ chemin, fils: [vuAFinDeTour('conv-1', true)] })
        ),
        copiesDeRunLues: 0,
        copiesDeRunIllisibles: 0
      })
    })

    const issue = await publierSansTour(d, passe)

    expect(issue.publie).toBe(true)
    expect(commiter.mock.calls[0]![1]).toEqual(['src/a.ts'])
  })

  /*
   * VRAI CAS (06/11/2026) : un fil ne fait que répondre à des questions sur
   * ElevenLabs. Pendant son premier tour, (le Quartier, un tour de 20 min encore en cours)
   * écrit `quartier-tenue.ts`, `board-dossier.ts`… Ses Edit/Write n'arrivent au journal des fichiers
   * qu'à la FIN de son appel : la comparaison de fin de tour est donc la seule trace, et
   * la passe lit « conv-1641 seul, diff inchangé ». Typage, tests de 42 fichiers, puis une note
   * « GIT : rien publié » posée au milieu d'une réponse sur les voix — et, tests verts, le travail
   * inachevé serait parti sous le nom.
   */
  it('un fichier seulement VU pendant qu’un autre fil du dépôt a un tour en cours n’est pas au fil (conv-1641)', async () => {
    const typer = vi.fn<DepsSansTour['typer']>(async () => ({ statut: 'sans-objet' }))
    const { d, commiter } = deps({
      typer,
      proprietaires: async (chemins) => ({
        fichiers: chemins.map((chemin) =>
          fichier({ chemin, fils: [vuAFinDeTour('conv-1641', true)] })
        ),
        copiesDeRunLues: 1,
        copiesDeRunIllisibles: 0
      }),
      autreTourEnCours: () => true
    })

    const issue = await publierSansTour(d, {
      fil: 'conv-1641',
      fichiers: ['src/renderer/src/quartier/quartier-tenue.ts', 'src/main/board/board-dossier.ts'],
      fils: ['conv-1641'],
      travaux: 0
    })

    // aTrier vide = aucune note `/git` dans le fil ; rien typé, rien commité sous son nom.
    expect(issue).toEqual({ publie: false, lignesShell: [], notes: [], aTrier: [] })
    expect(typer).not.toHaveBeenCalled()
    expect(commiter).not.toHaveBeenCalled()
  })

  it('un fichier ÉCRIT par le fil part encore, même si un autre fil a un tour en cours', async () => {
    const { d, commiter } = deps({ autreTourEnCours: () => true })

    const issue = await publierSansTour(d, passe)

    expect(issue.publie).toBe(true)
    expect(commiter.mock.calls[0]![1]).toEqual(['src/a.ts'])
  })
})

describe('redacteurDeCommit — le modèle des petites tâches d’Agent Studio', () => {
  it('appelle le binding des petites tâches, sans outil, et note son coût', async () => {
    const send = vi.fn(async () => ({
      text: ' fix(chat): x \n',
      provider: 'claude',
      model: 'claude-haiku',
      systemInjected: true
    }))
    const add = vi.fn()
    const rediger = redacteurDeCommit({
      registry: { send } as never,
      roles: { bindingDesPetitesTaches: () => ({ provider: 'claude', model: 'claude-haiku' }) },
      cost: { add } as never
    })
    expect(await rediger('charge', 'conv-1')).toBe('fix(chat): x')
    const [provider, , options] = send.mock.calls[0] as unknown as [
      string,
      unknown,
      Record<string, unknown>
    ]
    expect(provider).toBe('claude')
    expect(options).toMatchObject({ model: 'claude-haiku', toolProfile: 'sans-outil' })
    expect(add.mock.calls[0]![0]).toMatchObject({
      appel: 'messageDeCommit',
      conversationId: 'conv-1'
    })
  })
})
