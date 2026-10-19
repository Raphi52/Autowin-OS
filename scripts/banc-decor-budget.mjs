#!/usr/bin/env node
/**
 * banc-decor-budget — LE BUDGET 3D DU FOND D'ACCUEIL, mesuré dans la vraie app et tenu par des seuils.
 *
 * POURQUOI (conv-337, 2026-10-18). Les lots de halos (conv-323) avaient fait baisser le nombre de
 * dessins par image ; trois jours d'ajouts plus tard (vaisseau, anneaux, voitures), une sonde de
 * scout en a recompté 1 868 à 1 881 — le niveau d'AVANT les lots. Aucun outil ne l'avait vu
 * remonter : un gain de performance qui n'est pas tenu par une mesure répétable s'efface en
 * silence. Ce banc rend cette mesure répétable et la compare à des seuils VERSIONNÉS
 * (`banc-decor-budget.seuils.json`) : il échoue dès que le décor dépasse son budget.
 *
 * CE QU'IL MESURE, sans rien modifier au code de l'app (espion posé par CDP dans le fil du décor,
 * `decor-avenue.worker.ts`, attaché par `Target.setAutoAttach` en mode `flatten`) :
 *   1. LE DÉMARRAGE — les repères `decor-avenue:*` que le décor recopie dans la page : création de
 *      la scène, rue compilée, rue visible, reflet prêt, foule visible ; et les tâches longues du
 *      fil de l'interface pendant ce temps ;
 *   2. LE RÉGIME ÉTABLI, image par image : dessins (`draw*`), changements de programme
 *      (`useProgram`), triangles, et la part du REFLET (tout ce qui est dessiné hors de l'écran,
 *      `bindFramebuffer` vers une image à part) ; le temps du fil du décor par image ; le temps de
 *      la CARTE GRAPHIQUE par image (`EXT_disjoint_timer_query_webgl2`, quand le pilote l'expose) ;
 *   3. LE RETOUR SUR L'ACCUEIL — un clic vers le Chat puis vers l'Accueil : délai entre le clic et
 *      la première image qui dessine quelque chose, et nombre d'images dessinées PENDANT l'absence
 *      (le fond ne doit rien dessiner hors de l'Accueil — choix de l'utilisateur, App.tsx).
 *
 * CADENCE : l'instance cachée ne produit qu'environ une image par seconde, faute d'écran qui la
 * compose (note Brain « Instance cachée d'Autowin : ~1 image/s »). Le banc lance donc un
 * screencast CDP pendant toute la mesure : il remet la page à 40-57 images/s, donc le décor à sa
 * cadence réelle (30 images/s, `decor-cadence.ts`). Sans lui, le délai de retour serait faussé
 * jusqu'à 1 s.
 *
 * Usage :
 *   node scripts/avec-instance-headless.mjs --code-dev --instance-id <id> -- \
 *     node --experimental-websocket scripts/banc-decor-budget.mjs [--images 60] \
 *     [--seuils scripts/banc-decor-budget.seuils.json] [--sortie <fichier.json>] \
 *     [--capture <fichier.png>] [--sans-retour]
 * (`avec-instance-headless` ajoute lui-même `--port`.)
 *
 * Sortie : 0 = budget tenu ; 1 = au moins un seuil dépassé (listés) ; 2 = mesure impossible.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
export const SEUILS_PAR_DEFAUT = path.join(ICI, 'banc-decor-budget.seuils.json')

/* ------------------------------------------------------------------------------------------- *
 * Partie PURE (testée par banc-decor-budget.test.mjs)
 * ------------------------------------------------------------------------------------------- */

/** Médiane, centile 95, moyenne, minimum et maximum d'une série ; `null` si elle est vide. */
export function statistiques(valeurs) {
  const v = valeurs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const rang = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
  const somme = v.reduce((s, x) => s + x, 0)
  return {
    n: v.length,
    moyenne: arrondir(somme / v.length),
    mediane: arrondir(rang(0.5)),
    p95: arrondir(rang(0.95)),
    min: arrondir(v[0]),
    max: arrondir(v[v.length - 1])
  }
}

