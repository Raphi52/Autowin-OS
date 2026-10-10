import { describe, expect, it } from 'vitest'
import {
  fenetreSilencieuse,
  SILENCE_AVANT_GEL_MS,
  surveillerParBattement
} from './gel-battement-fenetre'

describe('battement actif vers la fenetre', () => {
  it('ne crie pas au gel sur un seul echo manque', () => {
    expect(fenetreSilencieuse({ echosManques: 1, intervalleMs: 5_000 })).toBe(false)
  })

  it('declare le gel quand le silence atteint le seuil', () => {
    expect(fenetreSilencieuse({ echosManques: 3, intervalleMs: 5_000 })).toBe(true)
  })

  it('rend le meme verdict quelle que soit la cadence, a silence egal', () => {
    expect(fenetreSilencieuse({ echosManques: 15, intervalleMs: 1_000 })).toBe(true)
    expect(fenetreSilencieuse({ echosManques: 14, intervalleMs: 1_000 })).toBe(false)
  })

  it('garde un seuil explicite plutot qu un nombre en dur', () => {
    expect(SILENCE_AVANT_GEL_MS).toBeGreaterThan(0)
  })
})

describe('branchement du battement sur une fenetre', () => {
  it('recharge la fenetre apres un silence prolonge, et le journalise', async () => {
    const journal: Array<{ operation: string; silenceMs: number }> = []
    let recharges = 0
    let battre: (() => void) | undefined
    const fenetre = {
      webContents: {
        // Une fenetre gelee ne resout JAMAIS son echo.
        mainFrame: { executeJavaScript: () => new Promise<unknown>(() => {}) },
        reloadIgnoringCache: () => {
          recharges += 1
        }
      }
    }
    surveillerParBattement(
      fenetre,
      (operation, silenceMs) => journal.push({ operation, silenceMs }),
      {
        intervalleMs: 5,
        silenceAvantGelMs: 10,
        planifier: (action) => {
          battre = action
          return 1
        }
      }
    )
    for (let tour = 0; tour < 3; tour++) {
      battre?.()
      await new Promise((res) => setTimeout(res, 20))
    }

    expect(recharges).toBe(1)
    expect(journal[0]?.operation).toBe('renderer:silence-au-battement')
    expect(journal[0]?.silenceMs).toBeGreaterThanOrEqual(10)
  })

  it('ne recharge pas une fenetre qui repond', async () => {
    let recharges = 0
    let battre: (() => void) | undefined
    const fenetre = {
      webContents: {
        mainFrame: { executeJavaScript: () => Promise.resolve(1) },
        reloadIgnoringCache: () => {
          recharges += 1
        }
      }
    }
    surveillerParBattement(fenetre, () => {}, {
      intervalleMs: 5,
      silenceAvantGelMs: 10,
      planifier: (action) => {
        battre = action
        return 1
      }
    })
    for (let tour = 0; tour < 4; tour++) {
      battre?.()
      await new Promise((res) => setTimeout(res, 20))
    }

    expect(recharges).toBe(0)
  })
})

describe('fenetre detruite', () => {
  /*
   * REGRESSION du 2026-09-12. Sur un BrowserWindow detruit, le simple ACCES a `webContents` leve
   * `TypeError: Object has been destroyed`. Ce throw part du timer, donc hors promesse : il remontait
   * en `uncaughtException` toutes les 5 s, et le filet de crash global y repondait en coupant TOUTES
   * les orchestrations en vol. Le battement doit se taire tout seul.
   */
  it('ne leve rien et s arrete de lui-meme au lieu d interroger la fenetre morte', () => {
    let battre: (() => void) | undefined
    let annulations = 0
    const fenetre = {
      isDestroyed: () => true,
      get webContents(): never {
        throw new TypeError('Object has been destroyed')
      }
    }
    surveillerParBattement(fenetre, () => {}, {
      intervalleMs: 5,
      planifier: (action) => {
        battre = action
        return 1
      },
      annuler: () => {
        annulations += 1
      }
    })

    expect(() => battre?.()).not.toThrow()
    expect(annulations).toBe(1)
  })
})

