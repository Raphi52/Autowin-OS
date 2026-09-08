/**
 * BANC DE GEL — capter, nommer, et repartir SANS fermer l'application.
 *
 * Boucle autonome : ouvre une vue, mesure si la fenetre repond, et si elle est morte, ATTEND la
 * reanimation automatique du processus principal (src/main/gel-reanimation.ts) au lieu d'exiger un
 * redemarrage complet. Rend un verdict chiffre et le motif lu dans le journal des gels.
 *
 * Usage : node scripts/banc-gel.mjs <vue> [essais]     ex. node scripts/banc-gel.mjs knowledge 3
 */
import { readFileSync, existsSync } from 'node:fs'
import { WebSocket } from 'ws'

const vue = process.argv[2] ?? 'knowledge'
const essais = Number(process.argv[3] ?? 3)
const JOURNAL = '.autowin-data/autowin-os/gels.jsonl'
const lirePort = () =>
  readFileSync('.autowin-data/autowin-os/DevToolsActivePort', 'utf8').split('\n')[0].trim()

const lignesJournal = () =>
  existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean) : []

async function session() {
  const liste = await (await fetch(`http://127.0.0.1:${lirePort()}/json/list`)).json()
  const page = liste.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('aucune page ouverte')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const attentes = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    const a = attentes.get(m.id)
    if (a) {
      attentes.delete(m.id)
      a(m)
    }
  })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  return {
    evaluer: (expression, plafondMs = 10_000) =>
      Promise.race([
        new Promise((res) => {
          const n = ++id
          attentes.set(n, res)
          ws.send(
            JSON.stringify({
              id: n,
              method: 'Runtime.evaluate',
              params: { expression, awaitPromise: true, returnByValue: true }
            })
          )
        }).then((m) => m.result?.result?.value),
        new Promise((res) => setTimeout(() => res('__MUET__'), plafondMs))
      ]),
    fermer: () => ws.close()
  }
}

const IMAGES = `new Promise(res=>{let n=0;const t=performance.now();const b=()=>{n++;performance.now()-t<3000?requestAnimationFrame(b):res(n)};requestAnimationFrame(b)})`
const OUVRIR = (nom) =>
  `(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>new RegExp(${JSON.stringify(nom)},'i').test(x.textContent||'')); if(b){b.click(); return 'ouvert'} return 'introuvable'})()`

async function unEssai(numero) {
  const repere = lignesJournal().length
  const s = await session()
  await s.evaluer(OUVRIR(vue), 8000)
  await new Promise((r) => setTimeout(r, 20_000))
  // LA VIE D'ABORD, la fluidite ensuite : `requestAnimationFrame` est SUSPENDU quand la page est
  // cachee, donc l'absence d'images ne prouve RIEN. Seule une evaluation triviale sans reponse
  // etablit un gel (mesure du 2026-09-08 : deux verdicts de gel etaient des pages simplement
  // cachees, la fenetre repondait instantanement).
  const vie = await s.evaluer('({t:Date.now(),visibilite:document.visibilityState})', 8000)
  const repond = vie !== '__MUET__'
  const visibilite = repond ? vie.visibilite : undefined
  const images = repond && visibilite === 'visible' ? await s.evaluer(IMAGES, 9000) : undefined
  s.fermer()
  if (repond && visibilite !== 'visible') {
    console.log(`essai ${numero} : VIVANTE (page cachée — fluidité non mesurable)`)
    return { gel: false, nonMesurable: true }
  }
  if (repond) {
    console.log(
      `essai ${numero} : VIVANTE — ${images === '__MUET__' ? 'images non rendues' : `${images} images en 3 s`}`
    )
    return { gel: false }
  }
  console.log(`essai ${numero} : GEL détecté — la fenêtre ne répond plus`)
  // On attend la réanimation automatique plutôt que d'exiger un redémarrage de l'application.
  for (let attente = 0; attente < 12; attente++) {
    await new Promise((r) => setTimeout(r, 5_000))
    const nouvelles = lignesJournal()
      .slice(repere)
      .map((ligne) => {
        try {
          return JSON.parse(ligne)
        } catch {
          return null
        }
      })
      .filter(Boolean)
    const reanimee = nouvelles.find((g) => g.operation === 'renderer:fenetre-reanimee')
    if (reanimee) {
      console.log(
        `  réanimée automatiquement après ${reanimee.blocageMs} ms — application NON fermée`
      )
      return { gel: true, reanimee: true, blocageMs: reanimee.blocageMs }
    }
  }
  console.log('  aucune réanimation observée dans la minute')
  return { gel: true, reanimee: false }
}

const resultats = []
for (let n = 1; n <= essais; n++) resultats.push(await unEssai(n))
const gels = resultats.filter((r) => r.gel).length
console.log(
  `\nVERDICT : ${gels}/${essais} gel(s) — réanimations réussies : ${resultats.filter((r) => r.reanimee).length}`
)
process.exit(gels > 0 ? 1 : 0)
