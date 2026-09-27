import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { OUTILS_NOEUD_SKILL, type LanceurCommandeSkill } from './skill-node-tools'
import type { ExecutionEvidence } from './providers/types'
import { amitelBrainRoot } from './amitel-paths'

/**
 * Les outils d'un noeud SKILL, servis sur le canal NATIF du provider.
 *
 * POURQUOI CE MODULE EXISTE. La boucle a protocole texte (`skill-node-tools`) demande au modele
 * d'ecrire `<cmd>{...}</cmd>` dans sa reponse. Or un agent CLI possede DEJA son propre mecanisme
 * d'outils : il choisit le sien ou le notre selon le tour. Mesure sur deux runs reels du meme
 * prompt — `conv-1341` a emis `<cmd>` (outil execute), `conv-1342` a tente l'appel natif et a rendu
 * « No such tool available ». Un chemin qui marche une fois sur deux n'est pas un chemin, et
 * durcir le prompt pour « mieux convaincre » le modele revient a lutter contre son affordance
 * native — ce qui a deja echoue.
 *
 * CE QU'ON FAIT A LA PLACE : on pose les MEMES deux commandes sur le canal que le modele utilise
 * spontanement. Pour le CLI Claude, ce canal est MCP (`--mcp-config`). Le serveur vit DANS le
 * process principal — la ou le bus de commandes existe deja — donc il n'y a aucune IPC a inventer
 * et AUCUNE duplication de la liste blanche : deux definitions du meme perimetre divergeraient, et
 * c'est le genre d'ecart qui ne se voit qu'en production.
 *
 * MESURE AVANT ECRITURE (2026-08-20, probe jetable) : un serveur MCP `http` en loopback, declare via
 * `--mcp-config` et sous `--strict-mcp-config`, rend bien son temoin non devinable au CLI (exit 0) ;
 * et le MEME appel SANS `--mcp-config` rend « outil absent ». Le canal est donc verifie, et la
 * privation des huit phases du pipeline l'est aussi, avant la premiere ligne de ce fichier.
 *
 * LES GARANTIES, ET CE QUI LES PORTE :
 *  - `orchestrate` reste inatteignable. En MCP, « ne pas declarer l'outil » est une garantie plus
 *    FAIBLE qu'un refus explicite : le catalogue publie est ce qu'on expose, et un appel a un nom
 *    non publie n'est plus refuse par NOUS mais ignore par le client. On garde donc les deux : le
 *    filtre de publication ici, et le refus runtime du lanceur (`index.ts`) qui devient la barriere
 *    AUTORITAIRE. Un appel hors liste blanche recoit un refus BAVARD, jamais un silence.
 *  - Rien ne coupe un run. Outil en echec, arguments refuses, corps illisible : on rend un contenu
 *    d'erreur LISIBLE par le modele. Un refus muet ferait croire a l'agent qu'il a agi, ce qui est
 *    le pire defaut possible.
 *  - Le jeton est propre au serveur et exige a chaque requete : le port est en loopback, mais un
 *    port en loopback est joignable par TOUT process de la machine.
 */

/**
 * Les providers qui CONSOMMENT reellement `SendOptions.skillNodeTools`.
 *
 * Liste FERMEE, et doublee par un controle runtime — la lecon coute cher dans ce depot : elargir un
 * type sans elargir le controle qui le double compile parfaitement et echoue a l'execution. Le test
 * `skill-node-mcp.providers.test.ts` interroge CHAQUE adaptateur enregistre : tout provider present
 * ici doit prouver qu'il transporte l'option, et tout provider absent doit prouver qu'il ne la
 * transporte pas. Ajouter un nom ici sans l'implementer dans son adaptateur fait donc ROUGIR un test,
 * au lieu de servir un port inutile en silence.
 *
 * Mesure du 2026-08-20 : `codex` fait un POST direct (aucun CLI, donc aucun `--mcp-config`), `gemini`
 * et `kimi` spawnent un CLI sans drapeau MCP. Ouvrir un serveur pour eux reviendrait a annoncer
 * « outils natifs servis » sur un appel qui ne les recevra jamais — exactement le mensonge de trace
 * que ce chantier a corrige pour `describePrompt`.
 */
export const PROVIDERS_OUTILS_NATIFS: readonly string[] = ['claude']

