/**
 * LANCER EN PLUSIEURS FILS (conv-1147, 2026-10-25) — cadrage :
 * `~/.claude/runs/conv-1147/fork-automatique-taches-independantes-workspace/RUN.md`, option A.
 *
 * Constat : un message qui demande deux tâches d'action était traité en série. Un tour ne lance
 * qu'un seul travail (`main/agent-pilot.ts`, verrou `orchestrationIssued`) et attend sa fin, alors
 * que l'app sait faire tourner plusieurs fils en même temps. L'agent du fil repère donc les tâches
 * et estime leurs fichiers. Il rend un bloc ```aw-fils, et l'app PROPOSE de lancer un fil par groupe.
 * Rien ne part sans clic : chaque fil coûte un tour.
 *
 * Ce module est le calcul pur, sans React ni IPC. Il lit le bloc, puis regroupe les tâches qui
 * touchent un même fichier : elles passent dans le MÊME fil, l'une après l'autre. Deux fils ne se
 * disputent ainsi aucun fichier prévu. Une prévision fausse reste couverte par la réservation des
 * fichiers entre fils (`shared/reservation-fichiers.ts`). Le module plafonne aussi à 3 fils et
 * écrit le message de chaque tâche.
 */

/** La langue de la fence que l'agent écrit pour proposer le découpage. */
export const FORME_FILS = 'aw-fils'

/** Même plafond que « Essaie 3 façons » (`main/ipc/conversations.ts`) : chaque fil est un tour payé. */
export const FILS_EN_PARALLELE_MAX = 3

const TACHES_MAX = 12
const TEXTE_MAX = 4_000
const FICHIERS_MAX = 40

export interface TacheDeFil {
  /** Nom court, affiché sur la carte et donné au fil. */
  titre: string
  /** Le message autoporté que recevra le fil (skill en tête comprise). */
  demande: string
  /** Fichiers que la tâche devrait toucher, estimés par l'agent ; vide = inconnus. */
  fichiers: string[]
}

/** Un fil à ouvrir : ses tâches, dans l'ordre où elles passeront. */
export interface FilPrevu {
  taches: TacheDeFil[]
}

function texte(valeur: unknown, ou: string): string {
  if (typeof valeur !== 'string' || !valeur.trim()) throw new Error(`${ou} : texte attendu`)
  if (valeur.length > TEXTE_MAX) throw new Error(`${ou} : plus de ${TEXTE_MAX} caractères`)
  return valeur.trim()
}

/**
 * Lecture STRICTE, comme les blocs de données (`blocs-donnees.ts`). Une source illisible n'est
 * jamais devinée : le fil la montre comme du code. Un bouton qui lancerait des tours sur une
 * lecture approximative coûterait de vrais appels.
 */
export function lireBlocFils(source: string): { taches: TacheDeFil[] } | { erreur: string } {
  try {
    const brut: unknown = JSON.parse(source)
    if (!brut || typeof brut !== 'object' || Array.isArray(brut))
      throw new Error('objet { "taches": [...] } attendu')
    const liste = (brut as { taches?: unknown }).taches
    if (!Array.isArray(liste) || liste.length === 0) throw new Error('« taches » : liste attendue')
    if (liste.length > TACHES_MAX) throw new Error(`plus de ${TACHES_MAX} tâches`)
    const taches = liste.map((entree, rang): TacheDeFil => {
      const ou = `tâche ${rang + 1}`
      if (!entree || typeof entree !== 'object') throw new Error(`${ou} : objet attendu`)
      const { titre, demande, fichiers } = entree as Record<string, unknown>
      if (fichiers !== undefined && !Array.isArray(fichiers))
        throw new Error(`${ou} : « fichiers » doit être une liste`)
      const chemins = (fichiers ?? []) as unknown[]
      if (chemins.length > FICHIERS_MAX) throw new Error(`${ou} : plus de ${FICHIERS_MAX} fichiers`)
      return {
        titre: texte(titre, `${ou}, titre`),
        demande: texte(demande, `${ou}, demande`),
        fichiers: chemins.map((chemin, n) => texte(chemin, `${ou}, fichier ${n + 1}`))
      }
    })
    return { taches }
  } catch (erreur) {
    return { erreur: erreur instanceof Error ? erreur.message : String(erreur) }
  }
}

