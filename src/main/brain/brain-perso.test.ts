import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PORT_BRAIN_PERSO_PAR_DEFAUT,
  brainPersoADesNotes,
  cheminSansPrefixePerso,
  envDuBrainPerso,
  estCheminPerso,
  fusionnerListesBrain,
  origineBrainPerso,
  pingBrainPerso,
  portBrainPerso,
  preparerDossierBrainPerso,
  racineBrainPerso
} from './brain-perso'
import { sharedBrainOrigin, sharedBrainRoot } from './brain-paths'
import { appliquerBrainReglage, lireBrainReglage } from './brain-reglage'
import {
  MAX_BRAIN_LAUNCH_ATTEMPTS,
  ensureBrainServerStarted,
  resetBrainLaunchAttempt,
  resolveBrainRuntime
} from './brain-server-launch'

/**
 * BRAIN PERSO À CÔTÉ DU BRAIN D'ÉQUIPE (demande utilisateur du 2026-10-28, conv-1233).
 * Même moteur, autre dossier, autre port : rien ne doit passer de l'un à l'autre.
 */
const dossiers: string[] = []
const temp = (prefixe = 'brain-perso-'): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})
/** Un poste : APPDATA (réglages), LOCALAPPDATA (dossier local), et un Brain d'équipe réglé. */
const poste = async (): Promise<{ env: NodeJS.ProcessEnv; equipe: string }> => {
  const racine = temp()
  const env: NodeJS.ProcessEnv = {
    APPDATA: join(racine, 'Roaming'),
    LOCALAPPDATA: join(racine, 'Local'),
    AUTOWIN_BRAIN_ORIGIN: 'http://127.0.0.1:8766'
  }
  const equipe = temp('brain-equipe-')
  await appliquerBrainReglage({ chemin: equipe }, { env, racineParDefaut: 'X:/jamais' })
  return { env, equipe }
}

describe('réglage du Brain perso', () => {
  it('sans réglage : aucun Brain perso, et rien ne change pour l’équipe', async () => {
    const { env, equipe } = await poste()
    expect(racineBrainPerso(env)).toBeUndefined()
    expect(envDuBrainPerso(env)).toBeUndefined()
    expect(sharedBrainRoot(env)).toBe(equipe)
  })

  it('son propre fichier : régler le perso ne touche pas au réglage de l’équipe', async () => {
    const { env, equipe } = await poste()
    const perso = temp('brain-perso-dossier-')
    await appliquerBrainReglage(
      { chemin: perso },
      { env, racineParDefaut: 'X:/jamais', quel: 'perso' }
    )

    expect(racineBrainPerso(env)).toBe(perso)
    expect(lireBrainReglage(env)).toEqual({ chemin: equipe })
    expect(sharedBrainRoot(env)).toBe(equipe)
  })

  it('dépôt sans chemin : cloné dans le dossier local d’Autowin, à part de celui de l’équipe', async () => {
    const { env } = await poste()
    const cloner = vi.fn(async (_depot: string, dossier: string) => {
      mkdirSync(join(dossier, '.git'), { recursive: true })
    })
    const reglage = await appliquerBrainReglage(
      { depot: 'https://exemple.invalid/moi/brain.git' },
      {
        env,
        racineParDefaut: join(env.LOCALAPPDATA!, 'AutowinBrain', 'perso'),
        quel: 'perso',
        cloner
      }
    )
    expect(reglage).toEqual({ depot: 'https://exemple.invalid/moi/brain.git' })
    expect(racineBrainPerso(env)).toBe(join(env.LOCALAPPDATA!, 'AutowinBrain', 'perso'))
    expect(cloner).toHaveBeenCalledOnce()
  })
})

describe('environnement du Brain perso', () => {
  it('vise le dossier perso et SON port, avec le code Python de l’équipe', async () => {
    const { env } = await poste()
    const perso = temp('brain-perso-dossier-')
    await appliquerBrainReglage(
      { chemin: perso },
      { env, racineParDefaut: 'X:/jamais', quel: 'perso' }
    )
    const envPerso = envDuBrainPerso(env)!

    expect(sharedBrainRoot(envPerso)).toBe(perso)
    expect(sharedBrainOrigin(envPerso)).toBe(`http://127.0.0.1:${PORT_BRAIN_PERSO_PAR_DEFAUT}`)
    expect(sharedBrainOrigin(env)).toBe('http://127.0.0.1:8766')
    const runtimePerso = resolveBrainRuntime(envPerso)
    const runtimeEquipe = resolveBrainRuntime(env)
    expect(runtimePerso.brainRoot).toBe(perso)
    expect(runtimePerso.tooling).toBe(runtimeEquipe.tooling)
    expect(runtimePerso.python).toBe(runtimeEquipe.python)
  })

  it('jamais le port de l’équipe : collision → le port suivant', () => {
    const env = { AUTOWIN_BRAIN_ORIGIN: 'http://127.0.0.1:8775' }
    expect(portBrainPerso(env)).toBe(8776)
    expect(origineBrainPerso({ AUTOWIN_BRAIN_PERSO_PORT: '9001' })).toBe('http://127.0.0.1:9001')
  })

  it('prépare knowledge/ et inbox/, et sait s’il y a déjà des notes', () => {
    const racine = temp('brain-perso-vide-')
    preparerDossierBrainPerso(racine)
    expect(existsSync(join(racine, 'knowledge'))).toBe(true)
    expect(existsSync(join(racine, 'inbox'))).toBe(true)
    expect(brainPersoADesNotes(racine)).toBe(false)
    mkdirSync(join(racine, 'knowledge', 'lessons'))
    writeFileSync(join(racine, 'knowledge', 'lessons', 'note.md'), '# note')
    expect(brainPersoADesNotes(racine)).toBe(true)
  })
})