const arrondir = (x) => Math.round(x * 10) / 10

/**
 * Résume les images relevées par l'espion. Une image sans aucun dessin (la rue pas encore compilée)
 * n'entre pas dans le régime établi.
 */
export function resumerImages(images) {
  const pleines = images.filter((i) => i.dessins > 0)
  const champ = (cle) => statistiques(pleines.map((i) => i[cle]))
  return {
    images: pleines.length,
    dessins: champ('dessins'),
    dessinsReflet: champ('dessinsReflet'),
    programmes: champ('programmes'),
    programmesReflet: champ('programmesReflet'),
    triangles: champ('triangles'),
    msFilDuDecor: champ('ms'),
    msCarteGraphique: champ('gpu'),
    imagesAvecReflet: pleines.filter((i) => i.dessinsReflet > 0).length,
    ...regulariteAffichage(pleines)
  }
}

/**
 * LA RÉGULARITÉ DES IMAGES (conv-347, « pas assez lissé ») : une image s'affiche à la fin de la tâche
 * qui la dessine (`finEcran`, la passe écran). Des écarts qui alternent 33 / 67 ms se voient, même à
 * cadence moyenne correcte. `regularite` = part des écarts à moins de 8 ms (un demi-battement 60 Hz)
 * de l'écart médian. Limite : dans l'instance cachée, le screencast cadence la page à 40-57 images/s,
 * pas 60 — les battements y sont eux-mêmes irréguliers, la mesure y reste donc pessimiste.
 */
export function regulariteAffichage(images) {
  const fins = images.map((i) => i.finEcran ?? i.fin).filter((t) => typeof t === 'number')
  const ecarts = fins.slice(1).map((t, k) => t - fins[k])
  const stats = statistiques(ecarts)
  if (!stats) return { ecartsAffichage: null, regulariteAffichage: null }
  const proches = ecarts.filter((x) => Math.abs(x - stats.mediane) <= 8).length
  return {
    ecartsAffichage: stats,
    regulariteAffichage: Math.round((100 * proches) / ecarts.length) / 100
  }
}

/**
 * Range les dessins relevés par paire (passe, programme, géométrie liée) : moyenne par image, triée
 * par nombre de dessins. `images` = liste de `{ "R:prog:vao": [dessins, triangles] }`.
 * Rend les paires les plus dessinées et, par programme, le nombre de géométries distinctes.
 */
export function analyserPaires(images, noms, limite = 25) {
  const n = images.length || 1
  const total = new Map()
  for (const img of images)
    for (const [cle, [d, t]] of Object.entries(img)) {
      const e = total.get(cle) ?? [0, 0]
      e[0] += d
      e[1] += t
      total.set(cle, e)
    }
  const paires = [...total].map(([cle, [d, t]]) => {
    const [passe, prog, vao] = cle.split(':')
    return {
      passe: passe === 'R' ? 'reflet' : 'ecran',
      programme: Number(prog),
      geometrie: Number(vao),
      dessins: arrondir(d / n),
      triangles: Math.round(t / n),
      nom: noms.get(Number(prog)) ?? '?'
    }
  })
  paires.sort((a, b) => b.dessins - a.dessins)
  const parProgramme = new Map()
  for (const p of paires) {
    const cle = `${p.passe}:${p.programme}`
    const e = parProgramme.get(cle) ?? {
      passe: p.passe,
      programme: p.programme,
      nom: p.nom,
      dessins: 0,
      geometries: 0
    }
    e.dessins = arrondir(e.dessins + p.dessins)
    e.geometries++
    parProgramme.set(cle, e)
  }
  return {
    images: images.length,
    paires: paires.slice(0, limite),
    programmes: [...parProgramme.values()].sort((a, b) => b.dessins - a.dessins).slice(0, limite)
  }
}

