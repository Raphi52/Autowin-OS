#!/usr/bin/env node
/**
 * PILOTER AUTOWIN DEPUIS UN SCRIPT DU POSTE (conv-1144).
 *
 * Parle au point d'entrée local de l'app (`src/main/point-entree-local.ts`), par le même protocole
 * que les outils du chat (JSON-RPC MCP sur HTTP, en loopback, jeton obligatoire). L'adresse et le
 * jeton sont lus dans `point-entree-local.json`, dans le dossier de données de l'instance visée.
 *
 * USAGE
 *   node scripts/autowin-client.mjs --nouveau [--titre "…"] --message "…" [--attendre] [--delai 600]
 *   node scripts/autowin-client.mjs --fil conv-123 --message "…" [--attendre] [--delai 600]
 *   node scripts/autowin-client.mjs --fil conv-123 --attendre
 *   Option : --donnees <dossier>  (sinon AUTOWIN_DATA_DIR, sinon <dépôt>/.autowin-data/autowin-os)
 *
 * SORTIE : la réponse de l'assistant sur stdout avec --attendre, sinon l'identifiant du fil. Le reste
 * (fil visé, attente) part sur stderr. Le jeton n'est JAMAIS affiché.
 *
 * CODES : 0 réussi · 1 erreur rendue par l'app · 2 arguments invalides (option inconnue, répétée,
 * délai invalide, message vide ou trop long) · 3 Autowin n'est pas lancé · 4 jeton refusé · 5 fil
 * occupé, rien envoyé · 6 délai dépassé, le tour continue · 7 tour non démarré · 8 tour en échec ·
 * 9 tour arrêté (Stop, ou app fermée) · 10 le tour attend ta réponse à une question.
 * Un redémarrage de l'app PENDANT l'attente n'est pas une fin : le client relit le fichier d'adresse
 * et reprend l'attente du même tour, dans la limite du délai.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Codes de sortie : un par cas que l'appelant doit pouvoir distinguer. */
export const CODES = Object.freeze({
  ok: 0,
  erreur: 1,
  usage: 2,
  absent: 3,
  jetonRefuse: 4,
  filOccupe: 5,
  delaiDepasse: 6,
  nonDemarre: 7,
  tourEchoue: 8,
  // conv-1144 (cadrage) : un arrêt voulu ou une app fermée n'est pas une panne, et une question
  // posée n'est pas un succès — l'appelant doit pouvoir les distinguer.
  tourArrete: 9,
  questionPosee: 10
})

/** Statuts d'un tour arrêté sans panne (src/main/chat-turn-arret.ts : Stop → cancelled). */
const STATUTS_ARRETES = new Set(['cancelled', 'interrupted'])

/** Même plafond que celui d'un résultat d'outil (`PLAFOND_RESULTAT_OUTIL_CAR`, skill-node-mcp.ts). */
export const MESSAGE_MAX_CAR = 500_000
export const DELAI_DEFAUT_S = 600
const INTERVALLE_MS = 2_000
/** Sans tour vu « en cours » ni réponse passé ce délai après l'envoi, le tour n'a pas démarré. */
const GRACE_DEMARRAGE_MS = 15_000
/** `chat_send` attend jusqu'à 120 s le démarrage du tour (index.ts) : on lui laisse cette marge. */
const DELAI_REQUETE_MS = 150_000
const FICHIER = 'point-entree-local.json'

