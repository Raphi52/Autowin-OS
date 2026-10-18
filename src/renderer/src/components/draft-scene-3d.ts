/**
 * LA SCENE 3D VA DANS LE BLOC /draft — demande utilisateur, conv-318 (2026-10-17, tour
 * 5b0c4fcb-e354-410e-99b6-567740e86db1) : « le bloc 3d doit etre dans le bloc draft ».
 *
 * Avant : un /draft sur un sujet en volume (conv-315, tour a6fcfb6e-c5ce-41c9-86c8-dcde195c67f2,
 * « refais la ville de gauche du fond d'ecran de l'accueil ») rendait DEUX blocs : une scene
 * ```threejs avec ses propres boutons 0 a 6, puis, dessous, le carrousel des propositions avec des
 * fiches en texte. La procedure le prescrivait (skills/draft/SKILL.md, « les scenes restent
 * au-dessus et le carrousel vient dessous ») parce que rien ne permettait mieux : le carrousel est
 * un bloc ```html-render, que le filtre du fil vide de tout script et de tout cadre.
 *
 * Maintenant : `scripts/draft-carrousel.mjs` ecrit la scene juste AVANT son carrousel, et laisse
 * dans la scene du carrousel une place vide `<div class="dkc-3d"></div>`. Le fil reconnait la paire
 * et monte la scene DANS cette place. La scene suit la proposition affichee : a chaque changement,
 * elle recoit le rang choisi (`autowin.surChoix`, pose par `src/renderer/scene-3d/choix-scene.mjs`).
 */
import type { MarkdownBlock } from './markdown-blocs'
import { CLASSE_PLACE_SCENE } from '../../scene-3d/choix-scene.mjs'

export { CLASSE_PLACE_SCENE, codeSceneDuCarrousel } from '../../scene-3d/choix-scene.mjs'

const PLACE_SCENE = new RegExp(String.raw`\bclass\s*=\s*["'][^"']*\b${CLASSE_PLACE_SCENE}\b`)

/** Un bloc du fil ; un carrousel /draft peut porter la scene qui va dans sa place. */
export type BlocDuFil = MarkdownBlock & { scene?: string }

/**
 * Rattache chaque scene ```threejs au carrousel /draft qui la SUIT et qui lui laisse une place.
 * Seul du blanc peut les separer. Une scene sans carrousel, ou un carrousel sans place, reste
 * tel quel.
 */
export function rattacherScenesAuxCarrousels(blocs: readonly MarkdownBlock[]): BlocDuFil[] {
  const sortie: BlocDuFil[] = []
  for (let i = 0; i < blocs.length; i += 1) {
    const bloc = blocs[i]
    if (bloc.kind === 'scene-3d') {
      let j = i + 1
      while (j < blocs.length && blocs[j].kind === 'text' && !blocs[j].content.trim()) j += 1
      const suivant = blocs[j]
      if (suivant?.kind === 'html-render' && PLACE_SCENE.test(suivant.content)) {
        sortie.push({ ...suivant, scene: bloc.content })
        i = j
        continue
      }
    }
    sortie.push(bloc)
  }
  return sortie
}

/**
 * Rang (a partir de 1) de la proposition affichee par le carrousel : sa case radio cochee. Les
 * identifiants du bloc sont prefixes par le filtre du fil ; on compte donc les cases, pas leurs noms.
 */
export function rangChoisi(racine: ParentNode): number {
  const cases = Array.from(
    racine.querySelectorAll<HTMLInputElement>('.dkc-car > input[type="radio"]')
  )
  const rang = cases.findIndex((element) => element.checked)
  return rang < 0 ? 1 : rang + 1
}
