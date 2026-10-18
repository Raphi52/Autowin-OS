import type { Plugin } from 'vite'

export const NOM_PAGE_SCENE_3D: 'scene-3d.html'
export function empreinteScript(texte: string): string
export function politiqueScene3d(empreintes: string[]): string
export function construirePageScene3d(options?: { dossier?: string }): Promise<string>
export function pluginScene3d(options?: { dossier?: string }): Plugin
