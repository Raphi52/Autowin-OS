/**
 * Moteur de la question à côté (conv-1362, lot 1/3) : un faux CLI et un faux serveur d'outils.
 *
 * Ce qui est prouvé : la session est reprise dans le dossier et le compte du FIL (pas ceux de l'app),
 * sans rien écrire ; le CLI reçoit les mêmes outils que le tour mais un refus total ; un fil sans
 * session, sur un autre modèle ou au compte retiré le dit sans lancer le CLI ; aucune ligne `AUTOWIN_*`
 * ne passe ; annuler n'arrête que le processus de CETTE question ; le serveur et sa config sont retirés
 * dans tous les cas.
 *
 * Ce qui ne peut PAS se prouver ici : qu'un outil soit réellement refusé et que le cache soit relu. Ces
 * deux faits sont mesurés sur le vrai CLI (en-tête de `question-a-cote.ts`).
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUTILS_TOUR_DE_CHAT } from './providers/claude'
import {
  argumentsQuestion,
  CONSIGNE_QUESTION,
  lireCleDeSession,
  lireSortie,
  messageDeQuestion,
  nettoyerReponse,
  QuestionsACote,
  reglagesDeQuestion,
  sessionDuTourEnCours,
  type DependancesQuestionACote
} from './question-a-cote'

const CLE = 'claude:claude-opus-5-5:compte-3:D:\\AutoWinOS:c0:w2'

interface FauxEnfant {
  processus: ChildProcess
  recu: () => string
  fermer: (code: number, sortie?: string) => void
  kill: ReturnType<typeof vi.fn>
}

function fauxEnfant(): FauxEnfant {
  const e = new EventEmitter() as unknown as ChildProcess & EventEmitter
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let recu = ''
  stdin.on('data', (m: Buffer) => (recu += m.toString('utf8')))
  Object.assign(e, { stdin, stdout, stderr })
  const kill = vi.fn(() => {
    setImmediate(() => e.emit('close', null))
    return true
  })
  Object.assign(e, { kill })
  return {
    processus: e,
    recu: () => recu,
    kill,
    fermer: (code, sortie = '') => {
      stdout.write(sortie)
      setImmediate(() => e.emit('close', code))
    }
  }
}

const JSON_OK = (reponse: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: reponse, ...extra })

function monter(
  extra: Partial<DependancesQuestionACote> = {},
  sessions: Record<string, { key: string; sessionId: string }> = {
    'conv-1': { key: CLE, sessionId: 'sess-1' }
  }
): {
  service: QuestionsACote
  enfants: FauxEnfant[]
  appels: Array<{ bin: string; args: string[]; options: SpawnOptions }>
  arreter: ReturnType<typeof vi.fn>
  ouvrirOutils: ReturnType<typeof vi.fn>
} {
  const enfants: FauxEnfant[] = []
  const appels: Array<{ bin: string; args: string[]; options: SpawnOptions }> = []
  const arreter = vi.fn(async () => undefined)
  const ouvrirOutils = vi.fn(async () => ({
    servis: {
      options: { mcpConfig: '{"mcpServers":{}}', allowedTools: ['mcp__autowin__get_state'] },
      noms: ['get_state'],
      arreter
    }
  }))
  const service = new QuestionsACote({
    catalogue: () => [],
    comptes: () => [
      { id: 'default', addedAt: '' },
      { id: 'compte-3', dir: 'D:/comptes/compte-3', addedAt: '' }
    ],
    sessions: () => sessions,
    tourEnCours: () => undefined,
    binaire: async () => 'claude.exe',
    lancer: (bin, args, options) => {
      appels.push({ bin, args, options })
      const enfant = fauxEnfant()
      enfants.push(enfant)
      return enfant.processus
    },
    ouvrirOutils: ouvrirOutils as unknown as DependancesQuestionACote['ouvrirOutils'],
    ...extra
  })
  return { service, enfants, appels, arreter, ouvrirOutils }
}

/** Laisse l'ouverture asynchrone arriver jusqu'au lancement du CLI. */
async function jusquAuLancement(enfants: FauxEnfant[], rang = 0): Promise<FauxEnfant> {
  await vi.waitFor(() => expect(enfants.length).toBeGreaterThan(rang))
  return enfants[rang]!
}

