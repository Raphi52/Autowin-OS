/**
 * OUVRIR UNE CONVERSATION PRÉCISE DANS L'INSTANCE CACHÉE (demande du 2026-10-15, conv-966).
 *
 * L'instance cachée de `ui-capture.mjs` démarre sur un profil VIERGE : aucune conversation, aucun
 * run, aucune trace. Trois tours de suite (conv-966), la preuve d'un changement d'affichage sur
 * conv-955 — le graphe de son tour arrêté par Stop, la pastille de son run — n'a donc pu être prise
 * QUE sur un rendu du composant hors de l'application.
 *
 * Ce module COPIE une conversation de la racine de données réelle vers celle de l'instance, AVANT
 * son démarrage. On ne copie que ce que l'écran lit, et JAMAIS ce qui fait agir l'application :
 *   - copié : son entrée du stockage des conversations (instantané, lignes de journal, archive), sa
 *     trace causale, son activité, ses appels de modèle, ses runs (RUN.md et fil des sous-agents) ;
 *   - jamais copié : `turn-journals/` — un tour inachevé y serait REPRIS au démarrage, jusqu'à
 *     renvoyer un message au modèle (« relance gratuite », ChatView.tsx) ; et `run-state/` — un run
 *     interrompu y serait RELANCÉ (survie niveau 3, index.ts). Une instance de preuve qui paie un
 *     modèle ou relance un run sur des données copiées serait pire que pas de preuve.
 *
 * Les chemins viennent de `src/main/store/conversations-disk.ts` (stockage) et de
 * `scripts/autowin-headless.ps1` (racine de données de l'instance) ; ils sont recopiés ici parce
 * qu'un script Node ne charge pas le TypeScript du processus principal.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Même règle que l'archive des conversations : un identifiant est un nom de fichier, rien de plus. */
const ID_DE_CONVERSATION = /^[A-Za-z0-9._-]{1,120}$/

export const estIdDeConversation = (id) =>
  typeof id === 'string' && ID_DE_CONVERSATION.test(id) && id !== '.' && id !== '..'

/** Racine de données de l'instance cachée (`<user-data-dir>/app-data/autowin-os`). Pure. */
export const racineDonneesInstance = (racine, instanceId) =>
  join(racine, 'Audit', 'headless-instances', instanceId, 'user-data', 'app-data', 'autowin-os')

/** Fichiers propres à une conversation, relatifs à la racine de données. Pure. */
export const fichiersDeConversation = (id) => [
  join('causal-trace', `${id}.jsonl`),
  join('causal-trace', `.${id}.sequence`),
  join('activity', `${id}.jsonl`),
  join('prompt-observability', `${id}.jsonl`)
]

/** Dossiers propres à une conversation. `turn-journals/<id>` en est EXCLU à dessein (voir en-tête). */
export const dossiersDeConversation = (id) => [join('runs', id)]

/**
 * Fichiers montrés DANS le fil (images lues, fichiers produits) : `chat-artifacts/<id>-<empreinte>`.
 * Sans eux, la copie affichait chaque image « Aperçu indisponible » — mesuré conv-332, 2026-10-18,
 * preuve de la pile d'images. Le tiret final empêche « conv-33 » de prendre « conv-332-… ».
 */
export const relocaliserArtefacts = (source, destination) => {
  const ancien = JSON.stringify(resolve(source, 'chat-artifacts')).slice(1, -1)
  const nouveau = JSON.stringify(resolve(destination, 'chat-artifacts')).slice(1, -1)
  return (texte) => (ancien === nouveau ? texte : texte.split(ancien).join(nouveau))
}

export const dossiersDArtefacts = (racine, id) =>
  readdirSafe(join(racine, 'chat-artifacts'))
    .filter((nom) => nom.startsWith(`${id}-`))
    .map((nom) => join('chat-artifacts', nom))

/**
 * Les lignes du journal des conversations qui concernent CETTE conversation. Une création porte son
 * identifiant dans `conversation.id`, les autres opérations dans `id`. Une ligne illisible est
 * écartée : elle ne peut pas être attribuée. Pure.
 */
