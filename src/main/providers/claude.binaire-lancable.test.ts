import { describe, expect, it } from 'vitest'
import { binaireClaudeLancable } from './claude'

// REPRODUIT le 2026-09-25 (20:48 puis 20:59, instance relancee par `restart_app`) : le relais
// survivable Windows a recu le NOM NU `claude` (`-ExecutableB64` decode = « claude »). Le runner le
// passe a CreateProcessW en lpApplicationName, qui ne cherche JAMAIS dans le PATH : echec certain,
// « Le fichier specifie est introuvable », a chaque tour, sans dire ce qui manque. Une instance neuve,
// meme environnement, resolvait bien `claude.exe` — la cause exacte n'a pas pu etre reconstituee.
// Garde : aucun nom nu ne part plus vers le relais ; on re-resout, sinon on echoue en le DISANT.

const EXE =
  'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
const sansAttente = async (): Promise<void> => {}

describe('binaireClaudeLancable — jamais de nom nu vers le relais Windows', () => {
  it('LE CAS REPRODUIT : `claude` nu est re-resolu en chemin absolu avant le lancement', async () => {
    let appels = 0
    const bin = await binaireClaudeLancable('claude', {
      platform: 'win32',
      rechercher: () => (++appels >= 2 ? EXE : undefined),
      attendre: sansAttente
    })
    expect(bin).toBe(EXE)
  })

  it('le dernier binaire trouve dans ce processus sert de secours s il existe encore', async () => {
    const bin = await binaireClaudeLancable('claude', {
      platform: 'win32',
      rechercher: () => undefined,
      dernierConnu: () => EXE,
      existe: (chemin) => chemin === EXE,
      attendre: sansAttente
    })
    expect(bin).toBe(EXE)
  })

  it('introuvable pour de bon : erreur qui NOMME les dossiers cherches, pas le message du runner', async () => {
    const echec = binaireClaudeLancable('claude', {
      platform: 'win32',
      rechercher: () => undefined,
      dernierConnu: () => undefined,
      candidats: () => ['C:\\Users\\x\\AppData\\Roaming\\npm', 'D:\\outils'],
      attendre: sansAttente
    })
    await expect(echec).rejects.toThrow(
      /introuvable.*C:\\Users\\x\\AppData\\Roaming\\npm.*CLAUDE_BIN/s
    )
  })

  it('un chemin absolu, un binaire DESIGNE (CLAUDE_BIN / option) ou hors Windows : inchange', async () => {
    const rechercher = (): string => {
      throw new Error('ne doit pas re-resoudre')
    }
    expect(await binaireClaudeLancable(EXE, { platform: 'win32', rechercher })).toBe(EXE)
    expect(
      await binaireClaudeLancable('claude-next', { platform: 'win32', designe: true, rechercher })
    ).toBe('claude-next')
    expect(await binaireClaudeLancable('claude', { platform: 'linux', rechercher })).toBe('claude')
  })
})
