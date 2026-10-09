import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  argumentsBash,
  composerPromptDeReprise,
  creerRelanceurSurDisque,
  creerRelanceurTachesDeFond,
  magasinLotsSurDisque,
  resoudreBash,
  type DependancesRelance,
  type MagasinLots,
  type TacheRelancee
} from './relance-taches-de-fond'

/*
 * Garde de `relance-taches-de-fond.ts` : une commande shell coupée en fin de tour est relancée hors
 * du tour, et UN tour de reprise rend son résultat réel dans la même conversation (conv-528, conv-42).
 */

function magasinMemoire(): MagasinLots & { lots: Map<string, TacheRelancee[]> } {
  const lots = new Map<string, TacheRelancee[]>()
  return {
    lots,
    ecrire: (lot, taches) => void lots.set(lot, structuredClone(taches)),
    lister: () => [...lots.values()].map((t) => structuredClone(t)),
    supprimer: (lot) => void lots.delete(lot)
  }
}

function banc(options: Partial<DependancesRelance> = {}) {
  let horloge = 0
  const codes = new Map<string, number>()
  const sorties = new Map<string, string>()
  const lancees: string[] = []
  const arretes: (number | undefined)[] = []
  const envois: { conversationId: string; prompt: string }[] = []
  let occupee = false
  /** Appelé à chaque attente : le banc y fait « finir » les commandes. */
  let pendantAttente: (horloge: number) => void = () => {}
  const magasin = magasinMemoire()
  const deps: DependancesRelance = {
    lancer: ({ commande, jeton }) => {
      lancees.push(commande)
      return { journalPath: `/j/${jeton}`, pid: 4000 + lancees.length }
    },
    codeDeSortie: (j) => codes.get(j),
    lireSortie: (j) => sorties.get(j) ?? '',
    arreter: (pid) => void arretes.push(pid),
    conversationOccupee: () => occupee,
    envoyerTour: async (conversationId, prompt) => void envois.push({ conversationId, prompt }),
    magasin,
    maintenant: () => horloge,
    attendre: async (ms) => {
      horloge += ms
      pendantAttente(horloge)
    },
    limiteMs: 60_000,
    intervalleMs: 1_000,
    journaliser: () => {},
    ...options
  }
  return {
    deps,
    codes,
    sorties,
    lancees,
    arretes,
    envois,
    magasin,
    occuper: (v: boolean) => (occupee = v),
    surAttente: (f: (h: number) => void) => (pendantAttente = f)
  }
}

const tache = (id: string, commande: string) => ({ id, commande, cwd: 'C:/depot' })

