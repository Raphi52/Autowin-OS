import { afterAll, describe, expect, it, vi } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resoudreBash } from '../chat/relance-taches-de-fond'
import { detectBlindFixLoop, SEUIL_FIX_GATE } from '../gates/hooks'
import {
  estDansUnDepotGit,
  fichiersEditesParLeRun,
  jetonsDeCauseParFichier
} from '../hooks/default-gate-hooks'
import {
  avecAvertissementDesTests,
  avecSignalDeCause,
  findClaudeExecutable,
  reglagesCliAutowin
} from './claude'
import { OUTILS_D_EDITION, scriptHookCauseEnCours } from './cause-en-cours'

/**
 * LE CONTRÔLE « CAUSE VÉRIFIÉE » SE SIGNALE PENDANT LE TRAVAIL (2026-10-31).
 *
 * Mesure : (lot 3 de plan-b4358910, run-7b7d533c318e-1) a appris à la 134e minute, au
 * contrôle final, que 14 modifications de src/main/bureau/navigateur-integre.ts n'avaient pas de cause
 * vérifiée. Ce refus a rejoué un passage complet, alors que l'agent aurait pu noter sa cause dès la
 * 3e modification. Le contrôle final ne change pas : seul l'avertissement arrive à temps.
 *
 * Le banc lance le VRAI script par node, comme le CLI. Piège du cas réel : navigateur-integre.ts porte
 * déjà 21 `fix-ok:`. Le jeton compté doit donc être celui que l'agent ÉCRIT, jamais un ancien.
 */

const FICHIER = 'src/main/bureau/navigateur-integre.ts'
const dossiers: string[] = []
afterAll(() => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true })
})

const dossierNeuf = (prefixe: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}

interface Banc {
  depot: string
  reglages: string
  hook: (entree: unknown) => { sortie: string; code: number | null }
}

function banc(creerScript: (racine: string) => string = scriptHookCauseEnCours): Banc {
  const reglages = dossierNeuf('hook-cause-reglages-')
  const depot = dossierNeuf('hook-cause-depot-')
  mkdirSync(join(depot, '.git'))
  const script = join(reglages, 'cause-en-cours.mjs')
  writeFileSync(script, creerScript(depot), 'utf8')
  return {
    depot,
    reglages,
    hook: (entree) => {
      const r = spawnSync(process.execPath, [script], {
        input: typeof entree === 'string' ? entree : JSON.stringify(entree),
        encoding: 'utf8'
      })
      return { sortie: r.stdout, code: r.status }
    }
  }
}

/** Ce que le CLI passe au hook après un `Edit` réussi (champs mesurés : `tool_use_result`). */
const edition = (
  depot: string,
  relatif = FICHIER,
  texte: { old_string?: string; new_string?: string } = {}
): Record<string, unknown> => ({
  hook_event_name: 'PostToolUse',
  tool_name: 'Edit',
  cwd: depot,
  tool_input: {
    file_path: join(depot, relatif),
    old_string: texte.old_string ?? 'const a = 1',
    new_string: texte.new_string ?? 'const a = 2'
  },
  tool_response: { filePath: join(depot, relatif) }
})

const contexte = (sortie: string): string => {
  const j = JSON.parse(sortie) as { hookSpecificOutput: { additionalContext: string } }
  return j.hookSpecificOutput.additionalContext
}

