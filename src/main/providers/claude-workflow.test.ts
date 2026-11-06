import { describe, expect, it } from 'vitest'
import { chantiersDuJournal, lireLigneDeChantier } from '../../shared/chantier-du-tour'
import { statusEstUneAction, statusEstUneLecture } from '../chat/chat-turn-messages'
import {
  SuiviDesChantiers,
  avisDeChantierPrecedent,
  avisDeFinDeChantier,
  cumulerUsage,
  demandeUnChantier,
  intervalleDeLigneMs,
  silenceMaxChantierMs,
  type EvenementCli
} from './claude-workflow'

/*
 * Fragments repris du flux réel du CLI 2.1.314 (`.autowin-tmp/conv-1366/petit.jsonl`, conv-1366,
 * 2026-10-31) : `workflow_progress` tel qu'il arrive, `run_id` et `origin` compris.
 */
const DEBUT: EvenementCli = {
  type: 'system',
  subtype: 'task_started',
  task_id: 'wi4rmejh2',
  run_id: '0mvw1d4lh-ee5ffede',
  tool_use_id: 'toolu_1',
  description: 'Deux agents haiku donnent chacun un nombre',
  task_type: 'local_workflow',
  workflow_name: 'essai-somme-haiku'
}
const agent = (
  index: number,
  state: string,
  plus: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'workflow_agent',
  index,
  label: `compte:${index}`,
  phaseIndex: 1,
  phaseTitle: 'Compte',
  agentId: `a${index}`,
  model: 'claude-haiku-5-5',
  state,
  startedAt: 1793429072322,
  queuedAt: 1793429072301,
  ...plus
})
const progres = (workflow_progress?: unknown[], total_tokens = 0): EvenementCli => ({
  type: 'system',
  subtype: 'task_progress',
  task_id: 'wi4rmejh2',
  run_id: '0mvw1d4lh-ee5ffede',
  usage: { total_tokens, tool_uses: 0, duration_ms: 84 },
  ...(workflow_progress ? { workflow_progress } : {})
})
const FIN: EvenementCli = {
  type: 'system',
  subtype: 'task_notification',
  task_id: 'wi4rmejh2',
  run_id: '0mvw1d4lh-ee5ffede',
  status: 'completed',
  usage: { total_tokens: 12064, tool_uses: 3, duration_ms: 3776 }
}
const PHASES = [
  { type: 'workflow_phase', index: 1, title: 'Compte' },
  { type: 'workflow_phase', index: 2, title: 'Somme' }
]

/** La dernière ligne relayée, relue comme le fera le fil. */
function dernier(suivi: SuiviDesChantiers): ReturnType<typeof lireLigneDeChantier> {
  return lireLigneDeChantier(suivi.ligneCourante() ?? '')
}

describe('demandeUnChantier — la définition de Workflow pèse 8 242 jetons, elle se charge sur demande', () => {
  it.each([
    ['Lance un workflow sur tout src/routes'],
    ['utilise un workflow pour auditer les routes'],
    ['ultracode: audit de toutes les routes'],
    ['use a workflow to audit every route'],
    ['Lance un gros chantier sur les 400 fichiers'],
    ['un chantier de dizaines à centaines d’agents'],
    ['fais ça avec 50 agents'],
    ['une cinquantaine d’agents suffiront'],
    ['des centaines d’agents'],
    ['dozens of agents, please'],
    ['hundreds of agents on this repo'],
    ['Branche-le avec l’outil Workflow'],
    ['relance le workflow']
  ])('oui : %s', (mots) => {
    expect(demandeUnChantier(`<message_utilisateur>${mots}</message_utilisateur>`)).toBe(true)
  })

  it.each([
    ['Corrige le bouton Enregistrer'],
    ['mène ce chantier à bien'],
    ['le workflow RUN.md de ce fil est rouge'],
    ['2 agents suffisent'],
    ['les agents du run'],
    ['quel est le meilleur workflow pour ça ?']
  ])('non : %s', (mots) => {
    expect(demandeUnChantier(`<message_utilisateur>${mots}</message_utilisateur>`)).toBe(false)
  })

  it('ne lit QUE les mots de l’utilisateur : un rappel de conversation ne charge rien', () => {
    const tour =
      "ÉTAT DE L'APP:\n{}\n\n[RAPPEL] lance un workflow, des centaines d'agents\n\n" +
      'UTILISATEUR: <message_utilisateur>Corrige le bouton</message_utilisateur>'
    expect(demandeUnChantier(tour)).toBe(false)
  })

  it('un message sans balise se lit entier', () => {
    expect(demandeUnChantier('Lance un workflow')).toBe(true)
  })

  it('un fil non repris : seule la DERNIÈRE demande compte', () => {
    const fil =
      'UTILISATEUR: <message_utilisateur>Lance un workflow</message_utilisateur>\n\nTOI: fait\n\n' +
      'UTILISATEUR: <message_utilisateur>Merci</message_utilisateur>'
    expect(demandeUnChantier(fil)).toBe(false)
  })
})

