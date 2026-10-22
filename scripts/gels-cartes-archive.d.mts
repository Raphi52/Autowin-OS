import type { Plugin } from 'vite'

/** Une construction archivée : l'instant d'écriture de son bundle et l'empreinte de chaque carte. */
export interface ConstructionArchivee {
  construitMs: number
  fichiers: Record<string, string>
}

export const DOSSIER_ARCHIVE_PAR_DEFAUT: string
export function cartesDuBundle(
  dossierMain: string
): Array<{ cle: string; chemin: string; ecritMs: number }>
export function lireArchive(dossierArchive: string): ConstructionArchivee[]
export function archiverCartes(options: {
  dossierMain: string
  dossierArchive: string
  maintenantMs?: number
  garderJours?: number
  garderMax?: number
}): { cartes: number; nouvelles: number; supprimees: number }
export function carteArchivee(
  entrees: readonly ConstructionArchivee[],
  cle: string,
  chargeMs: number | undefined
): { empreinte: string; construitMs: number } | undefined
export function lireCarteArchivee(dossierArchive: string, empreinte: string): unknown
export function reprendreVerrouOrphelin(verrou: string, maintenantMs?: number): boolean
export function pluginArchiveCartesGels(options?: {
  dossierArchive?: string
  racine?: string
}): Plugin