/** Vrai si ce provider transporte les outils d'un noeud skill sur son canal natif. */
export function porteLesOutilsNatifs(provider: string): boolean {
  return PROVIDERS_OUTILS_NATIFS.includes(provider)
}

/** Nom du serveur cote client. Les outils apparaissent donc en `mcp__autowin__<commande>`. */
export const NOM_SERVEUR_MCP = 'autowin'

/** Version de protocole rendue par defaut si le client n'en propose aucune. */
const PROTOCOLE_DEFAUT = '2025-06-18'

export interface ServeurOutilsNoeudSkill {
  /** URL a mettre dans `--mcp-config`. */
  readonly url: string
  /** Jeton attendu en en-tete `X-Autowin-Token`. */
  readonly jeton: string
  /** Le port reellement ouvert (0 demande a l'OS d'en choisir un libre). */
  readonly port: number
  /** Ce qu'on ecrit dans `--mcp-config`, deja au format attendu par le CLI. */
  configMcp(): string
  /** Les noms tels que le CLI les exposera — a passer a `--allowedTools`. */
  nomsExposes(): string[]
  /** Ferme le serveur. Idempotent : un run qui se termine deux fois ne doit pas jeter. */
  arreter(): Promise<void>
}

/** Un appel observe, pour la trace du run. Une capacite non tracee est une capacite non defendable. */
export interface AppelMcpObserve {
  outil: string
  refuse: boolean
  /** L'appel a-t-il ABOUTI au niveau du bus. Ne dit RIEN de l'issue metier — voir `issue`. */
  ok: boolean
  /**
   * L'ISSUE METIER, quand le resultat la porte. `ok` ne veut dire que « le transport a marche » :
   * mesure du 2026-08-20 sur le run conv-1346, la trace affichait `remember : ok` alors que le
   * resultat contenait `{"stored": false, "detail": "refuse par le Brain : not found"}` — et
   * `brain_query : ok` pour un `{"found": false, "status": "invalid"}`. Un libelle qui dit « ok »
   * quand rien n'a ete ni ecrit ni lu est un faux vert dans l'artefact meme qui sert de preuve.
   */
  issue?: string
  /**
   * La note OUVERTE par `brain_read` (son argument `path`). Sans elle, la trace disait seulement
   * « brain_read : ok — trouve » : impossible de savoir QUELLES notes un nœud `think` lit, ni de
   * comparer ce choix à la liste de candidates qu'il avait reçue (constat du 2026-09-27).
   */
  cible?: string
  /** Longueur du texte (`knowledge`) rendu au nœud : ce qu'il a réellement reçu, pas ce qu'il cite. */
  caracteres?: number
  erreur?: string
}

/**
 * Extrait l'issue METIER d'un resultat de commande, quand il en porte une.
 *
 * Volontairement conservateur : on ne nomme que des champs OBSERVES dans les resultats reels
 * (`stored`, `found`, `status`, `detail`, `note`). Une commande dont le resultat ne porte aucun de
 * ces champs n'a pas d'issue a annoncer — mieux vaut ne rien dire que d'inventer un statut.
 */
export function issueMetier(donnees: unknown): string | undefined {
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) return undefined
  const d = donnees as Record<string, unknown>
  const motif = typeof d.detail === 'string' ? d.detail : typeof d.note === 'string' ? d.note : ''
  if (d.stored === false) return `RIEN ECRIT${motif ? ` — ${motif}` : ''}`
  if (d.stored === true) return 'ecrit'
  if (d.found === false) return `RIEN TROUVE${motif ? ` — ${motif}` : ''}`
  if (d.found === true) return 'trouve'
  if (typeof d.status === 'string' && d.status !== 'ok') return `statut ${d.status}`
  return undefined
}

/**
 * Ce qu'un appel a LU : la note ouverte (`brain_read` seulement) et la longueur du texte rendu.
 * Même prudence que `issueMetier` : on ne mesure que les champs observés (`path`, `knowledge`).
 */
export function mesureAppel(
  nom: string,
  args: Record<string, unknown>,
  donnees: unknown
): Pick<AppelMcpObserve, 'cible' | 'caracteres'> {
  const mesure: Pick<AppelMcpObserve, 'cible' | 'caracteres'> = {}
  if (nom === 'brain_read' && typeof args.path === 'string' && args.path.trim()) {
    mesure.cible = args.path.trim()
  }
  if (donnees && typeof donnees === 'object' && !Array.isArray(donnees)) {
    const texte = (donnees as Record<string, unknown>).knowledge
    if (typeof texte === 'string') mesure.caracteres = texte.length
  }
  return mesure
}