/**
 * Un même fichier écrit autrement (antislash, `./`, casse) doit être reconnu. La casse est ignorée
 * partout, car le disque Windows ne la distingue pas. L'erreur inverse est sans danger : deux
 * fichiers distincts pris pour un seul font passer deux tâches à la suite, rien de plus.
 */
function cleDeFichier(chemin: string): string {
  return chemin
    .trim()
    .replace(/\\/gu, '/')
    .replace(/^(\.\/)+/u, '')
    .replace(/\/+$/u, '')
    .toLowerCase()
}

const cleDeDemande = (demande: string): string => demande.replace(/\s+/gu, ' ').trim().toLowerCase()

/**
 * LE PLAN : dédoublonne les tâches, puis réunit en un même fil celles qui partagent un fichier.
 * Le lien est transitif : A–B par un fichier et B–C par un autre font un seul fil A, B, C.
 * Au-delà de 3 fils, les groupes en trop passent, à tour de rôle, À LA SUITE des premiers fils.
 * Ils n'en ouvrent pas de nouveaux. L'ordre du message est gardé partout.
 *
 * Moins de deux tâches distinctes : aucun plan (`[]`), car il n'y a rien à découper.
 */
export function planDesFils(
  taches: readonly TacheDeFil[],
  plafond = FILS_EN_PARALLELE_MAX
): FilPrevu[] {
  const vues = new Set<string>()
  const uniques = taches.filter((tache) => {
    const cle = cleDeDemande(tache.demande)
    if (vues.has(cle)) return false
    vues.add(cle)
    return true
  })
  if (uniques.length < 2) return []

  // Union-find sur les rangs : chaque fichier rattache la tâche à la première qui l'a cité.
  const parent = uniques.map((_, rang) => rang)
  const racine = (rang: number): number => {
    while (parent[rang] !== rang) {
      parent[rang] = parent[parent[rang]!]!
      rang = parent[rang]!
    }
    return rang
  }
  const premierPorteur = new Map<string, number>()
  uniques.forEach((tache, rang) => {
    for (const fichier of tache.fichiers) {
      const cle = cleDeFichier(fichier)
      if (!cle) continue
      const porteur = premierPorteur.get(cle)
      if (porteur === undefined) {
        premierPorteur.set(cle, rang)
        continue
      }
      const [a, b] = [racine(porteur), racine(rang)]
      // La plus petite racine gagne : le groupe garde la place de sa première tâche.
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
    }
  })

  const groupes = new Map<number, TacheDeFil[]>()
  uniques.forEach((tache, rang) => {
    const cle = racine(rang)
    groupes.set(cle, [...(groupes.get(cle) ?? []), tache])
  })
  const ordonnes = [...groupes.entries()].sort(([a], [b]) => a - b).map(([, liste]) => liste)

  const fils: FilPrevu[] = []
  ordonnes.forEach((liste, rang) => {
    if (rang < plafond) fils.push({ taches: [...liste] })
    else fils[rang % plafond]!.taches.push(...liste)
  })
  return fils
}

/**
 * Le message que reçoit le fil pour UNE tâche. La demande vient EN TÊTE : une skill nommée au
 * début (« /build … ») reste reconnue comme une invocation. Les autres tâches sont nommées pour que
 * l'agent du fil, qui voit le message d'origine dans son historique, n'y touche pas.
 */
export function texteDeLaTache(tache: TacheDeFil, autres: readonly TacheDeFil[]): string {
  if (autres.length === 0) return tache.demande
  const noms = autres.map((autre) => `« ${autre.titre} »`).join(', ')
  return (
    `${tache.demande}\n\n` +
    `(Ce fil ne traite que cette tâche. Les autres tâches de mon message précédent partent ailleurs ` +
    `— ${noms} — n'y touche pas.)`
  )
}