describe('SuiviDesChantiers — l’état d’un chantier depuis le flux', () => {
  it('compte les agents en attente, en cours, finis et en échec, par phase', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(
      progres(
        [
          ...PHASES,
          agent(1, 'done', { tokens: 4012 }),
          agent(2, 'progress'),
          agent(3, 'start'),
          agent(4, 'start', { startedAt: undefined }),
          agent(5, 'error', { error: 'boom' }),
          agent(6, 'start', { phaseIndex: 2, phaseTitle: 'Somme' })
        ],
        4012
      ),
      10
    )
    const c = dernier(suivi)
    expect(c).toMatchObject({
      id: 'wi4rmejh2',
      nom: 'essai-somme-haiku',
      statut: 'en-cours',
      enAttente: 1,
      enCours: 3,
      finis: 1,
      echecs: 1,
      jetons: 4012,
      gros: false,
      quota: false
    })
    expect(c?.phases).toEqual([
      { titre: 'Compte', enAttente: 1, enCours: 2, finis: 1, echecs: 1 },
      { titre: 'Somme', enAttente: 0, enCours: 1, finis: 0, echecs: 0 }
    ])
  })

  it('une phase déclarée sans agent garde sa place', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([...PHASES, agent(1, 'start')]), 10)
    expect(dernier(suivi)?.phases.map((p) => p.titre)).toEqual(['Compte', 'Somme'])
  })

  it('fusionne un événement partiel : un agent absent de ce lot garde son état', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'done'), agent(2, 'start')]), 10)
    // Le CLI fusionne lui aussi par `type:index` : on ne suppose pas un instantané complet.
    suivi.recevoir(progres([agent(2, 'done')]), 20)
    expect(dernier(suivi)).toMatchObject({ finis: 2, enCours: 0 })
  })

  it('un événement sans `workflow_progress` met à jour les jetons sans perdre les agents', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'start')]), 10)
    suivi.recevoir(progres(undefined, 9766), 20)
    expect(dernier(suivi)).toMatchObject({ jetons: 9766, enCours: 1 })
  })

  it('les jetons ne redescendent pas sur un événement en retard', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'start')], 9000), 10)
    suivi.recevoir(progres(undefined, 100), 20)
    expect(dernier(suivi)?.jetons).toBe(9000)
  })

  it('signale un très gros chantier : plus de 25 agents', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres(Array.from({ length: 25 }, (_, i) => agent(i + 1, 'start'))), 10)
    expect(dernier(suivi)?.gros).toBe(false)
    suivi.recevoir(progres([agent(26, 'start')]), 20)
    expect(dernier(suivi)?.gros).toBe(true)
  })

  it('signale un très gros chantier : plus de 1,5 million de jetons', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'start')], 1_500_000), 10)
    expect(dernier(suivi)?.gros).toBe(false)
    suivi.recevoir(progres(undefined, 1_500_001), 20)
    expect(dernier(suivi)?.gros).toBe(true)
  })

  it('ferme le chantier à sa notification, et y prend les jetons définitifs', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([...PHASES, agent(1, 'done')], 8043), 10)
    expect(suivi.ouvert()).toBe(true)
    suivi.recevoir(FIN, 20)
    expect(suivi.ouvert()).toBe(false)
    expect(dernier(suivi)).toMatchObject({ statut: 'fini', jetons: 12064 })
  })

  it('un agent encore en cours à la fin du chantier ne reste pas compté en cours', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'done'), agent(2, 'progress')]), 10)
    suivi.recevoir({ ...FIN, status: 'failed' }, 20)
    expect(dernier(suivi)).toMatchObject({ statut: 'echec', enCours: 0, enAttente: 0, finis: 1 })
  })

  it.each([
    ['stopped', 'arrete'],
    ['killed', 'arrete'],
    ['failed', 'echec'],
    ['completed', 'fini']
  ])('statut %s → %s', (status, attendu) => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir({ ...FIN, status }, 20)
    expect(dernier(suivi)?.statut).toBe(attendu)
  })

  it('ignore une tâche qui n’est pas un chantier', () => {
    const suivi = new SuiviDesChantiers()
    const r = suivi.recevoir({ ...DEBUT, task_id: 'b1', task_type: 'local_bash' }, 0)
    expect(r).toEqual({ lignes: [], absorbe: false })
    expect(suivi.ouvert()).toBe(false)
  })

  it('absorbe les tâches shell DES AGENTS : elles ne sont pas des tâches de fond du tour', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    const shell = {
      type: 'system',
      subtype: 'task_started',
      task_id: 'b9iq7eofy',
      owned_by_subagent: true,
      task_type: 'local_bash',
      is_backgrounded: false
    }
    expect(suivi.recevoir(shell, 10).absorbe).toBe(true)
    expect(suivi.ouvert()).toBe(true)
  })

  it('la fin de ces tâches ne porte pas le drapeau : elle se reconnaît à son identifiant', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(
      { type: 'system', subtype: 'task_started', task_id: 'b9', owned_by_subagent: true },
      10
    )
    const fin = { type: 'system', subtype: 'task_notification', task_id: 'b9', status: 'failed' }
    expect(suivi.recevoir(fin, 20)).toEqual({ lignes: [], absorbe: true })
    expect(suivi.recevoir({ ...fin, task_id: 'autre' }, 30).absorbe).toBe(false)
  })

  it('hors chantier, une tâche d’un sous-agent reste au traitement historique', () => {
    const suivi = new SuiviDesChantiers()
    const r = suivi.recevoir(
      { type: 'system', subtype: 'task_started', owned_by_subagent: true, task_id: 'b1' },
      0
    )
    expect(r.absorbe).toBe(false)
  })

  it('reconnaît un chantier reconnu au `task_started` et le dit à l’appelant', () => {
    const suivi = new SuiviDesChantiers()
    expect(suivi.recevoir(DEBUT, 0).absorbe).toBe(true)
    expect(suivi.recevoir(progres([agent(1, 'start')]), 10).absorbe).toBe(true)
    expect(suivi.recevoir(FIN, 20).absorbe).toBe(true)
  })
})