export function lignesDuJournal(texte, id) {
  return String(texte)
    .split(/\r?\n/)
    .filter((ligne) => {
      if (!ligne.trim()) return false
      try {
        const enregistrement = JSON.parse(ligne)
        return enregistrement?.id === id || enregistrement?.conversation?.id === id
      } catch {
        return false
      }
    })
}

const lireJson = (chemin) => JSON.parse(readFileSync(chemin, 'utf8'))

/** Même nom que `NOM_JOURNAL_MESSAGES_FILS` (src/shared/messages-entre-fils.ts, conv-1139). */
const NOM_MESSAGES_FILS = 'messages-entre-fils.jsonl'

/**
 * Les lignes du journal des messages entre fils qui concernent `id` : messages envoyés ou reçus par
 * lui, et les remises de ces messages. Une ligne illisible est sautée. Pure.
 */
export function messagesEntreFilsDe(texte, id) {
  const lues = []
  for (const brute of texte.split('\n')) {
    if (!brute.trim()) continue
    try {
      lues.push({ brute, l: JSON.parse(brute) })
    } catch {
      // Ligne coupée : sautée.
    }
  }
  const siens = new Set(
    lues
      .filter(({ l }) => l?.type === 'message' && (l.a === id || l.de?.fil === id))
      .map(({ l }) => l.id)
  )
  return lues
    .filter(
      ({ l }) =>
        (l?.type === 'message' && siens.has(l.id)) ||
        (l?.type === 'livre' && Array.isArray(l.ids) && l.ids.some((x) => siens.has(x)))
    )
    .map(({ brute }) => brute)
}

/**
 * Copie la conversation `id` de `source` vers `destination` (deux racines de données). Rend ce qui a
 * été copié, ou `{ ok: false, echec }` sans rien écrire quand la conversation n'existe pas.
 */
export function semerConversation({ source, destination, id }) {
  if (!estIdDeConversation(id)) return { ok: false, echec: `conversation-id-invalide(${id})` }
  const stockage = join(source, 'conversations.json')
  const instantane = existsSync(stockage) ? lireJson(stockage) : []
  const conversations = Array.isArray(instantane) ? instantane : []
  const entree = conversations.find((conversation) => conversation?.id === id)
  const journal = `${stockage}.journal.jsonl`
  const lignes = existsSync(journal) ? lignesDuJournal(readFileSync(journal, 'utf8'), id) : []
  const archive = join(`${stockage}.archive`, `${id}.json`)
  const archivee = existsSync(archive)
  if (!entree && lignes.length === 0 && !archivee)
    return { ok: false, echec: `conversation-introuvable(${id})` }

  mkdirSync(destination, { recursive: true })
  const ecrits = []
  const cible = join(destination, 'conversations.json')
  // Chaque artefact garde le chemin ABSOLU de son fichier ; l'instance ne lit que sous SA racine
  // (`isStoredArtifactPath`, chat-artifact-store.ts : « Chemin d’artefact non autorisé »). Les chemins
  // vers `chat-artifacts` sont donc réécrits vers la copie, sous leur forme échappée JSON.
  const relocaliser = relocaliserArtefacts(source, destination)
  writeFileSync(cible, relocaliser(JSON.stringify(entree ? [entree] : [])), 'utf8')
  ecrits.push('conversations.json')
  if (lignes.length > 0) {
    writeFileSync(`${cible}.journal.jsonl`, `${lignes.map(relocaliser).join('\n')}\n`, 'utf8')
    ecrits.push('conversations.json.journal.jsonl')
  }
  if (archivee) {
    mkdirSync(`${cible}.archive`, { recursive: true })
    writeFileSync(
      join(`${cible}.archive`, `${id}.json`),
      relocaliser(readFileSync(archive, 'utf8')),
      'utf8'
    )
    ecrits.push(join('conversations.json.archive', `${id}.json`))
  }
  for (const relatif of fichiersDeConversation(id)) {
    if (!existsSync(join(source, relatif))) continue
    mkdirSync(dirname(join(destination, relatif)), { recursive: true })
    copyFileSync(join(source, relatif), join(destination, relatif))
    ecrits.push(relatif)
  }
  // Messages entre fils (conv-1139) : ceux que ce fil a envoyés ou reçus, et leurs remises — sans
  // eux, la capture d'un fil ne peut pas montrer ce que ses agents se sont écrits.
  const messagesFils = join(source, NOM_MESSAGES_FILS)
  if (existsSync(messagesFils)) {
    const lignesFils = messagesEntreFilsDe(readFileSync(messagesFils, 'utf8'), id)
    if (lignesFils.length > 0) {
      writeFileSync(join(destination, NOM_MESSAGES_FILS), `${lignesFils.join('\n')}\n`, 'utf8')
      ecrits.push(NOM_MESSAGES_FILS)
    }
  }
  let runs = 0
  for (const relatif of dossiersDeConversation(id)) {
    if (!existsSync(join(source, relatif))) continue
    cpSync(join(source, relatif), join(destination, relatif), { recursive: true })
    ecrits.push(relatif)
    if (relatif.startsWith('runs')) runs = readdirSafe(join(destination, relatif)).length
  }
  for (const relatif of dossiersDArtefacts(source, id)) {
    cpSync(join(source, relatif), join(destination, relatif), { recursive: true })
    ecrits.push(relatif)
  }
  return {
    ok: true,
    conversation: id,
    lignesDeJournal: lignes.length,
    archivee,
    runs,
    ecrits
  }
}

