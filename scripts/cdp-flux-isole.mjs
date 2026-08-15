/**
 * SUIVRE UN FLUX DE BOUT EN BOUT, SANS SALIR NI FAUSSER.
 *
 * Ce script remplace un harnais précédent qui tapait ses prompts dans la conversation ACTIVE de
 * l'utilisateur. Deux dégâts mesurés le 2026-08-15 :
 *   · il écrivait dans ses vraies conversations, avec de vrais appels payants ;
 *   · il enchaînait deux prompts dans le MÊME fil, si bien que le second héritait du premier. Une
 *     contrainte posée au prompt 1 (« sans exécuter de commande ») a fait refuser le prompt 2, et ce
 *     refus a été rapporté comme un DÉFAUT de l'application. C'était l'effet du harnais lui-même.
 *
 * La règle appliquée ici, sans exception : UN FIL NEUF PAR ESSAI, UN SEUL PROMPT DEDANS, SUPPRIMÉ À
 * LA FIN. Sans isolation, on ne mesure pas l'application : on mesure son propre passage.
 *
 * Usage : node scripts/cdp-flux-isole.mjs --port 9223 --prompt "…" [--garder]
 */
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}
const port = arg('--port', '9223')
const prompt = arg('--prompt', 'Réponds simplement « prêt », sans exécuter de commande.')
const garder = process.argv.includes('--garder')

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

// 1) FIL NEUF. Son titre le désigne comme jetable : si un nettoyage échoue, il reste identifiable.
const titre = `__sonde-flux-${Date.now()}`
const conv = await ev(
  `window.api.conversationsCreate({ title: ${JSON.stringify(titre)}, category: 'sonde', provider: 'claude' })`
)
if (!conv?.id) throw new Error("création du fil de sonde refusée")
console.log(`fil de sonde : ${conv.id}`)

let verdict = { ok: false, raison: 'non conclu' }
try {
  // 2) UN SEUL prompt, envoyé au moteur — pas de frappe dans le composer de l'utilisateur.
  const debut = Date.now()
  const res = await ev(
    `window.api.pilotChat([{ role: 'user', content: ${JSON.stringify(prompt)} }], ${JSON.stringify(conv.id)})`
  )
  const duree = Math.round((Date.now() - debut) / 100) / 10

  // 3) On LIT ce que le fil contient réellement, plutôt que de croire le code de retour.
  const fil = await ev(`window.api.conversation(${JSON.stringify(conv.id)})`)
  const messages = fil?.messages ?? []
  const reponse = [...messages].reverse().find((m) => m.role === 'assistant')
  const texte = (reponse?.content ?? '').trim()
  // Un tour MUET ne porte que des étiquettes d'action : c'est le défaut mesuré à 20,2 % du magasin.
  const sansEtiquettes = texte.replace(/\[a exécuté[^\]]*\]/g, '').trim()

  console.log(`retour moteur : ok=${res?.ok} cancelled=${res?.cancelled} en ${duree}s`)
  console.log(`statut message: ${reponse?.status ?? 'aucun'}`)
  console.log(`texte utile   : ${sansEtiquettes ? JSON.stringify(sansEtiquettes.slice(0, 200)) : 'AUCUN (tour muet)'}`)

  verdict = sansEtiquettes
    ? { ok: true, raison: `réponse utile en ${duree}s`, duree, texte: sansEtiquettes.slice(0, 200) }
    : { ok: false, raison: 'TOUR MUET : aucune phrase, seulement des étiquettes d’action', duree }
} finally {
  // 4) NETTOYAGE inconditionnel : un fil de sonde laissé derrière pollue la mesure suivante.
  if (!garder) {
    const supprime = await ev(`window.api.conversationsRemove(${JSON.stringify(conv.id)})`)
    console.log(`fil de sonde supprimé : ${supprime}`)
  } else console.log('fil de sonde CONSERVÉ (--garder)')
  ws.close()
}

console.log(`\nVERDICT : ${verdict.ok ? 'OK' : 'ÉCHEC'} — ${verdict.raison}`)
process.exit(verdict.ok ? 0 : 1)