describe('relance des tâches de fond coupées en fin de tour', () => {
  it('cas 3 — relance la commande et rend son résultat dans UN tour de reprise du même fil', async () => {
    const b = banc()
    b.surAttente((h) => {
      if (h >= 3_000) {
        b.codes.set('/j/' + [...b.magasin.lots.values()][0][0].lot + '-t1', 0)
        b.sorties.set('/j/' + [...b.magasin.lots.values()][0][0].lot + '-t1', 'Tests  713 passed')
      }
    })
    await creerRelanceurTachesDeFond(b.deps).relancer('conv-7', [tache('t1', 'npx vitest run')])
    expect(b.lancees).toEqual(['npx vitest run'])
    expect(b.envois).toHaveLength(1)
    expect(b.envois[0].conversationId).toBe('conv-7')
    expect(b.envois[0].prompt).toContain('npx vitest run')
    expect(b.envois[0].prompt).toContain('code de sortie 0')
    expect(b.envois[0].prompt).toContain('713 passed')
    // Le lot est retiré du disque une fois rendu : il ne repartira pas au démarrage suivant.
    expect(b.magasin.lots.size).toBe(0)
  })

  it('cas 6 — plusieurs tâches et une en double : chacune lancée une fois, UN seul tour de reprise', async () => {
    const b = banc()
    b.surAttente(() => {
      for (const [, taches] of b.magasin.lots)
        for (const t of taches) b.codes.set(t.journalPath!, 0)
    })
    const relanceur = creerRelanceurTachesDeFond(b.deps)
    await relanceur.relancer('conv-7', [
      tache('a', 'node a.mjs'),
      tache('b', 'node b.mjs'),
      tache('a', 'node a.mjs')
    ])
    await relanceur.relancer('conv-7', [tache('a', 'node a.mjs')])
    expect(b.lancees).toEqual(['node a.mjs', 'node b.mjs'])
    expect(b.envois).toHaveLength(1)
    expect(b.envois[0].prompt).toContain('node a.mjs')
    expect(b.envois[0].prompt).toContain('node b.mjs')
  })

  it('jumeau du cas 6 — le même task_id dans une AUTRE conversation est bien relancé', async () => {
    const b = banc()
    b.surAttente(() => {
      for (const [, taches] of b.magasin.lots)
        for (const t of taches) b.codes.set(t.journalPath!, 0)
    })
    const relanceur = creerRelanceurTachesDeFond(b.deps)
    await relanceur.relancer('conv-7', [tache('a', 'node a.mjs')])
    await relanceur.relancer('conv-8', [tache('a', 'node a.mjs')])
    expect(b.envois.map((e) => e.conversationId)).toEqual(['conv-7', 'conv-8'])
  })

  it('cas 4 — commande vide : rien n’est lancé, aucun tour de reprise', async () => {
    const b = banc()
    await creerRelanceurTachesDeFond(b.deps).relancer('conv-7', [tache('v', '   ')])
    expect(b.lancees).toEqual([])
    expect(b.envois).toEqual([])
  })

  it('cas 7 — code non nul : le tour de reprise dit ÉCHEC, jamais succès', async () => {
    const b = banc()
    b.surAttente(() => {
      for (const [, taches] of b.magasin.lots)
        for (const t of taches) b.codes.set(t.journalPath!, 2)
    })
    await creerRelanceurTachesDeFond(b.deps).relancer('conv-7', [tache('t', 'npm test')])
    expect(b.envois[0].prompt).toContain('ÉCHEC — code de sortie 2')
    expect(b.envois[0].prompt).not.toMatch(/succès/)
  })

  it('cas 7 — lancement impossible : le tour de reprise dit NON DÉMARRÉE avec la cause', async () => {
    const b = banc({
      lancer: () => {
        throw new Error('bash introuvable')
      }
    })
    await creerRelanceurTachesDeFond(b.deps).relancer('conv-7', [tache('t', 'npm test')])
    expect(b.envois[0].prompt).toContain('NON DÉMARRÉE — bash introuvable')
  })

  it('cas 8 — durée maximale dépassée : la commande est arrêtée et le tour le DIT', async () => {
    const b = banc()
    await creerRelanceurTachesDeFond(b.deps).relancer('conv-7', [tache('t', 'sleep 99999')])
    expect(b.arretes).toEqual([4001])
    expect(b.envois[0].prompt).toContain('durée maximale dépassée')
  })

  it('cas 8 — app fermée pendant la commande : le lot sur disque est repris au démarrage', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'relance-fond-'))
    try {
      const magasin = magasinLotsSurDisque(dossier)
      // Ce qu'un premier processus a laissé : la commande tournait, l'app s'est fermée.
      magasin.ecrire('lot-1', [
        {
          lot: 'lot-1',
          conversationId: 'conv-9',
          id: 't',
          commande: 'node long.mjs',
          cwd: 'C:/d',
          debut: 0,
          journalPath: '/j/long',
          pid: 77
        }
      ])
      const b = banc({ magasin })
      b.codes.set('/j/long', 0)
      b.sorties.set('/j/long', 'fini après redémarrage')
      await creerRelanceurTachesDeFond(b.deps).reprendreAuDemarrage()
      expect(b.lancees).toEqual([]) // jamais relancée une seconde fois
      expect(b.envois).toHaveLength(1)
      expect(b.envois[0].prompt).toContain('fini après redémarrage')
      expect(magasin.lister()).toEqual([])
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })

  it('cas 9 — un message de l’utilisateur passe en premier : la reprise attend que le fil soit libre', async () => {
    const b = banc()
    b.occuper(true)
    let horlogeLibre = 0
    b.surAttente((h) => {
      for (const [, taches] of b.magasin.lots)
        for (const t of taches) b.codes.set(t.journalPath!, 0)
      if (h >= 10_000 && !horlogeLibre) {
        horlogeLibre = h
        b.occuper(false)
      }
    })
    let envoyeA = -1
    const deps = {
      ...b.deps,
      envoyerTour: async (conversationId: string, prompt: string) => {
        envoyeA = horlogeLibre
        b.envois.push({ conversationId, prompt })
      }
    }
    await creerRelanceurTachesDeFond(deps).relancer('conv-7', [tache('t', 'npm test')])
    expect(b.envois).toHaveLength(1)
    expect(envoyeA).toBeGreaterThanOrEqual(10_000)
  })
})

