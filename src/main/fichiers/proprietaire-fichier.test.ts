import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendWorkspaceMutationTrace,
  captureMutationTraceBase
} from '../activity/trace-workspace-mutation'
import { configureAutowinAppDataBase } from '../app/app-data'
import { AppCommandBus } from '../commands/commands'
import { racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import { ConversationStore } from '../store/conversations'

/**
 * « À QUI EST CE FICHIER ? » — le réflexe 14 (ne pas écrire sur le travail d'un autre fil) en un
 * seul appel. Scout : 514 appels git à la main dans 143 journaux, et un vrai conflit
 * (`<<<<<<< HEAD … >>>>>>> 05a597f5 (conv-1074`). L'app SAVAIT quel fil avait touché quel fichier
 * (`conversation-file-trace-spool.ts`), mais seule l'interface le lisait, et seulement pour le fil
 * AFFICHÉ (`readCurrentConversationPathOwnership(conversationId)`).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : un fichier créé par conv-a,
 * demandé par conv-b. Une commande qui réutiliserait le filtre par conversation existant
 * (`readCurrentConversationPathOwnership('conv-b')`) ne trouverait RIEN et répondrait « libre » —
 * exactement l'écrasement que la commande doit empêcher.
 */
function depot(): string {
  const ws = mkdtempSync(join(tmpdir(), 'autowin-proprio-ws-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: ws })
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  mkdirSync(join(ws, 'src'))
  writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return ws
}

function bus(workspace: string): AppCommandBus {
  let horloge = 1000
  return new AppCommandBus(
    {
      conversations: new ConversationStore(() => horloge++),
      executionWorkspace: workspace,
      getWorktreeRuntimeStatus: () => ({ available: false, workspacePath: workspace }),
      getWorktreeConflictDiff: async () => ({ available: false, reason: 'not-conflict' })
    } as never,
    () => undefined
  )
}

interface FichierRendu {
  chemin: string
  refus?: string
  nonCommite?: boolean
  fils: {
    conversation: string
    tour?: string
    le: string
    toi: boolean
    diffInchange: boolean
    vuSeulement?: true
  }[]
  copiesDeRun: { run: string; etat: string }[]
  copiesDeFil: { conversation: string; etat: string; toi?: true }[]
  dossierPrincipal?: { nonCommite: boolean; fils: FichierRendu['fils'] }
  amont: { branche?: string; commits: string[] }
  resume: string
}

async function demander(
  b: AppCommandBus,
  chemins: unknown,
  conversationId: string
): Promise<FichierRendu[]> {
  const r = await b.exec('proprietaire_fichier', { chemins }, conversationId, undefined, 'tour-q')
  expect(r.error).toBeUndefined()
  expect(r.ok).toBe(true)
  return (r.data as { fichiers: FichierRendu[] }).fichiers
}

describe('proprietaire_fichier : à qui est ce fichier ?', () => {
  afterEach(() => configureAutowinAppDataBase(undefined))

  const donnees = (): void => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-proprio-data-')))
  }

  it('signale à conv-b le fichier modifié et non commité par conv-a, avec son tour', async () => {
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )

    const [fichier] = await demander(b, ['src/partage.ts'], 'conv-b')

    expect(fichier.nonCommite).toBe(true)
    expect(fichier.fils).toEqual([
      expect.objectContaining({
        conversation: 'conv-a',
        tour: 'tour-a',
        toi: false,
        diffInchange: true
      })
    ])
    expect(fichier.fils[0]?.le).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(fichier.resume).toContain('conv-a')
    expect(fichier.resume).toContain('tour-a')
  })

  it('lit une liste de chemins envoyée en TEXTE JSON par l’outil direct, sans rendre « libre » à tort', async () => {
    // L'outil direct ne transmet que des chaînes (`schemaEntree`, skill-node-mcp.ts) : la liste
    // arrive donc en texte. Lue comme UN chemin, elle rendait un seul fichier « libre », alors que
    // conv-a tient src/partage.ts (23/10/2026).
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )

    const fichiers = await demander(b, '["src/partage.ts", "src/propre.ts"]', 'conv-b')

    expect(fichiers.map((f) => f.chemin)).toEqual(['src/partage.ts', 'src/propre.ts'])
    expect(fichiers[0]?.fils).toEqual([expect.objectContaining({ conversation: 'conv-a' })])
    expect(fichiers[1]?.resume).toMatch(/libre/)
  })

  it('refuse en le disant une liste en texte mal formée, au lieu de la lire comme un chemin', async () => {
    donnees()
    const ws = depot()

    const r = await bus(ws).exec(
      'proprietaire_fichier',
      { chemins: '["src/propre.ts", src/autre.ts]' },
      'conv-b',
      undefined,
      'tour-q'
    )

    expect(r.ok).toBe(false)
    expect(String(r.error)).toMatch(/liste/)
  })

  it('jumeau : le même fichier demandé par conv-a est le SIEN, pas celui d’un autre fil', async () => {
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )

    const [fichier] = await demander(b, 'src/partage.ts', 'conv-a')

    expect(fichier.fils).toEqual([expect.objectContaining({ conversation: 'conv-a', toi: true })])
    expect(fichier.resume).toMatch(/ce fil/)
    expect(fichier.resume).not.toMatch(/autre fil/)
  })

  it('dit qu’un fichier retouché depuis hors de tout fil tracé n’est plus le diff de conv-a', async () => {
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )
    writeFileSync(join(ws, 'src/partage.ts'), 'export const a = 2 // à la main\n')

    const [fichier] = await demander(b, ['src/partage.ts'], 'conv-b')

    expect(fichier.fils).toEqual([
      expect.objectContaining({ conversation: 'conv-a', diffInchange: false })
    ])
    expect(fichier.resume).toMatch(/retouché/)
  })

  it('rend « libre » un fichier commité que personne ne tient', async () => {
    donnees()
    const ws = depot()

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.nonCommite).toBe(false)
    expect(fichier.fils).toEqual([])
    expect(fichier.copiesDeRun).toEqual([])
    expect(fichier.resume).toMatch(/libre/)
  })

  it('refuse un chemin hors du dossier de travail sans priver les autres de réponse', async () => {
    donnees()
    const ws = depot()

    const fichiers = await demander(bus(ws), ['../evasion.ts', 'src/propre.ts'], 'conv-b')

    expect(fichiers[0]).toMatchObject({ chemin: '../evasion.ts', refus: expect.any(String) })
    expect(fichiers[1]).toMatchObject({ chemin: 'src/propre.ts' })
    expect(fichiers[1]?.refus).toBeUndefined()
  })

  it('signale le fichier en cours dans la copie d’un run, pas dans une copie de vérification', async () => {
    donnees()
    const ws = depot()
    const copies = mkdtempSync(join(tmpdir(), 'autowin-proprio-copies-'))
    const copieRun = join(copies, 'agent__run-abc123-1')
    const copieVerif = join(copies, 'agent__command-verify-conv-9')
    execFileSync('git', ['worktree', 'add', '-q', '--detach', copieRun], { cwd: ws })
    execFileSync('git', ['worktree', 'add', '-q', '--detach', copieVerif], { cwd: ws })
    writeFileSync(join(copieRun, 'src/propre.ts'), 'export const propre = 2 // run\n')
    // Une copie de vérification est un INSTANTANÉ du dossier de l'utilisateur : la signaler
    // reviendrait à dénoncer chaque fichier en cours deux fois.
    writeFileSync(join(copieVerif, 'src/propre.ts'), 'export const propre = 3 // verif\n')

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeRun).toEqual([{ run: 'run-abc123-1', etat: 'non commité' }])
    expect(fichier.resume).toContain('run-abc123-1')
  })

  it('signale le fichier en cours dans la copie d’un run rangée sous la racine unique', async () => {
    donnees()
    const ws = depot()
    const copies = mkdtempSync(join(tmpdir(), 'autowin-proprio-copies-'))
    const copieRun = join(racineDesCopiesDeTaches(copies), 'run-def456-1')
    execFileSync('git', ['worktree', 'add', '-q', '--detach', copieRun], { cwd: ws })
    writeFileSync(join(copieRun, 'src/propre.ts'), 'export const propre = 2 // run\n')

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeRun).toEqual([{ run: 'run-def456-1', etat: 'non commité' }])
  })

  /*
   * Chaque fil travaille dans sa copie, et toutes reviennent dans le même main : deux fils qui changent
   * le même fichier ne s'écrasent plus, ils se heurtent à la fusion. L'outil ne lisait que les copies de
   * run : les 8 copies de fil vivantes du 09/11/2026 lui étaient invisibles. Trois emplacements existent :
   * la racine unique, `copies-de-fil/<fil>` et l'ancien `retours-de-tour/essai__<fil>-<instant>-<rang>`.
   */
  const copieDeFil = (ws: string, ...segments: string[]): string => {
    const dossier = join(mkdtempSync(join(tmpdir(), 'autowin-proprio-fils-')), ...segments)
    execFileSync('git', ['worktree', 'add', '-q', '--detach', dossier], { cwd: ws })
    return dossier
  }

  it('signale le fichier en cours dans la copie d’un autre fil, sous ses trois emplacements', async () => {
    donnees()
    const ws = depot()
    const neuve = copieDeFil(ws, 'copies-de-taches', 'conv-neuf')
    const avant = copieDeFil(ws, 'copies-de-fil', 'conv-avant')
    const ancienne = copieDeFil(ws, 'retours-de-tour', 'essai__conv-vieux-1794057684868-1')
    for (const copie of [neuve, avant, ancienne]) {
      writeFileSync(join(copie, 'src/propre.ts'), 'export const propre = 5 // fil\n')
    }

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeFil.map((c) => [c.conversation, c.etat, c.toi ?? false]).sort()).toEqual(
      [
        ['conv-avant', 'non commité', false],
        ['conv-neuf', 'non commité', false],
        ['conv-vieux', 'non commité', false]
      ]
    )
    expect(fichier.copiesDeRun).toEqual([])
    expect(fichier.resume).toContain('copie du fil conv-neuf')
    expect(fichier.resume).not.toMatch(/^libre/)
  })

  it('dit au fil que la copie qui tient le fichier est la SIENNE', async () => {
    donnees()
    const ws = depot()
    const sienne = copieDeFil(ws, 'copies-de-fil', 'conv-b')
    writeFileSync(join(sienne, 'src/propre.ts'), 'export const propre = 6 // ce fil\n')

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeFil).toEqual([
      { conversation: 'conv-b', etat: 'non commité', toi: true }
    ])
    expect(fichier.resume).toContain('copie de ce fil')
  })

  it('depuis une copie de fil en retard sur main, ne prend pas main pour le travail des autres copies', async () => {
    // Une copie de fil est remise à jour avec main à chaque tour : une copie mise à jour APRÈS celle qui
    // pose la question porte des commits de main que la sienne n'a pas encore. Comptés comme « commité
    // dans la copie, pas encore intégré », ils dénonçaient chaque fichier changé dans main entre-temps.
    donnees()
    const ws = depot()
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', args, { cwd })
    }
    const demandeur = copieDeFil(ws, 'copies-de-fil', 'conv-b')
    writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 7 // main avance\n')
    git(ws, 'commit', '-q', '-am', 'main avance')
    copieDeFil(ws, 'copies-de-fil', 'conv-a-jour')
    copieDeFil(ws, 'agent__run-a-jour-1')
    const avecTravail = copieDeFil(ws, 'copies-de-fil', 'conv-travail')
    writeFileSync(join(avecTravail, 'src/propre.ts'), 'export const propre = 8 // travail\n')
    git(avecTravail, 'commit', '-q', '-am', 'travail du fil')

    const [fichier] = await demander(bus(demandeur), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeRun).toEqual([])
    expect(fichier.copiesDeFil).toEqual([
      { conversation: 'conv-travail', etat: 'commité dans la copie, pas encore intégré' }
    ])
  })

  it('depuis la copie d’un run, son travail non commité est le sien, pas « l’utilisateur à la main »', async () => {
    // Une étape de lot pose la question depuis la copie de son run. Ses propres écritures n'ont pas
    // encore de trace (posée en fin d'appel) : sans cette règle, chaque fichier qu'elle venait de
    // modifier lui était rendu comme retouché par l'utilisateur.
    donnees()
    const ws = depot()
    const copies = mkdtempSync(join(tmpdir(), 'autowin-proprio-copies-'))
    const sienne = join(copies, 'agent__run-moi-1')
    const autre = join(copies, 'agent__run-autre-1')
    execFileSync('git', ['worktree', 'add', '-q', '--detach', sienne], { cwd: ws })
    execFileSync('git', ['worktree', 'add', '-q', '--detach', autre], { cwd: ws })
    writeFileSync(join(sienne, 'src/propre.ts'), 'export const propre = 2 // ce run\n')
    writeFileSync(join(autre, 'src/propre.ts'), 'export const propre = 3 // autre run\n')

    const [fichier] = await demander(bus(sienne), ['src/propre.ts'], 'conv-lot')

    expect(fichier.nonCommite).toBe(true)
    expect(fichier.copiesDeRun).toEqual([{ run: 'run-autre-1', etat: 'non commité' }])
    expect(fichier.resume).toContain('le travail en cours de cette copie (run-moi-1)')
    expect(fichier.resume).not.toMatch(/utilisateur à la main/)
  })

  /*
   * Posée depuis une copie, la question ne lisait le non commité QUE de cette copie. Le dossier
   * principal, où toutes les copies reviennent, restait invisible : un fil qui y travaille encore
   * sans copie, ou une retouche à la main, ne se voyait qu'au moment où la copie n'arrivait pas à y
   * entrer.
   */
  it('depuis une copie, signale le fichier modifié et non commité par un autre fil dans le dossier principal', async () => {
    donnees()
    // Sous son vrai nom, comme D:\AutoWinOS : `git worktree list` rend les noms longs, et le journal
    // des fichiers range une trace sous le nom exact qu'avait le dossier (le dossier temporaire de
    // Windows peut arriver en nom court, avec un `~1`, et ne s'y retrouverait pas).
    const ws = realpathSync.native(depot())
    await bus(ws).exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )
    const copie = copieDeFil(ws, 'copies-de-fil', 'conv-b')

    const [fichier] = await demander(bus(copie), ['src/partage.ts'], 'conv-b')

    expect(fichier.nonCommite).toBe(false)
    expect(fichier.dossierPrincipal).toEqual({
      nonCommite: true,
      fils: [
        expect.objectContaining({
          conversation: 'conv-a',
          tour: 'tour-a',
          toi: false,
          diffInchange: true
        })
      ]
    })
    expect(fichier.resume).toContain('dossier principal')
    expect(fichier.resume).toContain('conv-a')
    expect(fichier.resume).not.toMatch(/^libre/)
  })

  it('depuis une copie, dit qu’un changement du dossier principal sans fil tracé est une retouche à la main', async () => {
    donnees()
    const ws = depot()
    const copie = copieDeFil(ws, 'copies-de-fil', 'conv-b')
    writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 2 // à la main\n')

    const [fichier] = await demander(bus(copie), ['src/propre.ts'], 'conv-b')

    expect(fichier.dossierPrincipal).toEqual({ nonCommite: true, fils: [] })
    expect(fichier.resume).toMatch(/dossier principal.*utilisateur à la main/)
    // La règle « le non commité d'une copie est son travail » ne vaut pas pour le dossier principal.
    expect(fichier.resume).not.toContain('le travail en cours de cette copie')
  })

  it('jumeau : depuis une copie, un dossier principal propre laisse le fichier libre ; depuis le principal, rien de neuf', async () => {
    donnees()
    const ws = depot()
    const copie = copieDeFil(ws, 'copies-de-fil', 'conv-b')

    const [depuisLaCopie] = await demander(bus(copie), ['src/propre.ts'], 'conv-b')
    const [depuisLePrincipal] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(depuisLaCopie.dossierPrincipal).toEqual({ nonCommite: false, fils: [] })
    expect(depuisLaCopie.resume).toMatch(/^libre/)
    // Interrogé lui-même, le dossier principal est déjà lu par `nonCommite` : pas de second relevé.
    expect(depuisLePrincipal.dossierPrincipal).toBeUndefined()
  })

  it('depuis une copie, un fichier déjà tracé par ce fil puis encore modifié reste le travail de la copie', async () => {
    // Vu sur le vrai dépôt le 09/11/2026 : la copie de ce fil gardait la trace d'un tour précédent, et
    // l'écriture du tour en cours n'avait pas encore la sienne (posée en fin d'appel). L'outil disait
    // « retouché depuis hors de tout fil tracé (l'utilisateur à la main) » sur le propre travail du fil.
    donnees()
    const ws = depot()
    const copie = copieDeFil(ws, 'copies-de-fil', 'conv-b')
    const b = bus(copie)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-b',
      undefined,
      'tour-1'
    )
    writeFileSync(join(copie, 'src/partage.ts'), 'export const a = 2 // tour en cours\n')

    const [fichier] = await demander(b, ['src/partage.ts'], 'conv-b')

    expect(fichier.fils).toEqual([
      expect.objectContaining({ conversation: 'conv-b', toi: true, diffInchange: false })
    ])
    expect(fichier.resume).toContain('le travail en cours de cette copie (conv-b)')
    expect(fichier.resume).not.toMatch(/utilisateur à la main|retouché/)
  })

  it('compte le commit PROPRE d’une copie de run, jamais l’amont qu’elle a reçu à sa création', async () => {
    donnees()
    const ws = depot()
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', args, { cwd })
    }
    // Mesuré le 2026-10-22 sur le vrai dépôt : la copie de ce run part d'origin/main, en avance de
    // trois commits sur le main local. Ces trois commits ne sont pas le travail du run.
    git(ws, 'branch', 'amont')
    git(ws, 'checkout', '-q', 'amont')
    writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 9 // amont\n')
    git(ws, 'commit', '-q', '-am', 'change en amont')
    git(ws, 'checkout', '-q', 'main')
    git(ws, 'branch', '--set-upstream-to=amont')
    const copies = mkdtempSync(join(tmpdir(), 'autowin-proprio-copies-'))
    const surAmont = join(copies, 'agent__run-surAmont-1')
    const avecCommit = join(copies, 'agent__run-avecCommit-1')
    git(ws, 'worktree', 'add', '-q', '--detach', surAmont, 'amont')
    git(ws, 'worktree', 'add', '-q', '--detach', avecCommit, 'main')
    writeFileSync(join(avecCommit, 'src/propre.ts'), 'export const propre = 4 // run\n')
    git(avecCommit, 'commit', '-q', '-am', 'travail du run')

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeRun).toEqual([
      { run: 'run-avecCommit-1', etat: 'commité dans la copie, pas encore intégré' }
    ])
  })

  it('signale un fichier changé en amont, et seulement celui-là', async () => {
    donnees()
    const ws = depot()
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: ws })
    }
    writeFileSync(join(ws, 'src/autre.ts'), 'export const autre = 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'autre')
    git('branch', 'amont')
    git('checkout', '-q', 'amont')
    writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 9 // amont\n')
    git('commit', '-q', '-am', 'change en amont')
    git('checkout', '-q', 'main')
    git('branch', '--set-upstream-to=amont')

    const [change, intact] = await demander(bus(ws), ['src/propre.ts', 'src/autre.ts'], 'conv-b')

    expect(change.amont.branche).toBe('amont')
    expect(change.amont.commits).toEqual([expect.stringContaining('change en amont')])
    expect(change.resume).toMatch(/amont/)
    expect(intact.amont.commits).toEqual([])
  })

  /*
   * ÉCRITURE D'UN FIL, COMPARAISON DE FIN DE TOUR D'UN AUTRE (25/10/2026). En fin de
   * tour, l'app compare tout le dossier avant/après le tour (`agent-pilot.ts`, `etatAvantEnvoi`) et
   * range au nom du fil tout ce qui a changé — y compris ce qu'un AUTRE fil a écrit pendant ce
   * temps. Vrai cas : `src/main/app/reprise-apres-arret.ts`, créé (trace de son Write à
   * 13:36:07 UTC), puis compté par les comparaisons (13:36:13) et
   * (13:40:57) avec EXACTEMENT le même contenu et le même marqueur physique. La dernière trace
   * l'emportait : l'outil répondait « conv-1143 » sur son propre fichier.
   */
  const ecritAvecUnOutil = async (ws: string, fil: string, contenu: string): Promise<void> => {
    writeFileSync(join(ws, 'src/partage.ts'), contenu)
    await appendWorkspaceMutationTrace({
      conversationId: fil,
      turnId: `tour-${fil}`,
      workspaceRoot: ws,
      source: 'chat_tool',
      paths: ['src/partage.ts'],
      // Comme un Write natif du chat : il revendique ses lignes (`writtenLineFingerprints`).
      pathLineFingerprints: { 'src/partage.ts': ['ligne-1'] }
    })
  }
  const comparaisonDeFinDeTour = async (
    ws: string,
    fil: string,
    avant: Awaited<ReturnType<typeof captureMutationTraceBase>>
  ): Promise<void> => {
    await appendWorkspaceMutationTrace({
      conversationId: fil,
      turnId: `tour-${fil}`,
      workspaceRoot: ws,
      source: 'chat_tool',
      paths: ['src/partage.ts'],
      before: avant
    })
  }

  it('garde à son auteur un fichier qu’un autre fil a seulement VU apparaître pendant son tour', async () => {
    donnees()
    const ws = depot()
    const avantLeTourDeB = await captureMutationTraceBase(ws, [])
    await ecritAvecUnOutil(ws, 'conv-a', 'export const a = 1\n')
    await comparaisonDeFinDeTour(ws, 'conv-b', avantLeTourDeB)

    const [fichier] = await demander(bus(ws), ['src/partage.ts'], 'conv-a')

    expect(fichier.fils).toEqual([
      expect.objectContaining({
        conversation: 'conv-a',
        tour: 'tour-conv-a',
        toi: true,
        diffInchange: true
      })
    ])
    expect(fichier.resume).not.toContain('conv-b')
  })

  it('rend le fichier à son auteur même quand la comparaison de l’autre fil est écrite AVANT', async () => {
    // Les traces d'un tour ne s'écrivent qu'à SA fin : un tour qui finit plus tôt écrit sa
    // comparaison avant l'écriture du vrai auteur (29:04, 36:07).
    donnees()
    const ws = depot()
    const avantLeTourDeB = await captureMutationTraceBase(ws, [])
    writeFileSync(join(ws, 'src/partage.ts'), 'export const a = 1\n')
    await comparaisonDeFinDeTour(ws, 'conv-b', avantLeTourDeB)
    await appendWorkspaceMutationTrace({
      conversationId: 'conv-a',
      turnId: 'tour-conv-a',
      workspaceRoot: ws,
      source: 'chat_tool',
      paths: ['src/partage.ts'],
      pathLineFingerprints: { 'src/partage.ts': ['ligne-1'] }
    })

    const [fichier] = await demander(bus(ws), ['src/partage.ts'], 'conv-a')

    expect(fichier.fils.map((f) => f.conversation)).toEqual(['conv-a'])
  })

  it('compte le fil qui a VRAIMENT réécrit un fichier pendant son tour', async () => {
    // Garde-fou contre l'excès inverse : un contenu NOUVEAU vu par la comparaison (une commande
    // qui écrit sans nommer le fichier) reste le travail de ce fil. Il part du contenu de conv-a :
    // la chaîne avant→après garde les DEUX contributeurs (`readCurrentPathGenerations`).
    donnees()
    const ws = depot()
    await ecritAvecUnOutil(ws, 'conv-a', 'export const a = 1\n')
    const avantLeTourDeB = await captureMutationTraceBase(ws, [])
    writeFileSync(join(ws, 'src/partage.ts'), 'export const a = 2 // réécrit par conv-b\n')
    await comparaisonDeFinDeTour(ws, 'conv-b', avantLeTourDeB)

    const [fichier] = await demander(bus(ws), ['src/partage.ts'], 'conv-a')

    expect(fichier.fils.map((f) => f.conversation).sort()).toEqual(['conv-a', 'conv-b'])
    expect(fichier.resume).toContain('conv-b')
    // conv-a l'a écrit avec un outil, conv-b seulement vu changer : la publication auto le distingue.
    expect(fichier.fils.find((f) => f.conversation === 'conv-a')?.vuSeulement).toBeUndefined()
    expect(fichier.fils.find((f) => f.conversation === 'conv-b')?.vuSeulement).toBe(true)
  })

  it('marque « vu seulement » chaque fil qui n’a fait que voir un script écrire (conv-1587)', async () => {
    // Vrai cas du 05/11/2026 : 18 fichiers écrits par un script à 08:13:00, sans outil d'écriture,
    // vus par les comparaisons de fin de tour.
    donnees()
    const ws = depot()
    const avantLeTourDe1575 = await captureMutationTraceBase(ws, [])
    const avantLeTourDe1587 = await captureMutationTraceBase(ws, [])
    writeFileSync(join(ws, 'src/partage.ts'), 'export const decoupe = 1 // écrit par un script\n')
    await comparaisonDeFinDeTour(ws, 'conv-1575', avantLeTourDe1575)
    await comparaisonDeFinDeTour(ws, 'conv-1587', avantLeTourDe1587)

    const [fichier] = await demander(bus(ws), ['src/partage.ts'], 'conv-1587')

    expect(fichier.fils.map((f) => [f.conversation, f.vuSeulement]).sort()).toEqual([
      ['conv-1575', true],
      ['conv-1587', true]
    ])
  })

  it('un fil qui a écrit avec un outil n’est jamais « vu seulement », même revu à sa fin de tour', async () => {
    donnees()
    const ws = depot()
    const avantLeTourDeA = await captureMutationTraceBase(ws, [])
    await ecritAvecUnOutil(ws, 'conv-a', 'export const a = 1\n')
    await comparaisonDeFinDeTour(ws, 'conv-a', avantLeTourDeA)

    const [fichier] = await demander(bus(ws), ['src/partage.ts'], 'conv-a')

    expect(fichier.fils).toEqual([expect.objectContaining({ conversation: 'conv-a' })])
    expect(fichier.fils[0]!.vuSeulement).toBeUndefined()
  })

  it('se déclare en lecture seule, servie au chat comme outil direct', () => {
    const spec = bus(depot())
      .catalog()
      .find((c) => c.name === 'proprietaire_fichier')
    expect(spec?.annotations?.readOnlyHint).toBe(true)
    expect(spec?.horsCanalNatif).toBeUndefined()
  })
})
