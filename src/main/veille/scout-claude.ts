import { spawn } from 'node:child_process'
import { resolveClaudeBin } from '../providers/claude'
import type { LancerScout } from './passe'

/**
 * Le scout, cote APPLICATION : un appel au CLI avec les outils web, et rien d'autre.
 *
 * Le meme corps que `scripts/lancer-veille.ts`, et il vaut mieux qu'il vive ici : le script de mise au
 * point l'importera plutot que d'en garder une copie, sinon les deux divergeront — et c'est justement le
 * script qui a servi a trouver les trois pieges d'environnement encodes ci-dessous.
 */
interface OptionsScoutCli {
  /** Outils CHARGES et AUTORISES, en arguments SEPARES (la forme a virgules pend — mesure A/B). */
  outils: readonly string[]
  timeoutMs?: number
}

/** Le corps commun a tous les scouts CLI : memes pieges d'environnement, seuls les outils changent. */
const lancerScoutCli = (prompt: string, options: OptionsScoutCli): Promise<string> =>
  new Promise<string>((resoudre, rejeter) => {
    const enfant = spawn(
      resolveClaudeBin(),
      [
        '-p',
        prompt,
        '--tools',
        options.outils.join(','),
        // Arguments SEPARES : mesure A/B sur le CLI reel — la forme a virgules fait PENDRE toute
        // recuperation de page jusqu'au delai maximum, la forme separee repond en quelques secondes.
        '--allowedTools',
        ...options.outils,
        '--permission-mode',
        'bypassPermissions',
        // Sans ces trois-la, le CLI demarre tous les serveurs MCP du poste avant de repondre : mesure,
        // le scout depassait 240 s et se faisait tuer.
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--disable-slash-commands'
      ],
      // stdin FERME : avec un tuyau ouvert, le CLI attend une entree (« no stdin data received in 3s »).
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    let sortie = ''
    let erreurs = ''
    enfant.stdout.setEncoding('utf8')
    enfant.stdout.on('data', (bout: string) => {
      sortie += bout
    })
    enfant.stderr.setEncoding('utf8')
    enfant.stderr.on('data', (bout: string) => {
      erreurs += bout
    })
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), options.timeoutMs ?? 240_000)
    minuteur.unref?.()
    enfant.on('error', (erreur) => {
      clearTimeout(minuteur)
      rejeter(erreur)
    })
    enfant.on('close', (code) => {
      clearTimeout(minuteur)
      if (code === 0) return resoudre(sortie)
      // La FIN de stderr, pas le debut : stderr commence par des avertissements benins du poste, et les
      // garder cachait la cause reelle derriere du bruit connu.
      const utile = erreurs
        .split(String.fromCharCode(10))
        .map((ligne) => ligne.trim())
        .filter((ligne) => ligne && !/^Permission allow rule|^Warning: no stdin/.test(ligne))
      rejeter(
        new Error(
          `scout sorti en ${code} : ${utile.slice(-3).join(' | ').slice(0, 400) || 'sans message'}`
        )
      )
    })
  })

/** Le scout de veille WEB historique : outils web seuls — un scout n'a rien a ecrire ni a executer. */
export const lancerScoutVeille: LancerScout = (source, prompt) => {
  void source
  return lancerScoutCli(prompt, { outils: ['WebFetch', 'WebSearch'] })
}
