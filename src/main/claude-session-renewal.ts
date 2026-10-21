/**
 * RENOUVELLEMENT DE LA SESSION CLAUDE D'UN COMPTE, par le CLI lui-meme (conv-1031, 2026-10-21).
 *
 * Le jeton d'acces d'un compte Claude vit 8 h et SEUL le CLI sait le renouveler (il detient le jeton
 * de rafraichissement, le verrou du fichier et son format). La sonde de quota (`model-quotas.ts`)
 * lisait donc, pour un compte laisse de cote, un jeton expire : 401, puis des chiffres qui ne sont
 * pas ceux du compte — jusqu'a ce que l'utilisateur envoie un message. On fait ce geste-la, en plus
 * petit : un appel `-p` minimal dans le dossier du compte, que le CLI fait preceder du
 * renouvellement. Mesure sur ce poste : ~4 s, sortie 0.
 *
 * Choix des options, chacune pour une raison :
 *  - `--setting-sources ''` : ne charge PAS les reglages de l'utilisateur — ses hooks
 *    (`UserPromptSubmit` sur ce poste) ne doivent pas se declencher pour une sonde ;
 *  - `--strict-mcp-config` sans `--mcp-config` : aucun serveur MCP demarre ;
 *  - `--tools ''` : aucun outil — PLACE EN DERNIER, l'option est variadique et avalerait le prompt ;
 *  - `--no-session-persistence` : aucune session ajoutee a l'historique du compte ;
 *  - `cwd` = dossier temporaire : aucun CLAUDE.md de projet charge.
 */
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { withClaudeAccountEnv } from './claude-accounts'
import { resolveClaudeBin } from './providers/claude'

const DELAI_MAX_MS = 30_000

export const ARGUMENTS_RENOUVELLEMENT = [
  '-p',
  '.',
  '--model',
  'haiku',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--tools',
  ''
] as const

export interface RenouvellementDeps {
  spawnFn?: typeof spawn
  bin?: () => string
  delaiMaxMs?: number
}

/**
 * Rend `true` quand le CLI a tourne jusqu'au bout, QUEL QUE SOIT son code de sortie : un compte
 * epuise peut sortir en erreur APRES avoir renouvele son jeton. La verite reste la relecture de
 * `.credentials.json` par l'appelant. `false` = CLI introuvable, plantage au lancement ou delai.
 */
export function renouvelerSessionClaude(
  configDir: string | undefined,
  deps: RenouvellementDeps = {}
): Promise<boolean> {
  const spawnFn = deps.spawnFn ?? spawn
  return new Promise<boolean>((resolve) => {
    let fini = false
    const terminer = (valeur: boolean): void => {
      if (fini) return
      fini = true
      clearTimeout(minuteur)
      resolve(valeur)
    }
    let child: ReturnType<typeof spawn> | undefined
    const minuteur = setTimeout(() => {
      // Seul CE processus est arrete : jamais un arret par nom d'executable.
      child?.kill()
      terminer(false)
    }, deps.delaiMaxMs ?? DELAI_MAX_MS)
    try {
      child = spawnFn((deps.bin ?? resolveClaudeBin)(), [...ARGUMENTS_RENOUVELLEMENT], {
        cwd: tmpdir(),
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
        // EXPLICITE pour le compte par defaut aussi : sans retrait, le CLI heriterait d'un
        // CLAUDE_CONFIG_DIR du processus et renouvellerait la session d'un AUTRE compte.
        env: withClaudeAccountEnv(process.env, configDir ? { CLAUDE_CONFIG_DIR: configDir } : {})
      })
      child.on('error', () => terminer(false))
      child.on('close', () => terminer(true))
    } catch {
      terminer(false)
    }
  })
}