const valeurDe = (args: readonly string[], drapeau: string): string | undefined =>
  args[args.indexOf(drapeau) + 1]

describe('la clé de session du fil', () => {
  it('rend le fournisseur, le modèle, le compte et le dossier, deux-points du lecteur compris', () => {
    expect(lireCleDeSession(CLE)).toEqual({
      fournisseur: 'claude',
      modele: 'claude-opus-5-5',
      compte: 'compte-3',
      dossier: 'D:\\AutoWinOS'
    })
  })

  it('lit une clé sans compte ni dossier, et une clé d’avant les compteurs', () => {
    expect(lireCleDeSession('claude:opus:::c0:w0')).toMatchObject({ modele: 'opus', compte: '' })
    expect(lireCleDeSession('claude:opus:::c1')).toMatchObject({ modele: 'opus', dossier: '' })
    expect(lireCleDeSession('codex:gpt')).toMatchObject({ fournisseur: 'codex', dossier: '' })
  })
})

describe('la réponse', () => {
  it('retire toute ligne AUTOWIN_* et garde le reste mot pour mot', () => {
    const brut =
      'Le fichier est `x.css`.\n\nAUTOWIN_BESOIN_V1: aucun\nAUTOWIN_FIN_V1\n  AUTOWIN_PROMPT_V1: [80] Fais ça'
    expect(nettoyerReponse(brut)).toBe('Le fichier est `x.css`.')
  })

  it('ne retire pas une phrase qui parle de ces lignes', () => {
    expect(nettoyerReponse('La ligne AUTOWIN_FIN_V1 éteint le mode auto.')).toBe(
      'La ligne AUTOWIN_FIN_V1 éteint le mode auto.'
    )
  })

  it('signale un outil refusé', () => {
    const issue = lireSortie(JSON_OK('Je n’ai pas pu.', { permission_denials: [{}] }), '', 0)
    expect(issue).toEqual({ ok: true, reponse: 'Je n’ai pas pu.', outilRefuse: true })
  })

  it('nomme une session inconnue, quelle que soit la sortie où le CLI l’écrit', () => {
    expect(lireSortie('', 'No conversation found with session ID: x', 1)).toEqual({
      ok: false,
      motif: 'session-introuvable'
    })
    expect(
      lireSortie(
        JSON.stringify({ is_error: true, result: 'No conversation found with session ID: x' }),
        '',
        1
      )
    ).toEqual({ ok: false, motif: 'session-introuvable' })
  })

  it('tient pour « outil requis » un modèle qui insiste jusqu’à la borne d’appels', () => {
    const sortie = JSON.stringify({ subtype: 'error_max_turns', is_error: true })
    expect(lireSortie(sortie, '', 1)).toEqual({ ok: false, motif: 'outil-requis' })
  })

  it('n’invente pas une réponse : vide ou code non nul rend un échec nommé', () => {
    expect(lireSortie(JSON_OK('AUTOWIN_FIN_V1'), '', 0)).toMatchObject({
      ok: false,
      motif: 'echec'
    })
    expect(lireSortie('pas du JSON', 'boum', 2)).toEqual({
      ok: false,
      motif: 'echec',
      detail: 'boum'
    })
  })
})