describe('SuiviDesChantiers — le dernier result', () => {
  const resultat = (origin?: unknown): EvenementCli => ({
    type: 'result',
    ...(origin ? { origin } : {})
  })
  const ORIGINE = {
    kind: 'task-notification',
    producer: 'session-task',
    runId: '0mvw1d4lh-ee5ffede'
  }

  it('n’attend rien sans chantier', () => {
    expect(new SuiviDesChantiers().attendUnResultat()).toBe(false)
  })

  it('attend tant que le chantier tourne', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.resultatRecu(resultat())
    expect(suivi.attendUnResultat()).toBe(true)
  })

  it('après la fin du chantier, attend encore le result qui la traite', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.resultatRecu(resultat())
    suivi.recevoir(FIN, 10)
    expect(suivi.attendUnResultat()).toBe(true)
    expect(suivi.resultatRecu(resultat(ORIGINE))).toBe(true)
    expect(suivi.attendUnResultat()).toBe(false)
  })

  it('l’ordre court du CLI : deux result à la fin, le premier ne clôt rien', () => {
    // Mesuré : chantier de 4 s, assistant 1, notification, assistant 2, PUIS result 1 et result 2.
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(FIN, 10)
    expect(suivi.resultatRecu(resultat())).toBe(false)
    expect(suivi.attendUnResultat()).toBe(true)
    expect(suivi.resultatRecu(resultat(ORIGINE))).toBe(true)
    expect(suivi.attendUnResultat()).toBe(false)
  })

  it('le result d’une autre notification ne clôt pas le chantier', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(FIN, 10)
    expect(suivi.resultatRecu(resultat({ kind: 'task-notification', runId: 'autre' }))).toBe(false)
    expect(suivi.attendUnResultat()).toBe(true)
  })
})

