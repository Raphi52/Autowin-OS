import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { causesDesRunsTermines, runDuFichier } from './gc-causes-en-cours.mjs'

/*
 * Un poste jetable : `.autowin-data/autowin-os/` avec ses deux dossiers. Les noms reprennent ceux de
 * l'application : un fichier de cause se nomme `identifiantBureauCache(runId)`, soit `run-` suivi du
 * runId ; un run s'appelle `run-<hash>-<n>`. Donc le run `run-8a64d86cf869-1` a pour fichier
 * `run-run-8a64d86cf869-1.json`, et son état reprenable `run-state/run-8a64d86cf869-1.json`.
 */
const SCRIPT = fileURLToPath(new URL('./gc-causes-en-cours.mjs', import.meta.url))
const MAINTENANT = Date.parse('2026-11-10T08:00:00Z')
const JOUR_MS = 86_400_000
const RUN = 'run-8a64d86cf869-1'
const FICHIER_DE_RUN = `run-${RUN}.json`

let donnees

beforeEach(() => {
  donnees = mkdtempSync(join(tmpdir(), 'autowin-gc-causes-'))
})

afterEach(() => {
  rmSync(donnees, { recursive: true, force: true })
})

const appData = () => join(donnees, 'autowin-os')
const ctx = () => ({ donnees, maintenant: MAINTENANT })
const cheminsCandidats = () => causesDesRunsTermines(ctx()).candidats.map((c) => c.chemin)

/** Un fichier de cause posé, daté de `age` ms avant MAINTENANT. */
function causeDuRun(nom, age = 3 * JOUR_MS) {
  const dossier = join(appData(), 'cause-en-cours')
  mkdirSync(dossier, { recursive: true })
  const chemin = join(dossier, nom)
  writeFileSync(chemin, JSON.stringify({ 'src/x.ts': { editions: 3 } }), 'utf8')
  const date = (MAINTENANT - age) / 1000
  utimesSync(chemin, date, date)
  return chemin
}

/** L'état reprenable d'un run : présent tant que l'orchestrateur ne l'a pas réglé. */
function etatDuRun(runId) {
  const dossier = join(appData(), 'run-state')
  mkdirSync(dossier, { recursive: true })
  writeFileSync(join(dossier, `${runId}.json`), '{}', 'utf8')
}

describe('runDuFichier — le run d’un fichier de cause', () => {
  it('rend le runId quand le nom suit identifiantBureauCache : run- suivi du runId', () => {
    expect(runDuFichier(FICHIER_DE_RUN)).toBe(RUN)
  })

  it('rend null quand le nom ne suit pas ce motif', () => {
    expect(runDuFichier('autre.json')).toBeNull()
    expect(runDuFichier(`${FICHIER_DE_RUN}.tmp`)).toBeNull()
    expect(runDuFichier('run-.json')).toBeNull()
  })
})

describe('causesDesRunsTermines — ce qui part au ménage', () => {
  it('un run réglé (plus d’état reprenable) et calme depuis 3 jours : son fichier est candidat', () => {
    const chemin = causeDuRun(FICHIER_DE_RUN)
    expect(cheminsCandidats()).toEqual([chemin])
  })

  it('un run encore tenu par run-state garde son fichier, même ancien', () => {
    causeDuRun(FICHIER_DE_RUN)
    etatDuRun(RUN)
    expect(cheminsCandidats()).toEqual([])
    expect(causesDesRunsTermines(ctx()).gardes.encoreTenu).toBe(1)
  })

  it('un fichier modifié il y a moins de 24 h reste, même si son run est réglé', () => {
    causeDuRun(FICHIER_DE_RUN, 2 * 3_600_000)
    expect(cheminsCandidats()).toEqual([])
    expect(causesDesRunsTermines(ctx()).gardes.recent).toBe(1)
  })

  it('un nom qui n’est pas celui d’un run reste : rien ne prouve qu’il est mort', () => {
    causeDuRun('cause-sans-run.json')
    expect(cheminsCandidats()).toEqual([])
    expect(causesDesRunsTermines(ctx()).gardes.nomInconnu).toBe(1)
  })

  it('un dossier run-state illisible : aucun run n’est jugé réglé, et le bilan le dit', () => {
    causeDuRun(FICHIER_DE_RUN)
    // Un fichier à la place du dossier : sa lecture échoue, et rien ne prouve qu’un run est réglé.
    writeFileSync(join(appData(), 'run-state'), 'pas un dossier', 'utf8')
    const bilan = causesDesRunsTermines(ctx())
    expect(bilan.candidats).toEqual([])
    expect(bilan.sondeEnEchec).toBeDefined()
  })
})

describe('ligne de commande — lecture seule par défaut, déplacement sur --balayer', () => {
  const lancer = (...args) =>
    spawnSync(process.execPath, [SCRIPT, '--donnees', donnees, ...args], { encoding: 'utf8' })

  it('sans --balayer : le fichier reste à sa place', () => {
    const chemin = causeDuRun(FICHIER_DE_RUN)
    const sortie = lancer()
    expect(sortie.status).toBe(0)
    expect(JSON.parse(sortie.stdout).candidats).toHaveLength(1)
    expect(existsSync(chemin)).toBe(true)
  })

  it('--balayer : déplacé dans la corbeille datée avec sa ligne de MANIFEST, rien supprimé', () => {
    const chemin = causeDuRun(FICHIER_DE_RUN)
    const contenu = readFileSync(chemin, 'utf8')
    const sortie = lancer('--balayer')
    expect(sortie.status).toBe(0)
    expect(existsSync(chemin)).toBe(false)

    const corbeille = join(donnees, 'gc-corbeille')
    const restes = readdirSync(corbeille, { recursive: true }).map(String)
    const deplace = restes.find((n) => n.endsWith(FICHIER_DE_RUN))
    expect(deplace).toBeDefined()
    expect(readFileSync(join(corbeille, deplace), 'utf8')).toBe(contenu)

    const manifeste = restes.find((n) => n.endsWith('MANIFEST.txt'))
    expect(readFileSync(join(corbeille, manifeste), 'utf8')).toContain(FICHIER_DE_RUN)
  })

  it('un dossier de données introuvable : commande refusée, code 2', () => {
    const sortie = spawnSync(process.execPath, [SCRIPT, '--donnees', join(donnees, 'absent')], {
      encoding: 'utf8'
    })
    expect(sortie.status).toBe(2)
  })
})

describe('skills/gc/SKILL.md — le ménage quotidien appelle cette passe', () => {
  it('la procédure du /gc nomme la commande, sinon le ménage ne la lance jamais', () => {
    const skill = readFileSync(new URL('../skills/gc/SKILL.md', import.meta.url), 'utf8')
    expect(skill).toContain('node --no-warnings scripts/gc-causes-en-cours.mjs --balayer')
  })
})
