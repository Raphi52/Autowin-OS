import { randomUUID } from 'node:crypto'
import type { BrainMemoryOutcome } from '../commands/brain-graph-command'
import type { CostSink } from '../dashboards/cost'
import { noterAppelCourt, signalerPanneAppelCourt } from '../orchestration/petites-taches-trace'
import type { ProviderRegistry } from '../providers/registry'
import type { RoleModelConfig } from '../profil/roles'

/**
 * CONDENSEUR DES NOTES DU BRAIN (2026-11-04).
 *
 * POURQUOI : `brain_read` versait la note ENTIÈRE dans le contexte du modèle principal. Mesure du
 * 22 au 30/10 : 148 notes, 347 000 caractères, plus que tout le bloc des notes proches.
 * Demande de l'utilisateur : le fil ne doit recevoir qu'un MINIMUM d'information pertinente, après
 * un passage par le modèle des petites tâches (Haiku, réglage du Routeur).
 *
 * Règles : une note courte passe telle quelle (le condensé coûterait plus qu'il n'économise) ;
 * `entier: true` garde la note brute (il faut la lire en entier pour la remplacer via `remember`) ;
 * une panne du petit modèle rend la note entière, en le disant — jamais une note perdue.
 *
 * PÉRIMÈTRE (2026-11-10) — qui reçoit le condensé, et qui lit la note brute.
 * Dedans : le CHAT et les NŒUDS DE SKILL. Leurs `brain_read` et `brain_query` passent par le bus de
 * l'app, seul bus à porter un condensé (`bus.condenseurBrain`, câblé dans `ipc/chat.ts`). Sans condensé,
 * un bus rend la note entière (ou la liste complète, pour `brain_query`).
 * Dehors : les PHASES DU PIPELINE (frame, build, clean, judge…). Elles n'ont aucun outil Brain (leur
 * serveur d'outils n'est jamais ouvert, `isPipelinePhase` dans `orchestrator-parcours-sequentiel.ts`) et
 * lisent la note brute avec `Read`, sous la racine que donne `consigneCandidatesBrain`. Choix : une phase
 * ne se coupe pas sur le seul volume (même règle que sa sortie, passée entière à la suivante :
 * `porterVersPhaseSuivante`, `orchestrator-contrats.ts`). Ne leur donne pas `brain_read` sans revoir ce choix.
 * Un nœud skill qui a `brain_read` n'est pas invité à lire le fichier brut (option `brainRead` de
 * `consigneCandidatesBrain`) : il ouvre les notes avec le condensé.
 */

/** En dessous, la note passe telle quelle. */
export const SEUIL_CONDENSE = 1500

export const CONSIGNE_CONDENSEUR = [
  "Tu reçois une note d'une base de savoir et le BESOIN de l'agent qui la lit.",
  "Rends UNIQUEMENT ce qui sert ce besoin : faits, chiffres, chemins, décisions et leurs motifs, mots pour mot quand c'est technique.",
  'Puces courtes, au plus 12. Garde la date de la note si elle y figure.',
  "Rien d'inventé, aucun commentaire, aucune introduction.",
  'Si rien ne sert le besoin, réponds exactement : AUCUN_RAPPORT'
].join('\n')

/**
 * FILTRE DE LA LISTE DE `brain_query` (2026-11-05).
 *
 * POURQUOI : la liste de 30 candidates arrivait entière au modèle principal. Mesure du 23/10 au
 * 05/11 (spool Brain) : 176 appels, médiane 5 279 caractères, 891 000 au total — le plus gros
 * poste Brain du modèle principal après les notes lues. Choisir 3 à 8 notes dans une liste sur
 * une question est un appel sans outil à réponse unique : il revient au modèle des petites tâches,
 * comme le condensé des notes.
 *
 * Le petit modèle ne rend que des NUMÉROS : la liste servie est recomposée ici à partir des blocs
 * d'origine, donc il ne peut ni inventer ni déformer un chemin.
 */