describe('SuiviDesChantiers — un chantier sans réponse', () => {
  it('ouvert : sans réponse', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    expect(suivi.chantiersSansReponse().map((c) => c.id)).toEqual(['wi4rmejh2'])
  })

  it('fermé mais sans son result : sans réponse', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir({ ...FIN, status: 'stopped' }, 10)
    expect(suivi.chantiersSansReponse().map((c) => c.statut)).toEqual(['arrete'])
  })

  it('fini et traité : rien à signaler', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(FIN, 10)
    suivi.resultatRecu({
      type: 'result',
      origin: { kind: 'task-notification', runId: '0mvw1d4lh-ee5ffede' }
    })
    expect(suivi.chantiersSansReponse()).toEqual([])
  })
})

describe('SuiviDesChantiers — chantier coupé à un tour précédent', () => {
  // Mesuré (banc-reprise.mjs) : à la reprise de la session, le CLI signale la tâche du tour d'avant.
  const COUPE: EvenementCli = {
    type: 'system',
    subtype: 'task_notification',
    task_id: 'w7jvdxob3',
    status: 'stopped',
    summary:
      'Background workflow "vite-puis-attente" (run wf_b514ec3e-d22) didn\'t finish before the previous session ended'
  }

  it('n’est pas une tâche de fond perdue : ses agents finis restent repris du cache', () => {
    const suivi = new SuiviDesChantiers()
    expect(suivi.recevoir(COUPE, 0)).toEqual({ lignes: [], absorbe: true })
    expect(suivi.chantiersCoupes()).toEqual(['vite-puis-attente'])
  })

  it('l’avis dit comment le reprendre, avec les mots qui chargent l’outil', () => {
    const avis = avisDeChantierPrecedent('vite-puis-attente')
    expect(avis).toContain('vite-puis-attente')
    expect(avis).toContain('relance le workflow')
    expect(demandeUnChantier('relance le workflow')).toBe(true)
  })

  it('se tait s’il vient d’être relancé dans ce même appel', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(COUPE, 0)
    suivi.recevoir(DEBUT, 10)
    expect(suivi.chantiersCoupes()).toEqual([])
  })

  it('ne l’annonce qu’une fois', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(COUPE, 0)
    suivi.chantiersCoupes()
    expect(suivi.chantiersCoupes()).toEqual([])
  })

  it('une tâche de fond ordinaire d’un tour précédent garde son traitement', () => {
    const suivi = new SuiviDesChantiers()
    const r = suivi.recevoir({ ...COUPE, summary: 'Background shell command stopped' }, 0)
    expect(r.absorbe).toBe(false)
    expect(suivi.chantiersCoupes()).toEqual([])
  })
})

