import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTINUATION_INSTRUCTION } from '../chat-continuation'
import { MARGE_APRES_RETOUR_MS, PLAFOND_ATTENTE_MS } from '../runs/reveil-apres-quota'
import { StartupResumeQueue } from '../runs/startup-resume-queue'
import { ENTETE_REPRISE_AUTOMATIQUE, estUneRepriseAutomatique } from './relance-taches-de-fond'
import { MARQUE_REPRISE_APRES_QUOTA, estUneRepriseApresQuota } from '../../shared/reprise-quota'
import {
  VALIDITE_DE_LA_REPRISE_MS,
  composerMessageDeReprise,
  creerRepriseDesFils,
  etatDeRepriseDuFil,
  type FilLu
} from './reprise-fil-apres-quota'

/**
 * REPRISE AUTOMATIQUE D'UN FIL COUPÉ PAR LE QUOTA (conv-1423).
 *
 * Horloge simulée : le test observe les tours relancés eux-mêmes, avec la vraie file séquentielle et
 * le vrai réveil. Ce qui ferait échouer ces tests : un second essai, une reprise par-dessus un
 * message de l'utilisateur, ou un écran qui annonce autre chose que ce qui part.
 */
const COUPE_A = Date.parse('2026-11-01T10:00:00+01:00')
const RETOUR = Date.parse('2026-11-01T23:00:00+01:00')
const DEPART = RETOUR + MARGE_APRES_RETOUR_MS
const MUR = "You've hit your 5-hour limit · resets 11pm (Europe/Paris)"

const demande = (content: string): FilLu['messages'][number] => ({
  role: 'user',
  content,
  ts: COUPE_A - 1000
})
const coupure = (partiel: Partial<FilLu['messages'][number]> = {}): FilLu['messages'][number] => ({
  role: 'assistant',
  content: 'Je travaille',
  ts: COUPE_A,
  status: 'failed',
  error: MUR,
  runtime: { provider: 'claude', ouvertDepuisLeChat: true },
  ...partiel
})
const filCoupe = (id: string, partiel: Partial<FilLu> = {}): FilLu => ({
  id,
  messages: [demande('corrige a.ts'), coupure()],
  ...partiel
})
/**
 * Les DEUX ordres existent (`store/conversations.ts`, `append`) : une consigne passe AVANT un
 * brouillon encore vierge, et APRÈS une réponse déjà commencée, donc en dernier message du fil.
 *
 * fix-ok: un fil coupé dont le dernier message est une consigne (ordre réel, `append` du store) était
 * lu « pas coupé » par `fil.messages.at(-1)` : il ne repartait pas et l'écran ne donnait aucune raison.
 */
const consigne: FilLu['messages'][number] = { ...demande('fais aussi b.ts'), orientation: true }

