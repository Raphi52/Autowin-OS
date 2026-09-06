import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'
import { choisirPortLibre } from './port-libre.mjs'

/**
 * PREUVE HORS-MODÈLE de la demande de l'utilisateur : « lancer 3 convers sur la même chose, pas
 * d'erreur avant de se lancer au travail, pas de workspace orphelin à la fin ».
 *
 * GRATUITE DEPUIS LE 2026-09-06. Elle lançait trois VRAIS pipelines, avec de vrais agents qui
 * écrivaient dans le dépôt : plusieurs minutes et un coût réel à chaque passage, donc elle n'était
 * jamais jouée. Elle joue maintenant le scénario `nominal` de la fixture d'orchestration — le
 * pipeline reste le VRAI, seul l'appel au modèle est écrit d'avance.
 *
 * ELLE EST AUTONOME. Elle crée son dépôt jetable, démarre sa propre instance isolée en le lui
 * imposant par `AUTOWIN_OS_WORKSPACE`, joue, puis arrête et nettoie. Deux raisons : son plan de
 * travail ne doit surtout pas être le dépôt réel, et la concurrence qu'elle mesure ne supporte pas
 * de partager son instance avec d'autres sondes.
 *
 * ELLE REND UN VERDICT. Avant, elle imprimait un état à 8 secondes et sortait zéro quoi qu'elle
 * observe : elle ne pouvait pas rougir, donc elle ne protégeait de rien.
 */
const racine = racineDepot()
const instance = 'trois-conversations'
const base = join(racine, 'Audit', 'headless-instances', instance)
const depot = join(base, 'depot-jetable')
const TACHE = '[[autowin-fixture-orchestration]] nominal'

const binaire = join(racine, 'dist', 'win-unpacked', 'autowin-os.exe')
if (!existsSync(binaire)) {
  console.error(`[trois-conversations] binaire absent : ${binaire} — construis-le d abord.`)
  process.exit(2)
}

const port = choisirPortLibre(Number(process.env.AUTOWIN_TROIS_PORT || 9290))
if (port === undefined) {
  console.error('[trois-conversations] aucun port libre — machine saturée.')
  process.exit(3)
}

/*
 * LE DÉPÔT JETABLE, REFAIT À NEUF : une mesure de concurrence ne doit rien hériter du passage
 * précédent. Le distant nu permet au run de publier sans jamais joindre le réseau.
 */
rmSync(base, { recursive: true, force: true })
mkdirSync(depot, { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: depot, stdio: 'ignore' })
git('init', '-b', 'main')
git('config', 'user.email', 'fixture@autowin.local')
git('config', 'user.name', 'Fixture Orchestration')
writeFileSync(join(depot, '.autowin-depot-jetable'), 'jetable\n', 'utf8')
writeFileSync(join(depot, 'README.md'), '# Depot jetable\n', 'utf8')
git('add', '-A')
git('commit', '-m', 'base du depot jetable')
const distant = `${depot}-origin.git`
mkdirSync(distant, { recursive: true })
execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: distant, stdio: 'ignore' })
git('remote', 'add', 'origin', distant)
git('push', '-u', 'origin', 'main')

const lanceur = (action) =>
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(racine, 'scripts', 'autowin-headless.ps1'),
      '-Action',
      action,
      '-InstanceId',
      instance,
      '-Port',
      String(port)
    ],
    { cwd: racine, encoding: 'utf8', env: { ...process.env, AUTOWIN_OS_WORKSPACE: depot } }
  )

lanceur('Stop')
const demarrage = lanceur('Start')
if (demarrage.status !== 0) {
  console.error(
    `[trois-conversations] instance non démarrée :\n${demarrage.stderr || demarrage.stdout}`
  )
  process.exit(1)
}

const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = cibles.find((cible) => cible.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const erreursConsole = []
ws.onmessage = (message) => {
  const m = JSON.parse(message.data)
  if (m.method === 'Runtime.exceptionThrown')
    erreursConsole.push(
      String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200)
    )
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails)
    throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Runtime.enable')

// L'interface doit être MONTÉE : le port répond avant que React ait posé quoi que ce soit.
for (let reste = 30_000; reste > 0; reste -= 300) {
  if (await ev(`Boolean(document.querySelector('[data-testid="nav-chat"]') && window.api)`)) break
  await pause(300)
}
await ev(`window.api.workflowProfileSelect('eclair')`)

const ids = []
for (const nom of ['preuve-1', 'preuve-2', 'preuve-3'])
  ids.push(
    await ev(
      // L'API prend un OBJET, plus une chaine : la version d'avant passait `nom` seul et mourait sur
      // « IPC title: string attendue ». Encore un appel perime, la famille de defauts de la journee.
      `(async () => { const c = await window.api.conversationsCreate({ title: ${JSON.stringify(nom)}, category: '', provider: 'claude' }); return c?.id ?? c })()`
    )
  )
console.log('CONVERSATIONS', JSON.stringify(ids))

// Les trois partent sur LA MÊME CHOSE, sans attendre les unes les autres : c'est le sujet.
for (const cid of ids)
  await ev(
    `(() => { window.api.orchestrate(${JSON.stringify(TACHE)}, ${JSON.stringify(cid)}); return true })()`
  )
console.log('LANCEES', new Date().toISOString())

const etatsFinaux = {}
const echeance = Date.now() + 180_000
while (Date.now() < echeance) {
  await pause(3000)
  for (const cid of ids) {
    if (etatsFinaux[cid]) continue
    const statut = await ev(
      `(async () => { const c = await window.api.conversation(${JSON.stringify(cid)}); return (c.messages||[]).at(-1)?.status ?? 'en-cours' })()`
    )
    if (statut === 'completed' || statut === 'failed') etatsFinaux[cid] = statut
  }
  if (Object.keys(etatsFinaux).length === ids.length) break
}
console.log('ETATS_FINAUX', JSON.stringify(etatsFinaux))

// LE SUJET : après la fin des trois, aucun bureau ne doit rester en attente d'attention.
await pause(3000)
const activite = await ev(
  `(async () => { const a = await window.api.getWorktreeActivity(); return (a||[]).map(x => ({ id: x.agentId, s: x.state, p: x.publication, r: x.attentionReason })) })()`
)
console.log('ACTIVITE_FINALE', JSON.stringify(activite))
ws.close()
lanceur('Stop')

const echecs = []
const termines = Object.entries(etatsFinaux)
if (termines.length !== ids.length)
  echecs.push(`${ids.length - termines.length} run(s) jamais terminé(s) en 180 s`)
for (const [cid, statut] of termines)
  if (statut !== 'completed') echecs.push(`${cid} s est terminé en « ${statut} »`)
if (erreursConsole.length)
  echecs.push(`${erreursConsole.length} erreur(s) JavaScript : ${erreursConsole[0]}`)
const orphelins = activite.filter((bureau) => bureau.r)
if (orphelins.length)
  echecs.push(`bureau(x) orphelin(s) après les trois runs : ${JSON.stringify(orphelins)}`)

if (echecs.length) {
  console.error('\nECHEC :')
  for (const echec of echecs) console.error(`- ${echec}`)
  process.exit(1)
}
rmSync(base, { recursive: true, force: true })
console.log('\nOK — trois runs concurrents terminés, sans erreur au lancement ni bureau orphelin.')
