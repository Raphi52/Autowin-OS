import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * DU TRAVAIL NON FUSIONNÉ DOIT DÉCLENCHER SON TRI, pas seulement s'afficher.
 *
 * Le recensement des travaux non publiés a été réparé le 2026-08-26 : l'agent les VOIT désormais
 * dans `get_state`. Mais voir n'est pas agir — le défaut d'origine (« rien à fusionner » répondu
 * alors que le commit existait) venait d'un agent qui n'avait aucune procédure à suivre. Une donnée
 * de plus dans un état qu'il lit en diagonale ne change pas ce qu'il FAIT.
 *
 * On pose donc la consigne dans le PROMPT, mais pilotée par l'ÉTAT : le champ n'existe que quand du
 * travail est réellement échoué. Trois propriétés en découlent :
 *   - quand il n'y a rien, zéro ligne de prompt, zéro bruit — une règle permanente se dilue ;
 *   - quand il y a quelque chose, la consigne arrive à CHAQUE tour, pas une fois ;
 *   - elle nomme le skill à invoquer, `salvage`, plutôt que de décrire vaguement un devoir.
 *
 * Le snapshot de prompt est sérialisé en JSON dans « ÉTAT DE L'APP » à chaque tour
 * (`chat-turn-messages.ts`) : ce champ y voyage sans autre câblage.
 */

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

type Travail = { agentId: string; date: string; fichiers: string[] }

const osAvec = (travaux: Travail[]): OsDouble =>
  ({
    executionWorkspace: process.cwd(),
    conversations: { list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => [],
    travauxNonPubliesBornes: () => travaux
  }) as unknown as OsDouble

const UN_TRAVAIL: Travail = {
  agentId: 'run-ef845009a251-1',
  date: '2026-08-26',
  fichiers: ['src/renderer/src/components/home-decor-scene.ts']
}

describe('du travail non fusionné déclenche `salvage`', () => {
  it('pose une consigne qui NOMME le skill quand du travail attend', async () => {
    const bus = new AppCommandBus(osAvec([UN_TRAVAIL]), () => undefined)

    const prompt = await bus.snapshotForPrompt()

    expect(prompt.travauxNonFusionnes?.compte).toBe(1)
    expect(prompt.travauxNonFusionnes?.consigne).toContain('salvage')
  })

  it('reste ABSENT quand rien n’attend — une règle permanente se dilue', async () => {
    const bus = new AppCommandBus(osAvec([]), () => undefined)

    const prompt = await bus.snapshotForPrompt()

    expect(prompt.travauxNonFusionnes).toBeUndefined()
  })

  it('voyage dans le JSON du prompt, pas seulement dans l’objet', async () => {
    // C'est `JSON.stringify(snapshot)` qui atteint le modèle : un champ non sérialisable
    // n'existerait pas pour lui.
    const bus = new AppCommandBus(osAvec([UN_TRAVAIL]), () => undefined)

    const serialise = JSON.stringify(await bus.snapshotForPrompt())

    expect(serialise).toContain('salvage')
    expect(serialise).toContain('run-ef845009a251-1')
  })

  it('interdit explicitement de conclure « rien à fusionner » sans avoir trié', async () => {
    // La formulation exacte du défaut d'origine, pour que l'agent la reconnaisse.
    const bus = new AppCommandBus(osAvec([UN_TRAVAIL]), () => undefined)

    const consigne = (await bus.snapshotForPrompt()).travauxNonFusionnes?.consigne ?? ''

    expect(consigne).toMatch(/rien à fusionner/iu)
  })

  /**
   * LA LISTE EST UN POINT DE DEPART, PAS LE PERIMETRE.
   *
   * DEFAUT VECU le 2026-09-02 (conv-121) : l'utilisateur a du lancer `/salvage` QUATRE fois. Au
   * premier passage l'agent n'a trie que les N copies isolees citees ici, alors que deux remises de
   * cote (`git stash`) attendaient depuis la veille — dont une portant un vrai bug (un ordre dicte
   * partait DEUX fois, donc deux tours payants). Il les avait meme listees, puis ecartees d'un
   * « pre-existantes, non touchees ».
   *
   * La cause est dans cette consigne : en ne nommant QUE les copies isolees, et en opposant l'arbre
   * principal (« un `git status` ne les voit pas »), elle se lisait comme la DEFINITION du travail a
   * faire. La consigne doit donc nommer les autres cachettes, sinon un compte de N cadre le balayage
   * a N et le reste attend une relance de l'utilisateur.
   */
  it('dit que la liste est un POINT DE DEPART, et nomme les autres cachettes', async () => {
    const bus = new AppCommandBus(osAvec([UN_TRAVAIL]), () => undefined)

    const consigne = (await bus.snapshotForPrompt()).travauxNonFusionnes?.consigne ?? ''

    expect(consigne, 'la liste ne doit pas se lire comme le perimetre entier').toMatch(
      /point de d[eé]part/iu
    )
    expect(consigne, 'les remises de cote sont la cachette oubliee au premier passage').toMatch(
      /remise|stash/iu
    )
  })
})