describe('signal de cause — le VRAI script du hook, lancé par node', () => {
  it('conv-1324 : la 3e modification sans jeton nomme le fichier, le compte et le geste de sortie', () => {
    const { depot, hook } = banc()
    expect(hook(edition(depot)).sortie).toBe('')
    expect(hook(edition(depot)).sortie).toBe('')
    const { sortie, code } = hook(edition(depot))
    expect(code).toBe(0)
    const j = JSON.parse(sortie) as { hookSpecificOutput: { hookEventName: string } }
    expect(j.hookSpecificOutput.hookEventName).toBe('PostToolUse')
    const texte = contexte(sortie)
    expect(texte).toContain(FICHIER)
    expect(texte).toContain('3 édits')
    expect(texte).toContain('`fix-ok: <cause mesurée>`')
    // La phrase du contrôle final, mot pour mot : l'agent lit à temps ce qu'il lirait trop tard.
    expect(texte).toContain(detectBlindFixLoop({ [FICHIER]: 3 })[0].detail)
  })

  it('2 modifications : aucun message', () => {
    const { depot, hook } = banc()
    expect(hook(edition(depot)).sortie).toBe('')
    expect(hook(edition(depot)).sortie).toBe('')
  })

  it('un jeton écrit dans ce fichier fait taire le signal, à n’importe quel moment avant le seuil', () => {
    const { depot, hook } = banc()
    expect(
      hook(edition(depot, FICHIER, { new_string: '// fix-ok: cause mesurée\nconst a = 2' })).sortie
    ).toBe('')
    for (let i = 0; i < 4; i++) expect(hook(edition(depot)).sortie).toBe('')
  })

  it('le jeton écrit à la 3e modification elle-même fait taire le signal', () => {
    const { depot, hook } = banc()
    hook(edition(depot))
    hook(edition(depot))
    expect(hook(edition(depot, FICHIER, { new_string: '// check: lu dans la trace' })).sortie).toBe(
      ''
    )
  })

  it('le jeton d’un AUTRE fichier ne vaut rien ici : il ne dédouane que le fichier écrit', () => {
    const { depot, hook } = banc()
    hook(edition(depot, 'src/main/autre.ts', { new_string: '// fix-ok: ailleurs' }))
    hook(edition(depot))
    hook(edition(depot))
    expect(contexte(hook(edition(depot)).sortie)).toContain(FICHIER)
  })

  it('Write et MultiEdit écrivent aussi un jeton', () => {
    const { depot, hook } = banc()
    hook({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(depot, FICHIER), content: 'x\n// fix-ok: par Write\n' },
      tool_response: { type: 'create', originalFile: null }
    })
    for (let i = 0; i < 3; i++) expect(hook(edition(depot)).sortie).toBe('')

    const multi = banc()
    multi.hook({
      hook_event_name: 'PostToolUse',
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: join(multi.depot, FICHIER),
        edits: [{ old_string: 'a', new_string: '// CausalHypothesis: mesurée' }]
      }
    })
    for (let i = 0; i < 3; i++) expect(multi.hook(edition(multi.depot)).sortie).toBe('')
  })

  it('un ANCIEN jeton recopié avec son contexte ne compte pas (21 `fix-ok:` dans le cas réel)', () => {
    const { depot, hook } = banc()
    const ancien = '// fix-ok: conv-1 — ancien\nconst a = 1'
    const recopie = { old_string: ancien, new_string: '// fix-ok: conv-1 — ancien\nconst a = 2' }
    hook(edition(depot, FICHIER, recopie))
    hook(edition(depot, FICHIER, recopie))
    expect(contexte(hook(edition(depot, FICHIER, recopie)).sortie)).toContain(FICHIER)
  })

  it('Write sur un fichier existant : seules ses lignes NEUVES comptent', () => {
    const { depot, hook } = banc()
    const ecriture = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(depot, FICHIER), content: '// fix-ok: ancien\nconst a = 2\n' },
      tool_response: { type: 'update', originalFile: '// fix-ok: ancien\nconst a = 1\n' }
    }
    hook(ecriture)
    hook(ecriture)
    expect(contexte(hook(ecriture).sortie)).toContain(FICHIER)
  })

  it('un fichier hors dépôt git ne compte pas, comme au contrôle final (conv-1149)', () => {
    const { depot, hook } = banc()
    const dehors = dossierNeuf('hook-cause-dehors-')
    const brouillon = join(dehors, 'codemod2.cjs')
    expect(estDansUnDepotGit(depot)(brouillon)).toBe(false)
    const entree = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: brouillon, old_string: 'a', new_string: 'b' }
    }
    for (let i = 0; i < 4; i++) expect(hook(entree).sortie).toBe('')
  })

  it('un AUTRE dépôt compte, y compris une copie de travail (`.git` est un fichier)', () => {
    const { depot, hook } = banc()
    const autre = dossierNeuf('hook-cause-worktree-')
    writeFileSync(join(autre, '.git'), 'gitdir: ailleurs\n', 'utf8')
    const chemin = join(autre, 'x.ts')
    expect(estDansUnDepotGit(depot)(chemin)).toBe(true)
    const entree = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: chemin, old_string: 'a', new_string: 'b' }
    }
    hook(entree)
    hook(entree)
    expect(contexte(hook(entree).sortie)).toContain('x.ts')
  })

  it('JSON d’entrée illisible : aucun message, code 0, et le compte n’est pas perdu', () => {
    const { depot, hook } = banc()
    hook(edition(depot))
    expect(hook('pas du json')).toEqual({ sortie: '', code: 0 })
    hook(edition(depot))
    expect(contexte(hook(edition(depot)).sortie)).toContain(FICHIER)
  })

  it('état illisible sur le disque : aucun message, code 0', () => {
    const { depot, reglages, hook } = banc()
    writeFileSync(join(reglages, 'cause-en-cours.json'), '{ cassé', 'utf8')
    for (let i = 0; i < 4; i++) expect(hook(edition(depot))).toEqual({ sortie: '', code: 0 })
  })

  it('deuxième passage déjà signalé : un seul message par fichier', () => {
    const { depot, hook } = banc()
    hook(edition(depot))
    hook(edition(depot))
    expect(hook(edition(depot)).sortie).not.toBe('')
    for (let i = 0; i < 3; i++) expect(hook(edition(depot)).sortie).toBe('')
  })

  it('deux fichiers ont chacun leur compte et leur message', () => {
    const { depot, hook } = banc()
    hook(edition(depot, 'a.ts'))
    hook(edition(depot, 'b.ts'))
    hook(edition(depot, 'a.ts'))
    expect(hook(edition(depot, 'b.ts')).sortie).toBe('')
    expect(contexte(hook(edition(depot, 'a.ts')).sortie)).toContain('a.ts')
    expect(contexte(hook(edition(depot, 'b.ts')).sortie)).toContain('b.ts')
  })

  it('le même fichier sous trois écritures de chemin compte pour un seul', () => {
    const { depot, hook } = banc()
    const avec = (file_path: string): Record<string, unknown> => ({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path, old_string: 'a', new_string: 'b' }
    })
    hook(avec(join(depot, 'src', 'x.ts')))
    hook(avec(`${depot.replace(/\\/g, '/')}/src/x.ts`))
    const texte = contexte(hook(avec('src/x.ts')).sortie)
    expect(texte).toContain('3 édits de src/x.ts')
  })

  it('une modification = un compte : un MultiEdit de 3 changements n’en fait qu’une', () => {
    const { depot, hook } = banc()
    const multi = {
      hook_event_name: 'PostToolUse',
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: join(depot, FICHIER),
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
          { old_string: 'e', new_string: 'f' }
        ]
      }
    }
    expect(hook(multi).sortie).toBe('')
    expect(hook(multi).sortie).toBe('')
    expect(hook(multi).sortie).not.toBe('')
  })

  it('une modification en échec compte, comme `fichiersEditesParLeRun`, mais n’écrit aucun jeton', () => {
    const { depot, hook } = banc()
    const echec = {
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Edit',
      tool_input: {
        file_path: join(depot, FICHIER),
        old_string: 'introuvable',
        new_string: '// fix-ok: jamais écrit'
      },
      error: 'String to replace not found in file.',
      is_interrupt: false
    }
    expect(
      fichiersEditesParLeRun([
        {
          type: 'Edit',
          kind: 'mutation',
          status: 'failed',
          ok: false,
          summary: 'Edit',
          path: FICHIER
        }
      ])
    ).toEqual({ [FICHIER]: 1 })
    hook(edition(depot))
    hook(edition(depot))
    const { sortie } = hook(echec)
    const j = JSON.parse(sortie) as { hookSpecificOutput: { hookEventName: string } }
    expect(j.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure')
    expect(contexte(sortie)).toContain('3 édits')
  })

  it('un autre outil ne compte pas', () => {
    const { depot, hook } = banc()
    const lecture = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: join(depot, FICHIER) }
    }
    for (let i = 0; i < 4; i++) expect(hook(lecture).sortie).toBe('')
  })

  it('l’état vit dans le dossier de réglages de l’agent : il part avec lui', () => {
    const { depot, reglages, hook } = banc()
    hook(edition(depot))
    expect(existsSync(join(reglages, 'cause-en-cours.json'))).toBe(true)
    expect(existsSync(join(depot, 'cause-en-cours.json'))).toBe(false)
  })
})

