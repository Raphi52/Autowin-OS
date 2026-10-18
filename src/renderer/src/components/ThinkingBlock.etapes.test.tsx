// @vitest-environment happy-dom
/**
 * BLOC ÉTAPES — la liste de tâches de claude.exe dans le fil (conv-304, 2026-10-17 : « un bloc
 * avec les étapes de la task et leur progression, ils ont mis ça dans claude.exe »).
 *
 * Le journal mêle, comme en vrai, les lignes d'étapes écrites par `claude-etapes.ts` (flux réel du
 * CLI 2.1.302, voir claude.etapes.test.ts) et des actions ordinaires.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingBlock } from './ThinkingBlock'

const JOURNAL = [
  'Étape #1 à faire · Lire le code du bloc',
  'Étape #2 à faire · Écrire le test',
  'Étape #3 à faire · Vérifier à l’écran',
  'Étape #1 en cours · Lire le code du bloc',
  'Read · src/renderer/src/components/ThinkingBlock.tsx',
  'Read terminé - 0 s',
  'Étape #1 terminée · Lire le code du bloc',
  'Étape #2 en cours · Écrire le test',
  'Bash · npx vitest run src/shared/etapes-du-tour.test.ts'
]

async function monter(done: boolean, statusLog = JOURNAL, turnId?: string) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const rendre = async (fini: boolean, journal: string[]) => {
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, {
          text: '',
          done: fini,
          status: journal.at(-1)!,
          statusLog: journal,
          ...(turnId ? { turnId } : {})
        })
      )
    })
  }
  await rendre(done, statusLog)
  return {
    host,
    rendre,
    demonter: async () => {
      await act(async () => root.unmount())
      host.remove()
    }
  }
}

describe('bloc Étapes', () => {
  it('pendant le tour : ouvert, une case par étape, avancement « 1/3 », étape courante dessous', async () => {
    const { host, demonter } = await monter(false)
    const bloc = host.querySelector('[data-testid="etapes-block"]') as HTMLDetailsElement
    expect(bloc).not.toBeNull()
    expect(bloc.open).toBe(true)
    expect(host.querySelector('[data-testid="etapes-block-compte"]')?.textContent).toBe('1/3')
    expect(host.querySelector('[data-testid="etapes-block-status"]')?.textContent).toBe(
      'Écrire le test'
    )
    expect(
      [...host.querySelectorAll('[data-testid="etape"]')].map((e) => [
        e.querySelector('.etape-sujet')?.textContent,
        (e as HTMLElement).dataset['statut']
      ])
    ).toEqual([
      ['Lire le code du bloc', 'completed'],
      ['Écrire le test', 'in_progress'],
      ['Vérifier à l’écran', 'pending']
    ])
    await demonter()
  })

  it('disposition « Côte à côte » (conv-303) : Raisonnement et Actions sur une ligne, Étapes dessous, même largeur', async () => {
    const { host, demonter } = await monter(false)
    const cadre = host.querySelector('[data-testid="tour-blocs"]') as HTMLElement
    expect(cadre).not.toBeNull()
    // La ligne du haut porte les DEUX capsules, dans cet ordre, et rien d'autre.
    const rang = cadre.querySelector(':scope > .tour-blocs-rang') as HTMLElement
    expect([...rang.children].map((d) => (d as HTMLElement).dataset['testid'])).toEqual([
      'thinking-block',
      'action-block'
    ])
    // Étapes vient APRÈS la ligne, dans le même cadre : la largeur du cadre est celle des deux.
    expect([...cadre.children].map((d) => (d as HTMLElement).className.split(' ')[0])).toEqual([
      'tour-blocs-rang',
      'thinking-block'
    ])
    expect((cadre.lastElementChild as HTMLElement).dataset['testid']).toBe('etapes-block')
    await demonter()
  })

  it('chaque étape dit son avancement : ses actions et leur durée, « à faire » sinon', async () => {
    const { host, demonter } = await monter(false, [
      'Read · avant tout plan', // avant la première étape en cours : rattachée à aucune
      'Read terminé - 3 s',
      ...JOURNAL,
      'Bash terminé - 12 s',
      'Edit · src/shared/etapes-du-tour.ts'
    ])
    const valeurs = [...host.querySelectorAll('[data-testid="etape"]')].map(
      (e) => e.querySelector('[data-testid="etape-valeur"]')?.textContent
    )
    expect(valeurs).toEqual(['1 action', '2 actions · 12 s', 'à faire'])
    // Une barre par étape, décorative : la valeur dit déjà l'état aux lecteurs d'écran.
    const barres = host.querySelectorAll('[data-testid="etape"] .etape-barre[aria-hidden="true"]')
    expect(barres).toHaveLength(3)
    await demonter()
  })

  it('une étape en cours sans action encore dit « en cours », une étape finie sans action « terminée »', async () => {
    const { host, demonter } = await monter(false, [
      'Étape #1 à faire · Penser',
      'Étape #2 à faire · Agir',
      'Étape #1 en cours · Penser',
      'Étape #1 terminée · Penser',
      'Étape #2 en cours · Agir'
    ])
    const valeurs = [...host.querySelectorAll('[data-testid="etape-valeur"]')].map(
      (v) => v.textContent
    )
    expect(valeurs).toEqual(['terminée', 'en cours'])
    await demonter()
  })

  it('les lignes d’étapes ne deviennent ni des actions ni le signe de vie du bloc Actions', async () => {
    const { host, demonter } = await monter(false, [
      ...JOURNAL,
      'Étape #2 terminée · Écrire le test'
    ])
    const actions = [...host.querySelectorAll('[data-testid="action-frise-ligne"]')].map(
      (l) => l.textContent
    )
    expect(actions).toHaveLength(2)
    expect(actions.join('\n')).not.toMatch(/Étape/)
    // La dernière ligne reçue est une étape : sous « Actions », on lit toujours la commande.
    expect(host.querySelector('[data-testid="action-block-status"]')?.textContent).toBe(
      'Bash · npx vitest run src/shared/etapes-du-tour.test.ts'
    )
    await demonter()
  })

  it('tour fini : replié en résumé, et une étape restée ouverte n’est pas cochée d’office', async () => {
    const { host, demonter } = await monter(true)
    const bloc = host.querySelector('[data-testid="etapes-block"]') as HTMLDetailsElement
    expect(bloc.open).toBe(false)
    expect(host.querySelector('[data-testid="etapes-block-compte"]')?.textContent).toBe('1/3')
    expect(
      [...host.querySelectorAll('[data-testid="etape"]')].map(
        (e) => (e as HTMLElement).dataset['statut']
      )
    ).toEqual(['completed', 'in_progress', 'pending'])
    await demonter()
  })

  /*
   * LE TEMPS DE L'ÉTAPE EN COURS AVANCE (conv-313, 2026-10-17 : « le timer est fix dans ce bloc »,
   * capture : « Lire le vrai code… · 1 action · 59 s » immobile sous une étape rose qui défile). La
   * durée n'était que la SOMME des durées d'outils : elle ne bougeait qu'à la fin d'un outil (ou au
   * battement de 30 s d'un outil long), et jamais pendant que le modèle réfléchit entre deux outils.
   */
  describe('chrono des étapes', () => {
    const valeurs = (host: HTMLElement) =>
      [...host.querySelectorAll('[data-testid="etape-valeur"]')].map((v) => v.textContent)

    it('le temps de l’étape en cours avance seul, sans nouvelle ligne du journal', async () => {
      vi.useFakeTimers()
      try {
        const { host, demonter } = await monter(false, [
          'Étape #1 à faire · Lire le code',
          'Étape #2 à faire · Construire',
          'Étape #1 en cours · Lire le code',
          'Read · src/a.ts',
          'Read terminé - 59 s'
        ])
        await act(async () => {
          vi.advanceTimersByTime(0)
        })
        // Monté en plein milieu : le chrono reprend la durée déjà mesurée, il ne repart pas de zéro.
        expect(valeurs(host)).toEqual(['1 action · 59 s', 'à faire'])
        await act(async () => {
          vi.advanceTimersByTime(5_000)
        })
        expect(valeurs(host)).toEqual(['1 action · 1 min 4 s', 'à faire'])
        await demonter()
      } finally {
        vi.useRealTimers()
      }
    })

    it('une étape en cours sans action compte aussi, et se fige quand elle est terminée', async () => {
      vi.useFakeTimers()
      try {
        const debut = ['Étape #1 à faire · Penser', 'Étape #2 à faire · Agir']
        const { host, rendre, demonter } = await monter(false, [
          ...debut,
          'Étape #1 en cours · Penser'
        ])
        await act(async () => {
          vi.advanceTimersByTime(12_000)
        })
        expect(valeurs(host)).toEqual(['en cours · 12 s', 'à faire'])
        await rendre(false, [
          ...debut,
          'Étape #1 en cours · Penser',
          'Étape #1 terminée · Penser',
          'Étape #2 en cours · Agir'
        ])
        await act(async () => {
          vi.advanceTimersByTime(7_000)
        })
        expect(valeurs(host)).toEqual(['terminée · 12 s', 'en cours · 7 s'])
        await demonter()
      } finally {
        vi.useRealTimers()
      }
    })

    it('tour fini : le chrono s’arrête, et un remontage du même tour ne repart pas de zéro', async () => {
      vi.useFakeTimers()
      try {
        const journal = ['Étape #1 à faire · Penser', 'Étape #1 en cours · Penser']
        const premier = await monter(false, journal, 'tour-chrono-etapes')
        await act(async () => {
          vi.advanceTimersByTime(20_000)
        })
        await premier.demonter()
        const second = await monter(false, journal, 'tour-chrono-etapes')
        await act(async () => {
          vi.advanceTimersByTime(3_000)
        })
        expect(valeurs(second.host)).toEqual(['en cours · 23 s'])
        await second.rendre(true, journal)
        await act(async () => {
          vi.advanceTimersByTime(60_000)
        })
        expect(valeurs(second.host)).toEqual(['en cours · 23 s'])
        await second.demonter()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('aucun bloc Étapes pour un tour qui n’en a pas', async () => {
    const { host, demonter } = await monter(false, ['Read · a.ts', 'Read terminé - 0 s'])
    expect(host.querySelector('[data-testid="etapes-block"]')).toBeNull()
    await demonter()
  })
})