describe('fenetre en plein chargement', () => {
  /*
   * REGRESSION du 2026-10-10 (gels.jsonl, 06:54:39Z puis 06:55:09Z). Au demarrage, l'interface se
   * chargeait depuis le serveur de developpement : le battement a declare 15 s de silence, recharge
   * la page — ce qui relancait le chargement a zero —, puis tue l'affichage 30 s plus tard. Une fois
   * relancee, l'interface s'est chargee en 1,2 s : la fenetre n'etait pas gelee, elle CHARGEAIT.
   *
   * Cause : Electron 44.5.1 fait attendre `webContents.executeJavaScript` jusqu'a `did-stop-loading`
   * tant que la page charge (lib/browser/api/web-contents.ts, `waitTillCanExecuteJavaScript`). Le
   * faux reproduit exactement ce comportement ; `mainFrame.executeJavaScript`, lui, s'execute tout de
   * suite (shell/browser/api/electron_api_web_frame_main.cc, `WebFrameMain::ExecuteJavaScript`).
   */
  const fenetreQuiCharge = (cadreRepond: boolean) => {
    const compte = { recharges: 0, tues: 0 }
    const fenetre = {
      webContents: {
        isLoadingMainFrame: () => true,
        // Electron : en plein chargement, cet echo n'est execute qu'a la fin du chargement.
        executeJavaScript: () => new Promise<unknown>(() => {}),
        mainFrame: {
          executeJavaScript: () =>
            cadreRepond ? Promise.resolve(1) : new Promise<unknown>(() => {})
        },
        reloadIgnoringCache: () => {
          compte.recharges += 1
        },
        forcefullyCrashRenderer: () => {
          compte.tues += 1
        }
      }
    }
    return { fenetre, compte }
  }

  const battreSixFois = async (fenetre: Parameters<typeof surveillerParBattement>[0]) => {
    const journal: string[] = []
    let battre: (() => void) | undefined
    surveillerParBattement(fenetre, (operation) => journal.push(operation), {
      intervalleMs: 5,
      silenceAvantGelMs: 10,
      silenceAvantEscaladeMs: 10,
      planifier: (action) => {
        battre = action
        return 1
      }
    })
    for (let tour = 0; tour < 6; tour++) {
      battre?.()
      await new Promise((res) => setTimeout(res, 20))
    }
    return journal
  }

  it('ne compte pas un chargement lent comme un gel quand la page repond', async () => {
    const { fenetre, compte } = fenetreQuiCharge(true)

    const journal = await battreSixFois(fenetre)

    expect(journal).toEqual([])
    expect(compte).toEqual({ recharges: 0, tues: 0 })
  })

  it('voit toujours un vrai gel survenu pendant le chargement', async () => {
    const { fenetre, compte } = fenetreQuiCharge(false)

    const journal = await battreSixFois(fenetre)

    expect(journal).toEqual([
      'renderer:silence-au-battement',
      'renderer:affichage-force-a-repartir'
    ])
    expect(compte).toEqual({ recharges: 1, tues: 1 })
  })
})

describe('escalade quand le rechargement reste sans effet', () => {
  it('tue le processus d affichage si le silence persiste apres le rechargement', async () => {
    const journal: string[] = []
    let recharges = 0
    let tues = 0
    let battre: (() => void) | undefined
    const fenetre = {
      webContents: {
        mainFrame: { executeJavaScript: () => new Promise<unknown>(() => {}) },
        reloadIgnoringCache: () => {
          recharges += 1
        },
        forcefullyCrashRenderer: () => {
          tues += 1
        }
      }
    }
    surveillerParBattement(fenetre, (operation) => journal.push(operation), {
      intervalleMs: 5,
      silenceAvantGelMs: 10,
      silenceAvantEscaladeMs: 10,
      planifier: (action) => {
        battre = action
        return 1
      }
    })
    for (let tour = 0; tour < 6; tour++) {
      battre?.()
      await new Promise((res) => setTimeout(res, 20))
    }

    expect(recharges).toBe(1)
    expect(tues).toBe(1)
    expect(journal).toEqual([
      'renderer:silence-au-battement',
      'renderer:affichage-force-a-repartir'
    ])
  })
})