describe('signal de cause — mêmes règles que le contrôle final', () => {
  it('le seuil est celui du contrôle : silence juste en dessous, message juste au seuil', () => {
    const { depot, hook } = banc()
    expect(detectBlindFixLoop({ [FICHIER]: SEUIL_FIX_GATE - 1 })).toEqual([])
    expect(detectBlindFixLoop({ [FICHIER]: SEUIL_FIX_GATE })).toHaveLength(1)
    for (let i = 1; i < SEUIL_FIX_GATE; i++) expect(hook(edition(depot)).sortie).toBe('')
    expect(hook(edition(depot)).sortie).not.toBe('')
  })

  it('aucune seconde copie du seuil : le script suit SEUIL_FIX_GATE, le contrôle aussi', async () => {
    vi.resetModules()
    vi.doMock('../gates/hooks', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../gates/hooks')>()),
      SEUIL_FIX_GATE: 2
    }))
    const { scriptHookCauseEnCours: scriptAvecSeuil2 } = await import('./cause-en-cours')
    vi.doUnmock('../gates/hooks')
    vi.resetModules()
    const { depot, hook } = banc(scriptAvecSeuil2)
    expect(hook(edition(depot)).sortie).toBe('')
    expect(contexte(hook(edition(depot)).sortie)).toContain('2 édits')

    const source = readFileSync(join(__dirname, '..', 'gates', 'hooks.ts'), 'utf8')
    expect(source).toContain('threshold = SEUIL_FIX_GATE')
    expect(source).not.toMatch(/causeTokensByFile,\s*3,/)
  })

  it.each([
    ['// fix-ok: cause mesurée'],
    ['// CausalHypothesis: cause mesurée'],
    ['# check: lu dans la trace'],
    ['// fix-ok : avec une espace'],
    ['// fix ok sans tiret'],
    ['// fix-ok sans deux-points'],
    ['// recheck: un autre mot'],
    ['// hotfix-ok: collé à un mot']
  ])('même règle de jeton que le contrôle final : %s', async (ligne) => {
    const fantome = 'dossier-absent/fichier-fantome.ts'
    const credite = (await jetonsDeCauseParFichier(`${ligne} ${fantome}`, [], [fantome]))[fantome]
    const { depot, hook } = banc()
    hook(edition(depot, FICHIER, { new_string: ligne }))
    hook(edition(depot))
    const { sortie } = hook(edition(depot))
    expect(sortie === '').toBe(credite === true)
  })
})