/** Le délai (ms) entre deux repères `decor-avenue:*` ; `null` si l'un manque. */
export function delai(reperes, de, a) {
  if (typeof reperes[de] !== 'number' || typeof reperes[a] !== 'number') return null
  return arrondir(reperes[a] - reperes[de])
}

/**
 * Lit une valeur de la mesure par un chemin pointé (`regime.dessins.moyenne`).
 * Rend `undefined` si le chemin n'existe pas.
 */
export function lire(mesure, chemin) {
  return chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), mesure)
}

/**
 * Compare la mesure aux seuils. Chaque seuil = `{ "chemin": "...", "max": n }` ou `{ ..., "min": n }`.
 * Une valeur absente (`null`, extension GPU non exposée…) est NOMMÉE dans `absents` et ne fait pas
 * échouer, SAUF si le seuil porte `"requis": true` : une mesure qu'on exige ne peut pas manquer.
 */
export function evaluerSeuils(mesure, seuils) {
  const depasses = []
  const absents = []
  const tenus = []
  for (const s of seuils) {
    const v = lire(mesure, s.chemin)
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      if (s.requis) depasses.push({ ...s, valeur: v ?? null, raison: 'mesure absente' })
      else absents.push(s.chemin)
      continue
    }
    if (typeof s.max === 'number' && v > s.max)
      depasses.push({ ...s, valeur: v, raison: `> ${s.max}` })
    else if (typeof s.min === 'number' && v < s.min)
      depasses.push({ ...s, valeur: v, raison: `< ${s.min}` })
    else tenus.push({ chemin: s.chemin, valeur: v })
  }
  return { ok: depasses.length === 0, depasses, absents, tenus }
}

/* ------------------------------------------------------------------------------------------- *
 * L'ESPION, posé dans le fil du décor. Texte évalué tel quel par `Runtime.evaluate`.
 *
 * Il délimite chaque image par le message `image` que la page envoie au fil du décor : il enrobe
 * `self.onmessage` (ou s'intercale avant que le module ne le pose, si le fil vient de naître). Tout
 * ce que three dessine pendant le traitement de ce message appartient à cette image.
 * ------------------------------------------------------------------------------------------- */
