import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseTicketCredential } from './ticket-credential-store'
import { cliChildEnvironment } from './cli-child-environment'

const execFileAsync = promisify(execFile)
const AZURE_DEVOPS_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798'

export type AzureCliRunner = (
  executable: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: AzureCliRunner = async (executable, args) => {
  const windowsCommand = process.platform === 'win32'
  const target = windowsCommand ? (process.env.ComSpec ?? 'cmd.exe') : executable
  const targetArgs = windowsCommand ? ['/d', '/s', '/c', executable, ...args] : args
  const result = await execFileAsync(target, targetArgs, {
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 16_384,
    encoding: 'utf8',
    env: cliChildEnvironment()
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

/**
 * L'OUTIL EST-IL ABSENT, OU SEULEMENT DECONNECTE ? Deux pannes, deux gestes.
 *
 * Un seul message couvrait les DEUX causes, et il accusait la session : « Session Azure CLI
 * indisponible. » Or le 2026-09-08 sur ce poste, `az` n'etait pas DECONNECTE, il n'etait pas
 * INSTALLE — absent du PATH et de son emplacement standard, verifie. Le message envoyait donc
 * chercher une reconnexion la ou il fallait une installation : deux tours perdus sur cette fausse
 * piste, dans la session meme qui a produit ce correctif.
 *
 * ON NE RECOPIE RIEN de la sortie de l'outil, et ce n'est pas negociable : elle peut porter le jeton
 * lui-meme (garde posee par `azure-cli-token.test.ts`). On CHERCHE donc un motif dedans, et on rend
 * un texte FIXE — jamais l'erreur d'origine.
 *
 * Motifs couverts : `ENOENT` (l'executable n'existe pas, chemin direct hors Windows) et le refus de
 * l'interpreteur Windows, qui passe par `cmd /c` et rend un code de sortie ordinaire AU LIEU
 * d'`ENOENT` — en francais comme en anglais, la casse ne comptant pas.
 */
function outilAbsent(cause: unknown): boolean {
  if ((cause as { code?: unknown })?.code === 'ENOENT') return true
  const texte = [
    (cause as { stderr?: unknown })?.stderr,
    (cause as { message?: unknown })?.message
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase()
  return (
    texte.includes("n'est pas reconnu") ||
    texte.includes('is not recognized') ||
    texte.includes('command not found') ||
    texte.includes('enoent')
  )
}

/**
 * Les deux messages, EXPORTES pour qu'un test les cite au lieu de les recopier a la main.
 *
 * Chacun nomme le GESTE a faire, pas seulement l'etat constate : « indisponible » laissait le
 * lecteur deviner s'il devait installer, se reconnecter, ou renoncer.
 */
export const AZURE_CLI_ABSENT =
  "Azure CLI n'est pas installé sur ce poste (commande `az` introuvable) : l'installer, puis se connecter avec `az login`."
export const AZURE_CLI_DECONNECTE =
  'Session Azure CLI indisponible : Azure CLI est présent mais sans session valide — se connecter avec `az login`.'

export async function loadAzureDevOpsCliToken(
  run: AzureCliRunner = defaultRunner
): Promise<string> {
  try {
    const result = await run('az.cmd', [
      'account',
      'get-access-token',
      '--resource',
      AZURE_DEVOPS_RESOURCE_ID,
      '--query',
      'accessToken',
      '-o',
      'tsv'
    ])
    return parseTicketCredential(result.stdout.trim())
  } catch (cause) {
    throw new Error(outilAbsent(cause) ? AZURE_CLI_ABSENT : AZURE_CLI_DECONNECTE)
  }
}
