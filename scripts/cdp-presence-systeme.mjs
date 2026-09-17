/**
 * SONDE — la présence système des runs va-t-elle VRAIMENT jusqu'à l'OS ?
 *
 * Pourquoi elle existe : la jauge de barre des tâches et le texte de l'icône de zone de
 * notification ne sont visibles QUE pendant un run vivant. Attendre un vrai run de plusieurs
 * minutes pour regarder une icône coûte cher et n'est pas reproductible. Cette sonde pousse un
 * état de runs choisi À TRAVERS LE VRAI CHEMIN — `api.signalerRunsVivants` (préchargement) →
 * canal `os:presence` (processus principal) → `setProgressBar` + `setToolTip`.
 *
 * CE QU'ELLE PROUVE : que le pont existe et que le processus principal répond.
 * CE QU'ELLE NE PROUVE PAS : que `liveRuns` alimente ce pont pendant un run réel — ça, seule
 * l'observation d'un run l'établit. La sonde le DIT dans sa sortie plutôt que de le laisser croire.
 *
 * Usage : node scripts/cdp-presence-systeme.mjs [--runs 2] [--etapes 7]
 */
import { portCdp } from './cdp-port.mjs'

const argument = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : defaut
}

const rendre = (charge, code = 0) => {
  process.stdout.write(`${JSON.stringify(charge, null, 2)}\n`)
  process.exit(code)
}

/*
 * PAS DE REPLI MUET SUR 9223 (conv-611, redit conv-615) : cette sonde gardait sa PROPRE copie du
 * repli que `scripts/cdp-port.mjs` avait retire. Depuis une copie de travail qui n'a pas lance son
 * instance, elle poussait un etat de runs factice dans l'application d'un AUTRE travail — ou dans
 * celle de l'utilisateur. On passe par le resolveur commun, qui REFUSE sans cible propre.
 */
let port
try {
  port = String(portCdp())
} catch (e) {
  rendre({ ok: false, echec: 'aucune-instance-a-piloter', detail: String(e.message ?? e) }, 3)
}

const cibles = await fetch(`http://127.0.0.1:${port}/json/list`)
  .then((r) => r.json())
  .catch((e) => rendre({ ok: false, echec: 'cdp-injoignable', port, detail: String(e) }, 3))

const page = cibles.find((c) => c.type === 'page')
if (!page) rendre({ ok: false, echec: 'page-autowin-absente', port }, 3)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, ko) => {
  socket.onopen = ok
  socket.onerror = ko
})
let id = 0
const attente = new Map()
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const cb = attente.get(m.id)
  if (!cb) return
  attente.delete(m.id)
  m.error ? cb.ko(new Error(m.error.message)) : cb.ok(m.result)
}
const envoyer = (methode, params = {}) =>
  new Promise((ok, ko) => {
    const n = ++id
    attente.set(n, { ok, ko })
    socket.send(JSON.stringify({ id: n, method: methode, params }))
  })
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  }
  return r.result?.value
}

await envoyer('Runtime.enable')

const runsActifs = Number(argument('--runs', '2')) || 0
const etapesFaites = Number(argument('--etapes', '7')) || 0

const pontPresent = await evaluer(`Boolean(globalThis.api?.signalerRunsVivants)`)
if (!pontPresent) {
  socket.close()
  rendre(
    {
      ok: false,
      echec: 'pont-absent(api.signalerRunsVivants)',
      cause:
        "le préchargement chargé par la fenêtre n'expose pas signalerRunsVivants — l'application tourne sur un binaire antérieur à ce câblage, ou preload/index.ts n'est pas rechargé",
      port
    },
    4
  )
}

const reponse = await evaluer(
  `globalThis.api.signalerRunsVivants({ runsActifs: ${runsActifs}, etapesFaites: ${etapesFaites}, etapesTotales: 0 })`
)
socket.close()

// Le processus principal REND la présence qu'il a appliquée : c'est elle qui fait foi, pas l'appel.
const ok = Boolean(reponse) && typeof reponse === 'object' && 'infobulle' in reponse
rendre(
  {
    ok,
    ...(ok ? {} : { echec: 'reponse-inattendue' }),
    port,
    envoye: { runsActifs, etapesFaites, etapesTotales: 0 },
    presenceAppliquee: reponse,
    portee:
      "prouve le pont préchargement → processus principal → OS ; ne prouve PAS que liveRuns l'alimente pendant un run réel"
  },
  ok ? 0 : 5
)
