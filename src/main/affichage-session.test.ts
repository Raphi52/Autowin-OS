import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { on: vi.fn() },
  screen: { on: vi.fn(), getPrimaryDisplay: () => ({ size: { width: 1920, height: 1080 } }) }
}))
vi.mock('./ipc-senders', () => ({ assertTrustedRendererSender: vi.fn() }))

import { creerSuiviAffichage } from './affichage-session'
import { affichageDe, attributsAffichage, estEcranDeTelephone } from '../shared/affichage-session'

/**
 * L'affichage selon la connexion (conv-1442) : à distance → version allégée ; à distance sur un
 * petit écran → version téléphone. Écrans de référence : celui de la session mesurée le
 * 2026-11-02 depuis le PC (1920 x 1080), un téléphone 2400 x 1080 à 200 % (1200 x 540).
 */
describe("l'écran de téléphone se reconnaît à sa taille", () => {
  it('PC de bureau, portable et téléphone dans les deux sens', () => {
    expect(estEcranDeTelephone(1920, 1080)).toBe(false)
    expect(estEcranDeTelephone(1280, 720)).toBe(false) // 1920 x 1080 à 150 %
    expect(estEcranDeTelephone(1366, 768)).toBe(false)
    expect(estEcranDeTelephone(1200, 540)).toBe(true) // téléphone couché
    expect(estEcranDeTelephone(540, 1200)).toBe(true) // téléphone debout
    expect(estEcranDeTelephone(0, 0)).toBe(false) // écran pas encore connu
  })

  it('le forçage AUTOWIN_AFFICHAGE passe devant la mesure', () => {
    const pc = { distante: false, largeurEcran: 1920, hauteurEcran: 1080 }
    expect(affichageDe({ ...pc, force: 'telephone' })).toEqual({ distante: true, telephone: true })
    expect(affichageDe({ ...pc, force: 'distante' })).toEqual({ distante: true, telephone: false })
    expect(affichageDe({ ...pc, distante: true, force: 'local' })).toEqual({
      distante: false,
      telephone: false
    })
    expect(affichageDe({ ...pc, distante: true, force: 'n-importe' })).toEqual({
      distante: true,
      telephone: false
    })
  })

  it('les attributs posés sur la page', () => {
    expect(attributsAffichage({ distante: true, telephone: true })).toEqual({
      'data-session': 'distante',
      'data-ecran': 'telephone'
    })
    expect(attributsAffichage({ distante: false, telephone: false })).toEqual({
      'data-session': null,
      'data-ecran': null
    })
  })
})

describe('le suivi de la session', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('diffuse le passage à distance, puis au téléphone, et rien quand rien ne change', async () => {
    let distante = false
    let ecran = { width: 1920, height: 1080 }
    const diffuser = vi.fn()
    const suivi = creerSuiviAffichage({
      lireDistante: async () => distante,
      ecranPrincipal: () => ecran,
      diffuser
    })

    expect(await suivi.premiereMesure()).toEqual({ distante: false, telephone: false })
    expect(diffuser).not.toHaveBeenCalled() // l'état de départ est déjà « en local »

    distante = true // reconnexion depuis le PC par Windows App
    await suivi.mesurer()
    expect(diffuser).toHaveBeenLastCalledWith({ distante: true, telephone: false })

    ecran = { width: 1200, height: 540 } // puis depuis le téléphone
    await suivi.mesurer()
    expect(diffuser).toHaveBeenLastCalledWith({ distante: true, telephone: true })

    await suivi.mesurer()
    expect(diffuser).toHaveBeenCalledTimes(2)
  })

  it('une lecture Windows en échec garde la dernière valeur et le dit', async () => {
    let echoue = false
    const journal = vi.fn()
    const suivi = creerSuiviAffichage({
      lireDistante: async () => {
        if (echoue) throw new Error('powershell absent')
        return true
      },
      ecranPrincipal: () => ({ width: 1920, height: 1080 }),
      diffuser: vi.fn(),
      journal
    })
    await suivi.mesurer()
    echoue = true
    expect(await suivi.mesurer()).toEqual({ distante: true, telephone: false })
    expect(journal).toHaveBeenCalledWith(expect.stringContaining('powershell absent'))
  })

  it('une rafale de signaux (déverrouillage + changements d’écran) ne mesure qu’une fois', async () => {
    vi.useFakeTimers()
    const lireDistante = vi.fn(async () => true)
    const suivi = creerSuiviAffichage({
      lireDistante,
      ecranPrincipal: () => ({ width: 1920, height: 1080 }),
      diffuser: vi.fn()
    })
    suivi.remesurerBientot()
    suivi.remesurerBientot()
    suivi.remesurerBientot()
    await vi.advanceTimersByTimeAsync(1000)
    expect(lireDistante).toHaveBeenCalledTimes(1)
  })
})
