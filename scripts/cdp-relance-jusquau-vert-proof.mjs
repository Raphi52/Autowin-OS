import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'
import { choisirPortLibre } from './port-libre.mjs'

/**
 * PREUVE TERMINALE de la politique de relance, dans l'app REELLE.
 *
 * Ce que les tests unitaires prouvent : que les fonctions se comportent comme prevu. Ce qu'ils ne
 * prouvent PAS : que le process VIVANT les execute. Le bundle peut porter le correctif sans que le
 * process l'ait charge -- piege paye deux fois.
 *
 * L'ORACLE est la trace causale du run, jamais le compte rendu de l'agent. On cherche les lignes que
 * l'orchestrateur pousse LUI-MEME :
 *  - `[REPARATION n]` : la boucle a rejoue en reinjectant les raisons du gate ;
 *  - « aucune reparation : ... » : la politique a refuse, et elle DIT pourquoi ;
 *  - « plafond dur de N passage(s) atteint » : le garde-fou a mordu, et il le dit.
 *
 * GRATUITE ET AUTONOME DEPUIS LE 2026-09-07. Elle faisait travailler un vrai agent sur une tache
 * volontairement impossible : plusieurs minutes et un cout reel par passage, donc elle n'etait
 * jamais jouee. Pire, son en-tete l'avertissait -- l'agent ECRIVAIT dans le depot reel (mesure du
 * 2026-08-21). Elle joue maintenant le scenario `juge-rouge-puis-vert` de la fixture
 * d'orchestration : le pipeline reste le VRAI -- ses phases, ses juges, ses portes, sa politique de
 * relance -- seul l'appel au modele est ecrit d'avance, et toute ecriture a lieu dans un depot
 * JETABLE impose par `AUTOWIN_OS_WORKSPACE`.
 *
 * POURQUOI DEUX REFUS PUIS UN VERT : un run qui reussit du premier coup ne prouve rien sur ce qui se
 * passe quand il echoue. Deux refus font apparaitre `[REPARATION 1]` ET `[REPARATION 2]` -- donc une
 * boucle -- puis le vert montre sa sortie par le haut. Le profil `correctif` est impose : il accorde
 * des reparations, la ou `eclair` en refuse toute (mesure conv-1349 : on mesurait un refus de
 * politique en croyant mesurer une relance).
 *
 * Usage : node scripts/cdp-relance-jusquau-vert-proof.mjs [profil]
 */
const racine = racineDepot()
const instance = 'relance-jusquau-vert'
const base = join(racine, 'Audit', 'headless-instances', instance)
const depot = join(base, 'depot-jetable')
const traces = join(base, 'user-data', 'app-data', 'autowin-os', 'causal-trace')
const TACHE = '[[autowin-fixture-orchestration]] juge-rouge-puis-vert'
const PROFIL = process.argv[2] || 'correctif'

const binaire = join(racine, 'dist', 'win-unpacked', 'autowin-os.exe')
if (!existsSync(binaire)) {
  console.error(`[relance] binaire absent : ${binaire} - construis-le d abord.`)
  process.exit(2)
}

const port = choisirPortLibre(Number(process.env.AUTOWIN_RELANCE_PORT || 9294))
if (port === undefined) {
  console.error('[relance] aucun port libre - machine saturee.')
  process.exit(3)
}

/*
 * LE DEPOT JETABLE, REFAIT A NEUF. Le distant nu permet au run de publier sans joindre le reseau ;
 * le marqueur `.autowin-depot-jetable` est ce que le garde-fou de la fixture EXIGE avant d'ecrire.
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
  console.error(`[relance] instance non demarree :\n${demarrage.stderr || demarrage.stdout}`)
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

// L'interface doit etre MONTEE : le port repond avant que React ait pose quoi que ce soit.
for (let reste = 30_000; reste > 0; reste -= 300) {
  if (await ev(`Boolean(document.querySelector('[data-testid="nav-chat"]') && window.api)`)) break
  await pause(300)
}
console.log(`profil : ${PROFIL}`)
console.log(
  await ev(
    `(async () => JSON.stringify(await window.api.workflowProfileSelect(${JSON.stringify(PROFIL)})))()`
  )
)

const conv = await ev(
  `(async () => { const c = await window.api.conversationsCreate({ title: 'preuve relance jusquau vert', category: '', provider: 'claude' }); return c?.id ?? c })()`
)
console.log(`conversation : ${conv}`)
await ev(
  `(() => { window.api.orchestrate(${JSON.stringify(TACHE)}, ${JSON.stringify(conv)}); return true })()`
)

/*
 * LE DECOUPAGE DE LIGNES ET LE MARQUEUR DE REPARATION, POSES UNE FOIS.
 * Ce fichier melange des regex et des gabarits ; les reecrire a chaque usage est la porte d'entree
 * des coquilles d'echappement.
 */
const SAUTS_DE_LIGNE = /\r?\n/
const MARQUEUR_REPARATION = /\[R[EÉ]PARATION (\d+)\]/g
const SAUT = '\n'

