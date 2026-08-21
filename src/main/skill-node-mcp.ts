import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { OUTILS_NOEUD_SKILL, type LanceurCommandeSkill } from './skill-node-tools'

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

/** Borne d'un resultat rendu : un `brain_query` genereux noierait le contexte du modele. */
const RESULTAT_MAX_CARACTERES = 4_000

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
export function outilsPublies(lanceur: LanceurCommandeSkill): Array<{
  name: string
  description: string
  inputSchema: ReturnType<typeof schemaEntree>
}> {
  const specs = lanceur.catalogue?.() ?? []
  return specs
    .filter((s) => (OUTILS_NOEUD_SKILL as readonly string[]).includes(s.name))
    .map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: schemaEntree(s.args)
    }))
}

/** Borne un resultat avant de le rendre au modele. */
function borner(valeur: unknown): string {
  const brut = typeof valeur === 'string' ? valeur : JSON.stringify(valeur ?? null)
  return brut.length > RESULTAT_MAX_CARACTERES ? `${brut.slice(0, RESULTAT_MAX_CARACTERES)}…` : brut
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
        const issue = issueMetier(resultat.data)
        observer?.({
          outil: nom,
          refuse: false,
          ok: resultat.ok,
          ...(issue ? { issue } : {}),
          ...(resultat.error ? { erreur: resultat.error } : {})
        })
        return repondre({
          content: [
            {
              type: 'text',
              text: resultat.ok
                ? borner(resultat.data)
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
