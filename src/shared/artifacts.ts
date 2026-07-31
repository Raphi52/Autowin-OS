export type ArtifactEncoding = 'utf8' | 'base64'

export type ArtifactKind =
  | 'image'
  | 'vector'
  | 'markdown'
  | 'text'
  | 'code'
  | 'diff'
  | 'structured-data'
  | 'table'
  | 'diagram'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'notebook'
  | 'audio'
  | 'video'
  | 'web'
  | 'archive'
  | 'model3d'
  | 'font'
  | 'executable'
  | 'binary'

export interface ArtifactSource {
  provider: string
  model?: string
  tool?: string
  originalPath?: string
  url?: string
}

/**
 * Contrat supplier-agnostic d'un résultat produit par un modèle.
 *
 * `content` est borné par l'adaptateur provider. Les fichiers plus gros restent référencés par `path`
 * et sont lus par l'IPC sécurisé du chat, jamais via une URL `file://` exposée au renderer.
 */
export interface ChatArtifact {
  id: string
  name: string
  mimeType: string
  kind: ArtifactKind
  size: number
  createdAt: number
  encoding?: ArtifactEncoding
  content?: string
  path?: string
  url?: string
  source: ArtifactSource
}

/** Shape tolérante reçue d'un adaptateur avant normalisation et attribution. */
export interface ProviderArtifactCandidate {
  id?: string
  name?: string
  mimeType?: string
  kind?: ArtifactKind
  size?: number
  encoding?: ArtifactEncoding
  content?: string
  path?: string
  url?: string
  tool?: string
}
