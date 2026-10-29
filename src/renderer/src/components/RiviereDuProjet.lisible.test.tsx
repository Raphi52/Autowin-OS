// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import { readFileSync } from 'node:fs'
import { RiviereDuProjet } from './RiviereDuProjet'
import { POSTIT_H, POSTIT_L, texteDuPostit } from './carte-riviere'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'

/**
 * LE BOARD RESTE LISIBLE QUAND IL EST CHARGÉ OU ZOOMÉ (conv-1242, 2026-10-28) : « la vue board elle
 * casse quand ya trop d'éléments et quand je fais ctrl molette les textes disparaissent, et c'est
 * illisible ». Mesuré sur un banc à 40 fils par jour : le texte des post-it du jour tombait à ~6 px,
 * et au zoom ×1,5 il disparaissait (post-it réduits à des pastilles). Deux causes :
 * - le texte suivait l'échelle du post-it (11 px × k) et se cachait sous k = 0,55 ; or « tout tient
 *   dans l'écran » fait baisser k quand le board se charge, et le zoom de l'app (Ctrl + molette)
 *   réduit la place en pixels CSS, donc k encore ;
 * - Ctrl + molette sur le board déplaçait AUSSI la loupe d'une demi-journée par cran : les post-it
 *   regardés quittaient la colonne large et perdaient leur texte.
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un Ctrl + molette qui bouge la loupe ; un post-it du jour de la
 * loupe sans texte, ou dont le titre fait moins de 11 px à l'écran, sur un board chargé et petit.
 */

const MAINTENANT = new Date(2026, 9, 28, 17, 0).getTime()
const MINUTE = 60_000
const STATUTS: StatutDemande[] = ['sans-preuve', 'prouve', 'en-cours', 'refuse']

const demande = (n: number, statut: StatutDemande, debut: number): DemandeDeLaCarte => ({
  conversationId: `conv-${n}`,
  conversationTitre: `Fil ${n}`,
  rang: 1,
  titre: `corrige le défaut numéro ${n} de la vue`,
  statut,
  constat: 'npm test → exit 0',
  debut,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' }
})

/** `parJour` fils aujourd'hui, autant les 3 jours d'avant : un board chargé comme celui du 28/10. */
function carteChargee(parJour: number): CarteDesBesoins {
  const demandes: DemandeDeLaCarte[] = []
  let n = 1
  for (let jour = 0; jour < 4; jour += 1)
    for (let i = 0; i < parJour; i += 1) {
      demandes.push(
        demande(n, STATUTS[n % STATUTS.length], MAINTENANT - jour * 86_400_000 - i * 10 * MINUTE)
      )
      n += 1
    }
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: demandes.length,
    demandes,
    runsBloques: [],
    comptes: { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: demandes.length,
    demandeurs: [{ cle: 'raph@x', nom: 'Raph', demandes: demandes.length }],
    demandesJournalisees: demandes.length,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('le board reste lisible, chargé ou zoomé', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  beforeEach(() => {
    window.localStorage.removeItem(CLE_ETATS_MANUELS_CARTE)
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    vi.unstubAllGlobals()
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  /** happy-dom ne mesure rien : la place offerte au tableau est donnée par un faux observateur. */
  async function monter(donnees: CarteDesBesoins, l = 0, h = 0): Promise<HTMLDivElement> {
    if (l > 0)
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private rappel: ResizeObserverCallback) {}
          observe(): void {
            this.rappel(
              [{ contentRect: { width: l, height: h } } as ResizeObserverEntry],
              this as unknown as ResizeObserver
            )
          }
          unobserve = vi.fn()
          disconnect = vi.fn()
        }
      )
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(createElement(RiviereDuProjet, { carte: donnees, ouvrir: vi.fn() }))
    )
    return el
  }

  const tableau = (el: HTMLElement): HTMLElement =>
    el.querySelector('[data-testid="riviere-tableau"]') as HTMLElement

  it('Ctrl + molette zoome l’app sans déplacer la loupe du board', async () => {
    const el = await monter(carteChargee(3))
    expect(Number(tableau(el).dataset.foyer)).toBe(13.5)
    await act(async () => {
      for (let i = 0; i < 6; i += 1) {
        const e = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
        // happy-dom ne porte pas `ctrlKey` sur une molette (Chromium, si) : posé à la main.
        Object.defineProperty(e, 'ctrlKey', { value: true })
        expect(e.ctrlKey).toBe(true)
        tableau(el).dispatchEvent(e)
      }
    })
    expect(Number(tableau(el).dataset.foyer)).toBe(13.5)
    // Sans Ctrl, la même molette déplace toujours la loupe.
    await act(async () => {
      tableau(el).dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
      )
    })
    expect(Number(tableau(el).dataset.foyer)).toBe(13)
  })

  // 1067 × 470 : la place d'un écran de 1600 × 900 zoomé à ×1,5 ; 960 × 640 : un écran ordinaire
  // avec 40 fils par jour. Dans les deux, les post-it du jour passaient sous 11 px, ou sans texte.
  for (const [l, h] of [
    [1067, 470],
    [960, 640]
  ] as const) {
    it(`chargé à 40 fils par jour dans ${l} × ${h} : chaque post-it du jour garde un titre d’au moins 11 px à l’écran`, async () => {
      const el = await monter(carteChargee(40), l, h)
      const duJour = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-postit"]')].filter(
        (p) => p.dataset.jour === '13'
      )
      expect(duJour).toHaveLength(40)
      for (const p of duJour) {
        expect(p.dataset.taille, p.dataset.conversation).toBe('carte')
        const k = Number(/scale\([\d.e-]+, ([\d.e-]+)\)/u.exec(p.style.transform)![1])
        // Le titre s'écrit en 11 px (feuille de style) dans un bloc contre-échelonné : à l'écran,
        // 11 × contre-échelle × k.
        const bloc = p.querySelector<HTMLElement>('[data-testid="riviere-postit-texte"]')!
        const grossi = Number(/^scale\(([\d.e-]+)\)$/u.exec(bloc.style.transform)![1])
        expect(11 * grossi * k, `${p.dataset.conversation} à k = ${k}`).toBeGreaterThanOrEqual(
          11 - 1e-6
        )
        const titre = bloc.querySelector<HTMLElement>('.riviere-postit-titre')!
        expect(Number(titre.dataset.lignes)).toBeGreaterThanOrEqual(1)
      }
    })
  }
})

