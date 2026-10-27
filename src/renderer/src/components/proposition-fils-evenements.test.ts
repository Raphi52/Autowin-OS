// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EVT_FILS_LANCES,
  confirmerLancement,
  lancerAvecFilet,
  lireSouvenir,
  type ConfirmationDeLancement,
  type DemandeDeLancement
} from './proposition-fils-evenements'

/*
 * LE DERNIER FILET DE « LANCER EN N FILS » (2e relecture externe, conv-1147, point bas). Une erreur
 * imprévue APRÈS la création de branches répondait « Lancé : » avec une liste VIDE : les fils déjà
 * ouverts, qui travaillaient, n'étaient nommés nulle part sur la carte. Entrées qui font échouer
 * l'ancienne version : une branche créée puis une erreur ; une erreur APRÈS la réponse du lancement,
 * qui écrasait un reçu juste par un échec.
 */
const DEMANDE: DemandeDeLancement = {
  mode: 'fils',
  plan: [],
  cle: 'autowin:fils-lances:test:1'
}

let recues: ConfirmationDeLancement[]
const ecouter = (event: Event): void => {
  recues.push((event as CustomEvent<ConfirmationDeLancement>).detail)
}
beforeEach(() => {
  localStorage.clear()
  recues = []
  window.addEventListener(EVT_FILS_LANCES, ecouter)
})
afterEach(() => window.removeEventListener(EVT_FILS_LANCES, ecouter))

describe('lancerAvecFilet', () => {
  it('une erreur après une branche créée nomme ce fil sur la carte, et le dit interrompu', async () => {
    await lancerAvecFilet(async (_demande, suivi) => {
      suivi.fils.push({ id: 'conv-9', titre: 'Titre des fiches' })
      throw new Error('panne imprévue')
    }, DEMANDE)
    expect(recues).toHaveLength(1)
    expect(recues[0]!.fils).toEqual([{ id: 'conv-9', titre: 'Titre des fiches' }])
    expect(recues[0]!.refus?.[0]).toMatch(/interrompu.*panne imprévue/u)
    // Le reçu est ÉCRIT, pas seulement annoncé : une carte qui naît après le relit.
    expect(lireSouvenir(DEMANDE.cle)).toMatchObject({ fils: [{ id: 'conv-9' }] })
  })

  it('une erreur APRÈS la réponse du lancement n’écrase pas son reçu', async () => {
    await lancerAvecFilet(async (demande, suivi) => {
      suivi.fils.push({ id: 'conv-9', titre: 'A' })
      confirmerLancement({ cle: demande.cle, mode: demande.mode, fils: [...suivi.fils] })
      suivi.confirme = true
      throw new Error('après coup')
    }, DEMANDE)
    expect(recues).toHaveLength(1)
    expect(recues[0]!.refus).toBeUndefined()
    expect(lireSouvenir(DEMANDE.cle)).toEqual({
      mode: 'fils',
      fils: [{ id: 'conv-9', titre: 'A' }]
    })
  })

  it('sans erreur, le filet ne répond rien de lui-même', async () => {
    await lancerAvecFilet(async () => {}, DEMANDE)
    expect(recues).toHaveLength(0)
  })
})

/*
 * BRANCHEMENT DANS CHATVIEW, vérifié sur le code : aucune panne connue n'atteint ce filet (chaque
 * étape de `lancerEnFils` rattrape déjà la sienne), il n'y a donc pas d'erreur réelle à provoquer
 * de bout en bout. On vérifie que l'écouteur passe par le filet, que les fils créés sont ceux que le
 * filet lit, et que la réponse du lancement est notée.
 */
describe('lancerAvecFilet — branché dans ChatView', () => {
  it('l’écouteur passe par le filet, qui voit les fils créés et la réponse donnée', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8')
    expect(source).toMatch(
      /void lancerAvecFilet\(\s*\(aLancer, suivi\) => lancerEnFilsRef\.current\(aLancer, suivi\)/u
    )
    expect(source).toContain('const lances: FilLance[] = suivi.fils')
    expect(source).toMatch(/confirmerLancement\(detail\)\s*\n\s*suivi\.confirme = true/u)
    expect(source).not.toContain('refus: [\n            `lancement interrompu')
  })
})