/**
 * Le libellé de trace d'un appel natif : `outil natif <nom> (<phase>) : <état>[ — issue · cible · N car.]`.
 * Le préfixe est inchangé : `scripts/cdp-skill-node-brain-proof.mjs` le filtre par `startsWith`.
 */
/** Chemin comparable : séparateurs unifiés et répétitions écrasées (`\\ged2\x` ≡ `//ged2/x`). */
function cheminComparable(chemin: string): string {
  return chemin.replace(/[\\/]+/g, '/').replace(/\/$/, '')
}

/**
 * Les lectures DIRECTES du Brain d'une phase — `Read` d'une note, `Grep`/`Glob` sous sa racine —
 * rendues en lignes de trace, à côté de celles des outils natifs (`libelleAppelObserve`).
 *
 * Mesure du 2026-09-27 (`scripts/probe-think-brain.mts`, 5 tâches réelles) : un nœud `think` ouvre
 * les notes par `brain_read` MAIS AUSSI en lisant le fichier sous la racine du Brain, comme
 * `consigneCandidatesBrain` l'y autorise. Sur la tâche « heure dans une OPE RIG », la note qui
 * répondait n'a été lue QUE par `Read` : la trace « outil natif » n'en montrait rien.
 */
export function lecturesDirectesDuBrain(
  preuves: readonly ExecutionEvidence[] | undefined,
  racineBrain: string,
  phase: string
): string[] {
  const racine = cheminComparable(racineBrain.trim())
  if (!racine || !preuves?.length) return []
  const sousLaRacine = (chemin: string | undefined): string | undefined => {
    if (!chemin) return undefined
    const comparable = cheminComparable(chemin)
    if (comparable.toLowerCase() === racine.toLowerCase()) return '.'
    // Le séparateur final est exigé : `Amitel Brain-copie` ne passe pas pour `Amitel Brain`.
    if (!comparable.toLowerCase().startsWith(`${racine.toLowerCase()}/`)) return undefined
    return comparable.slice(racine.length + 1)
  }
  const lignes: string[] = []
  for (const preuve of preuves) {
    const etat = preuve.ok ? 'ok' : 'echec'
    const taille = preuve.outputChars ?? preuve.stdout?.length
    const car = taille !== undefined ? ` · ${taille} car.` : ''
    if (/^Read$/i.test(preuve.type)) {
      const note = sousLaRacine(preuve.path)
      if (note) lignes.push(`lecture directe Read (${phase}) : ${etat} — ${note}${car}`)
    } else if (/^(Grep|Glob)$/i.test(preuve.type)) {
      // Sans dossier, un Glob peut porter le chemin complet dans son MOTIF (`//ged2/…/knowledge/**`).
      const dossier = preuve.searchPath
        ? sousLaRacine(preuve.searchPath)
        : sousLaRacine(preuve.pattern)
      if (dossier) {
        const motif = preuve.pattern ? `« ${preuve.pattern} » · ` : ''
        lignes.push(
          `recherche directe ${preuve.type} (${phase}) : ${etat} — ${motif}${dossier}${car}`
        )
      }
    }
  }
  return lignes
}

export function libelleAppelObserve(appel: AppelMcpObserve, phase: string): string {
  const etat = appel.refuse ? 'refuse' : appel.ok ? 'ok' : 'echec'
  const suite = [
    appel.issue,
    appel.cible,
    appel.caracteres !== undefined ? `${appel.caracteres} car.` : undefined
  ].filter((part): part is string => Boolean(part))
  return `outil natif ${appel.outil} (${phase}) : ${etat}${suite.length ? ` — ${suite.join(' · ')}` : ''}`
}

/**
 * Le schema d'entree d'un outil, COPIE de la spec de la commande.
 *
 * Le bus decrit ses arguments en francais (`{ question: 'la question, en langage naturel' }`) : on
 * ne reecrit pas cette description, on la transporte. C'est la lecon de `conv-1339`, ou un prompt
 * ecrit DE MEMOIRE annoncait `brain_query {"query": ...}` quand la commande attend `question` —
 * l'outil etait branche, teste, et strictement inutilisable.
 *
 * `required` est derive du MOT `facultatif`, seul marqueur d'optionalite que porte la spec. La
 * degradation est volontairement dissymetrique : un argument exige a tort est simplement fourni par
 * le modele, alors qu'un argument oublie revient en refus NOMME que le modele peut lire et corriger.
 */