describe('etatDeRepriseDuFil — ce que l’écran annonce et ce qui part', () => {
  const etat = (
    fil: FilLu,
    partiel: Partial<Parameters<typeof etatDeRepriseDuFil>[0]> = {}
  ): ReturnType<typeof etatDeRepriseDuFil> =>
    etatDeRepriseDuFil({
      fil,
      maintenant: COUPE_A + 60_000,
      planDeLots: () => false,
      runAReprendre: () => false,
      ...partiel
    })

  it('nominal : repart à l’heure annoncée, avec la marge du réveil des runs', () => {
    expect(etat(filCoupe('a'))).toEqual({ etat: 'attente', reprendA: DEPART })
  })

  it('« resets 2am » lu à 23 h : le lendemain', () => {
    const ts = Date.parse('2026-11-01T23:00:00+01:00')
    const fil = filCoupe('a', {
      messages: [
        demande('x'),
        coupure({ ts, error: "You've hit your session limit · resets 2am (Europe/Paris)" })
      ]
    })
    expect(etat(fil, { maintenant: ts + 1 })).toEqual({
      etat: 'attente',
      reprendA: Date.parse('2026-11-02T02:00:00+01:00') + MARGE_APRES_RETOUR_MS
    })
  })

  it('l’heure se lit depuis la coupure, pas depuis maintenant', () => {
    // Lu le lendemain à 8 h, « resets 11pm » désignerait sinon le soir suivant.
    const lendemain = Date.parse('2026-11-02T08:00:00+01:00')
    expect(etat(filCoupe('a'), { maintenant: lendemain })).toEqual({
      etat: 'attente',
      reprendA: DEPART
    })
  })

  it.each([
    ['fil vide', []],
    ['dernier message de l’utilisateur', [coupure(), demande('je reprends la main')]],
    ['tour réussi', [demande('x'), coupure({ status: 'completed', error: undefined })]],
    ['tour en cours', [demande('x'), coupure({ status: 'streaming', error: undefined })]],
    ['tour arrêté', [demande('x'), coupure({ status: 'cancelled' })]],
    ['vraie erreur', [demande('x'), coupure({ error: 'ENOENT: fichier introuvable' })]],
    ['erreur vide', [demande('x'), coupure({ error: '   ' })]],
    ['erreur absente', [demande('x'), coupure({ error: undefined })]],
    [
      'rate-limit passager',
      [demande('x'), coupure({ error: 'rate limit exceeded, retry after 30s' })]
    ]
  ])('rien à reprendre : %s', (_cas, messages) => {
    expect(etat({ id: 'a', messages })).toBeUndefined()
  })

  it.each([
    ['sans heure', "You've hit your session limit"],
    ['heure impossible', "You've hit your session limit · resets 13pm"],
    ['date impossible', "You've hit your weekly limit · resets Sep 31, 2am"],
    ['fuseau inconnu', "You've hit your 5-hour limit · resets 11pm (Mars/Base)"],
    ['date trop lointaine', "You've hit your weekly limit · resets Feb 28, 2am"],
    ['date déjà passée', "You've hit your weekly limit · resets Oct 2, 2am"]
  ])('à la main, faute d’heure : %s', (_cas, error) => {
    const fil = filCoupe('a', { messages: [demande('x'), coupure({ error })] })
    expect(etat(fil)).toEqual({ etat: 'manuelle', raison: 'aucune-heure' })
  })

  it('date du message invalide : aucune heure, jamais une date inventée', () => {
    const fil = filCoupe('a', { messages: [demande('x'), coupure({ ts: Number.NaN })] })
    expect(etat(fil)).toEqual({ etat: 'manuelle', raison: 'aucune-heure' })
  })

  it('heure de retour déjà passée, depuis moins de 24 h : repart', () => {
    const maintenant = RETOUR + VALIDITE_DE_LA_REPRISE_MS - 1
    expect(etat(filCoupe('a'), { maintenant })).toEqual({ etat: 'attente', reprendA: DEPART })
  })

  it('24 h après l’heure annoncée, pile : l’intention est périmée', () => {
    expect(etat(filCoupe('a'), { maintenant: RETOUR + VALIDITE_DE_LA_REPRISE_MS })).toEqual({
      etat: 'manuelle',
      raison: 'coupure-ancienne'
    })
  })

  it('un fil de plan de lots, chef ou enfant : jamais automatique', () => {
    expect(etat(filCoupe('a'), { planDeLots: () => true })).toEqual({
      etat: 'manuelle',
      raison: 'plan-de-lots'
    })
  })

  it('un run de ce fil garde son propre réveil', () => {
    expect(etat(filCoupe('a'), { runAReprendre: () => true })).toEqual({
      etat: 'manuelle',
      raison: 'run'
    })
  })

  it('un `orchestrate` dans le tour coupé : relancer le fil paierait le travail deux fois', () => {
    const parts = [{ kind: 'action', name: 'orchestrate', ok: false }]
    const fil = filCoupe('a', { messages: [demande('x'), coupure({ parts })] })
    expect(etat(fil)).toEqual({ etat: 'manuelle', raison: 'run' })
  })

  it('jumeau : une autre action dans le tour coupé n’exclut rien', () => {
    const parts = [{ kind: 'action', name: 'verify', ok: true }]
    const fil = filCoupe('a', { messages: [demande('x'), coupure({ parts })] })
    expect(etat(fil)?.etat).toBe('attente')
  })

  it('un fil marqué inactif à la main ne dépense plus de quota seul', () => {
    expect(etat(filCoupe('a', { inactive: true }))).toEqual({
      etat: 'manuelle',
      raison: 'inactive'
    })
  })

  /*
   * Un tour de règle a des bornes (lecture seule, budget, 6 itérations pour un mail : `chat-dispatch.ts`)
   * et un historique non fiable. Relancé sans elles, il retrouverait tous les droits, sans personne
   * devant l'écran. Trouvé sur `conv-879` (Assistant mails, coupé le 30/09 pendant un mail).
   *
   * fix-ok: `etatDeRepriseDuFil` ne lisait rien de l'origine du tour coupé : `conv-879` sortait
   * « attente » (essai du contrôle final). 21 coupures sur 30 jours, aucune d'une règle, au plus 3
   * ouvertes par un autre fil : n'accepter que le tour marqué coûte peu et couvre les anciens tours.
   */
  describe('un tour qui ne vient pas du chat reste à relancer à la main', () => {
    const horsDuChat = { etat: 'manuelle', raison: 'hors-du-chat' }

    it.each([
      [
        'règle, tâche planifiée ou scout : leur moteur ne porte pas la marque',
        { provider: 'claude' }
      ],
      ['ancien tour, écrit avant la marque', undefined],
      [
        'marque illisible : inconnu ne vaut pas accord',
        { provider: 'claude', ouvertDepuisLeChat: 'oui' as never }
      ]
    ])('%s', (_cas, runtime) => {
      const fil = filCoupe('a', { messages: [demande('trie ce mail'), coupure({ runtime })] })
      expect(etat(fil)).toEqual(horsDuChat)
    })

    it('jumeau : le même tour ouvert depuis le chat repart', () => {
      const fil = filCoupe('a', { messages: [demande('trie ce mail'), coupure()] })
      expect(etat(fil)).toEqual({ etat: 'attente', reprendA: DEPART })
    })

    it('se lit sur le tour coupé, pas sur un tour précédent du fil', () => {
      const fil = filCoupe('a', {
        messages: [
          demande('bonjour'),
          coupure({ status: 'completed', error: undefined }),
          demande('trie ce mail'),
          coupure({ runtime: { provider: 'claude' } })
        ]
      })
      expect(etat(fil)).toEqual(horsDuChat)
    })

    it('une demande tapée après un tour de règle reprend la main : elle seule compte', () => {
      const fil = filCoupe('a', {
        messages: [
          demande('trie ce mail'),
          coupure({ status: 'completed', error: undefined, runtime: { provider: 'claude' } }),
          demande('corrige a.ts'),
          coupure()
        ]
      })
      expect(etat(fil)).toEqual({ etat: 'attente', reprendA: DEPART })
    })

    it('un plan de lots et un run gardent leur raison, plus précise', () => {
      const fil = filCoupe('a', { messages: [demande('x'), coupure({ runtime: undefined })] })
      expect(etat(fil, { planDeLots: () => true })).toEqual({
        etat: 'manuelle',
        raison: 'plan-de-lots'
      })
      expect(etat(fil, { runAReprendre: () => true })).toEqual({ etat: 'manuelle', raison: 'run' })
    })

    it('la coupure de l’essai lui-même reste un essai raté, pas une origine inconnue', () => {
      const fil = filCoupe('a', {
        messages: [
          demande('x'),
          coupure(),
          demande(composerMessageDeReprise()),
          coupure({ runtime: { provider: 'claude' } })
        ]
      })
      expect(etat(fil)).toEqual({ etat: 'essai-rate' })
    })
  })

  /*
   * `fork` recopie tout le tour : statut, erreur, marque d'origine. Une coupure devenait deux fils
   * coupés, donc deux tours payés : `partis ["conv-1","conv-2"]`, essai du nettoyage de conv-1423.
   *
   * fix-ok: `etatDeRepriseDuFil` lisait le tour copié comme un tour du fil, sans regarder
   * `turnConversationId`, que `fork` pose sur chaque tour copié (`store/conversations.ts`).
   */
  describe('une branche posée sur la coupure ne repart pas seule', () => {
    const branche = { etat: 'manuelle', raison: 'branche' }
    const copie = (partiel: Partial<FilLu['messages'][number]> = {}): FilLu['messages'][number] =>
      coupure({ turnConversationId: 'origine', ...partiel })

    it('le tour coupé est une copie : une coupure, un seul départ', () => {
      expect(etat(filCoupe('b', { messages: [demande('x'), copie()] }))).toEqual(branche)
    })

    it('champ vide : inconnu ne vaut pas accord', () => {
      const fil = filCoupe('b', { messages: [demande('x'), copie({ turnConversationId: '' })] })
      expect(etat(fil)).toEqual(branche)
    })

    it('une consigne sous la copie : même lecture', () => {
      expect(etat(filCoupe('b', { messages: [demande('x'), copie(), consigne] }))).toEqual(branche)
    })

    it('jumeau : un tour coupé DANS la branche est le sien, et il repart', () => {
      const fil = filCoupe('b', {
        messages: [
          demande('x'),
          copie({ status: 'completed', error: undefined }),
          demande('essaie autrement'),
          coupure()
        ]
      })
      expect(etat(fil)).toEqual({ etat: 'attente', reprendA: DEPART })
    })

    it('la copie d’un tour de règle dit « branche » : c’est ce qu’on sait d’elle', () => {
      const fil = filCoupe('b', {
        messages: [demande('x'), copie({ runtime: { provider: 'claude' } })]
      })
      expect(etat(fil)).toEqual(branche)
    })

    it('un plan de lots et un run gardent leur raison, plus précise', () => {
      const fil = filCoupe('b', { messages: [demande('x'), copie()] })
      expect(etat(fil, { planDeLots: () => true })).toEqual({
        etat: 'manuelle',
        raison: 'plan-de-lots'
      })
      expect(etat(fil, { runAReprendre: () => true })).toEqual({ etat: 'manuelle', raison: 'run' })
    })

    it('la copie d’un essai raté reste un essai raté : rien ne part', () => {
      const fil = filCoupe('b', { messages: [demande(composerMessageDeReprise()), copie()] })
      expect(etat(fil)).toEqual({ etat: 'essai-rate' })
    })
  })

  it('l’essai a déjà eu lieu : plus aucun départ, le fil le dit', () => {
    const fil = filCoupe('a', {
      messages: [demande('x'), coupure(), demande(composerMessageDeReprise()), coupure()]
    })
    expect(etat(fil)).toEqual({ etat: 'essai-rate' })
  })

  it.each([
    ['avant la réponse', [demande(composerMessageDeReprise()), consigne, coupure()]],
    ['après la réponse', [demande(composerMessageDeReprise()), coupure(), consigne]]
  ])('une consigne glissée pendant l’essai ne rouvre pas un second essai — %s', (_c, messages) => {
    expect(etat(filCoupe('a', { messages }))).toEqual({ etat: 'essai-rate' })
  })

  it('une consigne posée sous la coupure : le fil reste coupé et repart', () => {
    const fil = filCoupe('a', { messages: [demande('corrige a.ts'), coupure(), consigne] })
    expect(etat(fil)).toEqual({ etat: 'attente', reprendA: DEPART })
  })

  it('jumeau : deux consignes sous la coupure, même lecture', () => {
    const fil = filCoupe('a', { messages: [demande('x'), coupure(), consigne, consigne] })
    expect(etat(fil)).toEqual({ etat: 'attente', reprendA: DEPART })
  })

  it('jumeau : un vrai message sous la coupure reprend la main, consigne ou pas', () => {
    const fil = filCoupe('a', {
      messages: [demande('x'), coupure(), consigne, demande('laisse tomber')]
    })
    expect(etat(fil)).toBeUndefined()
  })

  it('une consigne seule dans le fil : rien à reprendre', () => {
    expect(etat({ id: 'a', messages: [consigne] })).toBeUndefined()
  })

  it('l’exclusion se lit aussi sur le tour coupé quand une consigne le suit', () => {
    const parts = [{ kind: 'action', name: 'orchestrate', ok: false }]
    const fil = filCoupe('a', { messages: [demande('x'), coupure({ parts }), consigne] })
    expect(etat(fil)).toEqual({ etat: 'manuelle', raison: 'run' })
  })

  it('une nouvelle demande de l’utilisateur, puis une nouvelle coupure : un nouvel essai', () => {
    const fil = filCoupe('a', {
      messages: [
        demande(composerMessageDeReprise()),
        coupure(),
        demande('reprends plutôt b.ts'),
        coupure()
      ]
    })
    expect(etat(fil)?.etat).toBe('attente')
  })

  it('la reprise d’une tâche de fond n’est pas l’essai après quota', () => {
    const fil = filCoupe('a', {
      messages: [
        demande(`${ENTETE_REPRISE_AUTOMATIQUE} Ton tour précédent s’est terminé`),
        coupure()
      ]
    })
    expect(etat(fil)?.etat).toBe('attente')
  })

  it('plans et runs ne sont lus que pour un fil vraiment coupé (lecture disque pour les runs)', () => {
    const planDeLots = vi.fn(() => false)
    const runAReprendre = vi.fn(() => false)
    etat({ id: 'a', messages: [demande('x')] }, { planDeLots, runAReprendre })
    expect(planDeLots).not.toHaveBeenCalled()
    etat(filCoupe('a', { inactive: true }), { planDeLots, runAReprendre })
    expect(runAReprendre).not.toHaveBeenCalled()
  })
})

