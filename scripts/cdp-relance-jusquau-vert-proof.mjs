/**
 * PREUVE TERMINALE de la politique de relance, dans l'app REELLE.
 *
 * Ce que les tests unitaires prouvent : que les fonctions se comportent comme prevu. Ce qu'ils ne
 * prouvent PAS : que le process VIVANT les execute. Le bundle peut porter le correctif sans que le
 * process l'ait charge — piege paye deux fois dans cette session.
 *
 * L'ORACLE est la trace causale du run, jamais le compte rendu de l'agent. On cherche les lignes que
 * l'orchestrateur pousse LUI-MEME :
 *  - `[REPARATION n]` : la boucle a rejoue en reinjectant les raisons du gate ;
 *  - « aucune réparation : … » : la politique a refuse, et elle DIT pourquoi (avant, ce refus etait
 *    muet — c'est le defaut corrige) ;
 *  - « plafond dur de N passage(s) atteint » : le garde-fou a mordu, et il le dit.
 *
 * La tache est volontairement une ANALYSE (non-mutation) : c'est le cas qui n'avait droit a AUCUNE
 * reparation, et l'hypothese H2 du RUN n'avait jamais ete mesuree.
 *
 * ATTENTION — CET INSTRUMENT LAISSE UNE TRACE DANS LE DEPOT.
 *
 * La tache `echec` fait travailler un vrai agent : il produit donc un vrai artefact. Mesure du
 * 2026-08-21 : face a la cible inexistante, l'agent a refuse de FABRIQUER le module pour pouvoir
 * « corriger » un bug invente — bon reflexe — et a ecrit a la place un ORACLE D'ABSENCE falsifiable
 * (`src/main/facturation-remise-fidelite-cible.test.ts`), qui deviendrait rouge le jour ou la cible
 * apparait. Ce fichier a ete RETIRE au nettoyage : il gardait une fiction inventee pour les besoins
 * d'une preuve, dans un domaine (`facturation`) qui appartient a RIG et non a ce depot.
 *
 * Apres tout usage de la tache `echec`, verifier `git status` et retirer l'artefact produit.
 *
 * Usage : node scripts/cdp-relance-jusquau-vert-proof.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const racine = 'C:\\Amitel\\Autowin OS'
const port = Number(process.env.AUTOWIN_CDP_PORT || 9224)
const traces = join(racine, '.autowin-data', 'autowin-os', 'causal-trace')

/**
 * Une ANALYSE, formulee pour tomber dans la branche lecture seule du classifieur (`analys…`), et
 * assez exigeante pour que le gate ait une chance de refuser le premier passage.
 */
/**
 * La tache ne parle PAS de son propre sujet.
 *
 * La premiere version demandait d'analyser la politique de relance : l'agent a lu `stopgate.ts` et
 * cite les phrases exactes que ce pilote cherche dans la trace. L'oracle comptait alors les echos de
 * l'agent comme des preuves. Une tache neutre supprime la contamination a la source.
 */
/**
 * DEUX taches, parce qu'elles prouvent des choses opposees.
 *
 * `neutre` : une analyse ordinaire. Sur conv-1351 elle est passee VERTE du premier coup — donc la
 * boucle de reparation n'a jamais ete sollicitee, et I4 est reste invisible. Un run qui reussit ne
 * prouve rien sur ce qui se passe quand il echoue.
 *
 * `echec` : une MUTATION sur une cible qui n'existe pas. Le contrat racine exige alors une preuve de
 * mutation executable, impossible a produire, et la garde « cible nommee » bloque un miss TOTAL des
 * chemins ancres dans la demande. Le gate refuse donc le premier passage, ce qui est le SEUL cadre ou
 * `[REPARATION n]`, le plafond dur et l'arret sur non-progres peuvent etre observes en vivant.
 * Provoquer l'echec est ici legitime : c'est une vraie tache, refusee pour une vraie raison.
 */