export function schemaEntree(args: Record<string, unknown>): {
  type: 'object'
  properties: Record<string, { type: 'string'; description: string }>
  required: string[]
} {
  const properties: Record<string, { type: 'string'; description: string }> = {}
  const required: string[] = []
  for (const [nom, description] of Object.entries(args ?? {})) {
    const texte = String(description)
    properties[nom] = { type: 'string', description: texte }
    // MARQUEUR EN TETE, pas sous-chaine : « obligatoire sauf si facultatif » contient le mot et
    // rendait l'argument optionnel — un argument REQUIS devenu optionnel en silence. Le bus ecrit
    // ses arguments facultatifs en commencant par le mot (« facultatif — … »), donc on l'ancre.
    // MARQUEUR EN TETE, pas sous-chaine : « obligatoire sauf si facultatif » contient le mot
    // et rendait l'argument optionnel — un argument REQUIS devenu optionnel en SILENCE.
    //
    // Aucune expression reguliere ici, deliberement : la premiere version portait un octet de
    // CONTROLE brut a la place de `` (0x08, invisible a la relecture), donc elle ne matchait
    // rien et TOUS les arguments devenaient requis. Ce depot documente deja cette classe de
    // defaut (`veille/audit-interne.ts` : « un octet de controle brut neutralise une expression
    // reguliere »). Une comparaison de chaine ne peut pas porter ce piege.
    if (!texte.trimStart().toLowerCase().startsWith('facultatif')) required.push(nom)
  }
  return { type: 'object', properties, required }
}

/** Les outils publies : la liste blanche, jamais le bus complet. */
/**
 * Plafond de taille d'un résultat d'outil que le CLI Claude met DANS la conversation.
 *
 * Sans déclaration, un résultat au-delà de ~50 000 caractères est remplacé par un renvoi vers un
 * fichier. Mesuré le 2026-09-27 sur le vrai CLI (`scripts/probe-brain-read-taille.mts`) : une note
 * de 120 000 caractères arrivait sous la forme « exceeds maximum allowed tokens. Output has been
 * saved to … ». Le champ et son maximum viennent de la documentation officielle
 * (https://code.claude.com/docs/en/mcp) : `_meta["anthropic/maxResultSizeChars"]`, « up to
 * 500,000 characters ». Au-delà, le renvoi fichier reste inévitable — d'où `enTexte` ci-dessous.
 */
export const PLAFOND_RESULTAT_OUTIL_CAR = 500_000

export function outilsPublies(lanceur: LanceurCommandeSkill): Array<{
  name: string
  description: string
  inputSchema: ReturnType<typeof schemaEntree>
  _meta: { 'anthropic/maxResultSizeChars': number }
}> {
  const specs = lanceur.catalogue?.() ?? []
  return specs
    .filter((s) => (OUTILS_NOEUD_SKILL as readonly string[]).includes(s.name))
    .map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: schemaEntree(s.args),
      _meta: { 'anthropic/maxResultSizeChars': PLAFOND_RESULTAT_OUTIL_CAR }
    }))
}

/**
 * Met un resultat en texte, ENTIER. Il etait coupe a 4 000 caracteres jusqu'au 2026-09-27 : une
 * note ouverte par `brain_read` arrivait amputee. Regle de l'utilisateur : pas de budget, on
 * recupere le necessaire — c'est le noeud qui choisit ce qu'il ouvre.
 *
 * Une note TROUVÉE part en texte brut, lignes intactes, et non en JSON : le JSON échappait chaque
 * retour à la ligne, si bien qu'une note trop grosse pour la conversation atterrissait dans un
 * fichier d'UNE seule ligne (« 121 713 characters across 1 line »), que `Read` ne sait pas lire.
 * Sans contenu (introuvable, panne), le JSON reste : c'est lui qui porte le statut et la note.
 */