describe('signal de cause — branchement dans les réglages', () => {
  const groupes = (r: Record<string, unknown>, evenement: string): Record<string, unknown>[] =>
    (r.hooks as Record<string, Record<string, unknown>[]>)[evenement] ?? []

  it('ajoute un hook après édition, sans échec fermé et sans toucher aux gardes', () => {
    const base = reglagesCliAutowin('G.mjs')
    const r = avecSignalDeCause(base, 'C:\\tmp\\reglages\\cause-en-cours.mjs')
    expect(groupes(r, 'PreToolUse')).toEqual(groupes(base, 'PreToolUse'))
    for (const evenement of ['PostToolUse', 'PostToolUseFailure']) {
      expect(groupes(r, evenement)).toEqual([
        {
          matcher: OUTILS_D_EDITION,
          hooks: [{ type: 'command', command: 'node "C:/tmp/reglages/cause-en-cours.mjs"' }]
        }
      ])
    }
    expect(JSON.stringify(groupes(r, 'PostToolUse'))).not.toContain('onFailure')
    expect(avecSignalDeCause(base, undefined)).toBe(base)
  })

  it('coexiste avec l’avertissement des tests, quel que soit l’ordre : aucun n’écrase l’autre', () => {
    const base = reglagesCliAutowin('G.mjs')
    const ordres = [
      avecSignalDeCause(avecAvertissementDesTests(base, 'T.mjs'), 'C.mjs'),
      avecAvertissementDesTests(avecSignalDeCause(base, 'C.mjs'), 'T.mjs')
    ]
    for (const r of ordres)
      for (const evenement of ['PostToolUse', 'PostToolUseFailure']) {
        const matchers = groupes(r, evenement).map((g) => g.matcher)
        expect(matchers.sort()).toEqual(['Bash', OUTILS_D_EDITION].sort())
      }
  })
})