const TACHES = {
  neutre:
    'Analyse en lecture seule la structure des dossiers de premier niveau de ce depot et resume en ' +
    'cinq lignes ce que chacun contient. Ne modifie aucun fichier.',
  /**
   * LE COUPLE MANQUANT, signale par un juge externe : un refus de tache NON-MUTATION sur un profil
   * qui ACCORDE des reparations.
   *
   * J'avais ecrit que ce refus etait « inatteignable par construction ». C'etait faux, et le juge l'a
   * prouve avec mes propres traces : conv-1349 et conv-1350 ONT ete refuses pour « Promis mais pas
   * fait : Analyse demandee presente dans le livrable » — un refus de lecture seule, bien reel. Si
   * aucune reparation n'a suivi, c'est que ces runs tournaient sur `eclair`, qui en accorde ZERO :
   * je mesurais I6 en croyant mesurer I3. Cette tache-ci rejoue le MEME enonce sur un profil qui
   * accorde, pour observer refus -> relance sur une tache non-mutation.
   */
  'analyse-echec':
    "Analyse la politique de relance de l'orchestrateur d'Autowin OS et explique en quoi le plafond " +
    'de reparations decidait a la place du progres. Ne modifie aucun fichier.',
  echec:
    'Corrige le bug de la fonction `calculerRemiseFidelite` dans ' +
    '`src/main/facturation/remise-fidelite-inexistante.ts` : elle arrondit au centime superieur au ' +
    'lieu de l inferieur. Fournis un test rouge puis vert qui le prouve.'
}
const cle = process.argv[3]
const tache = TACHES[cle && TACHES[cle] ? cle : 'neutre']

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((p) => p.type === 'page')
if (!page) throw new Error(`aucune page Electron sur ${port} — l'app tourne-t-elle ?`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((ok, ko) => {
  socket.onopen = ok
  socket.onerror = ko
})
let id = 0
const attente = new Map()
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  const appel = attente.get(m.id)
  if (!appel) return
  attente.delete(m.id)
  m.error ? appel.ko(new Error(m.error.message)) : appel.ok(m.result)
}
const envoyer = (method, params = {}) =>
  new Promise((ok, ko) => {
    const n = ++id
    attente.set(n, { ok, ko })
    socket.send(JSON.stringify({ id: n, method, params }))
  })
const evaluer = async (expression) => {
  const r = await envoyer('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    const d = r.exceptionDetails
    throw new Error([d.text, d.exception?.description, d.exception?.value].filter(Boolean).join(' | '))
  }
  return r.result.value
}

/**
 * Les lignes POUSSEES PAR L'ORCHESTRATEUR, et elles seules.
 *
 * DEFAUT MESURE sur conv-1350 : ma premiere version cherchait une chaine dans TOUS les payloads. Or la
 * tache demandait d'ANALYSER la politique de relance : l'agent a donc lu `stopgate.ts` et l'a CITE
 * dans sa sortie. Quatre des cinq « lignes » comptees etaient des echos de l'agent — un vert
 * entierement faux, produit par mon propre choix de tache.
 *
 * Le discriminant est le TYPE de l'evenement : les lignes de politique sont poussees en `gate` ou
 * `handoff` par l'orchestrateur, jamais en `tool-call` ni `model-response`. On exige en plus une
 * ligne COURTE et sans saut de ligne : un extrait de fichier n'en est jamais.
 */
const TYPES_POUSSES = new Set(['gate', 'handoff'])
const lignesPoussees = (conversationId) => {
  const chemin = join(traces, `${conversationId}.jsonl`)
  if (!existsSync(chemin)) return []
  const sorties = []
  for (const l of readFileSync(chemin, 'utf8').split(/\r?\n/)) {
    if (!l) continue
    let e
    try {
      e = JSON.parse(l)
    } catch {
      continue
    }
    if (!TYPES_POUSSES.has(e?.type)) continue
    for (const pl of Array.isArray(e?.payloads) ? e.payloads : []) {
      const c = pl?.content
      if (typeof c !== 'string' || !c.trim()) continue
      // Un extrait de fichier porte des sauts de ligne ; une ligne poussée n'en a jamais.
      if (c.length > 220 || /\r?\n/.test(c.trim())) continue
      sorties.push(c.trim())
    }
  }
  return sorties
}

/**
 * Tous les contenus, gardes uniquement pour le diagnostic quand rien n'est trouve.
 *
 * Prefixe `_` : elle n'est appelee par personne AUJOURD'HUI, et c'est voulu -- on la decommente au
 * besoin. Le prefixe dit cette intention a l'outil, la ou une suppression aurait detruit un outil
 * de diagnostic que son auteur a garde exprès.
 */