export const ESPION = `(() => {
  if (globalThis.__banc) return 'deja'
  const B = (globalThis.__banc = { images: [], courante: null, gl: null, ext: undefined, attente: [], horsEcran: false })
  const maintenant = () => performance.timeOrigin + performance.now()
  const P = WebGL2RenderingContext.prototype
  const surDessin = (gl, triangles) => {
    relevePaire(gl, triangles)
    if (B.gl === null) {
      B.gl = gl
      B.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null
    }
    const c = B.courante
    if (!c) return
    c.dessins++
    c.triangles += triangles
    if (B.horsEcran) { c.dessinsReflet++; c.trianglesReflet += triangles }
  }
  const TRI = 4
  // ANALYSE (option --analyse) : chaque dessin est rangé par (programme, géométrie liée). Une même
  // paire dessinée N fois dans une image = N objets identiques dessinés un par un (candidats aux
  // instances) ; un même programme sur de nombreuses géométries = candidats au regroupement.
  const ids = new WeakMap()
  let suivant = 1
  const idDe = (o) => { if (!o) return 0; let i = ids.get(o); if (!i) { i = suivant++; ids.set(o, i) } return i }
  let progCourant = null, vaoCourant = null
  B.noms = new Map()
  const nomDe = (gl, prog) => {
    const i = idDe(prog)
    if (!B.noms.has(i)) {
      let nom = '?'
      try {
        const sh = gl.getAttachedShaders(prog) || []
        const src = sh.map((x) => gl.getShaderSource(x) || '').join(String.fromCharCode(10))
        const m = src.match(new RegExp('#define SHADER_NAME ([^' + String.fromCharCode(10) + ']+)'))
        const corps = src.slice(src.lastIndexOf('void main')).split(String.fromCharCode(10)).join(' ').slice(0, 90)
        nom = (m ? m[1] : 'brut') + ' | ' + corps
      } catch {}
      B.noms.set(i, nom)
    }
    return i
  }
  const oVao = P.bindVertexArray
  P.bindVertexArray = function (v) { vaoCourant = v; return oVao.apply(this, arguments) }
  const relevePaire = (gl, triangles) => {
    const c = B.courante
    if (!c || !c.paires) return
    const cle = (B.horsEcran ? 'R' : 'E') + ':' + nomDe(gl, progCourant) + ':' + idDe(vaoCourant)
    const e = c.paires[cle] || (c.paires[cle] = [0, 0])
    e[0]++
    e[1] += triangles
  }
  const o1 = P.drawElements
  P.drawElements = function (mode, n) { surDessin(this, mode === TRI ? n / 3 : 0); return o1.apply(this, arguments) }
  const o2 = P.drawArrays
  P.drawArrays = function (mode, f, n) { surDessin(this, mode === TRI ? n / 3 : 0); return o2.apply(this, arguments) }
  const o3 = P.drawElementsInstanced
  P.drawElementsInstanced = function (mode, n, t, o, k) { surDessin(this, mode === TRI ? (n / 3) * k : 0); return o3.apply(this, arguments) }
  const o4 = P.drawArraysInstanced
  P.drawArraysInstanced = function (mode, f, n, k) { surDessin(this, mode === TRI ? (n / 3) * k : 0); return o4.apply(this, arguments) }
  const o5 = P.useProgram
  P.useProgram = function (prog) {
    progCourant = prog
    const c = B.courante
    if (c) { c.programmes++; if (B.horsEcran) c.programmesReflet++ }
    return o5.apply(this, arguments)
  }
  const o6 = P.bindFramebuffer
  P.bindFramebuffer = function (cible, fb) {
    if (cible === this.FRAMEBUFFER || cible === this.DRAW_FRAMEBUFFER) B.horsEcran = !!fb
    return o6.apply(this, arguments)
  }
  const relever = () => {
    const gl = B.gl, ext = B.ext
    if (!gl || !ext) return
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
    B.attente = B.attente.filter(([q, img]) => {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true
      // une image peut porter deux mesures (passe écran, puis son reflet) : elles s'additionnent
      if (!disjoint) img.gpu = (img.gpu ?? 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
      gl.deleteQuery(q)
      return false
    })
  }
  const enrober = (f) => function (e) {
    // LE REFLET APRÈS L'IMAGE (conv-347) : le Worker le dessine dans la tâche qui SUIT l'image, par
    // ce même point d'entrée. Il est compté avec son image (dessins, temps), sinon le banc verrait un
    // faux gain ; finEcran garde la fin de la passe écran, quand l'image s'affiche.
    if (e && e.data && e.data.type === 'reflet') {
      const img = B.images[B.images.length - 1]
      if (!img) return f.call(this, e)
      B.courante = img
      B.horsEcran = false
      let q = null
      if (B.gl && B.ext) { q = B.gl.createQuery(); B.gl.beginQuery(B.ext.TIME_ELAPSED_EXT, q) }
      const t0 = performance.now()
      try {
        return f.call(this, e)
      } finally {
        img.ms += performance.now() - t0
        img.fin = maintenant()
        if (q) { B.gl.endQuery(B.ext.TIME_ELAPSED_EXT); B.attente.push([q, img]) }
        B.courante = null
        relever()
      }
    }
    if (!e || !e.data || e.data.type !== 'image') return f.call(this, e)
    const img = { debut: maintenant(), fin: 0, ms: 0, gpu: null, dessins: 0, dessinsReflet: 0, programmes: 0, programmesReflet: 0, triangles: 0, trianglesReflet: 0, paires: B.analyse ? {} : null }
    if (B.tempsFige !== undefined && e.data) e.data.temps = B.tempsFige
    if (B.tempsFige !== undefined && e.data) e.data.regard = { x: 0, y: 0 }
    B.courante = img
    B.horsEcran = false
    let q = null
    if (B.gl && B.ext) { q = B.gl.createQuery(); B.gl.beginQuery(B.ext.TIME_ELAPSED_EXT, q) }
    const t0 = performance.now()
    try {
      return f.call(this, e)
    } finally {
      img.ms = performance.now() - t0
      img.fin = maintenant()
      img.finEcran = img.fin
      if (q) { B.gl.endQuery(B.ext.TIME_ELAPSED_EXT); B.attente.push([q, img]) }
      B.courante = null
      B.images.push(img)
      if (B.images.length > 2000) B.images.shift()
      relever()
    }
  }
  // Sur l'objet global d'un Worker, les attributs IDL vivent sur l'objet LUI-MÊME (interface
  // [Global]), pas sur son prototype : la recherche part donc de self.
  let desc = null
  for (let p = self; p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, 'onmessage')
  if (self.onmessage) self.onmessage = enrober(self.onmessage)
  if (desc && desc.set) {
    Object.defineProperty(self, 'onmessage', {
      configurable: true,
      get() { return desc.get.call(self) },
      set(f) { desc.set.call(self, typeof f === 'function' ? enrober(f) : f) }
    })
  }
  return 'pose'
})()`

