/**
 * LIMITE DE TAILLE d'un `brain_read` servi par le canal NATIF (serveur MCP du nœud skill).
 *
 * Pourquoi : `brain_read` promet la note ENTIÈRE. Or le CLI Claude ne met pas n'importe quelle
 * taille de résultat d'outil MCP dans la conversation. Documentation officielle
 * (https://code.claude.com/docs/en/mcp) : au-delà du seuil, « Claude Code saves it to a file and
 * replaces it in the conversation with a message that names the file path » ; un outil peut relever
 * ce seuil par `_meta["anthropic/maxResultSizeChars"]` dans `tools/list`, « up to 500,000
 * characters ». Mesure publique du seuil par défaut : ~50 000 caractères, indépendant de
 * MAX_MCP_OUTPUT_TOKENS (https://github.com/anthropics/claude-code/issues/97622).
 *
 * Cette sonde le constate sur le VRAI CLI et le VRAI serveur de l'app : pour chaque taille, le Brain
 * est remplacé par une note synthétique qui porte un TÉMOIN non devinable sur sa DERNIÈRE ligne, et
 * on lit le `tool_result` que le CLI transmet au modèle (flux stream-json). Oracle hors modèle :
 * témoin présent dans ce résultat = note arrivée entière dans la conversation.
 *
 * PAYANTE (petit modèle, 3 appels) : npx tsx scripts/probe-brain-read-taille.mts
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolveClaudeBin } from '../src/main/providers/claude'
import { claudeToolResultText } from '../src/main/providers/claude'
import { demarrerServeurOutilsNoeudSkill } from '../src/main/skill-node-mcp'
import type { LanceurCommandeSkill } from '../src/main/skill-node-tools'

const TAILLES = [30_000, 120_000, 600_000]

function note(taille: number, temoin: string): string {
  const ligne = 'Ligne de note du Brain — contenu de remplissage pour mesurer la taille.\n'
  const corps = ligne.repeat(Math.ceil(taille / ligne.length)).slice(0, taille - temoin.length - 1)
  return `${corps}\n${temoin}`
}

function lancerCli(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const enfant = spawn(resolveClaudeBin(), args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let sortie = ''
    enfant.stdout.on('data', (c) => (sortie += String(c)))
    enfant.stderr.on('data', (c) => (sortie += String(c)))
    enfant.stdin.end()
    const minuteur = setTimeout(() => enfant.kill(), 300_000)
    enfant.on('close', () => {
      clearTimeout(minuteur)
      resolve(sortie)
    })
  })
}

/** Le texte du `tool_result` que le CLI a remis au modèle pour l'appel MCP `brain_read`. */
function resultatTransmis(sortie: string): string | undefined {
  const idsBrainRead = new Set<string>()
  for (const brute of sortie.split('\n')) {
    const ligne = brute.trim()
    if (!ligne.startsWith('{')) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(ligne) as Record<string, unknown>
    } catch {
      continue
    }
    const contenu = (ev.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(contenu)) continue
    for (const bloc of contenu as Array<Record<string, unknown>>) {
      if (bloc.type === 'tool_use' && String(bloc.name).endsWith('brain_read')) {
        idsBrainRead.add(String(bloc.id))
      }
      if (bloc.type === 'tool_result' && idsBrainRead.has(String(bloc.tool_use_id))) {
        return claudeToolResultText(bloc.content)
      }
    }
  }
  return undefined
}

let tousOk = true
for (const taille of TAILLES) {
  const temoin = `TEMOIN-FIN-${randomUUID().slice(0, 12)}`
  const lanceur: LanceurCommandeSkill = {
    exec: async (nom) =>
      nom === 'brain_read'
        ? { ok: true, data: { found: true, status: 'found', knowledge: note(taille, temoin) } }
        : { ok: false, error: `non attendu dans cette sonde : ${nom}` },
    catalogue: () => [
      {
        name: 'brain_read',
        description: 'Ouvrir EN ENTIER une note curée du Brain',
        args: { path: 'chemin de la note, knowledge/…/nom.md' }
      }
    ]
  }
  const serveur = await demarrerServeurOutilsNoeudSkill(lanceur)
  try {
    const sortie = await lancerCli([
      '-p',
      "Appelle l'outil brain_read avec path='knowledge/t.md', puis réponds seulement FIN.",
      '--model',
      'haiku',
      '--setting-sources',
      '',
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config',
      serveur.configMcp(),
      '--allowedTools',
      ...serveur.nomsExposes()
    ])
    const transmis = resultatTransmis(sortie)
    const entier = transmis?.includes(temoin) === true
    const persiste = transmis !== undefined && /saved|persist|exceeds|too large/i.test(transmis)
    // Au-delà du plafond documenté (500 000), la note ne PEUT PAS arriver entière : on l'attend.
    const attendu = taille <= 500_000
    if (entier !== attendu) tousOk = false
    console.log(
      `${String(taille).padStart(7)} car. -> ${
        transmis === undefined
          ? 'AUCUN appel brain_read observé'
          : entier
            ? `ENTIÈRE dans la conversation (${transmis.length} car. transmis)`
            : persiste
              ? `NON transmise : remplacée par un renvoi vers un fichier (« ${transmis.slice(0, 110)}… »)`
              : `NON transmise (${transmis.length} car., témoin absent)`
      } — attendu : ${attendu ? 'entière' : 'renvoi fichier (au-delà de 500 000)'}`
    )
  } finally {
    await serveur.arreter()
  }
}
console.log(`\nSONDE ${tousOk ? 'VERTE' : 'ROUGE'}`)
process.exitCode = tousOk ? 0 : 1