export class ErreurClient extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Lit la ligne de commande. Refuse tôt, avant tout appel à l'app. */
export function lireArguments(argv) {
  const o = { nouveau: false, attendre: false, avertissements: [] }
  // conv-1144 (cadrage) : une option répétée gardait la dernière valeur en silence.
  const vues = new Set()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      if (vues.has(a))
        throw new ErreurClient(CODES.usage, `${a} est donnée deux fois : garde une seule valeur.`)
      vues.add(a)
    }
    const valeur = () => {
      const v = argv[++i]
      if (v === undefined) throw new ErreurClient(CODES.usage, `${a} attend une valeur.`)
      return v
    }
    if (a === '--nouveau') o.nouveau = true
    else if (a === '--attendre') o.attendre = true
    else if (a === '--fil') o.fil = valeur().trim()
    else if (a === '--message') o.message = valeur()
    else if (a === '--titre') o.titre = valeur()
    else if (a === '--delai') o.delaiBrut = valeur()
    else if (a === '--donnees') o.donnees = valeur()
    else throw new ErreurClient(CODES.usage, `Option inconnue : ${a}`)
  }
  if (o.nouveau && o.fil)
    throw new ErreurClient(CODES.usage, '--nouveau et --fil s’excluent : choisis l’un des deux.')
  if (!o.nouveau && !o.fil)
    throw new ErreurClient(CODES.usage, 'Indique --nouveau (créer un fil) ou --fil <id>.')
  if (o.message !== undefined) {
    if (!o.message.trim())
      throw new ErreurClient(CODES.usage, 'Message vide : rien n’a été envoyé.')
    if (o.message.length > MESSAGE_MAX_CAR)
      throw new ErreurClient(
        CODES.usage,
        `Message trop long : ${o.message.length} caractères, au-delà de ${MESSAGE_MAX_CAR}. Rien n’a été envoyé.`
      )
  } else if (o.nouveau) {
    throw new ErreurClient(CODES.usage, '--nouveau demande un --message.')
  } else if (!o.attendre) {
    throw new ErreurClient(CODES.usage, 'Avec --fil, donne un --message, --attendre, ou les deux.')
  }
  // conv-1144 (cadrage) : un délai invalide était remplacé par 600 s ; il est refusé, rien ne part.
  if (o.delaiBrut !== undefined) {
    const delai = o.delaiBrut.trim() === '' ? NaN : Number(o.delaiBrut)
    if (!Number.isFinite(delai) || delai <= 0)
      throw new ErreurClient(
        CODES.usage,
        `Délai « ${o.delaiBrut} » invalide : donne un nombre de secondes supérieur à 0.`
      )
    o.delaiS = delai
  } else {
    o.delaiS = DELAI_DEFAUT_S
  }
  return o
}

/** Le dossier de données du dépôt réel, même lancé depuis une copie de travail d'agent. */
export function dossierDonneesParDefaut(dossierScript, env = process.env) {
  if (env.AUTOWIN_DATA_DIR) return resolve(env.AUTOWIN_DATA_DIR)
  const depot = resolve(dossierScript, '..')
  const normalise = depot.split('\\').join('/')
  const coupe = normalise.indexOf('/.autowin-data/')
  const racine = coupe < 0 ? depot : depot.slice(0, coupe)
  return join(racine, '.autowin-data', 'autowin-os')
}

function processusVivant(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM : le processus existe mais appartient à un autre compte.
    return e?.code === 'EPERM'
  }
}

const PAS_LANCE = (dossier, detail) =>
  `Autowin n'est pas lancé (${detail}). Dossier de données visé : ${dossier}`

/** Lit l'adresse et le jeton. Un fichier laissé par une session arrêtée vaut « pas lancé ». */
export function lirePointEntree(dossier) {
  const fichier = join(dossier, FICHIER)
  if (!existsSync(fichier))
    throw new ErreurClient(CODES.absent, PAS_LANCE(dossier, `aucun ${FICHIER}`))
  let d
  try {
    d = JSON.parse(readFileSync(fichier, 'utf8'))
  } catch {
    throw new ErreurClient(CODES.absent, PAS_LANCE(dossier, `${FICHIER} illisible`))
  }
  if (typeof d?.url !== 'string' || typeof d?.jeton !== 'string')
    throw new ErreurClient(CODES.absent, PAS_LANCE(dossier, `${FICHIER} incomplet`))
  if (!processusVivant(d.pid))
    throw new ErreurClient(
      CODES.absent,
      PAS_LANCE(dossier, 'fichier laissé par une session arrêtée')
    )
  return { url: d.url, jeton: d.jeton, fichier, dossier }
}

/** Un appel d'outil. Rend les données de la commande, ou lève une `ErreurClient` nommée. */
export function creerAppeleur(point, { fetch: f = globalThis.fetch } = {}) {
  let id = 0
  return async function appeler(nom, args) {
    let reponse
    try {
      reponse = await f(point.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-autowin-token': point.jeton },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++id,
          method: 'tools/call',
          params: { name: nom, arguments: args }
        }),
        signal: AbortSignal.timeout(DELAI_REQUETE_MS)
      })
    } catch (e) {
      if (e?.name === 'TimeoutError')
        throw new ErreurClient(
          CODES.erreur,
          `${nom} : Autowin n'a pas répondu en ${DELAI_REQUETE_MS / 1000} s.`
        )
      throw new ErreurClient(CODES.absent, PAS_LANCE(point.dossier, 'connexion refusée'))
    }
    if (reponse.status === 401)
      throw new ErreurClient(
        CODES.jetonRefuse,
        `Jeton refusé par le serveur. ${point.fichier} vient sans doute d'une session précédente : relance Autowin.`
      )
    if (!reponse.ok)
      throw new ErreurClient(CODES.erreur, `${nom} : réponse HTTP ${reponse.status}.`)
    const corps = await reponse.json()
    const texte = corps?.result?.content?.find?.((c) => c.type === 'text')?.text ?? ''
    if (corps?.result?.isError)
      throw new ErreurClient(CODES.erreur, texte || `${nom} : échec sans détail.`)
    try {
      return JSON.parse(texte)
    } catch {
      return texte
    }
  }
}

