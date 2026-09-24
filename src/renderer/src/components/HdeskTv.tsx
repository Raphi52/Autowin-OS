/**
 * PETITE TV DU BUREAU CACHE (conv-528, 2026-09-13) : « quand tu bosses en arriere plan j'aimerais
 * une petite TV dans la conv qui me montre ce qui se passe dans le hdesk en temps reel ».
 * Lecture seule. Une image toutes les ~1,5 s, en boucle SANS chevauchement (la suivante part quand
 * la precedente est rendue). Pause quand la fenetre est masquee ; arret quand on ferme la TV.
 * Cas limites : aucun bureau -> rien ; plusieurs -> un onglet par travail ; bureau ferme pendant
 * qu'on regarde -> on le dit (et on bascule s'il en reste) ; capture unie -> on le dit.
 */
import { useEffect, useRef, useState } from 'react'
import type { BureauTv, ImageTv } from '../../../main/hdesk-tv'

export interface HdeskTvApi {
  hdeskTvBureaux: (conversationId?: string) => Promise<BureauTv[]>
  hdeskTvImage: (id: string) => Promise<ImageTv>
  hdeskTvArreter: () => Promise<void>
}

interface Props {
  conversationId?: string | null
  api?: HdeskTvApi
  intervalleMs?: number
}

const BOUTON_TV = {
  background: 'var(--surface-inset, rgba(255,255,255,.045))',
  border: '1px solid var(--border, rgba(255,255,255,.13))',
  borderRadius: 4,
  color: 'var(--text-dim, #a9b2c4)',
  fontSize: 11,
  padding: '1px 6px',
  cursor: 'pointer'
} as const