const _contenus = (conversationId) => {
  const chemin = join(traces, `${conversationId}.jsonl`)
  if (!existsSync(chemin)) return []
  return readFileSync(chemin, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        const e = JSON.parse(l)
        return Array.isArray(e?.payloads) ? e.payloads : []
      } catch {
        return []
      }
    })
    .map((p) => p?.content)
    .filter((c) => typeof c === 'string' && c.length > 0)
}

console.log(`api = ${await evaluer('typeof window.api')}`)
/**
 * Le PROFIL est un paramètre, parce que les deux cas prouvent des choses différentes :
 *  - `eclair` (aucun juge, aucune arête rouge) → la politique doit REFUSER toute réparation et LE
 *    DIRE. C'est ce qui a été observé sur conv-1349 et conv-1350.
 *  - `correctif` (juge + arête rouge `maxTraversals: 2`) → des réparations sont ACCORDÉES, donc la
 *    boucle peut réellement rejouer : c'est le seul cadre où `[RÉPARATION n]`, le plafond dur et
 *    l'arrêt sur non-progrès peuvent être vus en vivant.
 */
const profil = process.argv[2] || 'correctif'
console.log(`profil : ${profil}`)
console.log(
  await evaluer(
    `(async () => JSON.stringify(await window.api.workflowProfileSelect(${JSON.stringify(profil)})))()`
  )
)

const conv = JSON.parse(
  await evaluer(
    `(async () => JSON.stringify(await window.api.conversationsCreate({title:"preuve relance jusquau vert", category:"", provider:"claude"})))()`
  )
).id
console.log(`conversation : ${conv}`)
await evaluer(
  `(() => { window.api.orchestrate(${JSON.stringify(tache)}, ${JSON.stringify(conv)}); return true })()`
)

const limite = Date.now() + 12 * 60 * 1000
let lignes = []
let stable = 0
let taille = -1
while (Date.now() < limite) {
  await attendre(5_000)
  lignes = lignesPoussees(conv)
  /**
   * STABILITE = SILENCE LONG, pas silence court.
   *
   * Ma premiere version coupait apres 8 releves identiques a 5 s, soit 40 s. Or une phase est un
   * APPEL DE MODELE : elle n'ecrit rien pendant plusieurs minutes. Le pilote concluait donc en pleine
   * phase, sur 5 lignes de trace, et rendait ROUGE un mecanisme VERT — verifie sur conv-1349, ou la
   * trace est passee de 5 a 24 payloads APRES la sortie du script, ligne de politique incluse.
   *
   * Il faut aussi une CONDITION DE SORTIE POSITIVE : des qu'une ligne de la nouvelle politique est
   * vue, la preuve est faite, inutile d'attendre la fin du run.
   */
  const vuUneLigne =
    lignes.some((l) => l.includes('[RÉPARATION') || l.includes('[REPARATION')) ||
    lignes.some((l) => l.startsWith('aucune réparation')) ||
    lignes.some((l) => l.includes('plafond dur'))
  if (vuUneLigne) break
  if (lignes.length === taille) {
    stable += 1
    if (stable >= 60) break // 5 minutes de silence reel, pas 40 secondes
  } else {
    stable = 0
    taille = lignes.length
  }
}
socket.close()

const reparations = lignes.filter((l) => l.includes('[RÉPARATION') || l.includes('[REPARATION'))
const refusPolitique = lignes.filter((l) => l.startsWith('aucune réparation'))
const plafond = lignes.filter((l) => l.includes('plafond dur'))
const arretProgres = lignes.filter((l) => l.includes('hors de portée de build'))

console.log('\n=== CE QUE LA TRACE MONTRE ===')
console.log(`lignes de trace : ${lignes.length}`)
for (const l of [...reparations, ...refusPolitique, ...plafond, ...arretProgres]) {
  console.log(`  · ${l.slice(0, 160)}`)
}
const nouveauCodeVu = refusPolitique.length + plafond.length + reparations.length > 0
console.log(
  `\nPREUVE ${nouveauCodeVu ? 'VERTE' : 'ROUGE'} — la trace porte au moins une ligne de la NOUVELLE politique`
)
console.log(`  réparations jouées        : ${reparations.length}`)
console.log(`  refus de politique DIT    : ${refusPolitique.length}`)
console.log(`  plafond dur annoncé       : ${plafond.length}`)
console.log(`  arrêt sur non-progrès     : ${arretProgres.length}`)
process.exitCode = nouveauCodeVu ? 0 : 1
