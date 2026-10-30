// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TableauDesLots } from './TableauDesLots'
import {
  creerPlan,
  lirePlanDeLots,
  marquerLance,
  noterFinDeTour,
  type PlanDeLots,
  type ReponsePlansDeLots,
  type VuePlanDeLots
} from '../../../shared/plan-de-lots'

/*
 * conv-1150 : le fil chef montre l'avancement de ses lots, et c'est là — et seulement là — que
 * l'utilisateur lance le plan d'un clic.
 */
let ecouteur: ((e: { type: string; scope?: string }) => void) | undefined
let appels: unknown[][] = []
let lecturesDeCout: string[] = []

/** Lignes de coût rendues par `costBreakdown` pour un fil ; 'erreur' = canal qui rejette. */
type CoutsDeTest = Record<string, unknown[] | 'erreur'>

function ligneDeCout(costUsd: number, calls = 2): Record<string, unknown> {
  return {
    key: 'build',
    calls,
    costUsd,
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheHitRatio: 0,
    unpricedCalls: 0
  }
}

function poserApi(parFil: Record<string, VuePlanDeLots | null>, couts?: CoutsDeTest): void {
  appels = []
  lecturesDeCout = []
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    plansDeLots: (
      geste: string,
      fil: string,
      planId?: string,
      lot?: number
    ): Promise<ReponsePlansDeLots> => {
      appels.push(lot === undefined ? [geste, fil, planId] : [geste, fil, planId, lot])
      return Promise.resolve(
        geste === 'voir' ? { ok: true, vue: parFil[fil] ?? null } : { ok: true, detail: 'ok' }
      )
    },
    // Absent quand le test ne donne aucun coût : un shell plus ancien n'expose pas ce canal.
    ...(couts
      ? {
          costBreakdown: (dimension: string, fil: string): Promise<unknown[]> => {
            lecturesDeCout.push(`${dimension}:${fil}`)
            const rendu = couts[fil]
            return rendu === 'erreur'
              ? Promise.reject(new Error('journal illisible'))
              : Promise.resolve(rendu ?? [])
          }
        }
      : {}),
    onAppEvent: (cb: typeof ecouteur) => {
      ecouteur = cb
      return () => {
        ecouteur = undefined
      }
    }
  }
}

async function monter(conversationId: string): Promise<{ hote: HTMLElement; fin: () => void }> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const racine = createRoot(hote)
  await act(async () => {
    racine.render(<TableauDesLots conversationId={conversationId} />)
  })
  return { hote, fin: () => act(() => racine.unmount()) }
}

