/**
 * Les sources de veille : où les scouts vont lire.
 *
 * Chaque URL de cette liste a été RÉCUPÉRÉE le 2026-08-13 avant d'être inscrite ici — aucune n'est
 * posée de mémoire. Les URL évidentes qui ne répondaient pas sont absentes plutôt que gardées « au cas
 * où » : `docs.x.ai/docs/changelog` et `docs.bigmodel.cn/en/changelog` sont injoignables,
 * `platform.moonshot.ai/docs/changelog` répond mais ne publie pas de notes de version.
 *
 * La liste est OUVERTE : elle n'est pas la limite de la veille, elle en est le point de départ. Un scout
 * peut suivre un lien depuis la page qu'il lit, et un concurrent qui apparaît demain s'ajoute ici.
 * Ce qui n'est pas négociable est ailleurs : ce que le scout RAPPORTE doit porter son URL et sa citation.
 */

export interface SourceVeille {
  concurrent: string
  url: string
  /** Ce qu'on sait de cette source, y compris ce qui cloche. */
  note?: string
}

export const SOURCES_VEILLE: readonly SourceVeille[] = [
  {
    concurrent: 'Claude Code',
    url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md',
    // Le fichier brut plutôt que la page GitHub : la page rend du HTML autour du contenu, le brut
    // donne directement les lignes de version — donc une citation plus facile à retrouver ensuite.
    note: 'fichier brut ; les entrées portent le numéro de version, pas toujours une date'
  },
  { concurrent: 'Codex', url: 'https://github.com/openai/codex/releases' },
  { concurrent: 'OpenCode', url: 'https://github.com/sst/opencode/releases' },
  { concurrent: 'Antigravity', url: 'https://antigravity.google/changelog' },
  { concurrent: 'Grok', url: 'https://docs.x.ai/developers/release-notes' },
  { concurrent: 'GLM', url: 'https://docs.z.ai/release-notes' },
  {
    concurrent: 'Kimi',
    url: 'https://platform.kimi.ai/blog/posts/changelog',
    // À SURVEILLER : au 2026-08-13, la dernière entrée lue datait de novembre 2025. Soit la page est
    // abandonnée, soit c'est une archive. Une source qui ne bouge plus doit se voir — c'est pour ce
    // genre de cas que la passe conserve et affiche ses échecs au lieu de rendre zéro en silence.
    note: 'derniere entree lue en novembre 2025 — verifier si la page vit encore'
  }
]
