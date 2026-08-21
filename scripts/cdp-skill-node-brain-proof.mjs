/**
 * PREUVE TERMINALE — un nœud SKILL appelle le Brain par le mécanisme NATIF, dans l'app RÉELLE.
 *
 * Ce que les etapes precedentes prouvent deja, et ce qu'elles ne prouvent PAS :
 *  - les tests unitaires prouvent que MON code se comporte comme JE l'ai prevu ;
 *  - `probe-skill-node-mcp.mts` prouve que le VRAI CLI charge le serveur et appelle l'outil ;
 *  - AUCUN des deux ne prouve que l'orchestrateur de l'app vivante ouvre ce serveur pour un noeud
 *    skill, ni que le process qui tourne porte reellement le correctif. C'est l'objet de ce script.
 *
 * L'ORACLE est la TRACE CAUSALE du run, pas le compte rendu de l'agent : un agent qui raconte avoir
 * appele un outil est exactement le defaut d'origine. On cherche les lignes poussees par
 * l'orchestrateur lui-meme (`outils natifs servis a …`, `outil natif <nom> (<phase>) : ok`).
 *
 * DETERMINISME : plusieurs runs, meme tache. Un 2/3 est un echec — c'etait le defaut de depart.
 *
 * Usage : node scripts/cdp-skill-node-brain-proof.mjs [nbRuns]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = 'C:\\Amitel\\Autowin OS'
const port = Number(process.env.AUTOWIN_CDP_PORT || 9224)
const nbRuns = Number(process.argv[2] || 3)
const traceRoot = join(root, '.autowin-data', 'autowin-os', 'causal-trace')

/** Le premier run DEPOSE un fait ; les suivants se contentent de LIRE. */
const tacheAvecDepot =
  'Consulte le Brain avec brain_query pour savoir ce qui est deja etabli sur les outils des noeuds ' +
  "de workflow d'Autowin OS. Puis, dans la phase learn, retiens le fait suivant avec remember : " +
  'title="Outils natifs MCP pour les noeuds skill", ' +
  'fact="Les commandes brain_query et remember sont servies aux noeuds skill par un serveur MCP http ' +
  "loopback tenu par le process principal d'Autowin OS, declare au CLI via --mcp-config. Avant, seul " +
  'un protocole texte <cmd> existait et le modele choisissait son propre mecanisme natif une fois sur ' +
  'deux, ce qui rendait l\'acces au Brain non deterministe.", ' +
  'type="decision", scope="autowin-os", source="session:current".'

const tacheLectureSeule =
  'Consulte le Brain avec brain_query pour savoir ce qui est deja etabli sur les outils des noeuds de ' +
  "workflow d'Autowin OS, puis resume ce que tu as lu. NE DEPOSE AUCUN FAIT : n'appelle pas remember."

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error(`Aucune page Electron sur le port ${port} — l'app tourne-t-elle ?`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let nextId = 0
const pending = new Map()
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    // Rendre le refus BAVARD : « Uncaught » nu ne dit pas ce qui a echoue, et on repartirait sur une
    // hypothese plausible au lieu d'une cause.
    const d = r.exceptionDetails
    throw new Error(
      [d.text, d.exception?.description, d.exception?.value, d.lineNumber]
        .filter(Boolean)
        .join(' | ')
    )
  }
  return r.result.value
}