/**
 * L'ORACLE, ETABLI SUR CE QUE LA TRACE PORTE VRAIMENT -- mesure du 2026-09-07.
 *
 * Ma premiere version ne comptait que les payloads de type `gate` ou `handoff`, courts et sans saut
 * de ligne. Elle a rendu ROUGE un mecanisme VERT : le run avait bien refuse deux fois puis valide,
 * mais `[REPARATION n]` n'est PAS une ligne de gate. C'est un CONTEXTE reinjecte dans le build
 * suivant (`pousserContexte('reparation:n', ...)`), donc un long payload de type `message` : le
 * filtre « court et sans saut de ligne » l'excluait par construction.
 *
 * On lit donc DEUX signaux, chacun a sa place :
 *  - les VERDICTS du juge (`type: 'verdict'`) : deux refus, c'est la sequence voulue ;
 *  - les reinjections `[REPARATION n]` dans le contexte pousse : la preuve que la boucle a REJOUE en
 *    redonnant au build les raisons du refus.
 *
 * LA CONTAMINATION EST ECARTEE A LA SOURCE, et autrement qu'avant : la reponse du modele est ECRITE
 * D'AVANCE par la fixture, donc aucun agent ne peut echo-er ces marqueurs -- c'est le scenario, pas
 * un filtre, qui rend l'oracle propre. On exclut malgre tout du comptage des reparations les
 * payloads qui PORTENT une sortie de modele (`model-response`, `verdict`).
 */
const evenements = () => {
  const chemin = join(traces, `${conv}.jsonl`)
  if (!existsSync(chemin)) return []
  const sorties = []
  for (const ligne of readFileSync(chemin, 'utf8').split(SAUTS_DE_LIGNE)) {
    if (!ligne) continue
    try {
      sorties.push(JSON.parse(ligne))
    } catch {
      continue
    }
  }
  return sorties
}

/*
 * ON ATTEND LA FIN DU RUN, pas la premiere ligne interessante.
 *
 * La version payante sortait des qu'une ligne de politique apparaissait, parce qu'un vrai run durait
 * plusieurs minutes. Ici le run est gratuit et court : on peut donc exiger la SEQUENCE ENTIERE --
 * deux refus, deux reparations, PUIS un statut final vert -- ce qui est bien plus fort qu'une ligne.
 */
let statut = 'en-cours'
const echeance = Date.now() + 240_000
while (Date.now() < echeance) {
  await pause(3000)
  statut = await ev(
    `(async () => { const c = await window.api.conversation(${JSON.stringify(conv)}); return (c.messages||[]).at(-1)?.status ?? 'en-cours' })()`
  )
  if (statut === 'completed' || statut === 'failed') break
}
const evts = evenements()
ws.close()
lanceur('Stop')

const contenus = (predicat) =>
  evts
    .filter(predicat)
    .flatMap((e) => (Array.isArray(e.payloads) ? e.payloads : []))
    .map((p) => (typeof p?.content === 'string' ? p.content : ''))
    .filter((c) => c.length > 0)

const refusDuJuge = contenus((e) => e.type === 'verdict').filter((c) => /^DEFAUT/i.test(c.trim()))
// Les NUMEROS de reparation, dedupliques : quatre reinjections du meme numero restent UNE reparation.
const numerosReparation = new Set(
  contenus((e) => e.type !== 'verdict' && e.type !== 'model-response')
    .flatMap((c) => [...c.matchAll(MARQUEUR_REPARATION)])
    .map((trouve) => Number(trouve[1]))
)
const lignesCourtes = contenus((e) => e.type === 'gate' || e.type === 'handoff').filter(
  (c) => c.length <= 220 && !SAUTS_DE_LIGNE.test(c.trim())
)
const refusPolitique = lignesCourtes.filter((l) => l.trim().startsWith('aucune réparation'))
const plafond = lignesCourtes.filter((l) => l.includes('plafond dur'))
const arretProgres = lignesCourtes.filter((l) => l.includes('hors de portée de build'))

console.log(SAUT + '=== CE QUE LA TRACE MONTRE ===')
console.log(`statut final         : ${statut}`)
console.log(`refus du juge        : ${refusDuJuge.length}`)
console.log(`reparations rejouees : ${[...numerosReparation].sort().join(', ') || 'aucune'}`)
for (const l of [...refusPolitique, ...plafond, ...arretProgres])
  console.log(`  . ${l.slice(0, 160)}`)

const echecs = []
if (statut !== 'completed')
  echecs.push(`le run s est termine en « ${statut} » au lieu de completed`)
// LE SUJET : le juge refuse DEUX fois, donc la boucle doit avoir rejoue DEUX fois. Moins, et la
// relance n'a pas eu lieu -- l'oracle serait vert sans avoir rien observe.
if (refusDuJuge.length < 2)
  echecs.push(`${refusDuJuge.length} refus du juge trace(s) au lieu des 2 attendus`)
if (numerosReparation.size < 2)
  echecs.push(`${numerosReparation.size} reparation(s) rejouee(s) au lieu des 2 attendues`)
if (plafond.length) echecs.push('le plafond dur a mordu, ce que ce scenario ne doit pas atteindre')
if (arretProgres.length) echecs.push(`la boucle s est arretee sur non-progres : ${arretProgres[0]}`)
if (refusPolitique.length)
  echecs.push(`la politique a refuse toute reparation : ${refusPolitique[0]}`)
if (erreursConsole.length)
  echecs.push(`${erreursConsole.length} erreur(s) JavaScript : ${erreursConsole[0]}`)

if (echecs.length) {
  console.error(SAUT + 'ECHEC :')
  for (const echec of echecs) console.error(`- ${echec}`)
  process.exit(1)
}
rmSync(base, { recursive: true, force: true })
console.log(
  SAUT +
    `OK - juge rouge ${refusDuJuge.length} fois, ${numerosReparation.size} reparations rejouees, run termine VERT, sans un centime.`
)
