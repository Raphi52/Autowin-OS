import { existsSync } from 'node:fs'
import type { Msg } from './conversations'

/**
 * LES PIÈCES JOINTES QUE L'ORCHESTRATION NE VOYAIT PAS.
 *
 * Vécu le 2026-08-27 : l'utilisateur joint une image et demande « fais un truc comme l'image que je
 * t'ai envoyé, plus de couleur et de lumière ». Le run répond « Je n'ai pas l'image dans ce tour
 * (elle n'est pas remontée jusqu'à moi) ». Sa réaction, mot pour mot : « ça me dérange beaucoup pour
 * un orchestrateur censé être omniscient ».
 *
 * Le sous-agent disait VRAI, et il ne pouvait pas faire autrement. Établi par lecture :
 *  - le type `Message` porte `attachments` (`providers/types.ts:28`) ;
 *  - le tour de CHAT les matérialise en fichiers temporaires et cite leurs chemins dans le prompt
 *    (`providers/claude.ts`, `materializeClaudeAttachments`) ;
 *  - l'ORCHESTRATEUR, lui, construit partout `[{ role: 'user', content: <string> }]` — quatorze
 *    sites, pas UNE mention d'`attachments`, et son entrée est `task: string`.
 * L'image était donc perdue à l'entrée même du pipeline.
 *
 * Elle n'était pourtant pas perdue sur le DISQUE : chaque pièce jointe est persistée sous
 * `chat-artifacts/<conversation>/<tour>/user-image-*.png`, et `AttachmentMeta.artifact.path` en
 * donne l'adresse. Il suffisait de la DIRE.
 *
 * Ce module rend donc le suffixe de prompt qui cite ces chemins — l'agent orchestré a `Read`, il
 * peut ouvrir le fichier. Et quand l'original n'est PAS disponible, il le dit aussi : un agent qui
 * croit avoir l'image et décrit une miniature absente est pire qu'un agent qui sait qu'il ne l'a pas.
 */

/** Ce qu'on a pu retrouver, prêt à être annoncé au run. */
export interface PiecesJointesDuTour {
  /** Chemins réellement lisibles sur le disque. */
  chemins: string[]
  /** Noms des pièces jointes dont l'original est introuvable — dits, jamais tus. */
  introuvables: string[]
  /** Le texte à coller à la tâche, ou `undefined` s'il n'y a rien à annoncer. */
  suffixe?: string
}

/**
 * Les pièces jointes du DERNIER message utilisateur — celui qui porte la demande.
 *
 * Pourquoi le dernier et non tous : une conversation de trente tours peut contenir vingt images
 * anciennes, sans rapport avec la demande courante. Les citer toutes noierait celle qui compte.
 */
export function piecesJointesDuDernierTour(
  messages: readonly Msg[],
  fichierExiste: (chemin: string) => boolean = existsSync
): PiecesJointesDuTour {
  const dernierUtilisateur = [...messages].reverse().find((message) => message.role === 'user')
  const jointes = dernierUtilisateur?.attachments ?? []
  const chemins: string[] = []
  const introuvables: string[] = []

  for (const jointe of jointes) {
    const chemin = jointe.artifact?.path
    // `originalUnavailable` est un signal EXPLICITE du store : la miniature existe, l'original non.
    // Le croire sur parole évite de proposer un chemin qui décevra à la lecture.
    if (jointe.originalUnavailable === true || !chemin || !fichierExiste(chemin)) {
      introuvables.push(jointe.name)
      continue
    }
    chemins.push(chemin)
  }

  if (chemins.length === 0 && introuvables.length === 0) return { chemins, introuvables }

  const lignes: string[] = []
  if (chemins.length > 0) {
    lignes.push(
      '',
      '',
      'PIÈCES JOINTES FOURNIES PAR L’UTILISATEUR AVEC CETTE DEMANDE :',
      ...chemins.map((chemin) => `- ${chemin}`),
      'Ouvre-les avec Read avant de répondre : elles font partie de la demande, pas du décor.'
    )
  }
  if (introuvables.length > 0) {
    // Le dire est le SEUL comportement honnête. Se taire produirait un agent qui invente ce qu'il
    // n'a pas vu ; annoncer un chemin mort produirait la même invention, en plus déroutante.
    lignes.push(
      '',
      `PIÈCE(S) JOINTE(S) ANNONCÉE(S) MAIS INTROUVABLE(S) : ${introuvables.join(', ')}.`,
      'Dis-le franchement plutôt que de deviner leur contenu.'
    )
  }
  return { chemins, introuvables, suffixe: lignes.join('\n') }
}