/**
 * Ce que reçoit le modèle quand un résultat dépasse le plafond : la taille RÉELLE et le chemin du
 * fichier de la note, qu'il lit par morceaux ou fouille. Sans ce renvoi, le CLI rangeait le
 * résultat dans un `.json` où le texte tenait sur une seule ligne de 625 000 caractères (mesuré le
 * 2026-09-27), que ni `Read` ni `Grep` ne savent exploiter. Le fichier `.md` d'origine a ses lignes.
 */
function renvoiNoteTropGrande(nom: string, args: Record<string, unknown>, taille: number): string {
  const chemin = typeof args.path === 'string' ? args.path.trim().replace(/\\/g, '/') : ''
  const racine = amitelBrainRoot().replace(/\\/g, '/').replace(/\/+$/, '')
  // Casse ignorée, comme `lecturesDirectesDuBrain` : `//GED2/RIG/…` est déjà sous `\\ged2\rig\…`.
  const dejaSousLaRacine = cheminComparable(chemin)
    .toLowerCase()
    .startsWith(`${cheminComparable(racine).toLowerCase()}/`)
  const fichier = chemin ? (dejaSousLaRacine ? chemin : `${racine}/${chemin}`) : ''
  return [
    `RÉSULTAT TROP GRAND POUR ARRIVER EN UNE FOIS : ${taille} caractères, au-delà des ` +
      `${PLAFOND_RESULTAT_OUTIL_CAR} qu'un outil peut transmettre dans la conversation.`,
    fichier
      ? `La note est intacte sur le disque : ${fichier}. Lis-la par morceaux (Read avec offset et ` +
        `limit) ou fouille-la (Grep) plutôt que de la rouvrir par ${nom}.`
      : `Précise ta demande : ${nom} ne peut pas rendre ce résultat en entier.`
  ].join('\n')
}

function enTexte(valeur: unknown): string {
  if (typeof valeur === 'string') return valeur
  const savoir =
    valeur && typeof valeur === 'object' && !Array.isArray(valeur)
      ? (valeur as Record<string, unknown>).knowledge
      : undefined
  if (typeof savoir === 'string' && savoir.trim()) return savoir
  return JSON.stringify(valeur ?? null)
}

/**
 * Traite un message JSON-RPC. Extrait du transport pour etre testable SANS ouvrir de port : un test
 * qui doit ouvrir un socket finit par ne plus etre joue.
 */
export async function traiterMessageMcp(
  message: { method?: string; id?: unknown; params?: { name?: string; arguments?: unknown } },
  lanceur: LanceurCommandeSkill,
  observer?: (appel: AppelMcpObserve) => void
): Promise<{ statut: number; corps?: unknown }> {
  const id = message.id
  const repondre = (result: unknown): { statut: number; corps: unknown } => ({
    statut: 200,
    corps: { jsonrpc: '2.0', id, result }
  })
  switch (message.method) {
    case 'initialize':
      return repondre({
        protocolVersion: PROTOCOLE_DEFAUT,
        capabilities: { tools: {} },
        serverInfo: { name: NOM_SERVEUR_MCP, version: '1.0.0' }
      })
    case 'tools/list':
      return repondre({ tools: outilsPublies(lanceur) })
    case 'tools/call': {
      const nom = String(message.params?.name ?? '')
      const argsBruts = message.params?.arguments ?? {}
      /**
       * Les arguments sont VALIDES, pas seulement castes. Un client MCP peut envoyer une chaine, un
       * nombre ou un tableau : JSON valide, mais pas un objet. Le cast passait la valeur telle quelle
       * au bus, en violant son contrat a cette frontiere precise — et ce module revendique justement
       * le refus BAVARD plutot que la robustesse accidentelle de l'appelant.
       */
      if (typeof argsBruts !== 'object' || argsBruts === null || Array.isArray(argsBruts)) {
        observer?.({ outil: nom, refuse: false, ok: false, erreur: 'arguments invalides' })
        return repondre({
          content: [
            {
              type: 'text',
              text: `ÉCHEC — arguments invalides pour \`${nom}\` : un objet est attendu.`
            }
          ],
          isError: true
        })
      }
      const args = argsBruts as Record<string, unknown>
      /**
       * PREMIERE barriere : on ne sert que ce qu'on publie. Le refus est BAVARD — il nomme la
       * commande — parce qu'un agent qui ne comprend pas son refus le retente a l'identique.
       */
      if (!(OUTILS_NOEUD_SKILL as readonly string[]).includes(nom)) {
        observer?.({ outil: nom, refuse: true, ok: false })
        return repondre({
          content: [
            {
              type: 'text',
              text: `REFUSÉ — \`${nom}\` est indisponible depuis un nœud de workflow. L'appel n'a pas eu lieu.`
            }
          ],
          isError: true
        })
      }
      try {
        const resultat = await lanceur.exec(nom, args)
        const texte = resultat.ok ? enTexte(resultat.data) : ''
        const renvoi =
          resultat.ok && texte.length > PLAFOND_RESULTAT_OUTIL_CAR
            ? renvoiNoteTropGrande(nom, args, texte.length)
            : undefined
        const issue = renvoi
          ? `trop grande pour la conversation (${texte.length} car.) — renvoyée vers son fichier`
          : issueMetier(resultat.data)
        observer?.({
          outil: nom,
          refuse: false,
          ok: resultat.ok,
          ...(issue ? { issue } : {}),
          ...mesureAppel(nom, args, resultat.data),
          ...(resultat.error ? { erreur: resultat.error } : {})
        })
        return repondre({
          content: [
            {
              type: 'text',
              text: resultat.ok
                ? (renvoi ?? texte)
                : `ÉCHEC — ${resultat.error ?? 'raison inconnue'}`
            }
          ],
          isError: !resultat.ok
        })
      } catch (error) {
        // Un outil qui jette est une information pour le modele, pas une raison d'arreter le run.
        const erreur = error instanceof Error ? error.message : String(error)
        observer?.({ outil: nom, refuse: false, ok: false, erreur })
        return repondre({
          content: [{ type: 'text', text: `ÉCHEC — ${erreur}` }],
          isError: true
        })
      }
    }
    default:
      // Notification (aucun `id`) : rien a rendre, et surtout pas une erreur.
      if (typeof id === 'undefined') return { statut: 202 }
      return repondre({})
  }
}

