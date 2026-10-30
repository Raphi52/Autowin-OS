import type { Plugin } from 'vite'

export const NOM_PAGE_SCENE_3D: 'scene-3d.html'
export const NOM_PAGE_INTERACTIVE: 'page-interactive.html'
export const ID_MOTEUR_3D: 'autowin-moteur-3d'
export function empreinteScript(texte: string): string
export function politiqueScene3d(empreintes: string[]): string
export function construirePageScene3d(options?: {
  dossier?: string
  avecMoteur?: boolean
}): Promise<string>
export function pluginScene3d(options?: { dossier?: string }): Plugin