describe('composerMessageDeReprise — le message écrit dans le fil', () => {
  it('porte la marque, l’en-tête des reprises automatiques et l’ordre de continuer', () => {
    const message = composerMessageDeReprise()
    expect(estUneRepriseApresQuota(message)).toBe(true)
    expect(estUneRepriseAutomatique(message)).toBe(true)
    expect(MARQUE_REPRISE_APRES_QUOTA.startsWith(ENTETE_REPRISE_AUTOMATIQUE)).toBe(true)
    expect(message).toContain(CONTINUATION_INSTRUCTION)
  })

  it('une phrase de l’utilisateur qui en parle n’est pas la marque', () => {
    expect(estUneRepriseApresQuota('pourquoi « [Reprise automatique] » dans ce fil ?')).toBe(false)
    expect(estUneRepriseApresQuota(undefined)).toBe(false)
  })
})

describe('creerRepriseDesFils — un seul essai, à l’heure, un fil à la fois', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(COUPE_A + 60_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  interface Banc {
    fils: FilLu[]
    occupes: Set<string>
    plans: Set<string>
    runs: Set<string>
    lancerTour: ReturnType<typeof vi.fn>
    lectureDesRuns: ReturnType<typeof vi.fn>
    reprise: ReturnType<typeof creerRepriseDesFils>
  }

  /** Le tour relancé écrit sa demande dans le fil, comme `beginTurn`, puis finit selon `issue`. */
  function banc(
    fils: FilLu[],
    issue: (id: string) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: true })
  ): Banc {
    const occupes = new Set<string>()
    const plans = new Set<string>()
    const runs = new Set<string>()
    const file = new StartupResumeQueue()
    const lancerTour = vi.fn(async (id: string, messages: { role: string; content: string }[]) => {
      const fil = fils.find((f) => f.id === id)!
      fil.messages = [
        ...fil.messages,
        demande(messages.at(-1)!.content),
        coupure({ status: 'streaming', error: undefined })
      ]
      return issue(id)
    })
    // Une copie, comme une vraie lecture : le disque ne suit pas la mémoire tout seul.
    const lectureDesRuns = vi.fn(() => new Set(runs))
    const reprise = creerRepriseDesFils({
      lireFils: () => fils,
      filOccupe: (id) => occupes.has(id),
      filDansUnPlan: (id) => plans.has(id),
      filsAvecRunAReprendre: lectureDesRuns,
      mettreEnFile: (tache) => file.enqueue(tache),
      lancerTour
    })
    return { fils, occupes, plans, runs, lancerTour, lectureDesRuns, reprise }
  }

  /** Laisse passer l'heure, tâches en file comprises. */
  const avancerJusque = async (instant: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(instant - Date.now())
  }

  it('fil éligible : rien avant l’heure, un seul tour après', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART - 1000)
    expect(b.lancerTour).not.toHaveBeenCalled()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
  })

  it('un tour de règle ne part pas, même à l’heure, et ne retient pas le fil voisin', async () => {
    const regle = filCoupe('regle', {
      messages: [demande('trie ce mail'), coupure({ runtime: { provider: 'claude' } })]
    })
    const { lancerTour, reprise } = banc([regle, filCoupe('humain')])
    reprise.replanifier()
    await avancerJusque(DEPART + 60_000)
    expect(lancerTour.mock.calls.map(([id]) => id)).toEqual(['humain'])
    expect(reprise.etatDuFil(regle)).toEqual({ etat: 'manuelle', raison: 'hors-du-chat' })
  })

  it('une coupure et sa branche : un seul tour part, celui du fil d’origine', async () => {
    const branche = filCoupe('branche', {
      messages: [demande('corrige a.ts'), coupure({ turnConversationId: 'origine' })]
    })
    const { lancerTour, reprise } = banc([branche, filCoupe('origine')])
    reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(lancerTour.mock.calls.map(([id]) => id)).toEqual(['origine'])
    expect(reprise.etatDuFil(branche)).toEqual({ etat: 'manuelle', raison: 'branche' })
  })

  it('le tour reçoit l’historique complet, puis le message de reprise', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    // Deux arguments, et aucun modèle : le tour garde celui du fil (`tourCompteDesReception`).
    expect(b.lancerTour.mock.calls[0]).toHaveLength(2)
    const [id, messages] = b.lancerTour.mock.calls[0]
    expect(id).toBe('a')
    expect(messages).toEqual([
      { role: 'user', content: 'corrige a.ts' },
      { role: 'assistant', content: 'Je travaille' },
      { role: 'user', content: composerMessageDeReprise() }
    ])
  })

  it('une consigne sous la coupure part avec l’historique, à sa place', async () => {
    const b = banc([filCoupe('a', { messages: [demande('corrige a.ts'), coupure(), consigne] })])
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
    expect(b.lancerTour.mock.calls[0][1]).toEqual([
      { role: 'user', content: 'corrige a.ts' },
      { role: 'assistant', content: 'Je travaille' },
      { role: 'user', content: 'fais aussi b.ts' },
      { role: 'user', content: composerMessageDeReprise() }
    ])
  })

  it('une consigne arrivée après un départ refusé n’ouvre pas un second essai', async () => {
    // Le mur reste le même : son identité vient de la coupure, pas du dernier message du fil.
    const fil = filCoupe('a')
    const b = banc([fil])
    b.lancerTour.mockImplementationOnce(async () => ({ ok: false, error: 'refusé' }))
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
    fil.messages = [...fil.messages, consigne]
    b.reprise.replanifier()
    await avancerJusque(DEPART + 2 * PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
  })

  it('une coupure 41 h plus tôt reste suivie, quart d’heure après quart d’heure', async () => {
    const ts = Date.parse('2026-11-01T10:00:00+01:00')
    const retour = Date.parse('2026-11-03T03:00:00+01:00')
    const b = banc([
      filCoupe('a', {
        messages: [
          demande('x'),
          coupure({ ts, error: "You've hit your weekly limit · resets Nov 3, 3am (Europe/Paris)" })
        ]
      })
    ])
    b.reprise.replanifier()
    await avancerJusque(retour - 60_000)
    expect(b.lancerTour).not.toHaveBeenCalled()
    await avancerJusque(retour + MARGE_APRES_RETOUR_MS + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
  })

  it('heure déjà passée au démarrage : le fil part aussitôt', async () => {
    vi.setSystemTime(RETOUR + 3_600_000)
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await vi.advanceTimersByTimeAsync(0)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
  })

  it('le même mur replanifié deux fois : un seul départ', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    b.reprise.replanifier()
    await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
  })

  it('essai raté sur le quota : le fil reste coupé, aucun second essai', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    b.fils[0].messages = [...b.fils[0].messages.slice(0, -1), coupure({ ts: Date.now() })]
    b.reprise.replanifier()
    await vi.advanceTimersByTimeAsync(2 * 24 * 3_600_000)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
    expect(b.reprise.etatDuFil(b.fils[0])).toEqual({ etat: 'essai-rate' })
  })

  it('essai raté sur une autre erreur : aucun second essai, l’erreur reste celle du tour', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    b.fils[0].messages = [
      ...b.fils[0].messages.slice(0, -1),
      coupure({ ts: Date.now(), error: 'ENOENT: fichier introuvable' })
    ]
    b.reprise.replanifier()
    await vi.advanceTimersByTimeAsync(2 * 24 * 3_600_000)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
    expect(b.reprise.etatDuFil(b.fils[0])).toBeUndefined()
  })

  it('un redémarrage efface la mémoire : la marque lue dans le fil empêche le second essai', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    b.fils[0].messages = [...b.fils[0].messages.slice(0, -1), coupure({ ts: Date.now() })]

    const apresRedemarrage = banc(b.fils)
    apresRedemarrage.reprise.replanifier()
    await vi.advanceTimersByTimeAsync(2 * 24 * 3_600_000)
    expect(apresRedemarrage.lancerTour).not.toHaveBeenCalled()
  })

  it('un message de l’utilisateur arrivé entre-temps annule le départ', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART - 1000)
    b.fils[0].messages = [...b.fils[0].messages, demande('laisse tomber')]
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).not.toHaveBeenCalled()
  })

  it('un tour en cours au moment de partir : pas de tour par-dessus', async () => {
    const b = banc([filCoupe('a')])
    b.occupes.add('a')
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).not.toHaveBeenCalled()
  })

  it('jumeau : un autre fil occupé ne retient rien', async () => {
    const b = banc([filCoupe('a')])
    b.occupes.add('b')
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
  })

  it('un plan de lots ouvert entre-temps annule le départ', async () => {
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART - 1000)
    b.plans.add('a')
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).not.toHaveBeenCalled()
  })

  it('un run apparu depuis la dernière lecture est vu au moment de partir', async () => {
    // 90 s : le dernier tic du réveil tombe 30 s avant le départ. Sa lecture est encore dans la
    // mémoire d'une minute, et seule la relecture faite au moment de partir peut voir le run.
    vi.setSystemTime(COUPE_A + 90_000)
    const b = banc([filCoupe('a')])
    b.reprise.replanifier()
    await avancerJusque(DEPART - 1000)
    expect(b.reprise.etatDuFil(b.fils[0])?.etat).toBe('attente')
    b.runs.add('a')
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).not.toHaveBeenCalled()
  })

  /*
   * Objection du contrôle final (conv-1423, essai sur le vrai `creerRepriseDesFils`) : fil coupé et
   * marqué inactif, puis réactivé : `attente` à l'écran, 0 minuterie et 0 départ. Rien ne replanifiait
   * un fil qui changeait de situation, et un départ écarté à l'heure gardait sa clé.
   */
  describe('l’écran n’annonce pas un départ qui ne viendrait pas', () => {
    it('fil réactivé avant l’heure : il part à l’heure, sans nouvelle fin de tour', async () => {
      const fil = filCoupe('a', { inactive: true })
      const b = banc([fil])
      b.reprise.replanifier()
      fil.inactive = false
      await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
    })

    it('fil réactivé après l’heure : il part à la relecture suivante', async () => {
      const fil = filCoupe('a', { inactive: true })
      const b = banc([fil])
      b.reprise.replanifier()
      await avancerJusque(DEPART + 3_600_000)
      expect(b.lancerTour).not.toHaveBeenCalled()
      fil.inactive = false
      expect(b.reprise.etatDuFil(fil)?.etat).toBe('attente')
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
    })

    it('fil qui reste inactif : rien ne part', async () => {
      const b = banc([filCoupe('a', { inactive: true })])
      b.reprise.replanifier()
      await avancerJusque(DEPART + 3_600_000)
      expect(b.lancerTour).not.toHaveBeenCalled()
    })

    it('plan terminé après l’heure : le fil part à la relecture suivante', async () => {
      const b = banc([filCoupe('a')])
      b.plans.add('a')
      b.reprise.replanifier()
      await avancerJusque(DEPART + 3_600_000)
      expect(b.lancerTour).not.toHaveBeenCalled()
      b.plans.delete('a')
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
    })

    it('run disparu après l’heure : le fil part à la relecture suivante', async () => {
      const b = banc([filCoupe('a')])
      b.runs.add('a')
      b.reprise.replanifier()
      await avancerJusque(DEPART + 3_600_000)
      expect(b.lancerTour).not.toHaveBeenCalled()
      b.runs.delete('a')
      await vi.advanceTimersByTimeAsync(PLAFOND_ATTENTE_MS + 60_000)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
    })

    it('départ écarté par un tour en cours, fil libéré : il part ensuite, une fois', async () => {
      const b = banc([filCoupe('a')])
      b.occupes.add('a')
      b.reprise.replanifier()
      await avancerJusque(DEPART + 1000)
      expect(b.lancerTour).not.toHaveBeenCalled()
      b.occupes.delete('a')
      await vi.advanceTimersByTimeAsync(2 * PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
    })

    it('départ écarté par un run apparu, run disparu : il part ensuite, une fois', async () => {
      vi.setSystemTime(COUPE_A + 90_000)
      const b = banc([filCoupe('a')])
      b.reprise.replanifier()
      await avancerJusque(DEPART - 1000)
      b.runs.add('a')
      await avancerJusque(DEPART + 1000)
      expect(b.lancerTour).not.toHaveBeenCalled()
      b.runs.delete('a')
      await vi.advanceTimersByTimeAsync(2 * PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
    })

    it('24 h après l’heure, un fil réactivé ne repart plus et dit pourquoi', async () => {
      const fil = filCoupe('a', { inactive: true })
      const b = banc([fil])
      b.reprise.replanifier()
      await avancerJusque(RETOUR + VALIDITE_DE_LA_REPRISE_MS + 1000)
      fil.inactive = false
      await vi.advanceTimersByTimeAsync(2 * PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).not.toHaveBeenCalled()
      expect(b.reprise.etatDuFil(fil)).toEqual({ etat: 'manuelle', raison: 'coupure-ancienne' })
    })

    it('après le départ, plus aucune relecture', async () => {
      const b = banc([filCoupe('a')])
      b.reprise.replanifier()
      await avancerJusque(DEPART + 2 * PLAFOND_ATTENTE_MS)
      expect(b.lancerTour).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    // Le coût : la relecture s'arrête dès que plus rien ne peut repartir, et ne lit pas le disque pour
    // décider. Un vieux fil coupé ne doit pas relire les runs tous les quarts d'heure, à vie.
    it.each<[string, Partial<FilLu>, number]>([
      ['coupure ancienne', { inactive: true }, RETOUR + VALIDITE_DE_LA_REPRISE_MS + 1000],
      [
        'tour de fond',
        { messages: [demande('x'), coupure({ runtime: { provider: 'claude' } })] },
        0
      ],
      ['branche', { messages: [demande('x'), coupure({ turnConversationId: 'origine' })] }, 0],
      [
        'tour avec orchestrate',
        { messages: [demande('x'), coupure({ parts: [{ kind: 'action', name: 'orchestrate' }] })] },
        0
      ],
      [
        'aucune heure',
        { messages: [demande('x'), coupure({ error: "You've hit your session limit" })] },
        0
      ]
    ])('%s : aucun minuteur gardé', (_nom, surcharge, instant) => {
      if (instant) vi.setSystemTime(instant)
      const b = banc([filCoupe('a', surcharge)])
      b.reprise.replanifier()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('essai déjà fait : aucun minuteur gardé', () => {
      const b = banc([
        filCoupe('a', {
          messages: [demande('x'), coupure(), demande(composerMessageDeReprise()), coupure()]
        })
      ])
      b.reprise.replanifier()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('la décision de relire ne touche pas au disque', () => {
      const fil = filCoupe('a', { inactive: true })
      const b = banc([fil])
      b.reprise.replanifier()
      expect(vi.getTimerCount()).toBe(1)
      expect(b.lectureDesRuns).not.toHaveBeenCalled()
    })
  })

  it('dix fils coupés à la même heure partent un par un', async () => {
    const fins = new Map<string, () => void>()
    const ids = Array.from({ length: 10 }, (_, i) => `f${i}`)
    const b = banc(
      ids.map((id) => filCoupe(id)),
      (id) =>
        new Promise((resolve) => {
          fins.set(id, () => resolve({ ok: true }))
        })
    )
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(1)
    for (let rang = 1; rang < 10; rang += 1) {
      const enCours = b.lancerTour.mock.calls.at(-1)![0] as string
      fins.get(enCours)!()
      await vi.advanceTimersByTimeAsync(0)
      expect(b.lancerTour).toHaveBeenCalledTimes(rang + 1)
    }
  })

  it('un tour qui jette n’emporte pas les fils suivants', async () => {
    const b = banc([filCoupe('a'), filCoupe('b')], async (id) => {
      if (id === 'a') throw new Error('refus du modèle')
      return { ok: true }
    })
    b.reprise.replanifier()
    await avancerJusque(DEPART + PLAFOND_ATTENTE_MS)
    expect(b.lancerTour).toHaveBeenCalledTimes(2)
  })

  it('la liste lue souvent ne relit les runs sur disque qu’une fois par minute', () => {
    const b = banc([filCoupe('a')])
    b.reprise.etatDuFil(b.fils[0])
    b.reprise.etatDuFil(b.fils[0])
    expect(b.lectureDesRuns).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    b.reprise.etatDuFil(b.fils[0])
    expect(b.lectureDesRuns).toHaveBeenCalledTimes(2)
  })

  it('aucun fil coupé : aucun minuteur, aucune lecture des runs', () => {
    const b = banc([{ id: 'a', messages: [demande('x')] }])
    b.reprise.replanifier()
    expect(vi.getTimerCount()).toBe(0)
    expect(b.lectureDesRuns).not.toHaveBeenCalled()
  })
})
