import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { lecteurWindows, rechargerEnv, VARIABLES_RECHARGEABLES } from './env-reload'
import { verifyTimeoutMs, VERIFY_TIMEOUT_MS } from './verify-command'
import { amitelBrainOrigin } from './amitel-paths'

/**
 * CE QUE CE TEST PROUVE : le plafond de `verify` change SANS redemarrage.
 *
 * DEFAUT VECU (conv-1516) : `setx AUTOWIN_VERIFY_TIMEOUT_MS 86400000` a reussi (exit 0, valeur
 * relue dans `HKCU\Environment`) et le processus principal a continue de couper a 600 s, parce que
 * `process.env` est fige au lancement. La valeur existait, personne ne la lisait.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une valeur persistee
 * DIFFERENTE de celle du processus (ici `86400000` alors que l'env courant ne porte rien). Une
 * correction qui se contenterait de relire `process.env`, ou qui n'ecrirait pas la valeur lue,
 * laisserait `verifyTimeoutMs` a `VERIFY_TIMEOUT_MS` (600 000) et ce test tomberait rouge.
 */
afterEach(() => {
  delete process.env.AUTOWIN_VERIFY_TIMEOUT_MS
})

describe('reload_env — recharger une variable a chaud', () => {
  it('fait changer le plafond de verify sans redemarrer le processus', () => {
    const env = {} as NodeJS.ProcessEnv
    expect(verifyTimeoutMs(env)).toBe(VERIFY_TIMEOUT_MS)

    const issue = rechargerEnv('AUTOWIN_VERIFY_TIMEOUT_MS', {
      env,
      lecteur: () => '86400000'
    })

    expect(issue.change).toBe(true)
    expect(issue.apres).toBe('86400000')
    expect(env.AUTOWIN_VERIFY_TIMEOUT_MS).toBe('86400000')
    expect(verifyTimeoutMs(env)).toBe(86_400_000)
  })

  it('ne bouge pas quand la valeur persistée est identique', () => {
    const env = { AUTOWIN_VERIFY_TIMEOUT_MS: '86400000' } as NodeJS.ProcessEnv
    const issue = rechargerEnv('AUTOWIN_VERIFY_TIMEOUT_MS', { env, lecteur: () => '86400000' })
    expect(issue.change).toBe(false)
    expect(verifyTimeoutMs(env)).toBe(86_400_000)
  })

  it('rend la main sans rien changer quand rien n’est persisté', () => {
    const env = {} as NodeJS.ProcessEnv
    const issue = rechargerEnv('AUTOWIN_VERIFY_TIMEOUT_MS', { env, lecteur: () => undefined })
    expect(issue.change).toBe(false)
    expect(env.AUTOWIN_VERIFY_TIMEOUT_MS).toBeUndefined()
    expect(verifyTimeoutMs(env)).toBe(VERIFY_TIMEOUT_MS)
  })

  it('refuse toute variable hors liste blanche — le modèle ne choisit pas la cible', () => {
    const env = { PATH: 'inchangé' } as NodeJS.ProcessEnv
    expect(() => rechargerEnv('PATH', { env, lecteur: () => 'malveillant' })).toThrow(
      /non rechargeable/i
    )
    expect(() => rechargerEnv('', { env, lecteur: () => 'x' })).toThrow(/non rechargeable/i)
    expect(env.PATH).toBe('inchangé')
    expect(VARIABLES_RECHARGEABLES).toContain('AUTOWIN_VERIFY_TIMEOUT_MS')
  })

  /**
   * DEFAUT VECU (conv-8, 2026-09-03) : le service Brain ecoutait 8766, le processus principal
   * retombait sur le defaut 8765 parce que `AMITEL_BRAIN_ORIGIN` n'etait persistee NULLE PART —
   * elle ne vivait que dans le shell ou elle avait ete tapee. Chaque `brain_query` rendait
   * « indisponible » en 15 ms (connexion refusee), et l'origine n'etait pas rechargeable : la
   * seule issue etait un redemarrage complet de l'app.
   *
   * ENTREE QUI FAIT ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une origine persistee (8766)
   * differente de celle du processus (8765). Sans l'ajout a la liste blanche, `rechargerEnv` leve
   * « Variable non rechargeable » et `amitelBrainOrigin` reste sur 8765.
   */
  it('rebranche le canal Brain a chaud quand le port persiste diverge du processus', () => {
    const env = { AMITEL_BRAIN_ORIGIN: 'http://127.0.0.1:8765' } as NodeJS.ProcessEnv
    expect(amitelBrainOrigin(env)).toBe('http://127.0.0.1:8765')

    const issue = rechargerEnv('AMITEL_BRAIN_ORIGIN', {
      env,
      lecteur: (nom) => (nom === 'AMITEL_BRAIN_ORIGIN' ? 'http://127.0.0.1:8766' : undefined)
    })

    expect(issue.change).toBe(true)
    expect(amitelBrainOrigin(env)).toBe('http://127.0.0.1:8766')
  })


  /**
   * SANS CE TEST, tout le reste passe avec un lecteur qui ne lit RIEN : mesure du 2026-08-29, un
   * backslash mange par l'ecriture du fichier (`HKCU\Environment` devenu `HKCUEnvironment`)
   * faisait echouer chaque `reg query` en silence — six tests verts, zero lecture reelle.
   *
   * `Path` est la seule valeur dont l'existence dans `HKCU\Environment` est garantie sur un poste
   * Windows utilisateur ; elle est LUE, jamais rechargee (hors liste blanche).
   */
  it('lit réellement le registre utilisateur (sinon tout le reste est un faux-vert)', () => {
    if (process.platform !== 'win32') return
    expect(lecteurWindows('Path')).toBeTruthy()
    expect(lecteurWindows('AUTOWIN_VARIABLE_QUI_NEXISTE_PAS')).toBeUndefined()
  })

  it('est exposée comme commande et applique la valeur au process courant', async () => {
    const bus = new AppCommandBus({ executionWorkspace: process.cwd() } as never, () => undefined)

    const result = await bus.exec('reload_env', { nom: 'AUTOWIN_VERIFY_TIMEOUT_MS' })

    expect(result.ok).toBe(true)
    const data = result.data as { nom: string; apres?: string; detail: string }
    expect(data.nom).toBe('AUTOWIN_VERIFY_TIMEOUT_MS')
    // La valeur vient de l'OS, pas du test : on prouve seulement que ce qui est LU atterrit dans
    // `process.env` et pilote le plafond effectif, sans redemarrage.
    if (data.apres !== undefined) {
      expect(process.env.AUTOWIN_VERIFY_TIMEOUT_MS).toBe(data.apres)
      expect(verifyTimeoutMs(process.env)).toBe(Number(data.apres))
    } else {
      expect(data.detail).toMatch(/aucune valeur persistée/i)
    }
  })

  it('refuse par la commande une variable hors liste blanche', async () => {
    const bus = new AppCommandBus({ executionWorkspace: process.cwd() } as never, () => undefined)
    const result = await bus.exec('reload_env', { nom: 'PATH' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/non rechargeable/i)
  })
})