describe('sonde du serveur perso', () => {
  it('un 403 sur GET / veut dire « debout » (c’est ce que rend brain_server.py)', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403 }))
    expect(await pingBrainPerso({}, fetchFn as never)).toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT_BRAIN_PERSO_PAR_DEFAUT}/`,
      expect.anything()
    )
  })

  it('connexion refusée : éteint', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await pingBrainPerso({}, fetchFn as never)).toBe(false)
  })
})

describe('fusion des listes : l’agent sait de quel Brain vient chaque note', () => {
  const equipe = '### Candidate 1 — Décision A\n`knowledge/decisions/a.md` · 1 Ko · decision'
  const perso = '### Candidate 1 — Recette\n`knowledge/domain/recette.md` · 2 Ko · domain'

  it('les chemins perso reçoivent le préfixe perso:, ceux de l’équipe restent tels quels', () => {
    const fusion = fusionnerListesBrain(equipe, perso)
    expect(fusion).toContain('`knowledge/decisions/a.md`')
    expect(fusion).toContain('`perso:knowledge/domain/recette.md`')
    expect(fusion).not.toContain('`perso:knowledge/decisions/a.md`')
    expect(fusion.indexOf('BRAIN D’ÉQUIPE')).toBeLessThan(fusion.indexOf('BRAIN PERSO'))
  })

  it('rien de perso : la liste de l’équipe est rendue à l’identique', () => {
    expect(fusionnerListesBrain(equipe, '   ')).toBe(equipe)
  })

  it('rien de l’équipe : seul le bloc perso', () => {
    const fusion = fusionnerListesBrain('', perso)
    expect(fusion).not.toContain('BRAIN D’ÉQUIPE')
    expect(fusion).toContain('`perso:knowledge/domain/recette.md`')
  })

  it('un préfixe perso: se reconnaît et se retire pour le serveur perso', () => {
    expect(estCheminPerso(' perso:knowledge/x.md')).toBe(true)
    expect(estCheminPerso('knowledge/x.md')).toBe(false)
    expect(cheminSansPrefixePerso('perso:knowledge/x.md')).toBe('knowledge/x.md')
    expect(cheminSansPrefixePerso('knowledge/x.md')).toBe('knowledge/x.md')
  })
})

describe('deux serveurs, deux compteurs de démarrage', () => {
  let tooling: string
  beforeEach(() => {
    resetBrainLaunchAttempt()
    tooling = temp('brain-tooling-')
    mkdirSync(join(tooling, '.venv', 'Scripts'), { recursive: true })
    writeFileSync(join(tooling, '.venv', 'Scripts', 'python.exe'), '')
    writeFileSync(join(tooling, 'brain_server.py'), '')
  })

  it('les essais ratés du serveur d’équipe ne privent pas le Brain perso de son démarrage', async () => {
    let t = 0
    const now = (): number => (t += 10 * 60_000)
    const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() })
    const equipe = { AUTOWIN_BRAIN_TOOLING: tooling, AUTOWIN_BRAIN_ORIGIN: 'http://127.0.0.1:8766' }
    for (let i = 0; i < MAX_BRAIN_LAUNCH_ATTEMPTS; i++) {
      await ensureBrainServerStarted(async () => false, equipe, spawnFn as never, now)
    }
    const bloque = await ensureBrainServerStarted(async () => false, equipe, spawnFn as never, now)
    expect(bloque.status).toBe('unavailable')

    const perso = { ...equipe, AUTOWIN_BRAIN_ORIGIN: 'http://127.0.0.1:8775' }
    const r = await ensureBrainServerStarted(async () => false, perso, spawnFn as never, now)
    expect(r.status).toBe('starting')
    const envLance = spawnFn.mock.calls.at(-1)?.[2]?.env as NodeJS.ProcessEnv
    expect(envLance.AUTOWIN_BRAIN_PORT).toBe('8775')
  })
})
