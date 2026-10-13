import { describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { scriptHookGardes } from '../../shared/garde-git-destructeur'
import { refusReglageProd } from '../prod-run-guard'
import { findClaudeExecutable, gardeNpmDuDepot, gardeNpmDuLancement, reglagesCliAutowin } from './claude'

/** Le garde npm RÉEL du dépôt Autowin (`scripts/garde-npm-modules.mjs`). */
const VRAI_GARDE_NPM = resolve(__dirname, '..', '..', '..', 'scripts', 'garde-npm-modules.mjs')

/**
 * GARDE DES AGENTS QUI PLANTE = COMMANDE REFUSÉE (`onFailure: "block"`, CLI ≥ 2.1.295).
 *
 * MESURÉ le 2026-10-13 sur le CLI 2.1.296 installé, avec ce banc : un script de garde qui lève une
 * exception sort en code 1, que le CLI traite comme une « erreur non bloquante » — la commande de
 * l'agent s'exécutait quand même (fichier témoin créé). Une garde en panne (script tronqué, bug de
 * sérialisation, module introuvable) laissait donc passer TOUT ce qu'elle devait refuser, en silence.
 * Le CHANGELOG embarqué du CLI (2.1.295) : « a hook that can't start, times out, or exits with an
 * unexpected code blocks the action instead of letting it through ».
 *
 * Compatibilité mesurée le même jour sur les CLI 2.1.275 et 2.1.280 (Claude Desktop) : la clé y est
 * ignorée — la garde tourne et son refus JSON bloque toujours. Ils ne gagnent pas la protection,
 * ils ne perdent rien.
 *
 * Le banc : un FAUX serveur d'API Anthropic local répond « appelle l'outil shell » ; le VRAI CLI
 * tourne avec les réglages produits par `reglagesCliAutowin` (le code de production, pas un miroir).
 * Aucun appel modèle réel, aucun réseau : déterministe, ~1 s par lancement.
 */

const CLI = process.env.CLAUDE_BIN ?? findClaudeExecutable()
const VERSION = CLI
  ? /(\d+)\.(\d+)\.(\d+)/.exec(spawnSync(CLI, ['--version'], { encoding: 'utf8', timeout: 30_000 }).stdout ?? '')
  : null
/** `onFailure` n'existe qu'à partir du CLI 2.1.295 (CHANGELOG embarqué). */
const CLI_AVEC_ONFAILURE =
  VERSION !== null &&
  (Number(VERSION[1]) > 2 ||
    (Number(VERSION[1]) === 2 && (Number(VERSION[2]) > 1 || (Number(VERSION[2]) === 1 && Number(VERSION[3]) >= 295))))

const avant = (p: string): string => p.split('\\').join('/')

type ResultatOutil = { content: unknown; is_error?: boolean }

/** Un événement SSE de l'API Messages, au format que le CLI consomme en streaming. */
function messageSse(contenu: { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown }): unknown[] {
  const bloc =
    contenu.type === 'text'
      ? [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: contenu.text } }
        ]
      : [
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_garde', name: contenu.name, input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(contenu.input) } }
        ]
  return [
    {
      type: 'message_start',
      message: { id: 'msg_banc', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } }
    },
    ...bloc,
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: contenu.type === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' }
  ]
}

/**
 * Lance le VRAI CLI, avec les réglages de `reglagesCliAutowin(garde)`, sur un tour où le « modèle »
 * demande `echo x > <témoin>`. Rend ce que le CLI a renvoyé comme résultat d'outil et si le témoin existe.
 *
 * Spawn ASYNCHRONE obligatoire : un `spawnSync` bloquerait la boucle d'événements, donc le faux
 * serveur ne répondrait plus et le test pendrait sans erreur (leçon Brain du 2026-09-23).
 */