describe('SuiviDesChantiers — ligne relayée au fil, sans inonder le journal', () => {
  it('relaie la première ligne tout de suite', () => {
    const suivi = new SuiviDesChantiers()
    expect(suivi.recevoir(DEBUT, 0).lignes).toHaveLength(1)
  })

  it('tient le rythme : pas plus d’une ligne par intervalle, même si tout change', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    expect(suivi.recevoir(progres([agent(1, 'start')]), 100).lignes).toEqual([])
    expect(suivi.recevoir(progres([agent(2, 'start')]), 2_100).lignes).toHaveLength(1)
  })

  it('ne répète pas une ligne identique', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'start')]), 3_000)
    expect(suivi.recevoir(progres([agent(1, 'start')]), 9_000).lignes).toEqual([])
  })

  it('la fin du chantier passe toujours, intervalle ou pas', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    expect(suivi.recevoir(FIN, 1).lignes).toHaveLength(1)
  })

  it('un quota atteint passe tout de suite', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    const r = suivi.recevoir(
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1793446200, rateLimitType: 'five_hour' }
      },
      1
    )
    expect(r.lignes).toHaveLength(1)
    expect(lireLigneDeChantier(r.lignes[0]!)?.quota).toBe(true)
  })

  it('espace les lignes sur un long chantier : le journal d’actions borne à 2 000 lignes', () => {
    expect(intervalleDeLigneMs(60_000)).toBe(2_000)
    expect(intervalleDeLigneMs(10 * 60_000)).toBe(10_000)
    expect(intervalleDeLigneMs(60 * 60_000)).toBe(30_000)
    // Deux heures de chantier : 150 + 150 + 180 lignes au plus.
    let t = 0
    let lignes = 0
    while (t < 2 * 60 * 60_000) {
      lignes += 1
      t += intervalleDeLigneMs(t)
    }
    expect(lignes).toBeLessThan(500)
  })

  it('clore marque les chantiers ouverts, pour la carte d’un tour arrêté', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'progress')]), 10)
    const lignes = suivi.clore('arrete', 20)
    expect(lignes).toHaveLength(1)
    expect(lireLigneDeChantier(lignes[0]!)).toMatchObject({ statut: 'arrete', enCours: 0 })
    expect(suivi.ouvert()).toBe(false)
    expect(suivi.attendUnResultat()).toBe(false)
    expect(suivi.clore('arrete', 30)).toEqual([])
  })
})

describe('quota — en -p, un chantier ne patiente pas', () => {
  const limite = (status: string): EvenementCli => ({
    type: 'rate_limit_event',
    rate_limit_info: { status, resetsAt: 1793446200, rateLimitType: 'five_hour' }
  })

  it('un refus de quota pendant le chantier se voit sur la carte', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(limite('rejected'), 10)
    expect(dernier(suivi)?.quota).toBe(true)
  })

  it('un simple passage du quota n’alarme personne', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(limite('allowed'), 10)
    suivi.recevoir(limite('allowed_warning'), 20)
    expect(dernier(suivi)?.quota).toBe(false)
  })

  it('un refus avant le chantier ne le marque pas', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(limite('rejected'), 0)
    suivi.recevoir(DEBUT, 10)
    expect(dernier(suivi)?.quota).toBe(false)
  })

  it('un agent mort sur le mur de quota marque le chantier', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(
      progres([agent(1, 'error', { error: "You've hit your session limit · resets 1pm" })]),
      10
    )
    expect(dernier(suivi)).toMatchObject({ quota: true, echecs: 1 })
  })

  it('forme réelle du refus (CLI 2.1.314, banc-quota) : le chantier se dit « completed » quand même', () => {
    const suivi = new SuiviDesChantiers()
    const erreur = "You've hit your 5-hour limit · resets 9:09am (Europe/Paris)"
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'start'), agent(2, 'start'), agent(3, 'start')]), 10)
    suivi.recevoir(
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1793434160, rateLimitType: 'five_hour' }
      },
      20
    )
    suivi.recevoir(
      progres([
        agent(1, 'error', { error: erreur }),
        agent(2, 'error', { error: erreur }),
        agent(3, 'error', { error: erreur })
      ]),
      30
    )
    suivi.recevoir(FIN, 40)
    expect(dernier(suivi)).toMatchObject({ statut: 'fini', quota: true, echecs: 3, finis: 0 })
  })

  it('une autre erreur d’agent ne se déguise pas en quota', () => {
    const suivi = new SuiviDesChantiers()
    suivi.recevoir(DEBUT, 0)
    suivi.recevoir(progres([agent(1, 'error', { error: 'agent stalled on all 6 attempts' })]), 10)
    expect(dernier(suivi)).toMatchObject({ quota: false, echecs: 1 })
  })
})