function plan(): PlanDeLots {
  const lu = lirePlanDeLots({
    titre: 'Traduction anglaise',
    parallele: 2,
    lots: [1, 2, 3].map((n) => ({ titre: `Écrans ${n}`, demande: `/build groupe ${n}` }))
  })
  if (!lu.ok) throw new Error(lu.erreur)
  return creerPlan(lu.plan, { id: 'plan-a', chef: 'conv-1', maintenant: 1 })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TableauDesLots', () => {
  it('plan en attente : les lots, et UN bouton qui annonce lots, parallélisme et plafond', async () => {
    poserApi({ 'conv-1': { plan: plan(), role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    expect(hote.querySelectorAll('.tdl-lot')).toHaveLength(3)
    const bouton = hote.querySelector('.tdl-bouton--principal') as HTMLButtonElement
    expect(bouton.textContent).toBe('Lancer le plan — 3 lots, 2 en parallèle, plafond 6 tours')
    await act(async () => bouton.click())
    expect(appels.at(-1)).toEqual(['accepter', 'conv-1', 'plan-a'])
    fin()
  })

  it('plan en cours : état de chaque lot et fil qui le traite, sans bouton de lancement', async () => {
    let p: PlanDeLots = { ...plan(), statut: 'en-cours' }
    p = marquerLance(p, 1, 'conv-100', 2)
    p = marquerLance(p, 2, 'conv-101', 2)
    p = noterFinDeTour(p, 'conv-100', { ok: false, erreur: 'tests rouges' }, 3).plan
    poserApi({ 'conv-1': { plan: p, role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    const etats = [...hote.querySelectorAll('[data-lot-etat]')].map((l) =>
      l.getAttribute('data-lot-etat')
    )
    expect(etats).toEqual(['echec', 'en-cours', 'a-faire'])
    expect(hote.textContent).toContain('tests rouges')
    expect(hote.textContent).toContain('conv-101')
    expect(hote.textContent).toContain('0 fait, 1 en échec, 1 en cours, 1 à faire sur 3')
    expect(hote.textContent).not.toContain('Lancer le plan')
    expect(hote.textContent).toContain('Arrêter (aucun nouveau lot)')
    fin()
  })

  // conv-1284 (2026-10-29) : le lot qui a posé sa question au chef s'affiche « attend le chef », en
  // pointillé d'alerte et non en rouge, le bilan le compte à part, et « Relancer » reste possible.
  it('un lot qui attend la réponse du chef : son état à lui, compté à part, relançable', async () => {
    let p: PlanDeLots = { ...plan(), statut: 'en-cours' }
    p = marquerLance(p, 1, 'conv-100', 2)
    p = marquerLance(p, 2, 'conv-101', 2)
    p = noterFinDeTour(
      p,
      'conv-100',
      { ok: true, texte: 'Quel nom ?\n\n⛔ Bloqué : j’attends la réponse du chef' },
      3
    ).plan
    poserApi({ 'conv-1': { plan: p, role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    const lot1 = hote.querySelector('[data-lot-etat="attend-chef"]')
    expect(lot1?.classList.contains('tdl-lot--attend-chef')).toBe(true)
    expect(lot1?.querySelector('.tdl-pastille')?.textContent).toBe('attend le chef')
    expect(lot1?.textContent).toContain('question posée au chef conv-1')
    expect(hote.textContent).toContain(
      '0 fait, 0 en échec, 1 en cours, 1 à faire, 1 attend le chef sur 3'
    )
    const relance = hote.querySelector('[data-testid="tdl-lot-1-relancer"]') as HTMLButtonElement
    expect(relance?.disabled).toBe(false)
    await act(async () => relance.click())
    expect(appels.at(-1)).toEqual(['relancer', 'conv-1', 'plan-a', 1])
    fin()
  })

  /*
   * conv-1151, lot 3 : seul l'agent du chef relançait un lot en échec ; l'utilisateur, qui voit
   * l'échec ici, devait lui écrire. Chaque lot en échec porte maintenant son bouton « Relancer ».
   */
  describe('relancer un lot en échec', () => {
    const bouton = (hote: HTMLElement, rang: number): HTMLButtonElement | null =>
      hote.querySelector(`[data-testid="tdl-lot-${rang}-relancer"]`)

    /** Lot 1 en échec dans conv-100, lot 2 en cours dans conv-101, lot 3 à faire. */
    function planAvecEchec(base: PlanDeLots = plan()): PlanDeLots {
      let p: PlanDeLots = { ...base, statut: 'en-cours' }
      p = marquerLance(p, 1, 'conv-100', 2)
      p = marquerLance(p, 2, 'conv-101', 2)
      return noterFinDeTour(p, 'conv-100', { ok: false, erreur: 'tests rouges' }, 3).plan
    }

    it('plan en cours : le seul lot en échec a le bouton, qui envoie « relancer » avec son numéro', async () => {
      poserApi({ 'conv-1': { plan: planAvecEchec(), role: 'chef' } })
      const { hote, fin } = await monter('conv-1')
      const b1 = bouton(hote, 1)
      expect(b1?.textContent).toBe('Relancer')
      expect(b1?.disabled).toBe(false)
      expect(bouton(hote, 2)).toBeNull()
      expect(bouton(hote, 3)).toBeNull()
      await act(async () => b1?.click())
      expect(appels.at(-1)).toEqual(['relancer', 'conv-1', 'plan-a', 1])
      fin()
    })

    it('plan terminé avec un lot en échec : le bouton reste, actif', async () => {
      const p = noterFinDeTour(planAvecEchec(), 'conv-101', { ok: true }, 4).plan
      const termine: PlanDeLots = {
        ...p,
        statut: 'termine',
        lots: p.lots.map((l) => (l.rang === 3 ? { ...l, etat: 'fait' as const } : l))
      }
      poserApi({ 'conv-1': { plan: termine, role: 'chef' } })
      const { hote, fin } = await monter('conv-1')
      expect(bouton(hote, 1)?.disabled).toBe(false)
      expect(bouton(hote, 2)).toBeNull()
      fin()
    })

    it('plafond de tours atteint : bouton grisé, la raison est écrite, le clic n’envoie rien', async () => {
      const p = planAvecEchec({ ...plan(), plafondTours: 2 })
      expect(p.toursLances).toBe(2)
      poserApi({ 'conv-1': { plan: p, role: 'chef' } })
      const { hote, fin } = await monter('conv-1')
      const b1 = bouton(hote, 1)
      expect(b1?.disabled).toBe(true)
      expect(b1?.title).toBe('plafond de 2 tours atteint : relance impossible.')
      expect(hote.querySelector('.tdl-relance-raison')?.textContent).toBe(
        'plafond de 2 tours atteint : relance impossible.'
      )
      const avant = appels.length
      await act(async () => b1?.click())
      expect(appels).toHaveLength(avant)
      fin()
    })

    it('plan suspendu, arrêté ou en attente : aucun bouton « Relancer » (« Reprendre » y suffit)', async () => {
      for (const statut of ['suspendu-quota', 'arrete', 'attente-accord'] as const) {
        poserApi({ 'conv-1': { plan: { ...planAvecEchec(), statut }, role: 'chef' } })
        const { hote, fin } = await monter('conv-1')
        expect(bouton(hote, 1)).toBeNull()
        fin()
      }
    })
  })

  /*
   * conv-1171 : 36 avertissements dépliés poussaient la zone de saisie hors de l'écran. Ils sont
   * repliés derrière un compte, et restent lisibles une fois le plan parti (plus de phase d'accord).
   */
  it('avertissements repliés derrière leur nombre, aussi pendant que le plan tourne', async () => {
    const avertissements = Array.from(
      { length: 36 },
      (_, i) =>
        `les lots 1 et ${i + 2} annoncent le même fichier (src/x.ts) : ils passeront l’un après l’autre.`
    )
    poserApi({
      'conv-1': { plan: { ...plan(), statut: 'en-cours', avertissements }, role: 'chef' }
    })
    const { hote, fin } = await monter('conv-1')
    const bloc = hote.querySelector('[data-testid="tdl-avertissements"]') as HTMLDetailsElement
    expect(bloc.tagName).toBe('DETAILS')
    expect(bloc.open).toBe(false)
    expect(bloc.querySelector('summary')?.textContent).toBe('36 avertissements')
    expect(bloc.querySelectorAll('li')).toHaveLength(36)
    fin()
  })

  /*
   * conv-1284 : ce que chaque lot reçoit en plus de sa demande se lit dans le tableau — le contexte
   * commun et les décisions prises en route, repliés comme les avertissements — et le modèle d'un
   * lot s'affiche à côté de son titre.
   */
  it('contexte, décisions (avec leur auteur) et modèle d’un lot, repliés et lisibles', async () => {
    const base = plan()
    const avecMemoire: PlanDeLots = {
      ...base,
      statut: 'en-cours',
      contexte: 'Traduire les écrans. Décidé : clés en kebab-case, un fichier par écran.',
      decisions: [
        { texte: 'le module s’appelle carte-du-plan.ts', de: 'lot 1', le: 1 },
        { texte: 'on garde le port 5173', de: 'chef', le: 2 }
      ],
      lots: base.lots.map((l) => (l.rang === 2 ? { ...l, modele: 'haiku' } : l))
    }
    poserApi({ 'conv-1': { plan: avecMemoire, role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    const contexte = hote.querySelector('[data-testid="tdl-contexte"]') as HTMLDetailsElement
    expect(contexte.tagName).toBe('DETAILS')
    expect(contexte.open).toBe(false)
    expect(contexte.querySelector('p')?.textContent).toMatch(/^Traduire les écrans/)
    const decisions = hote.querySelector('[data-testid="tdl-decisions"]') as HTMLDetailsElement
    expect(decisions.querySelector('summary')?.textContent).toBe('2 décisions prises en route')
    expect([...decisions.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'le module s’appelle carte-du-plan.ts (lot 1)',
      'on garde le port 5173 (chef)'
    ])
    expect(hote.querySelector('[data-testid="tdl-lot-2-modele"]')?.textContent).toBe(' · haiku')
    expect(hote.querySelector('[data-testid="tdl-lot-1-modele"]')).toBeNull()
    fin()
  })

  it('jumeau : un plan sans contexte ni décision n’affiche aucun bloc vide', async () => {
    poserApi({ 'conv-1': { plan: { ...plan(), statut: 'en-cours' }, role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    expect(hote.querySelector('[data-testid="tdl-contexte"]')).toBeNull()
    expect(hote.querySelector('[data-testid="tdl-decisions"]')).toBeNull()
    fin()
  })

  it('se relit au signal « plans-de-lots » ; un fil sans plan n’affiche rien', async () => {
    poserApi({ 'conv-1': null })
    const { hote, fin } = await monter('conv-1')
    expect(hote.querySelector('[data-testid="tableau-des-lots"]')).toBeNull()
    poserApi({ 'conv-1': { plan: plan(), role: 'chef' } })
    await act(async () => ecouteur?.({ type: 'refresh', scope: 'plans-de-lots' }))
    expect(hote.querySelector('[data-testid="tableau-des-lots"]')).not.toBeNull()
    fin()
  })

  /*
   * conv-1283 : après « Refuser », le tableau restait posé au-dessus de la saisie avec ses lots qui
   * ne partiront jamais. Il se ferme au clic, sans attendre le signal de rafraîchissement.
   */
  describe('plan refusé', () => {
    it('« Refuser » ferme le tableau dès la réponse, sans signal de rafraîchissement', async () => {
      const p = plan()
      poserApi({ 'conv-1': { plan: p, role: 'chef' } })
      const api = (window as unknown as { api: Record<string, unknown> }).api
      const voir = api.plansDeLots as (...a: unknown[]) => Promise<ReponsePlansDeLots>
      api.plansDeLots = (geste: string, ...reste: unknown[]): Promise<ReponsePlansDeLots> =>
        geste === 'refuser'
          ? (appels.push([geste, ...reste]),
            Promise.resolve({ ok: true, plan: { ...p, statut: 'refuse' }, detail: 'plan refusé.' }))
          : voir(geste, ...reste)
      const { hote, fin } = await monter('conv-1')
      const refuser = [...hote.querySelectorAll('.tdl-bouton')].find(
        (b) => b.textContent === 'Refuser'
      ) as HTMLButtonElement
      await act(async () => refuser.click())
      expect(appels.at(-1)).toEqual(['refuser', 'conv-1', 'plan-a'])
      expect(hote.querySelector('[data-testid="tableau-des-lots"]')).toBeNull()
      fin()
    })

    it('un fil dont le plan est refusé n’affiche aucun tableau', async () => {
      poserApi({ 'conv-1': { plan: { ...plan(), statut: 'refuse' }, role: 'chef' } })
      const { hote, fin } = await monter('conv-1')
      expect(hote.querySelector('[data-testid="tableau-des-lots"]')).toBeNull()
      fin()
    })
  })

  /*
   * conv-1283 : le tableau prenait jusqu'à 340 px au-dessus de la saisie pendant tout le plan.
   * « Réduire » ne garde que la ligne de titre ; le choix est retenu par plan, au remontage aussi.
   */
  describe('réduire le tableau', () => {
    afterEach(() => window.localStorage.clear())

    it('« Réduire » ne garde que la ligne de titre ; « Agrandir » rend lots et boutons', async () => {
      poserApi({ 'conv-1': { plan: { ...plan(), statut: 'en-cours' }, role: 'chef' } })
      const { hote, fin } = await monter('conv-1')
      const bascule = (): HTMLButtonElement =>
        hote.querySelector('[data-testid="tdl-reduire"]') as HTMLButtonElement
      expect(bascule().textContent).toBe('Réduire')
      expect(bascule().getAttribute('aria-expanded')).toBe('true')
      await act(async () => bascule().click())
      const tableau = hote.querySelector('[data-testid="tableau-des-lots"]') as HTMLElement
      expect(tableau.getAttribute('data-reduit')).toBe('oui')
      expect(tableau.querySelector('.tdl-titre')?.textContent).toBe('Traduction anglaise')
      expect(tableau.querySelector('.tdl-statut')?.textContent).toBe('en cours')
      expect(tableau.querySelectorAll('.tdl-lot')).toHaveLength(0)
      expect(tableau.querySelector('.tdl-bilan')).toBeNull()
      expect(tableau.querySelector('.tdl-actions')).toBeNull()
      expect(bascule().textContent).toBe('Agrandir')
      expect(bascule().getAttribute('aria-expanded')).toBe('false')
      await act(async () => bascule().click())
      expect(hote.querySelectorAll('.tdl-lot')).toHaveLength(3)
      expect(hote.querySelector('.tdl-actions')).not.toBeNull()
      fin()
    })

    it('réduit reste réduit au remontage, pour ce plan seulement', async () => {
      poserApi({
        'conv-1': { plan: { ...plan(), statut: 'en-cours' }, role: 'chef' },
        'conv-2': { plan: { ...plan(), id: 'plan-b', chef: 'conv-2' }, role: 'chef' }
      })
      const premier = await monter('conv-1')
      await act(async () =>
        (premier.hote.querySelector('[data-testid="tdl-reduire"]') as HTMLButtonElement).click()
      )
      premier.fin()
      const encore = await monter('conv-1')
      expect(
        encore.hote.querySelector('[data-testid="tableau-des-lots"]')?.getAttribute('data-reduit')
      ).toBe('oui')
      expect(encore.hote.querySelectorAll('.tdl-lot')).toHaveLength(0)
      encore.fin()
      const autre = await monter('conv-2')
      expect(autre.hote.querySelectorAll('.tdl-lot')).toHaveLength(3)
      autre.fin()
    })
  })

  /*
   * Constat d'origine (conv-1146) : plus de 20 $ dans un seul fil sans que rien ne le montre. Chaque
   * lot dit donc sa durée et son coût, et le bilan le coût des lots — lu par `costBreakdown` et
   * résumé par le MÊME calcul que la pastille de coût du fil. Un coût inconnu se lit « — », jamais 0.
   */
  describe('durée et coût des lots', () => {
    function planMesure(): PlanDeLots {
      let p: PlanDeLots = { ...plan(), statut: 'en-cours' }
      p = marquerLance(p, 1, 'conv-100', 1_000)
      p = marquerLance(p, 2, 'conv-101', 2_000)
      // Lot 1 : 3 min 12 s entre son lancement et la fin de son tour.
      p = noterFinDeTour(p, 'conv-100', { ok: true }, 1_000 + 192_000).plan
      return p
    }

    const mesure = (hote: HTMLElement, rang: number, quoi: 'duree' | 'cout'): string =>
      hote.querySelector(`[data-testid="tdl-lot-${rang}-${quoi}"]`)?.textContent ?? ''

    it('chaque lot porte sa durée et son coût ; inconnu = « — » ; le bilan somme les lots mesurés', async () => {
      poserApi(
        { 'conv-1': { plan: planMesure(), role: 'chef' } },
        // conv-101 tourne encore : son journal n'a aucun appel → coût inconnu, pas 0.
        { 'conv-100': [ligneDeCout(1.5)], 'conv-101': [] }
      )
      const { hote, fin } = await monter('conv-1')
      expect(lecturesDeCout.sort()).toEqual(['actor:conv-100', 'actor:conv-101'])
      expect(mesure(hote, 1, 'duree')).toBe('3 min 12 s')
      expect(mesure(hote, 1, 'cout')).toBe('1,50 $')
      expect(mesure(hote, 2, 'duree')).toMatch(/^depuis \d{2}:\d{2}$/)
      expect(mesure(hote, 2, 'cout')).toBe('—')
      expect(mesure(hote, 3, 'duree')).toBe('—')
      expect(mesure(hote, 3, 'cout')).toBe('—')
      const total = hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent
      expect(total).toBe('coût des lots 1,50 $ · 1 lot sans mesure')
      expect(hote.textContent).not.toMatch(/(^|[^\d,])0 \$|0,00 \$/)
      fin()
    })

    it('le total additionne les lots par le même calcul que la pastille de coût', async () => {
      poserApi(
        { 'conv-1': { plan: planMesure(), role: 'chef' } },
        { 'conv-100': [ligneDeCout(1.5)], 'conv-101': [ligneDeCout(2), ligneDeCout(0.25, 1)] }
      )
      const { hote, fin } = await monter('conv-1')
      expect(mesure(hote, 2, 'cout')).toBe('2,25 $')
      expect(hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots 3,75 $'
      )
      fin()
    })

    it('aucun coût lisible (canal absent ou en erreur) : « — » partout, jamais 0', async () => {
      poserApi({ 'conv-1': { plan: planMesure(), role: 'chef' } })
      const sansCanal = await monter('conv-1')
      expect(mesure(sansCanal.hote, 1, 'cout')).toBe('—')
      expect(sansCanal.hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots —'
      )
      sansCanal.fin()

      poserApi(
        { 'conv-1': { plan: planMesure(), role: 'chef' } },
        { 'conv-100': 'erreur', 'conv-101': 'erreur' }
      )
      const enErreur = await monter('conv-1')
      expect(mesure(enErreur.hote, 1, 'cout')).toBe('—')
      expect(mesure(enErreur.hote, 2, 'cout')).toBe('—')
      expect(enErreur.hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots —'
      )
      expect(enErreur.hote.textContent).not.toMatch(/0,00 \$/)
      enErreur.fin()
    })

    it('un plan sans lot lancé ne lit aucun coût', async () => {
      poserApi({ 'conv-1': { plan: plan(), role: 'chef' } }, {})
      const { hote, fin } = await monter('conv-1')
      expect(lecturesDeCout).toEqual([])
      expect(hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots —'
      )
      fin()
    })
  })

  it('dans un fil enfant : une ligne nomme le lot et le chef', async () => {
    poserApi({ 'conv-100': { plan: plan(), role: 'enfant', rang: 2 } })
    const { hote, fin } = await monter('conv-100')
    expect(hote.textContent).toContain('Lot 2/3')
    expect(hote.textContent).toContain('mené par conv-1')
    fin()
  })

  /*
   * conv-1315 : en vue chat, la frise de la super conv montre déjà les lots. Le tableau ne garde que
   * ce qu'elle n'a pas — et surtout les gestes sur le plan, qu'aucun autre endroit ne porte.
   */
  describe('à côté de la frise', () => {
    async function monterAvecFrise(fil: string): Promise<{ hote: HTMLElement; fin: () => void }> {
      const hote = document.createElement('div')
      document.body.appendChild(hote)
      const racine = createRoot(hote)
      await act(async () => {
        racine.render(<TableauDesLots conversationId={fil} aCoteDeLaFrise />)
      })
      return { hote, fin: () => act(() => racine.unmount()) }
    }

    it('plus de lots, de bilan ni de Réduire ; titre, statut et Arrêter restent', async () => {
      const p = marquerLance({ ...plan(), statut: 'en-cours' }, 1, 'conv-100', 2)
      poserApi({ 'conv-1': { plan: p, role: 'chef' } }, { 'conv-100': [ligneDeCout(1)] })
      const { hote, fin } = await monterAvecFrise('conv-1')
      expect(hote.querySelector('.tdl-lots')).toBeNull()
      expect(hote.querySelector('.tdl-bilan')).toBeNull()
      expect(hote.querySelector('[data-testid="tdl-reduire"]')).toBeNull()
      expect(hote.textContent).toContain('Traduction anglaise')
      expect(hote.textContent).toContain('Arrêter (aucun nouveau lot)')
      // La frise lit déjà ces coûts : une seconde lecture ne servirait à rien.
      expect(lecturesDeCout).toEqual([])
      fin()
    })

    it('un plan réduit dans la mosaïque garde ici Arrêter et Reprendre', async () => {
      window.localStorage.setItem('autowin:plans-de-lots-reduits', JSON.stringify(['plan-a']))
      const p = marquerLance({ ...plan(), statut: 'en-cours' }, 1, 'conv-100', 2)
      poserApi({ 'conv-1': { plan: p, role: 'chef' } })
      const { hote, fin } = await monterAvecFrise('conv-1')
      expect(hote.textContent).toContain('Arrêter (aucun nouveau lot)')
      window.localStorage.clear()
      fin()
    })

    it('la mémoire du plan reste : contexte et décisions', async () => {
      const p: PlanDeLots = {
        ...plan(),
        statut: 'en-cours',
        contexte: 'Le contexte commun',
        decisions: [{ texte: 'Le nom est fixé', de: 'chef', le: 2 }]
      }
      poserApi({ 'conv-1': { plan: p, role: 'chef' } })
      const { hote, fin } = await monterAvecFrise('conv-1')
      expect(hote.querySelector('[data-testid="tdl-contexte"]')?.textContent).toContain(
        'Le contexte commun'
      )
      expect(hote.querySelector('[data-testid="tdl-decisions"]')?.textContent).toContain(
        'Le nom est fixé'
      )
      fin()
    })

    it('dans le fil d’un lot : rien, son onglet et sa piste le disent déjà', async () => {
      poserApi({ 'conv-100': { plan: plan(), role: 'enfant', rang: 2 } })
      const { hote, fin } = await monterAvecFrise('conv-100')
      expect(hote.querySelector('[data-testid="tableau-des-lots"]')).toBeNull()
      fin()
    })
  })
})
