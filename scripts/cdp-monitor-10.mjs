/**
 * MONITEUR « 1 PROMPT = 1 RÉUSSITE » — 10 essais, chacun isolé et vérifiable.
 *
 * Mandat de l'utilisateur le 2026-08-15 : « met tout ce qu'il faut en place pour monitorer et
 * atteint le 1 prompt une réussite, sur 10 essais 10 réussites ».
 *
 * Deux règles tirées d'erreurs commises le jour même, et non négociables ici :
 *
 *   1. ISOLATION — un fil NEUF par essai, un seul prompt dedans, supprimé après. Un harnais précédent
 *      tapait dans la conversation active de l'utilisateur et enchaînait deux prompts dans le même
 *      fil : le second héritait du premier, et ce report a été rapporté comme un défaut de l'app.
 *      C'était l'effet du harnais. Sans isolation, on mesure son propre passage.
 *
 *   2. VÉRITÉ TERRAIN — chaque essai porte une réponse attendue calculée HORS de l'application (par
 *      le système de fichiers). Sans elle on ne juge que le style : une sonde a déjà rendu « OK » sur
 *      « Je ne peux pas donner un nombre exact ». Le juge (`cdp-verdict.mjs`) refuse désormais les
 *      tours muets, les refus déclarés et les réponses fausses.
 *
 * Usage : node scripts/cdp-monitor-10.mjs [--port 9223] [--essais 10]
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { juger } from './cdp-verdict.mjs'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = arg('--port', '9223')
const nbEssais = Number(arg('--essais', '10'))
const sortie = resolve(arg('--out', 'Audit/cdp/monitor-10.json'))
/**
 * `--garder` : ne PAS supprimer les fils de sonde.
 *
 * Demande de l'utilisateur le 2026-08-15 : « je veux voir les 10 convers dans l'app, la je vois pas
 * tes tentatives ». La suppression automatique protegeait son historique, mais elle emportait aussi
 * la SEULE preuve qu'il pouvait inspecter lui-meme : il ne lui restait qu'un JSON et ma parole.
 * Une preuve qu'on ne peut pas regarder ne vaut pas grand-chose.
 */
const garder = process.argv.includes('--garder')
mkdirSync(dirname(sortie), { recursive: true })

// --- VÉRITÉS TERRAIN, calculées ici et jamais demandées à l'application -----------------------
const racine = process.cwd()
const compteFichiers = (dossier, filtre) =>
  readdirSync(join(racine, dossier)).filter(
    (nom) => filtre(nom) && statSync(join(racine, dossier, nom)).isFile()
  ).length
const compteDossiers = (dossier) =>
  readdirSync(join(racine, dossier)).filter((nom) =>
    statSync(join(racine, dossier, nom)).isDirectory()
  ).length

const ESSAIS = [
  {
    prompt:
      'Combien de fichiers dont le nom finit par .test.ts se trouvent DIRECTEMENT dans src/main (sans les sous-dossiers) ? Donne le nombre.',
    attendu: compteFichiers('src/main', (n) => n.endsWith('.test.ts'))
  },
  {
    prompt: 'Combien de sous-dossiers directs contient src/main ? Donne le nombre.',
    attendu: compteDossiers('src/main')
  },
  {
    prompt:
      'Combien de fichiers .ts (hors .test.ts) se trouvent DIRECTEMENT dans src/shared ? Donne le nombre.',
    attendu: compteFichiers('src/shared', (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
  },
  {
    prompt:
      'Combien de fichiers .mjs se trouvent DIRECTEMENT dans le dossier scripts ? Donne le nombre.',
    attendu: compteFichiers('scripts', (n) => n.endsWith('.mjs'))
  },
  {
    prompt:
      'Combien de fichiers .ps1 se trouvent DIRECTEMENT dans le dossier scripts ? Donne le nombre.',
    attendu: compteFichiers('scripts', (n) => n.endsWith('.ps1'))
  }
]

// --- Pilotage CDP ----------------------------------------------------------------------------
const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = cibles.find((c) => c.type === 'page')
if (!page) throw new Error(`Fenêtre Autowin introuvable sur ${port}`)
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = pend.get(m.id)
  if (!cb) return
  pend.delete(m.id)
  m.error ? cb.reject(new Error(m.error.message)) : cb.resolve(m.result)
}
await new Promise((r) => {
  ws.onopen = r
})
const rpc = (method, params = {}) =>
  new Promise((ok, ko) => {
    const i = ++id
    pend.set(i, { resolve: ok, reject: ko })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'refusé')
  return r.result?.value
}
const json = (valeur) => JSON.stringify(valeur)

const resultats = []
for (let n = 0; n < nbEssais; n++) {
  const essai = ESSAIS[n % ESSAIS.length]
  // Titre LISIBLE dans la liste des conversations : l'utilisateur doit reconnaitre la sonde et sa
  // question d'un coup d'oeil, pas dechiffrer un horodatage.
  const titre = garder
    ? `Sonde ${n + 1}/${nbEssais} — attendu ${essai.attendu}`
    : `__sonde-${Date.now()}-${n}`
  let convId
  try {
    const conv = await ev(
      `window.api.conversationsCreate({ title: ${json(titre)}, category: 'sonde', provider: 'claude' })`
    )
    convId = conv?.id
    if (!convId) throw new Error('création du fil refusée')
    const debut = Date.now()
    await ev(
      `window.api.pilotChat([{ role: 'user', content: ${json(essai.prompt)} }], ${json(convId)})`
    )
    const duree = Math.round((Date.now() - debut) / 1000)
    const fil = await ev(`window.api.conversation(${json(convId)})`)
    const reponse = [...(fil?.messages ?? [])].reverse().find((m) => m.role === 'assistant')
    const verdict = juger({
      contenu: reponse?.content,
      statut: reponse?.status,
      attendu: essai.attendu
    })
    resultats.push({ n: n + 1, duree, attendu: essai.attendu, ...verdict })
    console.log(
      `${verdict.ok ? '✔' : '✘'} essai ${n + 1}/${nbEssais} (${duree}s) — ${verdict.motif}`
    )
  } catch (erreur) {
    resultats.push({ n: n + 1, ok: false, motif: `sonde en erreur : ${erreur.message}` })
    console.log(`✘ essai ${n + 1}/${nbEssais} — sonde en erreur : ${erreur.message}`)
  } finally {
    // Nettoyage INCONDITIONNEL : un fil de sonde oublié fausserait la mesure suivante.
    if (convId && !garder)
      await ev(`window.api.conversationsRemove(${json(convId)})`).catch(() => {})
  }
}

const reussites = resultats.filter((r) => r.ok).length
writeFileSync(sortie, JSON.stringify({ port, reussites, total: nbEssais, resultats }, null, 2))
console.log(`\n${reussites}/${nbEssais} réussites → ${sortie}`)
ws.close()
process.exit(reussites === nbEssais ? 0 : 1)