export function HdeskTv({
  conversationId,
  api,
  // 500 ms (conv-540) : la boucle ne se chevauche pas, donc la cadence reelle = max(500, duree capture).
  intervalleMs = 500
}: Props): React.JSX.Element | null {
  const [bureaux, setBureaux] = useState<BureauTv[]>([])
  const [choisi, setChoisi] = useState<string | null>(null)
  const [image, setImage] = useState<ImageTv | null>(null)
  const [ferme, setFerme] = useState<BureauTv | null>(null)
  const [masquee, setMasquee] = useState(false)
  const [grand, setGrand] = useState(false)
  const choisiRef = useRef<string | null>(null)
  const connusRef = useRef<BureauTv[]>([])

  useEffect(() => {
    const cible = api ?? (window as unknown as { api?: Partial<HdeskTvApi> }).api
    if (masquee || !cible?.hdeskTvBureaux || !cible.hdeskTvImage) return
    const a = cible as HdeskTvApi
    let actif = true
    let minuterie: ReturnType<typeof setTimeout> | null = null

    const tour = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.hidden) return
      let liste: BureauTv[]
      try {
        liste = await a.hdeskTvBureaux(conversationId ?? undefined)
      } catch {
        return
      }
      if (!actif) return
      const precedent = choisiRef.current
      let courant = precedent && liste.some((b) => b.id === precedent) ? precedent : null
      if (precedent && !courant) {
        setFerme(
          connusRef.current.find((b) => b.id === precedent) ?? { id: precedent, travail: precedent }
        )
      }
      if (!courant && liste.length > 0) courant = liste[0].id
      if (courant && courant !== precedent && precedent === null) setFerme(null)
      choisiRef.current = courant
      connusRef.current = liste
      setBureaux(liste)
      setChoisi(courant)
      if (!courant) {
        setImage(null)
        return
      }
      const img = await a
        .hdeskTvImage(courant)
        .catch((e: unknown): ImageTv => ({ statut: 'erreur', id: courant!, message: String(e) }))
      if (!actif || choisiRef.current !== img.id) return
      if (img.statut === 'ferme') {
        setFerme(liste.find((b) => b.id === img.id) ?? { id: img.id, travail: img.id })
        choisiRef.current = null
        setChoisi(null)
        setImage(null)
        return
      }
      setImage(img)
    }

    const boucle = async (): Promise<void> => {
      await tour()
      if (actif) minuterie = setTimeout(() => void boucle(), intervalleMs)
    }
    void boucle()
    return () => {
      actif = false
      if (minuterie) clearTimeout(minuterie)
    }
  }, [api, conversationId, intervalleMs, masquee])

  const choisir = (id: string): void => {
    choisiRef.current = id
    setChoisi(id)
    setImage(null)
    setFerme(null)
  }

  const fermerTv = (): void => {
    setMasquee(true)
    const cible = api ?? (window as unknown as { api?: Partial<HdeskTvApi> }).api
    void cible?.hdeskTvArreter?.()
  }

  // Aucun bureau actif et rien a annoncer : la TV n'existe pas.
  if (masquee || (bureaux.length === 0 && !ferme)) return null

  const travailChoisi = bureaux.find((b) => b.id === choisi)
  return (
    <section
      className="msg assistant hdesk-tv"
      data-testid="hdesk-tv"
      aria-label="Aperçu en direct du bureau caché"
    >
      <div className="msg-meta">
        <span className="msg-role">Bureau caché</span>
      </div>
      <div
        style={{
          padding: '6px 0',
          background: 'transparent',
          borderTop: '1px solid transparent',
          borderBottom: '1px solid transparent',
          borderImage: 'linear-gradient(90deg, rgba(212,169,79,.55), rgba(212,169,79,.06)) 1',
          width: '100%',
          maxWidth: grand ? 760 : 420,
          fontSize: 12,
          color: 'var(--text, #dde3ee)'
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            aria-hidden
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 10,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'var(--gold, #d4a94f)'
            }}
          >
            📺 en direct
          </span>
          {bureaux.length > 1 ? (
            bureaux.map((b) => (
              <button
                key={b.id}
                type="button"
                data-testid="hdesk-tv-onglet"
                aria-pressed={b.id === choisi}
                onClick={() => choisir(b.id)}
                style={
                  b.id === choisi
                    ? { ...BOUTON_TV, borderColor: '#e3ba55', color: '#e3ba55' }
                    : BOUTON_TV
                }
              >
                {b.travail}
              </button>
            ))
          ) : (
            <span data-testid="hdesk-tv-travail" style={{ fontWeight: 600 }}>
              {travailChoisi?.travail ?? ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setGrand((g) => !g)}
            style={BOUTON_TV}
            aria-label={grand ? 'Réduire' : 'Agrandir'}
          >
            {grand ? '▭' : '⛶'}
          </button>
          <button
            type="button"
            onClick={fermerTv}
            style={BOUTON_TV}
            aria-label="Fermer l'aperçu"
            data-testid="hdesk-tv-fermer"
          >
            ×
          </button>
        </div>
        {ferme && (
          <p data-testid="hdesk-tv-ferme" style={{ margin: '4px 0', color: 'var(--text-dim, #a9b2c4)' }}>
            Le bureau « {ferme.travail} » s&apos;est fermé.
          </p>
        )}
        {image?.statut === 'uni' && (
          <p data-testid="hdesk-tv-uni" style={{ margin: '4px 0' }}>
            Capture unie : rien d&apos;observable (l&apos;app dessine peut-être par la carte
            graphique).
          </p>
        )}
        {image?.statut === 'erreur' && (
          <p data-testid="hdesk-tv-erreur" style={{ margin: '4px 0' }}>
            Capture impossible : {image.message}
          </p>
        )}
        {(image?.statut === 'ok' || image?.statut === 'uni') && (
          <img
            data-testid="hdesk-tv-image"
            src={image.dataUrl}
            alt={`Bureau caché — ${travailChoisi?.travail ?? image.id}`}
            style={{
              width: '100%',
              display: 'block',
              marginTop: 6,
              borderRadius: 4,
              opacity: image.statut === 'uni' ? 0.5 : 1
            }}
          />
        )}
      </div>
    </section>
  )
}