export const FILTRE_MAX_NOTES = 8
export const FILTRE_MIN_NOTES = 3

export const CONSIGNE_FILTRE = [
  "Tu reçois la QUESTION qu'un agent pose à une base de savoir, et la liste numérotée des notes candidates (titre, chemin, taille).",
  `Choisis les notes qui ont des chances de servir cette question : au moins ${FILTRE_MIN_NOTES}, au plus ${FILTRE_MAX_NOTES}, la plus utile en premier.`,
  'Réponds UNIQUEMENT par leurs numéros séparés par des virgules, par exemple : 4, 1, 12',
  'Aucun autre mot.'
].join('\n')

/** `filtre` = choix dans la liste de `brain_query` ; absent = condensé d'une note de `brain_read`. */
export type Condenseur = (
  charge: string,
  conversationId?: string,
  tache?: 'filtre'
) => Promise<string>

export function condenseurDuBrain(deps: {
  registry: Pick<ProviderRegistry, 'send'>
  roles: Pick<RoleModelConfig, 'bindingDesPetitesTaches'>
  cost: CostSink
}): Condenseur {
  return async (charge, conversationId, tache) => {
    const binding = deps.roles.bindingDesPetitesTaches()
    const consigne = tache === 'filtre' ? CONSIGNE_FILTRE : CONSIGNE_CONDENSEUR
    const reponse = await deps.registry
      .send(binding.provider, [{ role: 'user', content: charge }], {
        system: consigne,
        // Le coût reste rangé sous `condenseBrain` (même famille : le Brain allégé par le petit
        // modèle) ; le bloc système dit lequel des deux appels c'était.
        systemBlocks: [
          { name: tache === 'filtre' ? 'filtreBrain' : 'condenseBrain', chars: consigne.length }
        ],
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        requestId: randomUUID()
      })
      .catch((error: unknown) => {
        signalerPanneAppelCourt('condenseBrain', error)
        throw error
      })
    const texte = (reponse.text ?? '').trim()
    noterAppelCourt(deps.cost, {
      appel: 'condenseBrain',
      binding,
      res: reponse,
      issue: texte.slice(0, 80),
      conversationId
    })
    return texte
  }
}

/** Applique le condensé à un résultat de `brain_read`. Ne jette jamais. */
export async function condenserLecture(
  lu: BrainMemoryOutcome,
  args: Record<string, unknown>,
  condenser: Condenseur | undefined,
  conversationId?: string
): Promise<BrainMemoryOutcome> {
  if (!condenser || lu.status !== 'found' || args.entier === true || args.entier === 'true') {
    return lu
  }
  if (lu.knowledge.length < SEUIL_CONDENSE) return lu
  const besoin =
    typeof args.besoin === 'string' && args.besoin.trim()
      ? args.besoin.trim().slice(0, 600)
      : "l'essentiel durable de la note"
  try {
    const texte = await condenser(`BESOIN : ${besoin}\n\nNOTE :\n${lu.knowledge}`, conversationId)
    if (!texte) throw new Error('réponse vide')
    if (texte === 'AUCUN_RAPPORT') {
      return {
        ...lu,
        knowledge: '',
        note: `note sans rapport avec le besoin (${lu.knowledge.length} car. non servis) — rouvre avec entier: true si tu en doutes`
      }
    }
    return {
      ...lu,
      knowledge: texte,
      note: `condensé par le modèle des petites tâches (${lu.knowledge.length} → ${texte.length} car.) — entier: true pour la note brute`
    }
  } catch (error) {
    return {
      ...lu,
      note: `condensé indisponible (${error instanceof Error ? error.message : String(error)}) : note entière`
    }
  }
}

const DEBUT_CANDIDATE = /^### Candidate \d+ — /

