// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CandidatsPickPanel } from './CandidatsPickPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CandidatsPickPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('envoie au workflow uniquement les candidats cochés et expose les trois détails', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[
            {
              type: 'ajout',
              titre: 'Cockpit',
              url: 'src/main/index.ts:1',
              what: 'Affiche les coûts.',
              why: 'Les coûts sont relus à la main.',
              how: 'Ajouter une vue dédiée.'
            },
            { type: 'correction', titre: 'Retry', url: 'src/main/retry.ts:2' }
          ]}
          onPick={onPick}
        />
      )
    )

    const cases = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(cases).toHaveLength(3)
    act(() => cases[2].click())
    expect(container.querySelector('.cpick-compte')?.textContent).toContain('1/2')

    const deplier = container.querySelector<HTMLButtonElement>('[data-testid="cpick-deplier"]')
    act(() => deplier?.click())
    expect(container.querySelector('[data-testid="cpick-details"]')?.textContent).toContain(
      'Quoi ?Affiche les coûts.Pourquoi ?Les coûts sont relus à la main.Comment ?Ajouter une vue dédiée.'
    )

    const lancer = container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')
    act(() => lancer?.click())
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick.mock.calls[0][0]).toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Quoi : Affiche les coûts.')
    expect(onPick.mock.calls[0][0]).toContain('Pourquoi : Les coûts sont relus à la main.')
    expect(onPick.mock.calls[0][0]).toContain('Comment : Ajouter une vue dédiée.')
    expect(onPick.mock.calls[0][0]).not.toContain('Retry')
  })

  /*
   * « Pourquoi pas ? » retiré (conv-1198, « ça sert à rien ») : une ligne DÉCOCHÉE n'a plus de bouton
   * de motif, ni ses 4 choix — décocher suffit.
   */
  it('une ligne décochée n’a plus de bouton « Pourquoi pas ? » ni de motifs', () => {
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[
            { type: 'fix', titre: 'Gardée' },
            { type: 'fix', titre: 'Laissée' }
          ]}
        />
      )
    )
    act(() => container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2].click())
    expect(container.querySelector('.cpick-compte')?.textContent).toContain('1/2')
    expect(container.querySelectorAll('[data-testid="cpick-pourquoi"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="cpick-motif"]')).toHaveLength(0)
    expect(container.textContent).not.toContain('Pourquoi pas')
  })

  /**
   * Defaut nomme le 2026-09-06 : l'agent decidait des candidats dans son texte (`CIBLES:`) mais les
   * cases restaient toutes cochees — le clic partait donc sur des lignes que personne n'avait
   * choisies. Le choix ECRIT doit piloter les cases, et rester VISIBLE.
   */
  it('le choix declare par le scout pre-coche les cases et s’affiche', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }, { titre: 'Journal' }]}
          texteScout={['Trois pistes.', 'CIBLES: 2, 3'].join(String.fromCharCode(10))}
          onPick={onPick}
        />
      )
    )

    expect(container.querySelector('.cpick-compte')?.textContent).toContain('2/3')
    expect(container.querySelector('[data-testid="cpick-auto"]')?.textContent).toContain(
      'Choix du scout : 2 candidats sur 3'
    )
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="cpick-lancer"]')?.click())
    expect(onPick.mock.calls[0][0]).not.toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Retry')
    expect(onPick.mock.calls[0][0]).toContain('Journal')
  })
  /**
   * La demande du 2026-09-06 : l'orchestrateur DECIDE puis CLIQUE. Le pre-cochage seul laissait le
   * geste payant a l'utilisateur — donc la moitie de la demande non faite.
   */
  it('mode auto : le panneau appuie lui-meme sur le bouton avec la selection du scout', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }, { titre: 'Journal' }]}
          texteScout={['## Cible', '2, 3'].join(String.fromCharCode(10))}
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick.mock.calls[0][0]).not.toContain('Cockpit')
    expect(onPick.mock.calls[0][0]).toContain('Retry')
    expect(onPick.mock.calls[0][0]).toContain('Journal')
    expect(container.querySelector('[data-testid="cpick-auto"]')?.textContent).toContain(
      'lance automatiquement'.replace('lance', 'lancé')
    )
  })

  it('mode auto SANS choix ecrit du scout : rien ne part tout seul', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }]}
          texteScout={'Deux pistes, a toi de voir.'}
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).not.toHaveBeenCalled()
  })

  it('mode auto et « CIBLE: aucune » : rien ne part non plus', () => {
    const onPick = vi.fn()
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[{ titre: 'Cockpit' }, { titre: 'Retry' }]}
          texteScout={'CIBLE: aucune'}
          autoLancer
          onPick={onPick}
        />
      )
    )
    expect(onPick).not.toHaveBeenCalled()
  })

  /*
   * L'ARRIVEE DES CANDIDATS (conv-981) : cascade et details en fondu ; decalage de la cascade
   * plafonne a l'index 10 (30 candidats ne doivent pas attendre 1,2 s). La barre de note est
   * retiree (conv-1198) : le chiffre seul reste.
   */
  const candidat = (
    titre: string,
    pertinence?: number
  ): { titre: string; url: string; pertinence?: number } => ({
    titre,
    url: `src/${titre}.ts:1`,
    ...(pertinence === undefined ? {} : { pertinence })
  })
  it('la note s’affiche en chiffre seul, sans jauge', () => {
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[candidat('a', 72), candidat('b', 140), candidat('c', -5), candidat('d', 0)]}
        />
      )
    )
    const lignes = [...container.querySelectorAll('[data-testid="cpick-ligne"]')]
    expect(container.querySelector('.cpick-barre')).toBeNull()
    // Le chiffre reste affiche tel que le scout l'a donne.
    expect(lignes.map((l) => l.querySelector('.cpick-score')?.textContent)).toEqual([
      '72',
      '140',
      '-5',
      '0'
    ])
  })

  it('sans note, pas de barre : les pastilles Impact/Effort restent (jumeau)', () => {
    act(() =>
      root.render(
        <CandidatsPickPanel candidats={[{ ...candidat('a'), impact: 'g', effort: 'y' }]} />
      )
    )
    expect(container.querySelector('.cpick-barre')).toBeNull()
    expect(container.querySelector('[data-testid="cpick-pastilles"]')).not.toBeNull()
  })

  it('les lignes arrivent en cascade, decalage plafonne a l index 10', () => {
    const trente = Array.from({ length: 30 }, (_, i) => candidat(`c${i}`, 50))
    act(() => root.render(<CandidatsPickPanel candidats={trente} />))
    const rangs = [...container.querySelectorAll<HTMLElement>('[data-testid="cpick-ligne"]')].map(
      (l) => l.style.getPropertyValue('--i')
    )
    expect(rangs.slice(0, 3)).toEqual(['0', '1', '2'])
    expect(rangs[10]).toBe('10')
    expect(rangs[29]).toBe('10')
  })

  it('un seul candidat : aucun decalage', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[candidat('seul', 90)]} />))
    const ligne = container.querySelector<HTMLElement>('[data-testid="cpick-ligne"]')
    expect(ligne?.style.getPropertyValue('--i')).toBe('0')
  })

  it('les details deplies apparaissent en fondu', () => {
    act(() => root.render(<CandidatsPickPanel candidats={[candidat('a', 90)]} />))
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="cpick-deplier"]')?.click())
    expect(
      container.querySelector('[data-testid="cpick-details"]')?.classList.contains('fade-in')
    ).toBe(true)
  })

  /**
   * conv-1074 (2026-10-22) : « dans scout les candidats sont pas numérotés donc je sais meme pas si tu
   * comprend 1 2 3 ». Chaque ligne montre le NUMÉRO du tableau du scout — celui que la cible désigne,
   * même quand l'app a retrié le tableau. Entrée qui ferait échouer une mauvaise correction : des
   * numéros 4, 1, 3 dans cet ordre (une numérotation par position afficherait 1, 2, 3).
   */
  it('chaque ligne montre le numéro du tableau du scout, dans l’ordre retrié', () => {
    act(() =>
      root.render(
        <CandidatsPickPanel
          candidats={[
            { titre: 'Blocs', num: '4' },
            { titre: 'Filtre', num: '1' },
            { titre: 'Numéros', num: '3' }
          ]}
          texteScout="CIBLE: 1"
        />
      )
    )
    const numeros = [...container.querySelectorAll('[data-testid="cpick-num"]')].map(
      (element) => element.textContent
    )
    expect(numeros).toEqual(['4.', '1.', '3.'])
    const coches = [...container.querySelectorAll<HTMLInputElement>('.cpick-ligne input')].map(
      (caseACocher) => caseACocher.checked
    )
    expect(coches).toEqual([false, true, false])
  })

  it('jumeau : des candidats sans numéro sont numérotés par leur position', () => {
    act(() =>
      root.render(<CandidatsPickPanel candidats={[{ titre: 'Alpha' }, { titre: 'Beta' }]} />)
    )
    const numeros = [...container.querySelectorAll('[data-testid="cpick-num"]')].map(
      (element) => element.textContent
    )
    expect(numeros).toEqual(['1.', '2.'])
  })
})