/*
 * LE VRAI CLI, avec les réglages de production. Un faux serveur d'API joue le modèle (aucun appel
 * réel, aucun réseau) et on lit la requête qui suit chaque résultat : c'est ce que le modèle reçoit.
 * Modèle repris de `claude.tests-non-comptes.test.ts`, ici avec une SUITE d'outils.
 */
const CLI = process.env.CLAUDE_BIN ?? findClaudeExecutable()

interface Geste {
  outil: string
  entree: unknown
}

function messageSse(geste: Geste | undefined, rang: number): unknown[] {
  const bloc = geste
    ? [
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: `toolu_banc_${rang}`,
            name: geste.outil,
            input: {}
          }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(geste.entree) }
        }
      ]
    : [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fin' } }
      ]
  return [
    {
      type: 'message_start',
      message: {
        id: `msg_banc_${rang}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    },
    ...bloc,
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: geste ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 }
    },
    { type: 'message_stop' }
  ]
}

/** Joue `gestes` avec le vrai CLI ; rend, pour chaque résultat, ce qui part au modèle ensuite. */
async function requetesApresChaqueGeste(
  depot: string,
  gestes: (cheminFichier: string) => Geste[],
  fichierInitial?: string
): Promise<string[]> {
  // Préfixe d'un dossier de réglages d'agent : le nettoyeur de fin de suite l'épargne.
  const dir = mkdtempSync(join(tmpdir(), 'autowin-os-settings-'))
  const fichier = join(depot, 'src', 'cible.ts')
  mkdirSync(join(depot, 'src'), { recursive: true })
  if (fichierInitial !== undefined) writeFileSync(fichier, fichierInitial, 'utf8')
  const suite = gestes(fichier)
  try {
    const garde = join(dir, 'garde.mjs')
    writeFileSync(garde, '', 'utf8')
    const hookCause = join(dir, 'cause-en-cours.mjs')
    writeFileSync(hookCause, scriptHookCauseEnCours(depot), 'utf8')
    const settings = join(dir, 'settings.json')
    writeFileSync(
      settings,
      JSON.stringify(avecSignalDeCause(reglagesCliAutowin(garde), hookCause)),
      'utf8'
    )
    const recues: string[] = []
    const serveur = createServer((req: IncomingMessage, res: ServerResponse) => {
      let corps = ''
      req.on('data', (d) => (corps += d))
      req.on('end', () => {
        if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end('{}')
          return
        }
        const rang = recues.length
        recues.push(corps)
        const evenements = messageSse(suite[rang], rang)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const e of evenements)
          res.write(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
        res.end()
      })
    })
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok))
    const port = (serveur.address() as { port: number }).port
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: 'sk-ant-banc-local',
      CLAUDE_CONFIG_DIR: join(dir, 'config-cli'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      ...(process.platform === 'win32' ? { CLAUDE_CODE_GIT_BASH_PATH: resoudreBash() } : {})
    }
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    delete env.ANTHROPIC_AUTH_TOKEN
    const sortie = await new Promise<string>((ok, ko) => {
      const p = spawn(
        CLI!,
        [
          '-p',
          'modifie le fichier',
          '--output-format',
          'stream-json',
          '--verbose',
          '--setting-sources',
          '',
          '--settings',
          settings,
          '--permission-mode',
          'bypassPermissions',
          '--tools',
          'Read,Edit,Write',
          '--model',
          'claude-sonnet-4-5'
        ],
        { env, cwd: depot }
      )
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      p.stdin.end()
      const coupe = setTimeout(() => {
        p.kill()
        ko(new Error(`CLI pendu > 50 s :\n${out.slice(-2000)}`))
      }, 50_000)
      p.on('error', ko)
      p.on('close', () => {
        clearTimeout(coupe)
        ok(out)
      })
    })
    await new Promise<void>((ok) => serveur.close(() => ok()))
    if (recues.length !== suite.length + 1)
      throw new Error(
        `${recues.length} requêtes pour ${suite.length} gestes :\n${sortie.slice(-2000)}`
      )
    // recues[0] est la demande ; recues[n] suit le résultat du geste n.
    return recues.slice(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SIGNAL = 'Refus à venir au contrôle final'

describe.skipIf(!CLI)('vrai CLI — l’agent est prévenu à côté du résultat de son outil', () => {
  it('3 modifications sans jeton : le message arrive après la 3e, pas avant', async () => {
    const depot = dossierNeuf('hook-cause-cli-')
    mkdirSync(join(depot, '.git'))
    const apres = await requetesApresChaqueGeste(depot, (f) => [
      { outil: 'Write', entree: { file_path: f, content: 'const a = 1\nconst b = 1\n' } },
      { outil: 'Edit', entree: { file_path: f, old_string: 'a = 1', new_string: 'a = 2' } },
      { outil: 'Edit', entree: { file_path: f, old_string: 'b = 1', new_string: 'b = 2' } }
    ])
    expect(apres[0]).not.toContain(SIGNAL)
    expect(apres[1]).not.toContain(SIGNAL)
    expect(apres[2]).toContain(SIGNAL)
    expect(apres[2]).toContain('3 édits de src/cible.ts')
  }, 60_000)

  it('`Write` sur un fichier existant : un ancien jeton recopié ne fait pas taire le signal', async () => {
    const depot = dossierNeuf('hook-cause-cli-')
    mkdirSync(join(depot, '.git'))
    const apres = await requetesApresChaqueGeste(
      depot,
      (f) => [
        { outil: 'Read', entree: { file_path: f } },
        { outil: 'Write', entree: { file_path: f, content: '// fix-ok: ancien\nconst a = 2\n' } },
        { outil: 'Write', entree: { file_path: f, content: '// fix-ok: ancien\nconst a = 3\n' } },
        { outil: 'Write', entree: { file_path: f, content: '// fix-ok: ancien\nconst a = 4\n' } }
      ],
      '// fix-ok: ancien\nconst a = 1\n'
    )
    expect(apres[2]).not.toContain(SIGNAL)
    expect(apres[3]).toContain(SIGNAL)
  }, 60_000)
})