describe('prompt de reprise', () => {
  it('ne rend que la FIN d’une sortie énorme', () => {
    const texte = composerPromptDeReprise([
      {
        commande: 'x',
        cwd: 'd',
        issue: { type: 'sortie', code: 0 },
        sortie: 'a'.repeat(50_000) + 'FIN'
      }
    ])
    expect(texte).toContain('FIN')
    expect(texte.length).toBeLessThan(6_000)
  })
})

describe('bash de relance', () => {
  it('prend le bash du CLI Claude quand il est posé', () => {
    expect(
      resoudreBash({ CLAUDE_CODE_GIT_BASH_PATH: 'D:/git/bash.exe' }, 'win32', () => true)
    ).toBe('D:/git/bash.exe')
  })
  it('sous Windows, retombe sur Git Bash à son emplacement standard', () => {
    const vu = resoudreBash({ ProgramFiles: 'C:\\Program Files' }, 'win32', (c) =>
      c.includes('Program Files')
    )
    expect(vu).toMatch(/Git[\\/]bin[\\/]bash\.exe$/)
  })
  it('ailleurs, `bash` du PATH', () => {
    expect(resoudreBash({}, 'linux', () => false)).toBe('bash')
  })
  it('fusionne stderr dans stdout, sans réécrire la commande', () => {
    expect(argumentsBash('echo a | tail -1')).toEqual(['-c', '{\necho a | tail -1\n} 2>&1'])
  })
})