describe('avisDeFinDeChantier', () => {
  const base = {
    id: 'x',
    nom: 'audit',
    statut: 'fini' as const,
    phases: [],
    enAttente: 0,
    enCours: 0,
    finis: 30,
    echecs: 0,
    jetons: 10,
    gros: false,
    quota: false
  }

  it('se tait quand tout va bien', () => {
    expect(avisDeFinDeChantier(base)).toBe('')
  })

  it('dit le quota, le nombre d’agents perdus et qu’il n’y a pas d’attente', () => {
    const avis = avisDeFinDeChantier({ ...base, quota: true, finis: 12, echecs: 18 })
    expect(avis).toContain('Quota')
    expect(avis).toContain('18')
    expect(avis).toMatch(/ne patiente pas/)
  })

  it('un refus de quota sans agent perdu reste signalé', () => {
    expect(avisDeFinDeChantier({ ...base, quota: true })).toContain('Quota')
  })

  it('dit aussi les agents en échec hors quota', () => {
    const avis = avisDeFinDeChantier({ ...base, finis: 28, echecs: 2 })
    expect(avis).toContain('2 agents')
    expect(avis).not.toContain('Quota')
  })
})

describe('cumulerUsage — deux result, un seul tour', () => {
  it('additionne jetons et coût', () => {
    expect(
      cumulerUsage(
        {
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 50,
          cacheCreationTokens: 20,
          costUsd: 0.5
        },
        {
          inputTokens: 200,
          outputTokens: 20,
          cacheReadTokens: 60,
          cacheCreationTokens: 0,
          costUsd: 0.25
        }
      )
    ).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 110,
      cacheCreationTokens: 20,
      costUsd: 0.75
    })
  })

  it('sans usage précédent, rend le nouveau', () => {
    const b = { inputTokens: 1, outputTokens: 2 }
    expect(cumulerUsage(undefined, b)).toEqual(b)
  })

  it('un coût absent ne devient pas zéro', () => {
    const r = cumulerUsage({ inputTokens: 1, outputTokens: 1 }, { inputTokens: 1, outputTokens: 1 })
    expect(r).not.toHaveProperty('costUsd')
  })
})

describe('format partagé avec le fil', () => {
  it('le journal rejoué rend le dernier état de chaque chantier, dans l’ordre', () => {
    const suivi = new SuiviDesChantiers()
    const lignes: string[] = []
    lignes.push(...suivi.recevoir(DEBUT, 0).lignes)
    lignes.push('Bash · ls')
    lignes.push(...suivi.recevoir(progres([agent(1, 'start')]), 3_000).lignes)
    lignes.push(...suivi.recevoir(FIN, 3_001).lignes)
    const chantiers = chantiersDuJournal(lignes)
    expect(chantiers).toHaveLength(1)
    expect(chantiers[0]).toMatchObject({ id: 'wi4rmejh2', statut: 'fini' })
  })
})

describe('un chantier lancé est une action du tour', () => {
  it('l’appel de l’outil compte, les lignes de la carte non', () => {
    expect(statusEstUneAction('Workflow')).toBe(true)
    const ligne = new SuiviDesChantiers().recevoir(DEBUT, 0).lignes[0]!
    expect(statusEstUneAction(ligne)).toBe(false)
    expect(statusEstUneLecture(ligne)).toBe(false)
  })
})

describe('silenceMaxChantierMs', () => {
  it('30 min par défaut, réglable', () => {
    expect(silenceMaxChantierMs({})).toBe(30 * 60_000)
    expect(silenceMaxChantierMs({ AUTOWIN_CHANTIER_SILENCE_MAX_MS: '1000' })).toBe(1000)
    expect(silenceMaxChantierMs({ AUTOWIN_CHANTIER_SILENCE_MAX_MS: 'x' })).toBe(30 * 60_000)
  })
})
