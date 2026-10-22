import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cheminMemoReconciliation, createConvRun, reconcileAbandonedConvRuns } from './conv-runs'
import { parseRun } from '../dashboards/runs'
import { isBlocked } from '../../shared/run-blocked'
import { contratDepuisRuns } from '../conversation-task-contract'

/**
 * UN RUN QUI MEURT EN COURS RESTE `open` POUR TOUJOURS.
 *
 * `closeConvRun` n'est appelé qu'à la fin d'une orchestration. Si l'app s'arrête avant — crash,
 * fermeture, coupure — le `RUN.md` garde `status: open` et rien ne l'en sort jamais.
 *
 * Mesuré le 2026-08-05 sur l'état réel (`%APPDATA%\autowin-os\runs`, 8888 workspaces) :
 * 151 runs `open`, dont **141 vieux de plus de 24 h** — donc abandonnés, pas en cours. Comme le taux
 * de réussite se lit dans ces fichiers, ces 141 le faussent silencieusement : ni clos ni ouverts
 * pour de bon. Depuis conv-1070 ils sont clos `interrupted` : arrêtés avec l'app, pas jugés.
 *
 * Même motif que l'incident auto-kaizen figé en `fix-running` : rien ne renonce jamais.
 */
describe('réconciliation des runs abandonnés', () => {
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) {
      rmSync(r, { recursive: true, force: true })
      rmSync(cheminMemoReconciliation(r), { force: true })
    }
  })

  const HEURE = 3_600_000

  function racine(): string {
    const r = mkdtempSync(join(tmpdir(), 'autowin-conv-runs-'))
    racines.push(r)
    return r
  }

  /** Vieillit le fichier : c'est le mtime qui distingue un abandon d'un run en vol. */
  function vieillirDe(path: string, heures: number): void {
    const quand = new Date(Date.now() - heures * HEURE)
    utimesSync(path, quand, quand)
  }

  function statutDe(path: string): string {
    return readFileSync(path, 'utf8').split(/\r?\n/)[0]
  }

  // FERMETURE DE L'APP = INTERRUPTION (piste 4, conv-1070). Un run que plus personne ne porte n'a
  // pas été jugé : il s'est arrêté avec l'app. Le clore `red` le rangeait parmi les échecs ET le
  // laissait « bloqué » pour toujours (`isBlocked`) — 482 RUN.md clos ainsi, comptés le 2026-10-22.
  // Entrée qui fait rougir ce test si la correction est fausse : ce run `open` vieux de 72 h, clos
  // encore `red`.
  // fix-ok: conv-1070 — mesuré : rouge avant la correction de `clorePourAbandon` (« expected
  // 'status: red' to be 'status: interrupted' »), vert après ; le test du contrat ci-dessous a rougi
  // sur le texte reformulé « Interrompu : », d'où le texte « Abandonné : » gardé.
  it('un run `open` plus vieux que le seuil est clos `interrupted`, avec sa raison au Journal, et ne bloque pas', async () => {
    const root = racine()
    const path = createConvRun('conv-7', 'une tache abandonnee', root)
    vieillirDe(path, 72)

    const bilan = await reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(1)
    expect(statutDe(path)).toBe('status: interrupted')
    // La raison doit être inscrite : l'utilisateur doit lire POURQUOI le run s'est arrêté.
    const md = readFileSync(path, 'utf8')
    expect(md).toMatch(/Abandonné : l'app s'est arrêtée avant la clôture/)
    // Ce que voit l'utilisateur : le rail le lit avec `parseRun` puis `isBlocked`.
    expect(isBlocked(parseRun(md))).toBe(false)
  })

  // Le texte du Journal est un CONTRAT : `runAbandonne` (conversation-task-contract.ts) le relit
  // pour sauter un run qui n'a rendu aucun verdict. Entrée qui fait rougir ce test : la mention
  // reformulée (« Interrompu : … ») — le besoin ancré de ce run redeviendrait un contrat ouvert.
  it('la clôture d’abandon reste reconnue comme abandon par le contrat de tâche', async () => {
    const root = racine()
    const path = createConvRun('conv-7c', 'repare src/main/a.ts:10', root)
    vieillirDe(path, 72)

    await reconcileAbandonedConvRuns({ root })

    expect(contratDepuisRuns([{ path, content: readFileSync(path, 'utf8') }])).toBeUndefined()
  })

  // Jumeau : un VRAI échec (refus du juge, déjà clos `red`) reste `red` et bloqué — la
  // réconciliation ne touche qu'aux runs `open`, elle ne blanchit pas les échecs.
  it('un run déjà clos `red` par un échec reste `red` et bloqué', async () => {
    const root = racine()
    const path = createConvRun('conv-7b', 'une tache refusee', root)
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^status: open/m, 'status: red'), 'utf8')
    vieillirDe(path, 72)

    const bilan = await reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(0)
    expect(statutDe(path)).toBe('status: red')
    expect(isBlocked(parseRun(readFileSync(path, 'utf8')))).toBe(true)
  })

  it('un run `open` RÉCENT est laissé intact — un run en vol ne doit pas être tué', async () => {
    const root = racine()
    const path = createConvRun('conv-8', 'une tache en cours', root)
    // Pas de vieillissement : le fichier vient d'être écrit.

    const bilan = await reconcileAbandonedConvRuns({ root })

    // Discriminant : si ce test casse, la réconciliation ferme des runs qui tournent encore.
    expect(bilan.closed).toBe(0)
    expect(statutDe(path)).toBe('status: open')
  })

  it('un run déjà clos n’est pas retouché', async () => {
    const root = racine()
    const path = createConvRun('conv-9', 'une tache finie', root)
    const avant = readFileSync(path, 'utf8').replace(/^status: open/m, 'status: green')
    writeFileSync(path, avant, 'utf8')
    vieillirDe(path, 72)

    const bilan = await reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(0)
    expect(statutDe(path)).toBe('status: green')
  })

  it('le plafond est respecté ET le reste est RAPPORTÉ — pas de troncature muette', async () => {
    const root = racine()
    for (let n = 0; n < 5; n++) {
      const path = createConvRun('conv-10', `tache ${n}`, root, () => Date.now() + n)
      vieillirDe(path, 72)
    }

    const bilan = await reconcileAbandonedConvRuns({ root, max: 2 })

    expect(bilan.closed).toBe(2)
    // Une borne silencieuse se lirait « tout est traité » alors qu'il en reste 3.
    expect(bilan.remaining).toBe(3)
  })

  it('une arborescence absente ou illisible ne fait pas échouer le démarrage', async () => {
    const bilan = await reconcileAbandonedConvRuns({
      root: join(tmpdir(), 'racine-qui-nexiste-pas-4242')
    })
    expect(bilan).toEqual({ closed: 0, remaining: 0, dejaVerifies: 0 })
  })

  it('ne lit pas les dossiers qui ne sont pas des workspaces', async () => {
    const root = racine()
    const path = createConvRun('conv-11', 'tache valide', root)
    vieillirDe(path, 72)
    // Un worktree d'agent, ou tout autre dossier, ne porte pas de RUN.md à clore.
    const intrus = join(root, 'conv-11', 'agent__run-abcdef-1')
    mkdirSync(intrus, { recursive: true })
    writeFileSync(join(intrus, 'RUN.md'), 'status: open\n', 'utf8')
    vieillirDe(join(intrus, 'RUN.md'), 72)

    const bilan = await reconcileAbandonedConvRuns({ root })

    expect(bilan.closed).toBe(1)
    expect(statutDe(join(intrus, 'RUN.md'))).toBe('status: open')
  })
})
