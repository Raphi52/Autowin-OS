import { useEffect, useId, useMemo, useState } from 'react'
import type { ChatArtifact } from '../../../shared/artifacts'
import { useTextesArtefactsEtBandeaux } from '../textes-ecrans/artefacts-et-bandeaux'

export function ArtifactFontPreview({ artifact }: { artifact: ChatArtifact }): React.JSX.Element {
  const { t } = useTextesArtefactsEtBandeaux()
  const id = useId()
  const family = useMemo(() => `artifact-font-${id.replaceAll(':', '')}`, [id])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!artifact.content || artifact.encoding !== 'base64') return
    const face = new FontFace(family, `url(data:${artifact.mimeType};base64,${artifact.content})`)
    let active = true
    void face
      .load()
      .then((loaded) => {
        if (!active) return
        document.fonts.add(loaded)
        setReady(true)
      })
      .catch(() => setReady(false))
    return () => {
      active = false
      document.fonts.delete(face)
    }
  }, [artifact.content, artifact.encoding, artifact.mimeType, family])

  return (
    <div
      className="artifact-preview__font"
      style={ready ? { fontFamily: family } : undefined}
      data-font-loaded={ready}
    >
      <span>Aa Bb Cc · 0123456789</span>
      <small>{t('police.phraseEssai')}</small>
    </div>
  )
}