describe('les arguments du CLI', () => {
  const appel = {
    sessionId: 'sess-1',
    modele: 'claude-opus-5-5',
    dossier: 'D:\\AutoWinOS',
    configMcp: 'C:/tmp/mcp.json',
    modAutowin: 'D:/AutoWinOS/mods/autowin'
  }

  it('reprend le fil dans une copie jetable', () => {
    const args = argumentsQuestion(appel)
    expect(valeurDe(args, '--resume')).toBe('sess-1')
    expect(args).toContain('--fork-session')
    expect(args).toContain('--no-session-persistence')
    expect(valeurDe(args, '--model')).toBe('claude-opus-5-5')
  })

  it('déclare exactement les outils du tour de chat, et n’en autorise aucun', () => {
    const args = argumentsQuestion(appel)
    expect(valeurDe(args, '--tools')).toBe(OUTILS_TOUR_DE_CHAT)
    expect(valeurDe(args, '--mcp-config')).toBe('C:/tmp/mcp.json')
    expect(valeurDe(args, '--plugin-dir')).toBe('D:/AutoWinOS/mods/autowin')
    expect(valeurDe(args, '--permission-mode')).toBe('dontAsk')
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('bypassPermissions')
    // Une liste différente d'un seul nom ferait réécrire tout le cache du fil (conv-1370, lot 5).
    expect(valeurDe(args, '--tools')?.split(',')).toEqual(
      expect.arrayContaining(['Monitor', 'TaskStop'])
    )
  })

  it('pose un refus total, en échec fermé, à la place des crochets du tour', () => {
    const reglages = JSON.parse(reglagesDeQuestion()) as {
      autoCompactWindow: number
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<Record<string, string>> }> }
    }
    expect(reglages.hooks.PreToolUse).toHaveLength(1)
    const [groupe] = reglages.hooks.PreToolUse
    expect(groupe!.matcher).toBe('*')
    expect(groupe!.hooks[0]!.onFailure).toBe('block')
    expect(groupe!.hooks[0]!.command).toContain('process.exit(2)')
    // Mêmes réglages que le tour pour le reste : la fenêtre de compaction n'est pas perdue.
    expect(reglages.autoCompactWindow).toBeGreaterThan(0)
  })

  it('borne à deux appels : un outil refusé, puis la réponse', () => {
    expect(valeurDe(argumentsQuestion(appel), '--max-turns')).toBe('2')
  })

  it('sans serveur d’outils, retombe sur aucun outil du tout', () => {
    const args = argumentsQuestion({ sessionId: 's', modele: '', dossier: '' })
    expect(valeurDe(args, '--tools')).toBe('')
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--model')
    expect(args).not.toContain('--add-dir')
    // Le refus reste posé même là : aucun chemin ne dépend d'un seul drapeau.
    expect(valeurDe(args, '--settings')).toContain('"matcher":"*"')
  })
})

