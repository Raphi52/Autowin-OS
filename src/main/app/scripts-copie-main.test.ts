import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  choisirPort,
  environnementDeScript,
  LancementsParDossier,
  lireScriptsCopie,
  preparerCopie,
  type EtatLancement
} from './scripts-copie-main'

let racine: string
let depot: string
let copie: string

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'autowin-scripts-'))
  depot = join(racine, 'depot')
  copie = join(racine, 'copie')
  mkdirSync(depot)
  mkdirSync(copie)
})
afterEach(() => {
  rmSync(racine, { recursive: true, force: true })
})

function declarer(dossier: string, config: unknown): void {
  mkdirSync(join(dossier, '.autowin'), { recursive: true })
  writeFileSync(join(dossier, '.autowin', 'scripts.json'), JSON.stringify(config))
}

/** Une commande `node -e` portable (cmd.exe comme sh) : le script ne contient aucun guillemet double. */
const node = (script: string, ...args: string[]): string =>
  `node -e "${script}"${args.length ? ' ' + args.join(' ') : ''}`

const vivant = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function attendre(condition: () => boolean, delaiMs = 8_000): Promise<void> {
  const fin = Date.now() + delaiMs
  while (!condition()) {
    if (Date.now() > fin) throw new Error('condition non atteinte à temps')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('lireScriptsCopie', () => {
  it('Autowin prime sur Conductor, Conductor sur package.json', async () => {
    writeFileSync(join(depot, 'package.json'), '{"scripts":{"dev":"vite"}}')
    expect((await lireScriptsCopie(depot)).scripts?.source).toBe('package.json')
    mkdirSync(join(depot, '.conductor'))
    writeFileSync(join(depot, '.conductor', 'settings.toml'), '[scripts]\nrun = "pnpm dev"')
    expect((await lireScriptsCopie(depot)).scripts).toMatchObject({
      source: 'conductor',
      lancement: 'pnpm dev'
    })
    declarer(depot, { lancement: 'npm run web' })
    expect((await lireScriptsCopie(depot)).scripts).toMatchObject({
      source: 'autowin',
      lancement: 'npm run web'
    })
  })

  it('une déclaration invalide est RENDUE comme erreur, sans repli silencieux', async () => {
    writeFileSync(join(depot, 'package.json'), '{"scripts":{"dev":"vite"}}')
    mkdirSync(join(depot, '.autowin'))
    writeFileSync(join(depot, '.autowin', 'scripts.json'), '{ oups')
    const lu = await lireScriptsCopie(depot)
    expect(lu.scripts).toBeUndefined()
    expect(lu.erreur).toContain('.autowin/scripts.json illisible')
  })

  it('rien de déclaré → rien', async () => {
    expect(await lireScriptsCopie(depot)).toEqual({})
  })
})

describe('environnementDeScript', () => {
  it('garde l’environnement de l’utilisateur, retire ELECTRON_* et AUTOWIN_* de l’app, pose les nôtres', () => {
    const env = environnementDeScript(
      { AUTOWIN_PORT: '20010' },
      {
        PATH: 'p',
        JAVA_HOME: 'j',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
        AUTOWIN_VERIFY_TIMEOUT_MS: '1',
        AUTOWIN_PORT: '1'
      }
    )
    expect(env).toEqual({ PATH: 'p', JAVA_HOME: 'j', AUTOWIN_PORT: '20010' })
  })
})

describe('choisirPort', () => {
  it('saute un bloc occupé', async () => {
    const vus: number[] = []
    const port = await choisirPort('run-x', async (p) => {
      vus.push(p)
      return vus.length > 1
    })
    expect(port).toBe(vus[1])
    expect(vus[1] - vus[0]).toBe(10)
  })
})

describe('preparerCopie', () => {
  const port = async (): Promise<number> => 23_450

  it('rien de déclaré (ou seulement un lancement détecté) → aucune ligne', async () => {
    expect(await preparerCopie({ depot, chemin: copie, nom: 'r1' })).toBeUndefined()
    writeFileSync(join(depot, 'package.json'), '{"scripts":{"dev":"vite"}}')
    expect(await preparerCopie({ depot, chemin: copie, nom: 'r1' })).toBeUndefined()
  })

  it('copie les fichiers locaux sans écraser, joue la préparation DANS la copie avec nos variables', async () => {
    writeFileSync(join(depot, '.env'), 'SECRET_DU_DEPOT=1')
    mkdirSync(join(depot, 'config'))
    writeFileSync(join(depot, 'config', 'local.json'), '{"a":1}')
    writeFileSync(join(copie, 'deja.txt'), 'version de la copie')
    writeFileSync(join(depot, 'deja.txt'), 'version du dépôt')
    declarer(depot, {
      preparation: node(
        "require('fs').writeFileSync('prepare.txt', process.argv[1] + '|' + process.env.CONDUCTOR_ROOT_PATH)",
        '$AUTOWIN_PORT'
      ),
      copier: ['.env', 'config/local.json', 'deja.txt']
    })
    const r = await preparerCopie({ depot, chemin: copie, nom: 'r1' }, { choisirPort: port })
    expect(r?.ok).toBe(true)
    expect(r?.code).toBe(0)
    expect(readFileSync(join(copie, '.env'), 'utf8')).toBe('SECRET_DU_DEPOT=1')
    expect(readFileSync(join(copie, 'config', 'local.json'), 'utf8')).toBe('{"a":1}')
    expect(readFileSync(join(copie, 'deja.txt'), 'utf8')).toBe('version de la copie')
    expect(readFileSync(join(copie, 'prepare.txt'), 'utf8')).toBe(`23450|${depot}`)
    expect(existsSync(join(depot, 'prepare.txt'))).toBe(false)
    expect(r?.resume).toMatch(
      /réussie en \d+ s, 2 fichier\(s\) copié\(s\) \(\.env, config\/local\.json\)/
    )
  })

  it('un fichier déclaré absent du dépôt est NOMMÉ et rend la préparation non verte', async () => {
    declarer(depot, { copier: ['.env.local'] })
    const r = await preparerCopie({ depot, chemin: copie, nom: 'r1' })
    expect(r).toMatchObject({ ok: false, absents: ['.env.local'] })
    expect(r?.resume).toContain('introuvable(s) dans le dépôt : .env.local')
  })

  it('un échec rend le code de sortie et la dernière ligne, sans jeter', async () => {
    declarer(depot, {
      preparation: node("console.error('module introuvable : left-pad'); process.exit(3)")
    })
    const r = await preparerCopie({ depot, chemin: copie, nom: 'r1' }, { choisirPort: port })
    expect(r).toMatchObject({ ok: false, code: 3, expire: false })
    expect(r?.resume).toContain('ÉCHOUÉE (code 3)')
    expect(r?.resume).toContain('dernière ligne : module introuvable : left-pad')
  })

  it('un délai dépassé ARRÊTE la préparation et le dit', async () => {
    declarer(depot, { preparation: node('setTimeout(function(){}, 60000)') })
    const r = await preparerCopie(
      { depot, chemin: copie, nom: 'r1' },
      { choisirPort: port, delaiMs: 600 }
    )
    expect(r).toMatchObject({ ok: false, expire: true })
    expect(r?.resume).toContain('ARRÊTÉE après')
  })

  it('une déclaration invalide est rapportée, rien n’est joué', async () => {
    declarer(depot, { copier: ['../hors-du-depot'] })
    const r = await preparerCopie({ depot, chemin: copie, nom: 'r1' })
    expect(r?.ok).toBe(false)
    expect(r?.resume).toContain('non jouée')
    expect(r?.resume).toContain('../hors-du-depot')
  })
})

describe('LancementsParDossier', () => {
  it('sans lancement déclaré : échec nommé, rien de lancé', async () => {
    const l = new LancementsParDossier()
    const etat = await l.demarrer('conv-1', depot)
    expect(etat.statut).toBe('echec')
    expect(etat.erreur).toContain('aucun lancement déclaré')
  })

  it('lance, repère l’adresse locale, puis ARRÊTE tout l’arbre (le petit-enfant compris)', async () => {
    declarer(depot, {
      lancement: node(
        "require('fs').writeFileSync('pid.txt', String(process.pid)); console.log('Local: http://localhost:' + process.env.AUTOWIN_PORT + '/'); setInterval(function(){}, 1000)"
      )
    })
    const vus: EtatLancement[] = []
    const l = new LancementsParDossier({
      notifier: (_c, e) => vus.push(e),
      choisirPort: async () => 23_460
    })
    const depart = await l.demarrer('conv-1', depot)
    expect(depart).toMatchObject({ statut: 'en-cours', port: 23_460, source: 'autowin' })
    // Un second clic pendant qu'il tourne ne lance rien de plus.
    expect((await l.demarrer('conv-1', depot)).depuis).toBe(depart.depuis)
    await attendre(() => vus.some((e) => e.adresse === 'http://localhost:23460/'))
    await attendre(() => existsSync(join(depot, 'pid.txt')))
    const pid = Number(readFileSync(join(depot, 'pid.txt'), 'utf8'))
    expect(vivant(pid)).toBe(true)
    const arrete = await l.arreter('conv-1')
    expect(arrete.statut).toBe('arrete')
    await attendre(() => !vivant(pid))
    // L'arrêt manuel n'est pas réécrit en échec par la fin du processus qui suit.
    await new Promise((r) => setTimeout(r, 200))
    expect((await l.etat('conv-1', depot)).statut).toBe('arrete')
  }, 20_000)

  it('une commande qui sort seule : terminé (0) ou échec avec son code', async () => {
    let dernier: EtatLancement | undefined
    const l = new LancementsParDossier({
      notifier: (_c, e) => {
        dernier = e
      },
      choisirPort: async () => 23_470
    })
    declarer(depot, { lancement: node("console.log('fini')") })
    await l.demarrer('a', depot)
    await attendre(() => dernier?.statut === 'termine')
    expect(dernier?.lignes).toContain('fini')
    declarer(depot, { lancement: node('process.exit(2)') })
    await l.demarrer('a', depot)
    await attendre(() => dernier?.statut === 'echec')
    expect(dernier?.code).toBe(2)
  }, 20_000)
})