/**
 * Clé d'un lancement. La carte s'en sert pour se souvenir qu'elle a déjà été cliquée : le fil
 * re-rend le texte à chaque tour, et un second clic relancerait N tours.
 *
 * La RÉPONSE qui porte la carte en fait partie (défaut D5, conv-1147) : tirée de la seule source,
 * la clé était partagée par deux réponses au même bloc et par une réponse recopiée dans une
 * branche, et la seconde carte se croyait lancée. `reponse` = l'identité posée par ChatMessageRow
 * (fil + tour, `renderer/.../message-du-fil.ts`) ; sans elle (rendu hors d'un fil), la clé retombe
 * sur la source.
 */
export function cleDuLancement(source: string, reponse?: string): string {
  let h = 5381
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) | 0
  const cle = `autowin:fils-lances:${(h >>> 0).toString(36)}:${source.length}`
  return reponse ? `${cle}:${reponse}` : cle
}

/**
 * LA CONSIGNE DE L'AGENT DU CHAT (servie par `main/chat-pilotage-prompt.ts`, hors tour lecture
 * seule). Une capacité que la consigne ne nomme pas reste morte : sans ce paragraphe, aucun agent
 * n'écrirait de bloc ```aw-fils. L'exemple est lu par la carte dans le test du contrat
 * (`chat-pilotage-prompt.lancer-en-fils.test.ts`), donc il ne peut pas dériver du format.
 *
 * PLUS D'ÉTAPE DE VALIDATION (conv-1163, 2026-10-27, sur la capture de la carte « 2 tâches dans ton
 * message » : « je ne veux plu avoir cette etape de validation »). Depuis conv-1147, deux tâches
 * indépendantes arrêtaient le tour sur la carte, et rien ne partait avant un clic ; quand les tâches
 * partageaient un fichier, la carte n'offrait même qu'un bouton (« Tout ici »). Désormais l'agent les
 * fait toutes, à la suite, dans le tour — règle d'Autonomie (4) de la constitution — et la carte ne
 * sert plus que si l'utilisateur demande lui-même de répartir le travail en fils.
 *
 * RACCOURCIE (conv-1229, 2026-10-28) : ce bloc part à CHAQUE appel du chat, alors qu'il ne sert que
 * sur demande explicite de fils. Retirés : l'explication de la carte côté app (« L'app dessine une
 * carte… », mécanique que le modèle n'a pas à appliquer) et la seconde tâche de l'exemple. Toutes
 * les consignes de comportement restent, mot pour mot ou resserrées.
 */
export const CONSIGNE_LANCER_EN_FILS =
  `PLUSIEURS TÂCHES DANS UN MESSAGE — au moment où le message de l'utilisateur demande au moins DEUX ` +
  `tâches d'ACTION, fais-les TOUTES dans ce tour, l'une après l'autre, sans carte ni demande ` +
  `d'accord : l'utilisateur a refusé cette étape de validation. Le bloc ` +
  '```' +
  `${FORME_FILS} ne se rend QUE si l'utilisateur demande LUI-MÊME de répartir le travail en plusieurs ` +
  `fils (« répartis en fils », « lance-les en parallèle ») : estime d'abord, par une recherche rapide, ` +
  `les fichiers de chaque tâche, puis rends, après une phrase, un bloc ` +
  '```' +
  `${FORME_FILS} {"taches":[{"titre":"Tri par date","demande":"Ajoute un tri par date dans le rail ` +
  `de l'Observatoire","fichiers":["src/renderer/src/components/ObservatoryRail.tsx"]}]} — une entrée ` +
  `par tâche — et ton tour s'arrête là. Chaque \`demande\` est autoportée et reprend en tête la skill ` +
  `nommée (« /build … ») ; \`fichiers\` liste ceux qu'elle devrait modifier, vide si tu ne sais pas. ` +
  `Les pièces jointes du message suivent chaque fil : n'y recopie ni leur contenu ni leur chemin ` +
  `temporaire, nomme-les par leur nom. Jamais de bloc de ta propre initiative : ni pour plusieurs ` +
  `tâches, ni pour des étapes liées (quand B dépend du résultat de A), ni pour des questions seules.`