describe('poser une question', () => {
  it('lance le CLI dans le dossier et le compte du fil, avec la consigne en tête', async () => {
    const { service, enfants, appels } = monter()
    const issue = service.poser('conv-1', '  Quel fichier ?  ')
    const enfant = await jusquAuLancement(enfants)
    enfant.fermer(0, JSON_OK('Celui-là.\nAUTOWIN_BESOIN_V1: aucun'))
    expect(await issue).toEqual({ ok: true, reponse: 'Celui-là.', outilRefuse: false })

    const appel = appels[0]!
    expect(appel.bin).toBe('claude.exe')
    expect(appel.options.cwd).toBe('D:\\AutoWinOS')
    expect(appel.options.shell).toBe(false)
    expect((appel.options.env as NodeJS.ProcessEnv).CLAUDE_CONFIG_DIR).toBe('D:/comptes/compte-3')
    expect(enfant.recu()).toBe(messageDeQuestion('Quel fichier ?'))
    expect(enfant.recu().startsWith(CONSIGNE_QUESTION)).toBe(true)
  })

  it('compte par défaut : retire le dossier de configuration hérité du processus', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'D:/un/autre/compte')
    const { service, enfants, appels } = monter(
      {},
      { 'conv-1': { key: 'claude:opus:default:D:\\X:c0:w0', sessionId: 's' } }
    )
    const issue = service.poser('conv-1', 'q')
    ;(await jusquAuLancement(enfants)).fermer(0, JSON_OK('r'))
    await issue
    expect((appels[0]!.options.env as NodeJS.ProcessEnv).CLAUDE_CONFIG_DIR).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('rend un motif clair, sans lancer le CLI, pour un fil sans session', async () => {
    const { service, appels } = monter({}, {})
    expect(await service.poser('conv-1', 'q')).toEqual({ ok: false, motif: 'sans-session' })
    expect(appels).toHaveLength(0)
  })

  it('refuse un fil sur un autre modèle IA, sa session n’étant pas celle du CLI Claude', async () => {
    const { service, appels } = monter({}, { 'conv-1': { key: 'codex:gpt', sessionId: 't' } })
    expect(await service.poser('conv-1', 'q')).toEqual({ ok: false, motif: 'autre-modele' })
    expect(appels).toHaveLength(0)
  })

  it('refuse un compte retiré : la session vit dans son dossier', async () => {
    const { service, appels } = monter(
      {},
      { 'conv-1': { key: 'claude:opus:compte-9:D:\\X:c0:w0', sessionId: 's' } }
    )
    expect(await service.poser('conv-1', 'q')).toEqual({ ok: false, motif: 'compte-absent' })
    expect(appels).toHaveLength(0)
  })

  it('passe par la session du tour en cours quand l’index n’en a pas encore', async () => {
    const tourEnCours = vi.fn(() => ({
      sessionId: 'sess-tour',
      fournisseur: 'claude',
      modele: 'claude-opus-5-5',
      compte: 'compte-3',
      dossier: 'D:\\AutoWinOS'
    }))
    const { service, enfants, appels } = monter({ tourEnCours }, {})
    const issue = service.poser('conv-1', 'q')
    ;(await jusquAuLancement(enfants)).fermer(0, JSON_OK('r'))
    await issue
    expect(tourEnCours).toHaveBeenCalledWith('conv-1')
    expect(valeurDe(appels[0]!.args, '--resume')).toBe('sess-tour')
  })

  it('le serveur d’outils refuse tout : rien n’est exécuté s’il est appelé', async () => {
    const { service, enfants, ouvrirOutils } = monter()
    const issue = service.poser('conv-1', 'q')
    ;(await jusquAuLancement(enfants)).fermer(0, JSON_OK('r'))
    await issue
    const { exec } = ouvrirOutils.mock.calls[0]![0] as {
      exec: (nom: string, args: object) => Promise<{ ok: boolean }>
    }
    expect((await exec('get_state', {})).ok).toBe(false)
  })

  it('retire le serveur et sa config, en succès comme en échec', async () => {
    let chemin = ''
    const { service, enfants, appels, arreter } = monter()
    const issue = service.poser('conv-1', 'q')
    const enfant = await jusquAuLancement(enfants)
    chemin = valeurDe(appels[0]!.args, '--mcp-config')!
    expect(readFileSync(chemin, 'utf8')).toBe('{"mcpServers":{}}')
    enfant.fermer(1, '')
    await issue
    expect(arreter).toHaveBeenCalledTimes(1)
    expect(existsSync(chemin)).toBe(false)
  })

  it('serveur d’outils indisponible : la question part quand même, sans aucun outil', async () => {
    const ouvrirOutils = vi.fn(async () => ({ repli: 'port occupé' }))
    const { service, enfants, appels } = monter({
      ouvrirOutils: ouvrirOutils as unknown as DependancesQuestionACote['ouvrirOutils']
    })
    const issue = service.poser('conv-1', 'q')
    ;(await jusquAuLancement(enfants)).fermer(0, JSON_OK('r'))
    expect(await issue).toMatchObject({ ok: true })
    expect(valeurDe(appels[0]!.args, '--tools')).toBe('')
  })

  it('un binaire absent rend un échec nommé', async () => {
    const lancer = (): ChildProcess => {
      const enfant = fauxEnfant()
      setImmediate(() => enfant.processus.emit('error', new Error('spawn ENOENT')))
      return enfant.processus
    }
    const { service } = monter({ lancer })
    expect(await service.poser('conv-1', 'q')).toEqual({
      ok: false,
      motif: 'echec',
      detail: 'spawn ENOENT'
    })
  })
})