const dormirParDefaut = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Attend la fin du tour du fil, puis rend le dernier message de l'assistant.
 * `avant` = nombre de messages lu AVANT l'envoi ; absent = on attend le tour déjà en cours.
 * `reconnecter()` rend un nouvel `appeler` lu dans le fichier d'adresse : sans lui, une coupure finit
 * l'attente ; avec lui, un redémarrage de l'app est attendu puis le MÊME tour est repris.
 */
export async function attendreFinDuTour(appelerInitial, fil, o = {}) {
  const maintenant = o.maintenant ?? Date.now
  const dormir = o.dormir ?? dormirParDefaut
  const journal = o.journal ?? (() => {})
  const intervalle = o.intervalleMs ?? INTERVALLE_MS
  const grace = o.graceMs ?? GRACE_DEMARRAGE_MS
  const delaiS = o.delaiS ?? DELAI_DEFAUT_S
  const delaiMs = delaiS * 1000
  const debut = maintenant()
  let appeler = appelerInitial
  let vuEnCours = false
  /** Heure de la dernière reprise après un redémarrage de l'app. */
  let repriseA
  for (;;) {
    let lu
    try {
      lu = await appeler('conversation_read', { id: fil, derniers: '1' })
    } catch (e) {
      /*
       * conv-1144 (cadrage) : un redémarrage coupe la connexion, puis l'app revient avec un AUTRE
       * jeton. Ce n'est pas la fin du tour : on relit le fichier d'adresse jusqu'au retour de l'app.
       */
      const coupure =
        e instanceof ErreurClient && (e.code === CODES.absent || e.code === CODES.jetonRefuse)
      if (!coupure || !o.reconnecter) throw e
      journal(
        `Autowin ne répond plus (redémarrage ?) : j'attends son retour pour reprendre le tour de ${fil}…`
      )
      for (;;) {
        if (maintenant() - debut >= delaiMs)
          throw new ErreurClient(
            CODES.absent,
            `Autowin n'est pas revenu avant la fin du délai (${delaiS} s) : le tour de ${fil} n'a pas pu être suivi jusqu'au bout. Relance --fil ${fil} --attendre.`
          )
        await dormir(intervalle)
        try {
          appeler = o.reconnecter()
          break
        } catch (e2) {
          if (!(e2 instanceof ErreurClient && e2.code === CODES.absent)) throw e2
        }
      }
      repriseA = maintenant()
      journal(`Autowin est revenu : je reprends l'attente du tour de ${fil}.`)
      continue
    }
    const ecoule = maintenant() - debut
    // Juste après une reprise, le tour coupé par le redémarrage peut ne pas être encore réenregistré
    // (tours repris, active-chat-turns.ts) : un « interrupted » ou un silence n'y est pas une fin.
    const justeRepris = repriseA !== undefined && maintenant() - repriseA < grace
    if (lu?.tourEnCours) {
      vuEnCours = true
    } else {
      const dernier = Array.isArray(lu?.messages) ? lu.messages.at(-1) : undefined
      const nouveau = o.avant === undefined || Number(lu?.messageCount) > o.avant
      const statut = dernier?.statut
      const enSuspens = justeRepris && (statut === 'interrupted' || statut === 'streaming')
      if (nouveau && dernier?.role === 'assistant' && !enSuspens) {
        // Réussi = statut absent (`conversation_read` omet `done`) ou `completed` : mesuré sur l'app
        // réelle, un tour réussi s'y relit `completed`. Le reste de `ChatTurnStatus`
        // (src/shared/chat-turn.ts) : cancelled/interrupted = arrêté, failed/streaming hors tour = échec.
        // fix-ok: conv-1144 — sur l'app réelle (D:/tmp/sonde-pel-1144/run2.log) un tour réussi s'est relu
        // `statut: completed` et sortait en code 8 « échec (completed) » ; les autres retouches de ce
        // fichier étaient le retrait puis la remise du refus « fil occupé », pour prouver que 2 tests mordent.
        if (statut && STATUTS_ARRETES.has(statut))
          throw new ErreurClient(
            CODES.tourArrete,
            `Le tour de ${fil} a été arrêté (${statut === 'cancelled' ? 'bouton Stop' : 'app fermée pendant le tour'}) avant sa fin.`
          )
        if (dernier.erreur || (statut && statut !== 'completed'))
          throw new ErreurClient(
            CODES.tourEchoue,
            `Le tour de ${fil} s'est terminé en échec (${statut ?? 'échec'}) : ${dernier.erreur ?? 'cause non renseignée'}`
          )
        return dernier
      }
      if (!justeRepris) {
        if (vuEnCours)
          throw new ErreurClient(
            CODES.tourEchoue,
            `Le tour de ${fil} s'est terminé sans réponse de l'assistant.`
          )
        if (o.avant === undefined)
          throw new ErreurClient(
            CODES.erreur,
            `Aucun tour en cours dans ${fil}, et aucune réponse à rendre.`
          )
        if (ecoule >= grace)
          throw new ErreurClient(
            CODES.nonDemarre,
            `Le tour n'a pas démarré dans ${fil} après ${Math.round(ecoule / 1000)} s. Rien n'est conclu : vérifie le fil dans l'app.`
          )
      }
    }
    if (ecoule >= delaiMs)
      throw new ErreurClient(
        CODES.delaiDepasse,
        `Délai de ${delaiS} s dépassé : le tour continue dans ${fil}, il n'est pas arrêté.`
      )
    await dormir(intervalle)
  }
}

