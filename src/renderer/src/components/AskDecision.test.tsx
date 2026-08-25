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

  /*
   * DEUX RENDUS, un clic chacun -- et non deux clics dans le meme bloc comme avant.
   *
   * Depuis le 2026-08-25 un bloc `ask` se VERROUILLE des la premiere reponse : l'utilisateur avait
   * clique quatre fois la meme option et quatre envois etaient partis (conv-1400). Les assertions de
   * ce test sont INCHANGEES -- il verifie la derivation du prompt (`envoi`, sinon le libelle), pas le
   * droit de repondre deux fois ; les deux clics n'etaient qu'une commodite.
   */
  it('renvoie `envoi` au clic', () => {
    const choisi = vi.fn()
    rendre(choisi)
    act(() => [...hote.querySelectorAll<HTMLButtonElement>('.askd-choix')][0].click())
    expect(choisi).toHaveBeenCalledWith('applique les deux correctifs')
  })

  it('renvoie le libellé quand `envoi` manque', () => {
    const choisi = vi.fn()
    rendre(choisi)
    act(() => [...hote.querySelectorAll<HTMLButtonElement>('.askd-choix')][2].click())
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

describe('AskDecisionBlock — la ligne entière est cliquable', () => {
  /*
   * happy-dom ne fait aucun test de collision : aucune assertion sur les elements ne peut prouver
   * qu'un clic dans la marge de la ligne atteint le bouton. La feuille est le seul oracle — et
   * c'est bien la que vivait le defaut : le survol allumait toute la ligne alors que seule la
   * colonne du texte repondait au clic.
   */
  it('la zone de clic est étirée sur la ligne, pas limitée au texte', () => {
    const css = readFileSync('src/renderer/src/components/AskDecision.css', 'utf8')
    const debut = css.indexOf('.askd-choix::after {')
    expect(debut).toBeGreaterThan(-1)
    const regle = css.slice(debut, css.indexOf('}', debut))
    expect(regle).toMatch(/position:\s*absolute/)
    expect(regle).toMatch(/inset:\s*0/)
    // Sans ancrage sur la ligne, `inset: 0` s'étirerait sur le bloc entier.
    const ligne = css.slice(
      css.indexOf('.askd-ligne {'),
      css.indexOf('}', css.indexOf('.askd-ligne {'))
    )
    expect(ligne).toMatch(/position:\s*relative/)
    // Et le triangle doit rester au-dessus, sinon déplier devient impossible.
    expect(css).toMatch(/\.askd-tri\s*\{[^}]*z-index:\s*1/)
  })
})

describe('AskDecisionBlock — plusieurs réponses à la fois', () => {
  const multiple = {
    question: 'Lesquels de ces correctifs veux-tu ?',
    choixMultiple: true as const,
    options: [
      { libelle: 'Le serveur Brain', consequence: 'Hors dépôt.' },
      { libelle: 'La sonde', consequence: 'Versionné ici.' },
      { libelle: 'Le test de non-régression' }
    ]
  }
  const rendreMultiple = (onPick?: (prompt: string) => void): void =>
    act(() => racine.render(<AskDecisionBlock decision={multiple} onPick={onPick} />))

  it('rend une case à cocher par réponse, et aucune en mode exclusif', () => {
    rendreMultiple()
    expect(hote.querySelectorAll('input[type="checkbox"]')).toHaveLength(3)
    rendre()
    expect(hote.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('n’envoie RIEN tant que rien n’est coché — un envoi vide n’est pas une réponse', () => {
    const choisi = vi.fn()
    rendreMultiple(choisi)
    const envoyer = hote.querySelector<HTMLButtonElement>('[data-testid="ask-decision-envoyer"]')!
    expect(envoyer.disabled).toBe(true)
    act(() => envoyer.click())
    expect(choisi).not.toHaveBeenCalled()
  })

  it('envoie les réponses cochées en puces, dans l’ordre du bloc', () => {
    const choisi = vi.fn()
    rendreMultiple(choisi)
    const cases = [...hote.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    // On coche dans l'ordre inverse : l'envoi doit suivre l'ordre LU, pas l'ordre des clics.
    act(() => cases[2].click())
    act(() => cases[0].click())
    const envoyer = hote.querySelector<HTMLButtonElement>('[data-testid="ask-decision-envoyer"]')!
    expect(envoyer.disabled).toBe(false)
    expect(envoyer.textContent).toContain('(2)')
    act(() => envoyer.click())
    expect(choisi).toHaveBeenCalledWith('- Le serveur Brain\n- Le test de non-régression')
  })

  it('une seule case cochée envoie la réponse seule, sans puce', () => {
    const choisi = vi.fn()
    rendreMultiple(choisi)
    act(() => hote.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click())
    act(() =>
      hote.querySelector<HTMLButtonElement>('[data-testid="ask-decision-envoyer"]')!.click()
    )
    expect(choisi).toHaveBeenCalledWith('La sonde')
  })

  it('décocher retire la réponse de l’envoi', () => {
    const choisi = vi.fn()
    rendreMultiple(choisi)
    const cases = [...hote.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    act(() => cases[0].click())
    act(() => cases[1].click())
    act(() => cases[0].click())
    act(() =>
      hote.querySelector<HTMLButtonElement>('[data-testid="ask-decision-envoyer"]')!.click()
    )
    expect(choisi).toHaveBeenCalledWith('La sonde')
  })

  it('le pied dit que plusieurs réponses sont possibles, et n’annonce pas Entrée', () => {
    rendreMultiple()
    const pied = hote.querySelector('.askd-pied')?.textContent ?? ''
    expect(pied).toContain('plusieurs réponses possibles')
    expect(pied).not.toContain('sur une ligne pour répondre')
  })
})
