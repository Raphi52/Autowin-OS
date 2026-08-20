// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'
import { parseAskDecision } from './ask-choices'

let hote: HTMLDivElement
let racine: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

const decision = {
  question: 'Quel correctif appliquer ?',
  options: [
    {
      libelle: 'Les deux correctifs',
      consequence: 'Couvre les deux causes.',
      recommande: true as const,
      detail: {
        fait: 'Rend le serveur silencieux.',
        touche: 'brain_server.py hors dépôt',
        neReglePas: 'La moitié serveur n’est pas versionnée.'
      },
      envoi: 'applique les deux correctifs'
    },
    { libelle: 'Côté Autowin seulement', consequence: 'Revert immédiat.' },
    { libelle: 'Ne rien changer' }
  ]
}

function rendre(onPick?: (prompt: string) => void): void {
  act(() => racine.render(<AskDecisionBlock decision={decision} onPick={onPick} />))
}

describe('AskDecisionBlock — une ligne par réponse, jamais côte à côte', () => {
  it('rend une ligne par réponse, empilée', () => {
    rendre()
    const lignes = hote.querySelectorAll('[data-testid="ask-decision-option"]')
    expect(lignes).toHaveLength(3)
    const liste = hote.querySelector('.askd-liste')
    expect(liste?.className).not.toMatch(/grid|row/)
  })

  /*
   * Le libelle et la consequence vivent dans un <button>, donc en <span>. Sans `display: block`
   * ils se collent sur une seule ligne — defaut vu sur le rendu reel du 20/08 et invisible sur la
   * maquette, ou c'etaient deux <div>. happy-dom ne calcule pas la mise en page : la feuille est
   * le seul oracle.
   */
  it('le libellé et la conséquence sont des blocs, jamais collés sur une ligne', () => {
    const css = readFileSync('src/renderer/src/components/AskDecision.css', 'utf8')
    for (const classe of ['askd-libelle', 'askd-consequence']) {
      // Pas de RegExp construite par chaine : dans un template literal, `\.` devient `.` et `\s`
      // devient `s`, donc la regle ne matcherait rien et le test passerait sur du vide.
      const debut = css.indexOf(`.${classe} {`)
      expect(debut).toBeGreaterThan(-1)
      const regle = css.slice(debut, css.indexOf('}', debut))
      expect(regle).toMatch(/display\s*:\s*block/)
    }
  })

  /*
   * Le garde-fou de la spec se joue dans la FEUILLE, pas dans le DOM : happy-dom ne calcule aucune
   * mise en page, donc aucune assertion sur les elements ne peut voir une rangee revenir. On lit
   * donc la regle elle-meme — le seul oracle disponible ici. Si quelqu'un remet un
   * `flex-direction: row` ou une grille multi-colonnes sur la liste, ce test tombe.
   */
  it('la feuille n’autorise pas la liste a redevenir une rangée', () => {
    // Chemin depuis la racine du dépôt : `import.meta.url` n'est pas de schéma file sous la
    // transformation vite, et le lire renvoie un TypeError plutôt qu'un faux vert.
    const css = readFileSync('src/renderer/src/components/AskDecision.css', 'utf8')
    const regle = /\.askd-liste\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(regle).not.toMatch(/flex-direction\s*:\s*row/)
    expect(regle).not.toMatch(/display\s*:\s*(flex|inline-flex)/)
    // Une grille est permise, mais jamais avec plus d'une colonne de contenu.
    expect(regle).not.toMatch(/grid-template-columns\s*:\s*(?!1fr\s*;?\s*$)/)
  })

  it('renvoie `envoi` au clic, et le libellé quand `envoi` manque', () => {
    const choisi = vi.fn()
    rendre(choisi)
    const boutons = [...hote.querySelectorAll<HTMLButtonElement>('.askd-choix')]
    act(() => boutons[0].click())
    expect(choisi).toHaveBeenCalledWith('applique les deux correctifs')
    act(() => boutons[2].click())
    expect(choisi).toHaveBeenLastCalledWith('Ne rien changer')
  })

  it('ouvre d’office le détail de la recommandée, et le replie au clic', () => {
    rendre()
    expect(hote.textContent).toContain('Ne règle pas')
    const triangle = hote.querySelector<HTMLButtonElement>('.askd-tri[aria-expanded]')
    expect(triangle?.getAttribute('aria-expanded')).toBe('true')
    act(() => triangle!.click())
    expect(triangle?.getAttribute('aria-expanded')).toBe('false')
    expect(hote.textContent).not.toContain('Ne règle pas')
  })

  it('marque la recommandée et elle seule', () => {
    rendre()
    expect(hote.querySelectorAll('.askd-item.est-reco')).toHaveLength(1)
    expect(hote.querySelectorAll('.askd-tag')).toHaveLength(1)
  })

  it('une option sans détail n’offre pas de triangle cliquable', () => {
    rendre()
    // Trois lignes, un seul détail : donc un seul triangle actionnable.
    expect(hote.querySelectorAll('.askd-tri[aria-expanded]')).toHaveLength(1)
    expect(hote.querySelectorAll('.askd-tri[aria-hidden="true"]')).toHaveLength(2)
  })

  it('n’affiche pas le glyphe tofu du tour 3 — le mot est écrit', () => {
    rendre()
    expect(hote.textContent).not.toContain('\u23ce')
    expect(hote.querySelector('.askd-entree')?.textContent).toBe('Entrée')
  })

  it('le pied ne promet que ce qui existe : aucun raccourci chiffré annoncé', () => {
    rendre()
    const pied = hote.querySelector('.askd-pied')?.textContent ?? ''
    expect(pied).toContain('Entrée')
    expect(pied).not.toMatch(/1\s*[–-]\s*4/)
  })

  it('sans aucun détail, le pied ne parle pas de déplier', () => {
    act(() =>
      racine.render(
        <AskDecisionBlock
          decision={{ question: 'On y va ?', options: [{ libelle: 'Oui' }, { libelle: 'Non' }] }}
        />
      )
    )
    expect(hote.querySelector('.askd-pied')?.textContent).not.toContain('déplier')
  })
})

describe('parseAskDecision — le pont depuis la charge utile de l’action', () => {
  const action = (data: unknown): Parameters<typeof parseAskDecision>[0] => ({
    kind: 'action',
    name: 'ask',
    ok: true,
    data
  })

  it('accepte l’ancienne forme, des chaînes nues', () => {
    const lue = parseAskDecision(action({ question: 'q', options: ['Oui', 'Non'] }))
    expect(lue?.options).toEqual([{ libelle: 'Oui' }, { libelle: 'Non' }])
  })

  it('une seule réponse exploitable n’est pas un choix', () => {
    expect(parseAskDecision(action({ question: 'q', options: ['Oui'] }))).toBeNull()
    expect(
      parseAskDecision(action({ question: 'q', options: [{ libelle: 'Oui' }, { libelle: ' ' }] }))
    ).toBeNull()
  })

  it('ignore ce qui n’est pas une action ask réussie', () => {
    const data = { question: 'q', options: ['a', 'b'] }
    expect(parseAskDecision({ ...action(data), name: 'orchestrate' })).toBeNull()
    expect(parseAskDecision({ ...action(data), ok: false })).toBeNull()
    expect(parseAskDecision({ ...action(data), kind: 'text' })).toBeNull()
    expect(parseAskDecision(action({ question: '  ', options: ['a', 'b'] }))).toBeNull()
    expect(parseAskDecision(action({ question: 'q', options: 'a, b' }))).toBeNull()
  })
})