/** Les lignes de trace d'une conversation, telles que l'orchestrateur les a ecrites. */
function lireTrace(conversationId) {
  const chemin = join(traceRoot, `${conversationId}.jsonl`)
  if (!existsSync(chemin)) return []
  return readFileSync(chemin, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * Les details vivent dans `payloads[].content`, PAS dans un champ `detail`.
 *
 * Ma premiere version lisait `e.detail` : le fichier n'en contient aucun, donc l'oracle rendait
 * toujours « rien vu » — un test qui ne peut pas voir son sujet aurait declare rouge un mecanisme
 * vert, ou l'inverse. Verifie en lisant le fichier reel du run conv-1343.
 */
const detailsDe = (evenements) =>
  evenements
    .flatMap((e) => (Array.isArray(e?.payloads) ? e.payloads : []))
    .map((pl) => pl?.content)
    .filter((c) => typeof c === 'string' && c.length > 0)

/**
 * L'ARGV du CLI, tel que la trace l'a enregistre. C'est le signal STRUCTUREL : il dit si
 * `--mcp-config` a ete passe, independamment de ce que le modele a fait ensuite. Sans lui, un run
 * ou le repli texte fonctionne ressemble a un run ou le mecanisme natif fonctionne — c'etait
 * exactement la confusion de depart.
 */
const argvDuRun = (evenements) => {
  for (const e of evenements) {
    for (const pl of Array.isArray(e?.payloads) ? e.payloads : []) {
      if (typeof pl?.content !== 'string' || !pl.content.includes('"argv"')) continue
      try {
        const argv = JSON.parse(pl.content).argv
        if (Array.isArray(argv)) return argv
      } catch {
        // payload non JSON : on continue, ce n'est pas celui-la.
      }
    }
  }
  return undefined
}

console.log(`API disponible : ${await evaluate('typeof window.api')}`)
console.log(
  await evaluate(
    `(async () => JSON.stringify(await window.api.workflowProfileSelect('memoire-depot')))()`
  )
)

const resultats = []
for (let i = 0; i < nbRuns; i++) {
  const avecDepot = i === 0
  const tache = avecDepot ? tacheAvecDepot : tacheLectureSeule
  const conv = await evaluate(
    `(async () => JSON.stringify(await window.api.conversationsCreate({title:${JSON.stringify(
      `preuve outils natifs #${i + 1}`
    )}, category:"", provider:"claude"})))()`
  )
  const conversationId = JSON.parse(conv).id
  console.log(
    `\n--- run ${i + 1}/${nbRuns} (${avecDepot ? 'avec depot' : 'lecture seule'}) : ${conversationId}`
  )
  await evaluate(
    `(() => { window.api.orchestrate(${JSON.stringify(tache)}, ${JSON.stringify(
      conversationId
    )}); return true })()`
  )

  // On attend la TRACE, pas un etat d'interface : c'est l'artefact qui fait preuve.
  const limite = Date.now() + 15 * 60 * 1000
  let details = []
  let servi = false
  let appels = []
  let replisTexte = []
  let refusNatifs = []
  let argv
  let derniereTaille = -1
  let stable = 0
  while (Date.now() < limite) {
    await attendre(5_000)
    const evenements = lireTrace(conversationId)
    details = detailsDe(evenements)
    argv = argvDuRun(evenements)
    servi = details.some((d) => d.includes('outils natifs servis'))
    appels = details.filter((d) => d.startsWith('outil natif '))
    replisTexte = details.filter((d) => /^outil [a-z_]+ \([a-z]+\) : /.test(d))
    refusNatifs = details.filter((d) => d.includes('No such tool available'))
    /**
     * On attend que la trace se STABILISE, on ne coupe PAS au premier signe de vie.
     *
     * Ma premiere version cassait la boucle des le premier appel natif observe. Consequence mesuree
     * sur conv-1344 : l'argv du run n'etait pas encore ecrit, donc l'oracle a rendu
     * « --mcp-config: false » alors que le seul argv trace le portait bel et bien — un verdict ROUGE
     * sur un mecanisme VERT. Et le noeud `learn` n'avait pas encore joue, donc `remember` passait
     * pour absent alors qu'il n'avait pas encore eu son tour.
     */
    const taille = details.length + (argv ? 1 : 0)
    if (taille === derniereTaille) {
      stable += 1
      if (stable >= 6 && appels.length > 0) break
      if (stable >= 24) break // rien ne bouge depuis ~2 min : le run est fini ou bloque
    } else {
      stable = 0
      derniereTaille = taille
    }
  }
  const mcpPasse = Array.isArray(argv) && argv.includes('--mcp-config')
  console.log(`  --mcp-config passe au CLI : ${mcpPasse}`)
  console.log(`  serveur ouvert pour un noeud skill : ${servi}`)
  console.log(`  appels NATIFS observes : ${appels.length}`)
  for (const a of appels) console.log(`    ${a}`)
  console.log(`  replis TEXTE observes : ${replisTexte.length}`)
  for (const a of replisTexte) console.log(`    ${a}`)
  if (refusNatifs.length > 0) {
    console.log(
      `  ⚠ refus « No such tool available » : ${refusNatifs.length} — le defaut d'origine`
    )
  }
  resultats.push({ conversationId, servi, appels, replisTexte, refusNatifs, mcpPasse })
}

socket.close()

console.log('\n=== BILAN ===')
const avecMcp = resultats.filter((r) => r.mcpPasse).length
/**
 * ABOUTI = `ok` SANS `RIEN`, pas `endsWith(': ok')`.
 *
 * Le suffixe exact a cesse de marcher le jour ou la trace a commence a DIRE l'issue metier : une
 * ligne finit desormais par `: ok — trouve` ou `: ok — RIEN ECRIT — …`. Le test de suffixe rendait
 * donc ROUGE un aller-retour Brain parfaitement VERT (mesure du 2026-08-21). Ironie utile a garder :
 * c'est la correction qui empeche un libelle de mentir qui a casse le script verifiant ce libelle.
 * La vraie propriete est l'ABSENCE de `RIEN` — un `ok` seul reste accepte (une commande sans issue
 * metier n'en annonce aucune).
 */
const aAbouti = (ligne) => /: ok/.test(ligne) && !/RIEN/.test(ligne)
const avecAppel = resultats.filter((r) => r.appels.some(aAbouti)).length
const refus = resultats.reduce((n, r) => n + r.refusNatifs.length, 0)
console.log(`runs ou --mcp-config a ete passe : ${avecMcp}/${nbRuns}`)
console.log(`runs avec au moins un appel NATIF ok : ${avecAppel}/${nbRuns}`)
console.log(`refus « No such tool available » cumules : ${refus}`)
const depot = resultats[0]?.appels.some((a) => a.includes('remember') && aAbouti(a))
console.log(`depot remember par le chemin natif au run 1 : ${Boolean(depot)}`)
const vert = avecMcp === nbRuns && avecAppel === nbRuns && refus === 0
console.log(
  `
PREUVE ${vert ? 'VERTE' : 'ROUGE'} — mcp ${avecMcp}/${nbRuns}, natif ${avecAppel}/${nbRuns}, refus ${refus}`
)
process.exitCode = vert ? 0 : 1
