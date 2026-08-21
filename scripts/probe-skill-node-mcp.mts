/**
 * PREUVE HORS-MODELE du serveur d'outils d'un noeud skill.
 *
 * Un test unitaire que j'ecris moi-meme prouve que MON code se comporte comme JE l'ai prevu. Il ne
 * prouve pas que le CLI Claude charge ce serveur, ni qu'il appelle l'outil. Ce script fait la seule
 * chose qui le prouve : il lance le VRAI serveur (celui du process principal, pas une maquette),
 * puis le VRAI CLI, et regarde si le TEMOIN — une chaine non devinable, absente du prompt —
 * ressort. Si elle ressort, l'outil a ete appele ; le modele ne peut pas l'inventer.
 *
 * Il verifie aussi le CONTROLE NEGATIF : sans `--mcp-config`, le meme appel doit rendre l'outil
 * ABSENT. C'est la garantie « les huit phases du pipeline ne recoivent aucun outil », prouvee sur le
 * meme binaire que la garantie positive.
 *
 * Usage : npx tsx scripts/probe-skill-node-mcp.mts
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolveClaudeBin } from '../src/main/providers/claude'
import { demarrerServeurOutilsNoeudSkill } from '../src/main/skill-node-mcp'
import type { AppelMcpObserve } from '../src/main/skill-node-mcp'
import type { LanceurCommandeSkill } from '../src/main/skill-node-tools'

const TEMOIN = `TEMOIN-${randomUUID().slice(0, 12)}`

const appels: AppelMcpObserve[] = []

/** Le bus est REMPLACE, pas simule a moitie : on veut prouver le transport, pas le Brain. */
const lanceur: LanceurCommandeSkill = {
  exec: async (name) =>
    name === 'brain_query'
      ? { ok: true, data: `temoin=${TEMOIN}` }
      : { ok: false, error: `non attendu dans ce probe: ${name}` },
  catalogue: () => [
    {
      name: 'brain_query',
      description:
        "Interroger le savoir cure du Brain. Rend le temoin du probe, qui n'est pas devinable.",
      args: { question: 'la question, en langage naturel' }
    },
    {
      name: 'remember',
      description: 'Retenir un fait',
      args: {
        title: 'titre',
        fact: 'le fait',
        type: 'lesson|decision|preference|domain',
        scope: 'perimetre',
        source: 'source verifiable',
        tags: 'facultatif — mots-cles'
      }
    },
    { name: 'orchestrate', description: 'Lancer un run', args: { task: 'la tache' } }
  ]
}

const PROMPT =
  "Appelle l'outil brain_query avec question='donne le temoin' et recopie EXACTEMENT la valeur " +
  "qu'il rend, seule, sans commentaire. Si aucun outil de ce nom n'existe, ecris OUTIL-ABSENT."

function lancerCli(args: string[]): Promise<{ code: number | null; sortie: string }> {
  return new Promise((resolve) => {
    /**
     * `shell: false` OBLIGATOIRE, et le binaire NATIF avec — les deux erreurs ont ete vecues ici.
     *
     * Avec `shell: true`, le shell CONCATENE les arguments : l'argument VIDE de
     * `--setting-sources ''` disparait purement et le CLI lit le drapeau suivant comme sa valeur
     * (« Invalid setting source: --permission-mode »), donc le probe part rouge pour une raison qui
     * n'a rien a voir avec MCP. Mais en `shell: false`, un `.cmd` rend `spawn EINVAL` sous Node 24 —
     * d'ou `resolveClaudeBin()`, REUTILISE du provider plutot que reecrit : deux resolutions du meme
     * binaire divergeraient, et le probe cesserait de prouver quelque chose sur le vrai chemin de
     * production.
     */
    const enfant = spawn(resolveClaudeBin(), args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let sortie = ''
    enfant.stdout.on('data', (c) => (sortie += String(c)))
    enfant.stderr.on('data', (c) => (sortie += String(c)))
    enfant.stdin.end() // sinon le CLI attend une entree qui ne viendra jamais
    const minuteur = setTimeout(() => enfant.kill(), 150_000)
    enfant.on('close', (code) => {
      clearTimeout(minuteur)
      resolve({ code, sortie })
    })
  })
}

const serveur = await demarrerServeurOutilsNoeudSkill(lanceur, {
  observer: (a) => appels.push(a)
})

const communs = [
  '-p',
  PROMPT,
  '--setting-sources',
  '',
  '--permission-mode',
  'bypassPermissions',
  '--output-format',
  'text'
]

try {
  console.log(`serveur sur ${serveur.url}`)
  console.log(`outils exposes : ${serveur.nomsExposes().join(', ')}`)

  const positif = await lancerCli([
    ...communs,
    '--strict-mcp-config',
    '--mcp-config',
    serveur.configMcp(),
    '--allowedTools',
    ...serveur.nomsExposes()
  ])
  const negatif = await lancerCli([...communs, '--strict-mcp-config'])

  const temoinRendu = positif.sortie.includes(TEMOIN)
  const outilAbsent = /OUTIL-ABSENT/i.test(negatif.sortie)
  const appelObserve = appels.some((a) => a.outil === 'brain_query' && a.ok && !a.refuse)

  console.log('\n=== POSITIF (avec --mcp-config) ===')
  console.log(`code=${positif.code} | temoin present = ${temoinRendu}`)
  console.log(positif.sortie.trim().slice(0, 500))
  console.log('\n=== NEGATIF (strict seul, cas des 8 phases) ===')
  console.log(`code=${negatif.code} | outil absent = ${outilAbsent}`)
  console.log(negatif.sortie.trim().slice(0, 300))
  console.log('\n=== JOURNAL SERVEUR (corroboration hors-modele) ===')
  console.log(JSON.stringify(appels))

  const vert = temoinRendu && outilAbsent && appelObserve
  console.log(
    `\nPROBE ${vert ? 'VERT' : 'ROUGE'} — temoin=${temoinRendu} absent=${outilAbsent} appel-observe=${appelObserve}`
  )
  process.exitCode = vert ? 0 : 1
} finally {
  await serveur.arreter()
}