function readdirSafe(chemin) {
  try {
    return readdirSync(chemin)
  } catch {
    return []
  }
}

/**
 * Tous les emplacements d'une conversation dans une racine de données : ce que `semerConversation`
 * écrit, et ce que l'application a pu en faire pendant la capture (archivage, journal de tour).
 * Relatifs, construits ici à partir d'un identifiant validé. Pure.
 */
export const emplacementsDeConversation = (id) => [
  'conversations.json',
  'conversations.json.journal.jsonl',
  join('conversations.json.archive', `${id}.json`),
  NOM_MESSAGES_FILS,
  ...fichiersDeConversation(id),
  ...dossiersDeConversation(id),
  join('turn-journals', id)
]

/**
 * Retire de l'instance la copie de la conversation, et RIEN d'autre : les données de l'utilisateur
 * ne restent pas derrière la capture. N'agit que si la copie a eu lieu (`rapport.ok`) ; aucun
 * chemin ne sort de `destination`.
 */
export function retirerSemence(destination, rapport) {
  const bilan = { retires: [], restants: [] }
  if (!rapport?.ok || !estIdDeConversation(rapport.conversation)) return bilan
  // Les SAUVEGARDES du stockage que l'application écrit à son démarrage (`conversations.json.pre-remake`,
  // `.avant-archive-<date>` : vu le 2026-10-15, 21 Ko avec le contenu de conv-955 restés dans
  // l'instance). L'instance démarrait vide (`instance-deja-peuplee` sinon) : toute variante du
  // stockage vient donc de la copie.
  const variantes = existsSync(destination)
    ? readdirSync(destination).filter(
        (nom) => nom.startsWith('conversations.json') && !nom.includes('/') && !nom.includes('\\')
      )
    : []
  const aRetirer = [
    ...new Set([
      ...emplacementsDeConversation(rapport.conversation),
      ...dossiersDArtefacts(destination, rapport.conversation),
      ...variantes
    ])
  ]
  for (const relatif of aRetirer) {
    const chemin = join(destination, relatif)
    if (!existsSync(chemin)) continue
    try {
      rmSync(chemin, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      bilan.retires.push(relatif)
    } catch (erreur) {
      // Un fichier encore tenu par un processus de l'instance qui s'éteint : il est NOMMÉ, pas tu.
      bilan.restants.push(`${relatif} (${erreur?.code ?? erreur})`)
    }
  }
  return bilan
}
