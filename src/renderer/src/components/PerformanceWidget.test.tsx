// fix-ok: chaque ajout ici est le test rouge qui a nomme la cause corrigee dans
// PerformanceWidget.tsx (repeinture au changement de seuil, relecture du reglage a la reouverture).
// @vitest-environment happy-dom
/**
 * La tuile Performance, montée pour de vrai.
 *
 * Ce que ce fichier protège, et qui casserait sans bruit :
 *  - les CINQ compteurs demandés sont affichés, RCS et RSM, les trois actes du RSM sur une ligne ;
 *  - le mode greffier montre tout le greffe ET le détail par personne ; le mode utilisateur non ;
 *  - baisser un seuil REPEINT la ligne sans changer le chiffre — c'est la demande centrale (« ils
 *    verraient tout en rouge tout le temps »), et le réglage survit à une réouverture.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PerformanceWidget } from './PerformanceWidget'
import { CLE_SEUILS_PERF, type PerfMesure } from './performance-greffe-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const MESURES: PerfMesure[] = [
  { utilisateur: 'moi', type: 'formalite-validee', valeur: 25 },
  { utilisateur: 'moi', type: 'dca', valeur: 4 },
  { utilisateur: 'moi', type: 'inscription', valeur: 3 },
  { utilisateur: 'moi', type: 'modification', valeur: 2 },
  { utilisateur: 'moi', type: 'renouvellement', valeur: 1 },
  { utilisateur: 'Zoe', type: 'formalite-validee', valeur: 75 },
  { utilisateur: 'Zoe', type: 'radiation', valeur: 30 }
]

let hote: HTMLDivElement
let racine: ReturnType<typeof createRoot>

function memoire(): { getItem(c: string): string | null; setItem(c: string, v: string): void } {
  const data = new Map<string, string>()
  return {
    getItem: (c) => data.get(c) ?? null,
    setItem: (c, v) => {
      data.set(c, v)
    }
  }
}

function monter(props: Parameters<typeof PerformanceWidget>[0]): void {
  act(() => {
    racine.render(createElement(PerformanceWidget, props))
  })
}

function ligne(id: string): HTMLElement {
  const el = hote.querySelector<HTMLElement>(`[data-testid="perf-ligne-${id}"]`)
  if (!el) throw new Error(`ligne absente : ${id}`)
  return el
}

function cliquer(testid: string): void {
  const bouton = hote.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
  if (!bouton) throw new Error(`bouton absent : ${testid}`)
  act(() => {
    bouton.click()
  })
}

/**
 * Taper dans un champ CONTROLE par React.
 *
 * Ecrire `input.value` directement ne suffit pas : React garde une copie de la derniere valeur et
 * conclut que rien n'a change, donc `onChange` ne part jamais. On passe donc par le setter natif du
 * prototype, ce que fait la vraie frappe clavier.
 */
function saisir(champ: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(champ, valeur)
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  hote = document.createElement('div')
  document.body.append(hote)
  racine = createRoot(hote)
})

afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

describe('les compteurs demandes', () => {
  it('affiche les trois lignes RCS et les deux lignes RSM', () => {
    monter({ mesures: MESURES, utilisateur: 'moi', storage: memoire() })
    expect(ligne('rcs-formalites-validees').textContent).toContain('Formalités validées')
    expect(ligne('rcs-dca')).toBeTruthy()
    expect(ligne('rcs-das')).toBeTruthy()
    expect(ligne('rsm-radiations')).toBeTruthy()
    // Les trois actes du RSM comptent ENSEMBLE : 3 + 2 + 1.
    expect(ligne('rsm-imr').querySelector('strong')?.textContent).toBe('6')
  })

  it('dit quand aucune source n alimente les compteurs', () => {
    monter({ mesures: [], utilisateur: 'moi', storage: memoire() })
    expect(hote.querySelector('[data-testid="perf-sans-source"]')).toBeTruthy()
    expect(ligne('rcs-dca').querySelector('strong')?.textContent).toBe('0')
  })
})

describe('mode utilisateur et mode greffier', () => {
  it('ouvre sur MES chiffres, sans le detail des autres', () => {
    monter({ mesures: MESURES, utilisateur: 'moi', storage: memoire() })
    expect(ligne('rcs-formalites-validees').querySelector('strong')?.textContent).toBe('25')
    expect(hote.querySelector('[data-testid="perf-personne-Zoe"]')).toBeNull()
  })

  it('bascule sur tout le greffe et detaille personne par personne', () => {
    monter({ mesures: MESURES, utilisateur: 'moi', storage: memoire() })
    cliquer('perf-mode-greffier')
    expect(ligne('rcs-formalites-validees').querySelector('strong')?.textContent).toBe('100')
    expect(hote.querySelector('[data-testid="perf-personne-Zoe"]')).toBeTruthy()
    expect(hote.querySelector('[data-testid="perf-personne-moi"]')).toBeTruthy()
  })
})

describe('le code couleur se regle', () => {
  it('repeint la ligne quand on baisse le seuil, sans toucher au chiffre', () => {
    const storage = memoire()
    monter({ mesures: MESURES, utilisateur: 'moi', storage })
    // 25 formalites contre un plancher vert a 100 : rouge.
    expect(ligne('rcs-formalites-validees').dataset.couleur).toBe('rouge')

    cliquer('perf-ouvrir-seuils')
    const champ = hote.querySelector<HTMLInputElement>(
      '[data-testid="perf-seuil-rcs-formalites-validees-vert"]'
    )
    if (!champ) throw new Error('champ de seuil absent')
    saisir(champ, '20')

    const apres = ligne('rcs-formalites-validees')
    expect(apres.dataset.couleur).toBe('vert')
    expect(apres.querySelector('strong')?.textContent).toBe('25')
    // Et le reglage est ECRIT : sinon il faudrait le retaper a chaque ouverture.
    expect(storage.getItem(CLE_SEUILS_PERF)).toContain('"vert":20')
  })

  it('relit le reglage a la reouverture de la tuile', () => {
    const storage = memoire()
    storage.setItem(
      CLE_SEUILS_PERF,
      JSON.stringify({ 'rcs-formalites-validees': { vert: 10, jaune: 5, orange: 2 } })
    )
    monter({ mesures: MESURES, utilisateur: 'moi', storage })
    expect(ligne('rcs-formalites-validees').dataset.couleur).toBe('vert')
  })

  it('ouvre sur les defauts quand le reglage enregistre est illisible', () => {
    const storage = memoire()
    storage.setItem(CLE_SEUILS_PERF, '{casse')
    monter({ mesures: MESURES, utilisateur: 'moi', storage })
    expect(ligne('rcs-formalites-validees').dataset.couleur).toBe('rouge')
    expect(ligne('rcs-formalites-validees').querySelector('strong')?.textContent).toBe('25')
  })

  it("prend le compte du poste comme sujet quand aucun utilisateur n'est fourni", async () => {
    // fix-ok: la tuile etait montee sans `utilisateur` dans HomeView.tsx, donc « mes chiffres »
    // n'avait AUCUN sujet et restait vide. Elle demande maintenant l'identite a l'app.
    ;(window as unknown as { api: { identiteUtilisateur: () => Promise<string> } }).api = {
      identiteUtilisateur: () => Promise.resolve('moi')
    }
    await act(async () => {
      racine.render(createElement(PerformanceWidget, { mesures: MESURES, storage: memoire() }))
    })
    expect(hote.querySelector('[data-testid="perf-moi"]')?.textContent).toContain('moi')
    expect(ligne('rcs-formalites-validees').querySelector('strong')?.textContent).toBe('25')
  })
})