describe('relance réelle (bash + lancement survivable)', () => {
  let dossier = ''
  let pidRelais: number | undefined
  afterEach(async () => {
    // Le relais survivable écrit `.exit.json` PUIS se termine (~65 ms mesurés) : tant qu'il vit, il
    // tient le dossier (son cwd) et le nettoyage échoue en EPERM. On attend sa mort réelle.
    const vivant = (): boolean => {
      try {
        if (pidRelais) process.kill(pidRelais, 0)
        return Boolean(pidRelais)
      } catch {
        return false
      }
    }
    for (let i = 0; i < 100 && vivant(); i++) await new Promise((r) => setTimeout(r, 50))
    if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('exécute vraiment la commande et rend son code et sa sortie', async () => {
    const { spawnSurvivable } = await import('../runs/survivable-spawn')
    const { survivableExitCode } = await import('../runs/stdout-journal')
    const { readFileSync } = await import('node:fs')
    dossier = mkdtempSync(join(tmpdir(), 'relance-reelle-'))
    const envois: string[] = []
    const relanceur = creerRelanceurTachesDeFond({
      lancer: ({ commande, cwd, jeton }) => {
        const run = spawnSurvivable({
          bin: resoudreBash(),
          args: argumentsBash(commande),
          cwd,
          runId: jeton,
          journalRoot: join(dossier, 'journaux'),
          onJournalPrepared: () => {}
        })
        run.release()
        pidRelais = run.pid
        return { journalPath: run.journalPath!, pid: run.pid }
      },
      codeDeSortie: (j) => survivableExitCode(j),
      lireSortie: (j) => readFileSync(j, 'utf8'),
      arreter: () => {},
      conversationOccupee: () => false,
      envoyerTour: async (_c, prompt) => void envois.push(prompt),
      magasin: magasinLotsSurDisque(join(dossier, 'lots')),
      intervalleMs: 100,
      limiteMs: 60_000
    })
    await relanceur.relancer('conv-r', [
      { id: 'r1', commande: 'echo bonjour-relance; echo erreur >&2; exit 3', cwd: dossier }
    ])
    expect(envois).toHaveLength(1)
    expect(envois[0]).toContain('bonjour-relance')
    expect(envois[0]).toContain('erreur')
    expect(envois[0]).toContain('ÉCHEC — code de sortie 3')
  }, 60_000)

  /*
   * UNE COMMANDE MUETTE GARDE SON CODE. Mesure du 2026-10-09 : quand la commande n'ecrit RIEN (sortie
   * redirigee vers un fichier, `sleep`, `exit 4`), `spawnSurvivable` efface a la fermeture son journal
   * vide ET sa preuve `.exit.json` (`discardEmptyJournal`, runs/survivable-spawn.ts). Le relanceur ne
   * lisait le code QUE dans cette preuve : il attendait sa duree maximale (2 h) puis disait « duree
   * depassee » au lieu du vrai code.
   */
  it('le cablage reel rend le code d’une commande qui n’ecrit rien, sans attendre la duree maximale', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'relance-muette-'))
    const envois: string[] = []
    const relanceur = creerRelanceurSurDisque({
      dossier,
      conversationOccupee: () => false,
      envoyerTour: async (_c, prompt) => void envois.push(prompt)
    })
    const fini = relanceur.relancer('conv-m', [{ id: 'm1', commande: 'exit 4', cwd: dossier }])
    await Promise.race([fini, new Promise((resolve) => setTimeout(resolve, 20_000))])
    expect(envois).toHaveLength(1)
    expect(envois[0]).toContain('ÉCHEC — code de sortie 4')
  }, 60_000)

  /*
   * PID PEUT-ETRE REATTRIBUE : on ne tue que ce qu'on a lance. Apres un redemarrage (poste rebooté
   * pendant la commande), le lot sur disque porte le pid du relais d'une AUTRE session ; ce numero a pu
   * etre donne a n'importe quel processus. Le tuer au-dela de la duree maximale pouvait abattre un
   * programme de l'utilisateur. Ici, un processus inoffensif tient le role du « pid reattribue ».
   */
  it('au demarrage, un lot depasse ne tue JAMAIS un pid lance par une autre session — et le dit', async () => {
    const { spawn } = await import('node:child_process')
    dossier = mkdtempSync(join(tmpdir(), 'relance-pid-'))
    const temoin = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore'
    })
    const vivant = (): boolean => {
      try {
        process.kill(temoin.pid!, 0)
        return true
      } catch {
        return false
      }
    }
    try {
      magasinLotsSurDisque(join(dossier, 'lots')).ecrire('lot-ancien', [
        {
          lot: 'lot-ancien',
          conversationId: 'conv-p',
          id: 'p1',
          commande: 'npx vitest run',
          cwd: dossier,
          debut: Date.now() - 3 * 60 * 60 * 1000,
          journalPath: join(dossier, 'journaux', 'absent.stdout.jsonl'),
          pid: temoin.pid
        }
      ])
      const envois: string[] = []
      await creerRelanceurSurDisque({
        dossier,
        conversationOccupee: () => false,
        envoyerTour: async (_c, prompt) => void envois.push(prompt)
      }).reprendreAuDemarrage()
      expect(vivant()).toBe(true)
      expect(envois).toHaveLength(1)
      expect(envois[0]).toContain('NON arrêtée')
      expect(envois[0]).not.toContain('ARRÊTÉE —')
    } finally {
      temoin.kill()
    }
  }, 60_000)
})