describe('texteDuPostit : la taille à l’écran tient, les lignes cèdent', () => {
  it('à l’échelle 1, les 4 lignes et la ligne projet · heure d’avant', () => {
    expect(texteDuPostit(1, POSTIT_L)).toEqual({
      grossi: 1,
      largeur: POSTIT_L - 18,
      lignes: 4,
      avecMeta: true
    })
  })

  it('au-dessus de 1, le texte grandit avec le post-it, comme avant', () => {
    expect(texteDuPostit(1.5, POSTIT_L)).toEqual({
      grossi: 1,
      largeur: POSTIT_L - 18,
      lignes: 4,
      avecMeta: true
    })
  })

  it('en rapetissant, le titre garde 11 px à l’écran et perd des lignes, puis la ligne projet · heure', () => {
    const lignes: number[] = []
    let metaPerdue = false
    for (const k of [0.9, 0.7, 0.5, 0.4, 0.3, 0.2]) {
      // Le papier le plus large que `placer` lui donne : 2 × POSTIT_L à l'écran.
      const largeur = (POSTIT_L * 2) / k
      const t = texteDuPostit(k, largeur)!
      expect(t, `k = ${k}`).not.toBeNull()
      // 11 px de titre et 9 px de ligne projet · heure à l'écran.
      expect(11 * t.grossi * k).toBeCloseTo(11)
      expect(9 * t.grossi * k).toBeCloseTo(9)
      // Grossi, le bloc revient à la largeur du papier sous ses marges.
      expect(t.largeur * t.grossi).toBeCloseTo(largeur - 18)
      // Le titre et sa ligne projet · heure tiennent sous la punaise, dans le papier.
      const meta = t.avecMeta ? 2 + 9 * 1.2 : 0
      expect(14 + (t.lignes * 11 * 1.2 + meta) * t.grossi + 4).toBeLessThanOrEqual(POSTIT_H + 1e-9)
      if (metaPerdue) expect(t.avecMeta).toBe(false)
      metaPerdue ||= !t.avecMeta
      lignes.push(t.lignes)
    }
    expect(lignes).toEqual([...lignes].sort((a, b) => b - a))
    expect(lignes[0]).toBe(3)
    expect(lignes[lignes.length - 1]).toBe(1)
    expect(metaPerdue).toBe(true)
  })

  it('une pastille quand plus une ligne ne tient, ou quand le post-it est trop étroit pour écrire', () => {
    expect(texteDuPostit(0.15, POSTIT_L * 2)).toBeNull()
    // 58 px de texte à l'écran au moins (~9 lettres) : les colonnes voisines restent des pastilles.
    expect(texteDuPostit(0.5, POSTIT_L)).toBeNull()
    // Ce qui s'écrivait avant (k ≥ 0,55 à la largeur de base) s'écrit encore.
    expect(texteDuPostit(0.55, POSTIT_L)).not.toBeNull()
  })

  it('les mesures du calcul sont celles de la feuille de style', () => {
    const css = readFileSync('src/renderer/src/components/RiviereDuProjet.css', 'utf8')
    const regle = (selecteur: string): string => {
      const debut = css.search(new RegExp(`^${selecteur.replace(/\./gu, '\\.')} \\{`, 'mu'))
      expect(debut, selecteur).toBeGreaterThanOrEqual(0)
      return css.slice(debut, css.indexOf('}', debut))
    }
    expect(regle('.riviere-postit')).toMatch(/padding:\s*14px 9px 4px;/u)
    expect(regle('.riviere-postit-texte')).toMatch(/gap:\s*2px;/u)
    // Le bloc glisse avec le papier, à la même durée et la même courbe (pas de texte qui gonfle).
    expect(regle('.riviere-postit')).toMatch(/transform 0\.3s var\(--riviere-courbe\)/u)
    expect(regle('.riviere-postit-texte')).toMatch(
      /transition:\s*transform 0\.3s var\(--riviere-courbe\);/u
    )
    expect(regle('.riviere-postit-titre')).toMatch(/font:\s*700 11px\/1\.2 /u)
    expect(regle('.riviere-postit-titre')).toMatch(/-webkit-line-clamp:\s*4;/u)
    expect(regle('.riviere-postit-meta')).toMatch(/font:\s*500 9px\/1\.2 /u)
    // Chaque nombre de lignes que rend texteDuPostit a sa règle (4 = celle du titre).
    for (const n of [1, 2, 3])
      expect(css.replace(/\s+/gu, ' ')).toContain(
        `.riviere-postit-titre[data-lignes='${n}'] { -webkit-line-clamp: ${n}; }`
      )
  })
})