/** Le déroulé complet. Rend `{ code, sortie }` ; `journal` reçoit ce qui part sur stderr. */
export async function executer(options, { appeler, journal = () => {}, attente = {} }) {
  for (const a of options.avertissements ?? []) journal(a)
  let fil = options.fil
  if (options.nouveau) {
    const titre = options.titre?.trim() || options.message.trim().split(/\r?\n/)[0].slice(0, 60)
    const c = await appeler('create_conversation', { title: titre })
    if (typeof c?.id !== 'string')
      throw new ErreurClient(CODES.erreur, 'create_conversation n’a pas rendu de fil.')
    fil = c.id
    journal(`Fil ${fil}${c.reprise ? ' (repris : créé il y a quelques secondes)' : ' créé'}.`)
  }
  let avant
  if (options.message !== undefined) {
    // Lu AVANT l'envoi : un fil inconnu échoue ici, et un fil occupé est refusé sans rien envoyer.
    const lu = await appeler('conversation_read', { id: fil, derniers: '1' })
    if (lu?.tourEnCours)
      throw new ErreurClient(
        CODES.filOccupe,
        `Le fil ${fil} a déjà un tour en cours : rien n'a été envoyé. Réessaie après sa fin (--fil ${fil} --attendre).`
      )
    avant = Number(lu?.messageCount) || 0
    await appeler('chat_send', { message: options.message, conversationId: fil })
    journal(`Demande envoyée dans ${fil}.`)
  }
  if (!options.attendre) return { code: CODES.ok, sortie: fil }
  journal(`J'attends la fin du tour (délai ${options.delaiS ?? DELAI_DEFAUT_S} s)…`)
  const dernier = await attendreFinDuTour(appeler, fil, {
    journal,
    ...attente,
    avant,
    delaiS: options.delaiS
  })
  if (dernier.tronque)
    journal(
      `Réponse coupée à ${dernier.text.length} caractères sur ${dernier.longueurReelle} : le reste est dans le fil ${fil}.`
    )
  // conv-1144 (cadrage) : le tour a fini sur une question — le fil attend l'utilisateur, ce n'est
  // pas un succès. La question et ses choix sont rendus avec la réponse.
  if (dernier.questionPosee) {
    journal(`Le tour de ${fil} s'est terminé sur une question : il attend ta réponse dans l'app.`)
    const { question, options: choix = [] } = dernier.questionPosee
    return {
      code: CODES.questionPosee,
      sortie: [dernier.text ?? '', `Question : ${question}`, choix.map((c) => `- ${c}`).join('\n')]
        .filter(Boolean)
        .join('\n\n')
    }
  }
  return { code: CODES.ok, sortie: dernier.text ?? '' }
}

async function principal() {
  const journal = (texte) => process.stderr.write(`${texte}\n`)
  try {
    const options = lireArguments(process.argv.slice(2))
    const dossier = options.donnees
      ? resolve(options.donnees)
      : dossierDonneesParDefaut(dirname(fileURLToPath(import.meta.url)))
    const appeler = creerAppeleur(lirePointEntree(dossier))
    // Après un redémarrage de l'app, le port et le jeton changent : on relit le même fichier.
    const reconnecter = () => creerAppeleur(lirePointEntree(dossier))
    const { code, sortie } = await executer(options, {
      appeler,
      journal,
      attente: { reconnecter }
    })
    process.stdout.write(`${sortie}\n`)
    process.exitCode = code
  } catch (e) {
    journal(e instanceof Error ? e.message : String(e))
    process.exitCode = e instanceof ErreurClient ? e.code : CODES.erreur
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await principal()
}