/**
 * Ouvre le serveur d'outils d'un run. `port: 0` laisse l'OS choisir : deux runs simultanes ne
 * doivent pas se disputer un port fixe.
 */
export async function demarrerServeurOutilsNoeudSkill(
  lanceur: LanceurCommandeSkill,
  options: { port?: number; observer?: (appel: AppelMcpObserve) => void } = {}
): Promise<ServeurOutilsNoeudSkill> {
  const jeton = randomUUID()
  const serveur: Server = createServer((req, res) => {
    let brut = ''
    req.on('data', (c) => (brut += c))
    req.on('end', () => {
      if (req.headers['x-autowin-token'] !== jeton) {
        // Un port en loopback est joignable par tout process de la machine : le jeton n'est pas
        // decoratif.
        res.writeHead(401).end('jeton invalide')
        return
      }
      let message: Record<string, unknown>
      try {
        message = JSON.parse(brut || '{}')
      } catch {
        res.writeHead(400).end('json illisible')
        return
      }
      void traiterMessageMcp(message, lanceur, options.observer)
        .then(({ statut, corps }) => {
          if (typeof corps === 'undefined') {
            res.writeHead(statut).end()
            return
          }
          const texte = JSON.stringify(corps)
          res.writeHead(statut, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(texte)
          })
          res.end(texte)
        })
        .catch(() => {
          // Meme ici, on ne laisse pas la requete pendre : un client qui attend indefiniment
          // ferait durer la phase jusqu'au plafond du provider.
          res.writeHead(500).end('erreur interne')
        })
    })
  })
  await new Promise<void>((resolve, reject) => {
    serveur.once('error', reject)
    serveur.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  const adresse = serveur.address()
  const port = typeof adresse === 'object' && adresse ? adresse.port : 0
  const url = `http://127.0.0.1:${port}/mcp`
  return {
    url,
    jeton,
    port,
    configMcp: () =>
      JSON.stringify({
        mcpServers: {
          [NOM_SERVEUR_MCP]: { type: 'http', url, headers: { 'X-Autowin-Token': jeton } }
        }
      }),
    nomsExposes: () => outilsPublies(lanceur).map((o) => `mcp__${NOM_SERVEUR_MCP}__${o.name}`),
    arreter: () =>
      new Promise<void>((resolve) => {
        if (!serveur.listening) return resolve()
        serveur.close(() => resolve())
      })
  }
}