/* ------------------------------------------------------------------------------------------- *
 * Partie CDP
 * ------------------------------------------------------------------------------------------- */

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

function argument(nom, defaut) {
  const i = process.argv.indexOf(nom)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : defaut
}

async function connecter(port) {
  const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = liste.find((t) => t.type === 'page' && !String(t.url).startsWith('devtools'))
  if (!page) throw new Error(`aucune page sur le port ${port}`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, ko) => {
    ws.onopen = ok
    ws.onerror = () => ko(new Error('connexion CDP refusée'))
  })
  let id = 0
  const enAttente = new Map()
  const ecouteurs = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && enAttente.has(m.id)) {
      enAttente.get(m.id)(m)
      enAttente.delete(m.id)
      return
    }
    for (const f of ecouteurs) f(m)
  }
  const envoyer = (method, params = {}, sessionId) =>
    new Promise((ok) => {
      const n = ++id
      enAttente.set(n, ok)
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const evaluer = async (expression, sessionId) => {
    const m = await envoyer(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId
    )
    if (m.error) throw new Error(`${expression.slice(0, 60)}… : ${m.error.message}`)
    if (m.result?.exceptionDetails)
      throw new Error(
        `${expression.slice(0, 60)}… : ${m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text}`
      )
    return m.result?.result?.value
  }
  return { ws, envoyer, evaluer, ecouter: (f) => ecouteurs.push(f) }
}

const LIRE_REPERES = `JSON.stringify(Object.fromEntries(performance.getEntriesByType('mark')
  .filter((m) => m.name.startsWith('decor-avenue:'))
  .map((m) => [m.name.slice('decor-avenue:'.length), performance.timeOrigin + m.startTime])))`

/** Lit les images de l'espion (temps absolus), sans les retirer. */
const LIRE_IMAGES = `JSON.stringify(globalThis.__banc ? globalThis.__banc.images : null)`

async function main() {
  const port = Number(argument('--port'))
  const nbImages = Number(argument('--images', '60'))
  const fichierSeuils = argument('--seuils', SEUILS_PAR_DEFAUT)
  const sortie = argument('--sortie')
  const capture = argument('--capture')
  const avecRetour = !process.argv.includes('--sans-retour')
  const avecAnalyse = process.argv.includes('--analyse')
  const captureFige = argument('--capture-fige')
  const tempsFige = argument('--temps-fige', '40')
  if (!Number.isInteger(port)) {
    console.error('--port manquant (lancer par scripts/avec-instance-headless.mjs)')
    return 2
  }
  const cdp = await connecter(port)

  // Les tâches longues du fil de l'interface, depuis le chargement (entrées mises en mémoire).
  await cdp.evaluer(`(() => {
    globalThis.__bancLongues = []
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__bancLongues.push([performance.timeOrigin + e.startTime, e.duration]) })
        .observe({ type: 'longtask', buffered: true })
    } catch {}
    return true
  })()`)

  // Le screencast remet la page à sa cadence réelle (voir l'en-tête).
  cdp.ecouter((m) => {
    if (m.method === 'Page.screencastFrame')
      void cdp.envoyer('Page.screencastFrameAck', { sessionId: m.params.sessionId })
  })
  await cdp.envoyer('Page.enable')
  await cdp.envoyer('Page.startScreencast', {
    format: 'jpeg',
    quality: 10,
    maxWidth: 320,
    everyNthFrame: 1
  })
  // UN UTILISATEUR PRÉSENT : l'instance cachée n'a jamais le focus, et personne n'y bouge la souris ;
  // le décor y passerait à sa cadence de repos (decor-cadence.ts). Le régime établi se mesure fenêtre
  // active, souris qui bouge ; le repos se mesure à part, à la fin.
  await cdp.envoyer('Emulation.setFocusEmulationEnabled', { enabled: true })
  let k = 0
  const pompe = setInterval(() => {
    k++
    void cdp.envoyer('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 500 + 40 * Math.sin(k),
      y: 400 + 30 * Math.cos(k)
    })
  }, 1000)

  // 1. LE DÉMARRAGE : attendre la foule (fin du chargement du décor).
  const debut = Date.now()
  let reperes = {}
  while (Date.now() - debut < 180_000) {
    reperes = JSON.parse(await cdp.evaluer(LIRE_REPERES))
    if (reperes['foule-visible'] && reperes['rue-visible']) break
    await attendre(500)
  }
  if (!reperes['rue-visible']) {
    console.error('le décor avenue ne s’est pas affiché en 180 s :', JSON.stringify(reperes))
    return 2
  }
  const origine = await cdp.evaluer('performance.timeOrigin')
  const longues = JSON.parse(await cdp.evaluer('JSON.stringify(globalThis.__bancLongues)'))
  const finDemarrage = (reperes['foule-visible'] ?? reperes['rue-visible']) + 1000
  const longuesDemarrage = longues.filter(([t]) => t <= finDemarrage).map(([, d]) => d)
  const demarrage = {
    pageVersCreeMs: delai({ ...reperes, page: origine }, 'page', 'cree'),
    creeVersRueCompileeMs: delai(reperes, 'cree', 'rue-compilee'),
    creeVersRueVisibleMs: delai(reperes, 'cree', 'rue-visible'),
    creeVersRefletPretMs: delai(reperes, 'cree', 'reflet-pret'),
    creeVersFouleVisibleMs: delai(reperes, 'cree', 'foule-visible'),
    tachesLonguesInterface: {
      nombre: longuesDemarrage.length,
      maxMs: longuesDemarrage.length ? arrondir(Math.max(...longuesDemarrage)) : 0,
      totalMs: arrondir(longuesDemarrage.reduce((s, d) => s + d, 0))
    }
  }

  // 2. LE RÉGIME ÉTABLI : l'espion dans le fil du décor (et dans tout fil qui naîtra ensuite).
  const fils = new Map()
  cdp.ecouter((m) => {
    if (m.method !== 'Target.attachedToTarget') return
    const { sessionId, targetInfo, waitingForDebugger } = m.params
    const duDecor = /decor-avenue/.test(targetInfo.url)
    if (duDecor) fils.set(sessionId, targetInfo.url)
    if (process.env.BANC_TRACE)
      console.error(
        `[banc] fil attaché ${targetInfo.type} ${targetInfo.url} en attente=${waitingForDebugger}`
      )
    void (async () => {
      if (duDecor) {
        try {
          const r = await cdp.evaluer(ESPION, sessionId)
          if (process.env.BANC_TRACE) console.error(`[banc] espion : ${r}`)
        } catch (e) {
          console.error('[banc] espion non posé :', e.message)
        }
      }
      if (waitingForDebugger) await cdp.envoyer('Runtime.runIfWaitingForDebugger', {}, sessionId)
    })()
  })
  cdp.ecouter((m) => {
    if (m.method === 'Target.detachedFromTarget') fils.delete(m.params.sessionId)
  })
  await cdp.envoyer('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true
  })
  const t0 = Date.now()
  while (fils.size === 0 && Date.now() - t0 < 10_000) await attendre(200)
  const session = [...fils.keys()].at(-1)
  if (!session) {
    console.error('fil du décor introuvable (le décor tourne-t-il dans un Worker ?)')
    return 2
  }
  // l'image en cours au moment de la pose n'est pas complète : on repart d'une liste vide
  await attendre(300)
  await cdp.evaluer('globalThis.__banc.images.length = 0', session)
  const t1 = Date.now()
  let images = []
  while (Date.now() - t1 < 120_000) {
    images = JSON.parse(await cdp.evaluer(LIRE_IMAGES, session)) ?? []
    if (images.filter((i) => i.dessins > 0).length >= nbImages + 2) break
    await attendre(500)
  }
  // les résultats GPU arrivent avec une ou deux images de retard
  await attendre(400)
  images = (JSON.parse(await cdp.evaluer(LIRE_IMAGES, session)) ?? []).filter((i) => i.dessins > 0)
  const regime = resumerImages(images.slice(0, nbImages))
  const cadence =
    images.length > 2
      ? arrondir((1000 * (images.length - 1)) / (images.at(-1).debut - images[0].debut))
      : null
  const gpuExpose = await cdp.evaluer('!!(globalThis.__banc && globalThis.__banc.ext)', session)

  if (capture) {
    const r = await cdp.envoyer('Page.captureScreenshot', { format: 'png' })
    if (r.result?.data) writeFileSync(capture, Buffer.from(r.result.data, 'base64'))
  }

  // ANALYSE : où partent les dessins (option --analyse).
  let analyse = null
  if (avecAnalyse) {
    await cdp.evaluer(
      'globalThis.__banc.analyse = true; globalThis.__banc.images.length = 0',
      session
    )
    const t2 = Date.now()
    let brut = { images: [], noms: [] }
    while (Date.now() - t2 < 60_000) {
      brut = JSON.parse(
        await cdp.evaluer(
          `JSON.stringify({ images: globalThis.__banc.images.filter((i) => i.dessins > 0 && i.paires).map((i) => i.paires), noms: [...globalThis.__banc.noms] })`,
          session
        )
      )
      if (brut.images.length >= 12) break
      await attendre(500)
    }
    await cdp.evaluer('globalThis.__banc.analyse = false', session)
    analyse = analyserPaires(brut.images, new Map(brut.noms))
  }

  // IMAGE À TEMPS FIGÉ (option --capture-fige <png>) : même instant de la scène d'une version à
  // l'autre, regard au centre — deux captures comparables pixel à pixel.
  if (captureFige) {
    await cdp.evaluer(`globalThis.__banc.tempsFige = ${Number(tempsFige)}`, session)
    await attendre(4000)
    const r = await cdp.envoyer('Page.captureScreenshot', { format: 'png' })
    if (r.result?.data) writeFileSync(captureFige, Buffer.from(r.result.data, 'base64'))
    await cdp.evaluer('delete globalThis.__banc.tempsFige', session)
  }

  // 3. LE RETOUR SUR L'ACCUEIL.
  let retour = null
  if (avecRetour) {
    const cliquer = (onglet) =>
      cdp.evaluer(
        `(() => { const b = document.querySelector('[data-testid="nav-${onglet}"]'); if (!b) return false; b.click(); return performance.timeOrigin + performance.now() })()`
      )
    const depart = await cliquer('chat')
    if (depart === false) {
      retour = { erreur: 'bouton nav-chat introuvable' }
    } else {
      await attendre(2500)
      const clic = await cliquer('accueil')
      const finAttente = Date.now() + 20_000
      let premiere = null
      let pendantAbsence = 0
      while (Date.now() < finAttente && premiere === null) {
        await attendre(100)
        pendantAbsence = 0
        for (const s of fils.keys()) {
          const lues =
            JSON.parse((await cdp.evaluer(LIRE_IMAGES, s).catch(() => 'null')) ?? 'null') ?? []
          pendantAbsence += lues.filter(
            (i) => i.debut > depart + 200 && i.fin < clic && i.dessins > 0
          ).length
          const apres = lues.find((i) => i.debut >= clic && i.dessins > 0)
          if (apres && (premiere === null || apres.fin < premiere)) premiere = apres.fin
        }
      }
      if (process.env.BANC_TRACE)
        for (const s of fils.keys()) {
          const etat = await cdp
            .evaluer(
              `JSON.stringify({ n: globalThis.__banc?.images.length, pleines: globalThis.__banc?.images.filter((i) => i.dessins > 0).length, derniere: globalThis.__banc?.images.at(-1), onmessage: typeof self.onmessage, gl: !!globalThis.__banc?.gl })`,
              s
            )
            .catch((e) => e.message)
          console.error(`[banc] retour, fil ${s.slice(0, 8)} clic=${clic} : ${etat}`)
        }
      retour = {
        premiereImageMs: premiere === null ? null : arrondir(premiere - clic),
        imagesPendantAbsence: pendantAbsence,
        filsDuDecor: fils.size
      }
    }
  }

  // 4. LE REPOS : plus de geste, plus de focus — la cadence doit descendre (decor-cadence.ts).
  clearInterval(pompe)
  await cdp.envoyer('Emulation.setFocusEmulationEnabled', { enabled: false })
  let repos = null
  const sessionRepos = [...fils.keys()].at(-1)
  if (sessionRepos) {
    await attendre(1500)
    await cdp.evaluer('globalThis.__banc.images.length = 0', sessionRepos)
    await attendre(5000)
    const lues = (JSON.parse(await cdp.evaluer(LIRE_IMAGES, sessionRepos)) ?? []).filter(
      (i) => i.dessins > 0
    )
    repos = {
      // le bureau caché peut donner le focus à la seule fenêtre qu'il porte : sans focus perdu, le
      // repos n'arrive qu'après 90 s sans geste, et cette mesure ne le montre pas
      focusReel: await cdp.evaluer('document.hasFocus()'),
      imagesParSeconde:
        lues.length > 2
          ? arrondir((1000 * (lues.length - 1)) / (lues.at(-1).debut - lues[0].debut))
          : null
    }
  }

  await cdp.envoyer('Page.stopScreencast').catch(() => {})
  const mesure = {
    date: new Date().toISOString(),
    demarrage,
    regime: { ...regime, imagesParSeconde: cadence, carteGraphiqueMesuree: gpuExpose },
    retour,
    repos,
    ...(analyse ? { analyse } : {})
  }
  const seuils = JSON.parse(readFileSync(fichierSeuils, 'utf8'))
  const verdict = evaluerSeuils(mesure, seuils.seuils)
  const rapport = { mesure, verdict }
  if (sortie) writeFileSync(sortie, JSON.stringify(rapport, null, 2))
  console.log(JSON.stringify(rapport, null, 2))
  if (!verdict.ok) {
    for (const d of verdict.depasses)
      console.error(`[banc] DÉPASSÉ ${d.chemin} = ${d.valeur} (${d.raison}) — ${d.pourquoi ?? ''}`)
  }
  cdp.ws.close()
  return verdict.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().then(
    (code) => process.exit(code),
    (erreur) => {
      console.error('[banc] mesure impossible :', erreur?.stack ?? erreur)
      process.exit(2)
    }
  )
}