async function tourAvecGarde(
  scriptGarde: string,
  /**
   * Le garde npm : un CONTENU de script (écrit dans le dossier du banc), `{ chemin }` d'un script
   * existant, ou une fonction qui reçoit le dossier de réglages du lancement et rend le chemin.
   */
  gardeNpm?: string | { chemin: string } | ((dossierReglages: string) => Promise<string | undefined>)
): Promise<{ temoinCree: boolean; resultat?: ResultatOutil; sortie: string }> {
  // Le dossier du banc EST un dossier de réglages d'agent : il en porte le préfixe. Effet voulu : le
  // nettoyeur de fin de suite (`tests/temp-cleanup.ts`, `PREFIXES_VIVANTS_DE_LAPP`) l'épargne. Mesuré
  // le 2026-10-13 : sous un préfixe `autowin-*` ordinaire, ses scripts disparaissaient en plein test
  // (« Cannot find module …/garde.mjs ») pendant que d'autres conversations jouaient leur suite sur le
  // poste. Cause réelle, hors de ce fichier : ce nettoyeur supprime par date de naissance, sans savoir
  // si une AUTRE suite utilise encore le dossier.
  const dir = mkdtempSync(join(tmpdir(), 'autowin-os-settings-'))
  try {
    const garde = join(dir, 'garde.mjs')
    writeFileSync(garde, scriptGarde, 'utf8')
    let npm: string | undefined
    if (typeof gardeNpm === 'string') {
      npm = join(dir, 'garde-npm-modules.mjs')
      writeFileSync(npm, gardeNpm, 'utf8')
    } else if (typeof gardeNpm === 'function') npm = await gardeNpm(dir)
    else if (gardeNpm) npm = gardeNpm.chemin
    const temoin = avant(join(dir, 'temoin.txt'))
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, JSON.stringify(reglagesCliAutowin(garde, npm)), 'utf8')

    let resultat: ResultatOutil | undefined
    let requetes = 0
    const serveur = createServer((req: IncomingMessage, res: ServerResponse) => {
      let corps = ''
      req.on('data', (d) => (corps += d))
      req.on('end', () => {
        if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end('{}')
          return
        }
        requetes++
        const r = JSON.parse(corps) as { tools?: { name: string }[]; messages: { content: unknown }[] }
        const retour = r.messages
          .flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string }[]) : []))
          .find((c) => c.type === 'tool_result') as ResultatOutil | undefined
        const outils = (r.tools ?? []).map((t) => t.name)
        // Sur Windows l'outil shell du CLI s'appelle `PowerShell`, ailleurs `Bash` : on prend celui offert.
        const shell = outils.find((n) => n === 'Bash' || n === 'PowerShell')
        if (retour) resultat = retour
        const evenements =
          retour || !shell || requetes > 4
            ? messageSse({ type: 'text', text: 'fin' })
            : // « npm » dans le texte : le vrai garde npm va jusqu'à l'analyse de la commande au lieu
              // de sortir dès son premier filtre (`/\bnpm/`). Elle reste anodine : `echo`, pas npm.
              messageSse({ type: 'tool_use', name: shell, input: { command: `echo npm x > ${temoin}`, description: 'témoin du banc' } })
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const e of evenements) res.write(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
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
      DISABLE_AUTOUPDATER: '1'
    }
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    delete env.ANTHROPIC_AUTH_TOKEN

    // Les drapeaux de production qui comptent ici (voir `send`) : -p, `--setting-sources ''`,
    // `--settings`, `--permission-mode bypassPermissions` — la garde est le SEUL frein possible.
    const sortie = await new Promise<string>((ok, ko) => {
      const p = spawn(
        CLI!,
        ['-p', 'lance la commande', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--settings', settings, '--permission-mode', 'bypassPermissions', '--model', 'claude-sonnet-4-5'],
        { env, cwd: dir }
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
    return { temoinCree: existsSync(join(dir, 'temoin.txt')), resultat, sortie }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('reglagesCliAutowin — garde Bash/Edit/Write en échec fermé', () => {
  it('le hook de garde du groupe terminal/édition porte onFailure: "block"', () => {
    const groupe = (reglagesCliAutowin('G.mjs') as { hooks: { PreToolUse: { matcher: string; hooks: Record<string, unknown>[] }[] } })
      .hooks.PreToolUse[0]
    expect(groupe.matcher.split('|')).toEqual(expect.arrayContaining(['Bash', 'PowerShell', 'Edit', 'Write']))
    expect(groupe.hooks[0]).toMatchObject({ type: 'command', command: 'node "G.mjs"', onFailure: 'block' })
  })

  it('le garde npm du même groupe porte aussi onFailure: "block"', () => {
    const groupe = (reglagesCliAutowin('G.mjs', 'D:\\depot\\scripts\\garde-npm-modules.mjs') as {
      hooks: { PreToolUse: { hooks: Record<string, unknown>[] }[] }
    }).hooks.PreToolUse[0]
    expect(groupe.hooks[1]).toMatchObject({
      type: 'command',
      command: 'node "D:/depot/scripts/garde-npm-modules.mjs"',
      onFailure: 'block'
    })
  })

  it('le garde npm d’un lancement est une COPIE dans son dossier de réglages, pas le fichier du dépôt', async () => {
    const reglages = mkdtempSync(join(tmpdir(), 'autowin-os-settings-'))
    try {
      const mod = resolve(__dirname, '..', '..', '..', 'mods', 'autowin')
      const copie = await gardeNpmDuLancement(reglages, mod)
      expect(copie).toBe(join(reglages, 'garde-npm-modules.mjs'))
      expect(readFileSync(copie!, 'utf8')).toBe(readFileSync(VRAI_GARDE_NPM, 'utf8'))
      // Pas de mod, ou pas de script dans le dépôt : aucun garde npm, comme avant.
      expect(await gardeNpmDuLancement(reglages, undefined)).toBeUndefined()
      expect(await gardeNpmDuLancement(reglages, join(reglages, 'pas-de-depot', 'mods', 'autowin'))).toBeUndefined()
    } finally {
      rmSync(reglages, { recursive: true, force: true })
    }
  })

  it('`send` passe par gardeNpmDuLancement avec le dossier de réglages du lancement', () => {
    const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')
    expect(source).toMatch(/reglagesCliAutowin\(hookGarde, await gardeNpmDuLancement\(settingsDir, modAutowin\)\)/)
  })
})

describe.skipIf(!CLI_AVEC_ONFAILURE)(`vrai CLI ${VERSION?.[0] ?? '(introuvable ou < 2.1.295)'} — garde qui plante`, () => {
  it('LE CAS MESURÉ : un script de garde qui lève une exception BLOQUE la commande de l’agent', async () => {
    const t = await tourAvecGarde("throw new Error('garde en panne')\n")
    expect(t.resultat, t.sortie.slice(-2000)).toBeDefined()
    expect(t.temoinCree).toBe(false)
    expect(t.resultat!.is_error).toBe(true)
    expect(String(t.resultat!.content)).toMatch(/blocking because onFailure is "block"/)
  }, 60_000)

  it('témoin : la VRAIE garde, saine, laisse passer une commande anodine', async () => {
    const t = await tourAvecGarde(scriptHookGardes(refusReglageProd))
    expect(t.resultat, t.sortie.slice(-2000)).toBeDefined()
    expect(t.resultat!.is_error, String(t.resultat!.content)).not.toBe(true)
    expect(t.temoinCree).toBe(true)
  }, 60_000)

  it('un GARDE NPM qui plante bloque la commande, même quand la garde principale la laisse passer', async () => {
    const t = await tourAvecGarde(scriptHookGardes(refusReglageProd), "throw new Error('garde npm en panne')\n")
    expect(t.resultat, t.sortie.slice(-2000)).toBeDefined()
    expect(t.temoinCree).toBe(false)
    expect(t.resultat!.is_error).toBe(true)
    const message = String(t.resultat!.content)
    expect(message).toMatch(/blocking because onFailure is "block"/)
    // C'est bien le garde npm qui a refusé, pas la garde principale (le CLI cite la commande du hook).
    expect(message).toMatch(/garde-npm-modules\.mjs/)
  }, 60_000)

  it('un garde npm CASSÉ dans le dépôt APRÈS le lancement ne bloque pas l’agent déjà lancé', async () => {
    let choisi: string | undefined
    const t = await tourAvecGarde(scriptHookGardes(refusReglageProd), async (dossierReglages) => {
      // Faux dépôt (`mods/autowin` + `scripts/garde-npm-modules.mjs`, copie SAINE du vrai garde),
      // logé dans le dossier du banc : nettoyé avec lui.
      const depot = join(dossierReglages, 'depot')
      const mod = join(depot, 'mods', 'autowin')
      mkdirSync(mod, { recursive: true })
      mkdirSync(join(depot, 'scripts'))
      const source = join(depot, 'scripts', 'garde-npm-modules.mjs')
      writeFileSync(source, readFileSync(VRAI_GARDE_NPM, 'utf8'), 'utf8')
      // Le CODE DE PRODUCTION choisit le garde npm du lancement…
      choisi = await gardeNpmDuLancement(dossierReglages, mod)
      // …puis quelqu'un modifie le dépôt pendant que l'agent tourne : erreur de syntaxe.
      writeFileSync(source, 'export const garde = (\n', 'utf8')
      return choisi
    })
    // Un lancement SANS garde npm passerait aussi : ce ne serait pas la preuve cherchée.
    expect(choisi, 'aucun garde npm branché').toBeDefined()
    expect(t.resultat, t.sortie.slice(-2000)).toBeDefined()
    expect(t.resultat!.is_error, String(t.resultat!.content)).not.toBe(true)
    expect(t.temoinCree).toBe(true)
  }, 60_000)

  it('témoin : le VRAI garde npm du dépôt, sain, laisse passer une commande anodine', async () => {
    const vrai = gardeNpmDuDepot(resolve(__dirname, '..', '..', '..', 'mods', 'autowin'))
    expect(vrai, 'scripts/garde-npm-modules.mjs introuvable à côté de mods/autowin').toBeDefined()
    const t = await tourAvecGarde(scriptHookGardes(refusReglageProd), { chemin: vrai! })
    expect(t.resultat, t.sortie.slice(-2000)).toBeDefined()
    expect(t.resultat!.is_error, String(t.resultat!.content)).not.toBe(true)
    expect(t.temoinCree).toBe(true)
  }, 60_000)
})
