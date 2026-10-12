import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { ChatArtifact } from '../shared/artifacts'
import { artifactKindFor, normalizeProviderArtifacts } from './providers/artifacts'
import { MAX_PERSISTED_ARTIFACT_BYTES } from './store/chat-artifact-store'
import { mesurerVideo } from './video-ffprobe'

/**
 * `show_video` — MONTRER DANS LE FIL UNE VIDÉO DU DOSSIER DE TRAVAIL (conv-253, 2026-10-11).
 *
 * Cause : une carte du fil ne naît que d'un bloc image/fichier d'un outil natif (`claude.ts`) ou
 * d'une capture IMAGE de commande (`agent-pilot.ts`). Un MP4 rendu par ffmpeg dans un shell ne
 * passe par aucun des deux : le film B6 n'est jamais arrivé dans le fil, donc l'utilisateur ne
 * pouvait pas en pointer une image.
 *
 * La carte part par `CommandResult.artifacts`, JAMAIS par `attachments` (ce champ alimente le
 * prochain message du modèle IA : la vidéo n'a rien à y faire). Seul le CHEMIN est porté ; les
 * octets sont copiés dans le stockage du fil par `materializeChatArtifact`, qui garde le chemin
 * d'origine dans `source.originalPath` — c'est lui que cite la référence pointée.
 *
 * Chaque refus est NOMMÉ : `normalizeProviderArtifacts` écarte en silence un chemin hors du
 * dossier, ce qui laisserait l'agent croire la carte montrée.
 *
 * Images/s : MESURÉES par ffprobe (`video-ffprobe.ts`), jamais prises de l'agent. Une valeur donnée
 * par l'agent masquerait l'échec d'ffprobe, que l'utilisateur veut voir affiché « 30 supposé ».
 */

export type VideoAMontrer =
  | { ok: true; artifact: ChatArtifact; resume: Record<string, unknown> }
  | { ok: false; raison: string }

function megaOctets(octets: number): string {
  return `${Math.round(octets / 1024 / 1024)} Mo`
}

export async function preparerVideoAMontrer(
  args: Record<string, unknown>,
  dossierDeTravail: string,
  maxOctets = MAX_PERSISTED_ARTIFACT_BYTES
): Promise<VideoAMontrer> {
  const demande = typeof args.path === 'string' ? args.path.trim() : ''
  if (demande === '') return { ok: false, raison: 'chemin manquant : `path` est obligatoire' }
  const racine = resolve(dossierDeTravail)
  const absolu = isAbsolute(demande) ? resolve(demande) : resolve(racine, demande)
  const rel = relative(racine, absolu)
  if (rel.startsWith('..') || isAbsolute(rel))
    return {
      ok: false,
      raison: `${demande} est hors du dossier de travail (${racine}) : seule une vidéo de ce dossier peut être montrée`
    }
  if (!existsSync(absolu)) return { ok: false, raison: `fichier introuvable : ${demande}` }
  const stats = statSync(absolu)
  if (!stats.isFile()) return { ok: false, raison: `${demande} n'est pas un fichier` }
  if (artifactKindFor(basename(absolu)) !== 'video')
    return { ok: false, raison: `${demande} n'est pas une vidéo (.mp4, .webm, .mov…)` }
  if (stats.size > maxOctets)
    return {
      ok: false,
      raison: `${demande} pèse ${megaOctets(stats.size)} : au-delà de la limite de conservation du fil (${megaOctets(maxOctets)})`
    }
  const [carte] = normalizeProviderArtifacts([{ path: absolu, tool: 'show_video' }], {
    provider: 'autowin',
    workspaceRoot: racine
  })
  if (!carte) return { ok: false, raison: `${demande} n'a pas pu être converti en carte` }
  const mesure = await mesurerVideo(absolu)
  // ffprobe a FONCTIONNÉ et dit « pas une vidéo » (son seul, ou fichier illisible comme vidéo :
  // texte, JSON, octets renommés) : refus nommé ; « 30 supposé » ne vaut que quand ffprobe échoue.
  // fix-ok: conv-253 — ffprobe 8.0.1 (mesuré) rend code 0 et `streams: []` sur un .mp4 son seul, et
  // code 1 + « Invalid data found when processing input » sur un texte renommé ; les deux partaient
  // en « 30 supposé » avec un lecteur vide. Sans ce refus, commands.show-video.test.ts « ffprobe
  // répond SANS flux vidéo » est rouge (code 1), vert avec.
  if (!mesure.ok && mesure.sansFluxVideo)
    return {
      ok: false,
      raison: `${demande} ne contient aucune image vidéo (ffprobe : ${mesure.raison}) : rien à montrer`
    }
  // Un identifiant par APPEL : montrer deux fois le même film donne deux cartes, pas un doublon
  // écarté plus loin par identifiant.
  const artifact: ChatArtifact = {
    ...carte,
    id: `${carte.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...(mesure.ok ? { fps: mesure.fps } : {}),
    ...(mesure.ok && mesure.images !== undefined ? { images: mesure.images } : {})
  }
  return {
    ok: true,
    artifact,
    resume: {
      montre: true,
      nom: artifact.name,
      chemin: absolu,
      octets: artifact.size,
      fps: mesure.ok ? mesure.fps : `non mesuré (${mesure.raison}) — le lecteur affiche 30 supposé`,
      ...(mesure.ok && mesure.images !== undefined ? { images: mesure.images } : {})
    }
  }
}
