import { compareModelsByName, type NamedRuntimeModel } from './model-name-order'

/**
 * LA liste de modèles affichable — une seule définition pour toutes les vues.
 *
 * Il en existait trois, et elles ne montraient pas la même chose :
 *  - « Modèles & topologie » filtrait sur `dynamicallyLoaded === true` ;
 *  - « Routage » ne filtrait rien, d'où le symptôme signalé le 2026-08-06 : les entrées ALIAS du CLI
 *    Claude (`claude/opus`, `claude/sonnet`, `claude/fable`) portent le label du modèle concret le
 *    plus récent de leur famille (`models.ts`, `claudeAliasModels`), donc « Claude Opus 5 · CLI »
 *    apparaissait DEUX fois — une fois comme pointeur, une fois comme version ;
 *  - « TaskManager » dédoublonne par nom affiché, encore une autre règle.
 *
 * La définition retenue est celle de « Modèles & topologie », par décision explicite de
 * l'utilisateur : seuls les modèles DÉCOUVERTS dynamiquement. Conséquence assumée et signalée
 * avant le choix : les modèles kimi et gemini, qui sont des constantes de `DEFAULT_IMPORTED_MODELS`
 * et ne portent jamais ce drapeau, n'apparaissent dans AUCUNE liste de modèles.
 *
 * Ce que cette fonction ne doit PAS servir à filtrer : la liste des PROVIDERS. Un provider sans
 * modèle listé garde sa carte et son statut d'authentification — sinon Routage perdrait justement
 * l'écran qui sert à voir cet état. Voir `agentStudioProviderIds`, qui part du catalogue complet.
 */
export function libraryModels<T extends NamedRuntimeModel & { dynamicallyLoaded?: boolean }>(
  models: readonly T[]
): T[] {
  return models.filter((model) => model.dynamicallyLoaded === true).sort(compareModelsByName)
}