describe('annuler', () => {
  it('n’arrête que le processus de CETTE question', async () => {
    const { service, enfants } = monter(
      {},
      {
        'conv-1': { key: CLE, sessionId: 's1' },
        'conv-2': { key: CLE, sessionId: 's2' }
      }
    )
    const premiere = service.poser('conv-1', 'q')
    const seconde = service.poser('conv-2', 'q')
    const un = await jusquAuLancement(enfants, 0)
    const deux = await jusquAuLancement(enfants, 1)

    service.annuler('conv-1')
    expect(await premiere).toEqual({ ok: false, motif: 'annulee' })
    expect(un.kill).toHaveBeenCalledTimes(1)
    expect(deux.kill).not.toHaveBeenCalled()

    deux.fermer(0, JSON_OK('toujours là'))
    expect(await seconde).toMatchObject({ ok: true, reponse: 'toujours là' })
  })

  it('une annulation pendant l’ouverture ne lance jamais le CLI', async () => {
    let liberer: (() => void) | undefined
    const ouvrirOutils = vi.fn(
      () =>
        new Promise((resoudre) => {
          liberer = () => resoudre({ repli: 'x' })
        })
    )
    const { service, appels } = monter({
      ouvrirOutils: ouvrirOutils as unknown as DependancesQuestionACote['ouvrirOutils']
    })
    const issue = service.poser('conv-1', 'q')
    await vi.waitFor(() => expect(ouvrirOutils).toHaveBeenCalled())
    service.annuler('conv-1')
    liberer?.()
    expect(await issue).toEqual({ ok: false, motif: 'annulee' })
    expect(appels).toHaveLength(0)
  })

  it('une seconde question du même fil remplace la première', async () => {
    const { service, enfants } = monter()
    const premiere = service.poser('conv-1', 'une')
    const un = await jusquAuLancement(enfants, 0)
    const seconde = service.poser('conv-1', 'deux')
    expect(await premiere).toEqual({ ok: false, motif: 'annulee' })
    const deux = await jusquAuLancement(enfants, 1)
    deux.fermer(0, JSON_OK('r'))
    expect(await seconde).toMatchObject({ ok: true })
    expect(un.kill).toHaveBeenCalledTimes(1)
  })

  it('arrête un CLI bloqué au-delà du délai', async () => {
    const { service, enfants } = monter({ delaiMs: 10 })
    const issue = service.poser('conv-1', 'q')
    const enfant = await jusquAuLancement(enfants)
    expect(await issue).toEqual({ ok: false, motif: 'delai' })
    expect(enfant.kill).toHaveBeenCalledTimes(1)
  })
})

describe('la session du premier tour, encore en cours', () => {
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  function journaux(init: string | null): { racine: string; journal: string } {
    const racine = mkdtempSync(join(tmpdir(), 'question-a-cote-'))
    racines.push(racine)
    const token = '69430ac6-a9d0-4e3f-9e68-4fb8ebabacb2'
    mkdirSync(join(racine, 'turn-journals', 'conv-9'), { recursive: true })
    mkdirSync(join(racine, 'run-stdout'), { recursive: true })
    writeFileSync(
      join(racine, 'turn-journals', 'conv-9', 'tour.jsonl'),
      `${JSON.stringify({ kind: 'provider-journal', provider: 'claude', token })}\n{"kind":"x"}\n`
    )
    const journal = join(racine, 'run-stdout', `${token}.stdout.jsonl`)
    if (init !== null) writeFileSync(journal, `${init}\n{"type":"assistant"}\n`)
    return { racine, journal }
  }

  const INIT = JSON.stringify({
    subtype: 'init',
    session_id: 'sess-9',
    model: 'claude-opus-5-5',
    cwd: 'D:\\AutoWinOS'
  })

  it('lit la session, le modèle et le dossier dans le journal du tour', () => {
    const { racine } = journaux(INIT)
    expect(sessionDuTourEnCours('conv-9', [], racine)).toEqual({
      sessionId: 'sess-9',
      fournisseur: 'claude',
      modele: 'claude-opus-5-5',
      compte: '',
      dossier: 'D:\\AutoWinOS'
    })
  })

  it('retrouve le compte qui garde le fichier de session', () => {
    const { racine } = journaux(INIT)
    const dossier = join(racine, 'compte-2')
    const projet = join(dossier, 'projects', 'D--AutoWinOS')
    mkdirSync(projet, { recursive: true })
    writeFileSync(join(projet, 'sess-9.jsonl'), '')
    const comptes = [{ id: 'compte-2', dir: dossier, addedAt: '' }]
    expect(sessionDuTourEnCours('conv-9', comptes, racine)?.compte).toBe('compte-2')
  })

  it('un tour terminé ne compte pas : le fil n’a plus de session si l’index l’a oubliée', () => {
    const { racine, journal } = journaux(INIT)
    writeFileSync(`${journal}.exit.json`, '{}')
    expect(sessionDuTourEnCours('conv-9', [], racine)).toBeUndefined()
  })

  it('un fil sans journal, ou un journal illisible, vaut « pas de session »', () => {
    const { racine } = journaux('pas du JSON')
    expect(sessionDuTourEnCours('conv-9', [], racine)).toBeUndefined()
    expect(sessionDuTourEnCours('conv-absent', [], racine)).toBeUndefined()
    expect(sessionDuTourEnCours('conv-9', [], journaux(null).racine)).toBeUndefined()
  })
})