/**
 * Découpe la liste rendue par le serveur (`describe_candidates`, `brain_context.py`) : chaque
 * candidate tient en deux lignes (« ### Candidate N — titre » puis « `chemin` · taille · type »).
 * Les en-têtes entre deux listes (Brain d'équipe, Brain perso) ne sont pas des notes.
 */
export function decouperListeBrain(texte: string): { entete: string; notes: string[] } {
  const morceaux = texte.split(/^(?=### Candidate \d+ — )/m)
  const entete = DEBUT_CANDIDATE.test(morceaux[0] ?? '') ? '' : (morceaux.shift() ?? '')
  const notes = morceaux.map((m) => m.split(/\n\s*\n/)[0].trim()).filter(Boolean)
  return { entete, notes }
}

/** Numéros rendus par le petit modèle → indices valides, sans doublon, au plus FILTRE_MAX_NOTES. */
function numerosChoisis(texte: string, total: number): number[] {
  const choisis: number[] = []
  for (const brut of texte.match(/\d+/g) ?? []) {
    const indice = Number(brut) - 1
    if (indice >= 0 && indice < total && !choisis.includes(indice)) choisis.push(indice)
    if (choisis.length === FILTRE_MAX_NOTES) break
  }
  return choisis
}

/**
 * Applique le filtre à un résultat de `brain_query`. Ne jette jamais : une panne du petit modèle
 * ou une réponse illisible sert la liste complète, en le disant.
 */
export async function filtrerListeBrain<
  T extends { found: boolean; query: string; knowledge: string; note?: string }
>(
  resultat: T,
  args: Record<string, unknown>,
  filtrer: Condenseur | undefined,
  conversationId?: string
): Promise<T> {
  if (!filtrer || !resultat.found || args.entier === true || args.entier === 'true') {
    return resultat
  }
  const { entete, notes } = decouperListeBrain(resultat.knowledge)
  // Une liste déjà courte se sert telle quelle : l'appel coûterait plus qu'il n'économise.
  if (notes.length <= FILTRE_MAX_NOTES) return resultat
  const avecNote = (ajout: string): string =>
    resultat.note ? `${resultat.note} · ${ajout}` : ajout
  try {
    const lignes = notes.map(
      (bloc, i) => `[${i + 1}] ${bloc.replace(DEBUT_CANDIDATE, '').replace(/\n/g, ' — ')}`
    )
    const reponse = await filtrer(
      `QUESTION : ${resultat.query}\n\nNOTES :\n${lignes.join('\n')}`,
      conversationId,
      'filtre'
    )
    const choisis = numerosChoisis(reponse, notes.length)
    if (choisis.length === 0) throw new Error(`réponse illisible : « ${reponse.slice(0, 60)} »`)
    // Plancher de 3 : complété par les mieux classées du serveur, jamais par une note inventée.
    for (let i = 0; choisis.length < FILTRE_MIN_NOTES && i < notes.length; i += 1) {
      if (!choisis.includes(i)) choisis.push(i)
    }
    const gardees = choisis.map((i) => notes[i])
    const enteteServi = entete.replace(/^## BRAIN D’ÉQUIPE\s*\n+/, '')
    const perso = gardees.some((bloc) => bloc.includes('`perso:'))
      ? 'Les chemins `perso:` viennent du Brain perso : garde le préfixe dans brain_read.\n\n'
      : ''
    const knowledge = `${enteteServi}${perso}${gardees.join('\n\n')}`
    return {
      ...resultat,
      knowledge,
      note: avecNote(
        `liste filtrée sur ta question par le modèle des petites tâches (${notes.length} → ${gardees.length} notes, ` +
          `${resultat.knowledge.length} → ${knowledge.length} car.) — entier: true pour la liste complète`
      )
    }
  } catch (error) {
    return {
      ...resultat,
      note: avecNote(
        `filtre indisponible (${error instanceof Error ? error.message : String(error)}) : liste complète`
      )
    }
  }
}
