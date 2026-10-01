/**
 * PETITE TV DU BUREAU CACHE (conv-528, 2026-09-13) : « quand tu bosses en arriere plan j'aimerais
 * une petite TV dans la conv qui me montre ce qui se passe dans le hdesk en temps reel ».
 * Lecture seule. Une image toutes les ~1,5 s, en boucle SANS chevauchement (la suivante part quand
 * la precedente est rendue). Pause quand la fenetre est masquee ; arret quand on ferme la TV.
 * Cas limites : aucun bureau -> rien ; plusieurs -> un onglet par travail ; bureau ferme pendant
 * qu'on regarde -> on le dit (et on bascule s'il en reste) ; capture unie -> on le dit.
 */
import { useEffect, useRef, useState } from 'react'
import type { BureauTv, GesteTv, ImageTv, ResultatGeste } from '../../../main/hdesk-tv'

/**
 * Touche du champ de la TV -> touche nommée de hdesk-act. Entrée reste le « valider » du formulaire.
 * Ctrl+A/C/V/X/Z ne partent au bureau caché que si le champ de la TV est VIDE : sinon ils agissent sur
 * le champ lui-même (corriger sa frappe avant l'envoi).
 */
export function toucheTv(e: { key: string; ctrlKey?: boolean; currentTarget?: unknown; target?: unknown }, champVide = true): string | null {
  const directes: Record<string, string> = {
    Tab: 'Tab', Escape: 'Echap', Delete: 'Suppr', ArrowUp: 'Haut', ArrowDown: 'Bas', ArrowLeft: 'Gauche',
    ArrowRight: 'Droite', Home: 'Debut', End: 'Fin', PageUp: 'PageHaut', PageDown: 'PageBas'
  }
  if (e.ctrlKey) {
    const k = e.key.toLowerCase()
    return champVide && ['a', 'c', 'v', 'x', 'z'].includes(k) ? `Ctrl${k.toUpperCase()}` : null
  }
  if (e.key === 'Backspace') return champVide ? 'Retour' : null
  const d = directes[e.key]
  if (!d) return null
  // Flèches/Début/Fin dans un champ non vide : édition locale du champ de la TV.
  if (!champVide && ['Gauche', 'Droite', 'Debut', 'Fin', 'Suppr'].includes(d)) return null
  return d
}

export interface HdeskTvApi {
  hdeskTvBureaux: (conversationId?: string) => Promise<BureauTv[]>
  hdeskTvImage: (id: string) => Promise<ImageTv>
  hdeskTvArreter: () => Promise<void>
  /** TV interactive (conv-35) : clic puis frappe éventuelle, envoyés au bureau caché. */
  hdeskTvAct?: (geste: GesteTv) => Promise<ResultatGeste>
  /** Option (conv-35) : bascule l'écran réel vers le bureau caché, retour garanti par le script. */
  hdeskTvBasculer?: (id: string) => Promise<{ ok: boolean; message?: string }>
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

/**
 * MASQUAGE MEMORISE HORS DU COMPOSANT (retour utilisateur 2026-09-24, conv-536) : « il reapparait
 * meme si j'ai clique sur le bouton des que je reposte un message ». Le composant est remonte a
 * chaque envoi, donc un simple useState perdait le choix. On retient, par conversation, les bureaux
 * deja masques : la TV ne revient que si un bureau NOUVEAU apparait dans ce fil.
 */
// Rangé dans sessionStorage et non en memoire du module : un rechargement complet de l'interface
// (mise a jour a chaud d'un fichier partage) vidait la memoire et la TV revenait (conv-536).
const CLE_STOCKAGE = 'autowin.hdesk-tv.masques'
function lireMasques(): Record<string, string[]> {
  try {
    const brut = JSON.parse(globalThis.sessionStorage?.getItem(CLE_STOCKAGE) ?? '{}')
    return brut && typeof brut === 'object' ? (brut as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}
function ecrireMasques(masques: Record<string, string[]>): void {
  try {
    globalThis.sessionStorage?.setItem(CLE_STOCKAGE, JSON.stringify(masques))
  } catch {
    // Stockage indisponible : le masquage vaut alors jusqu'au prochain rechargement seulement.
  }
}
const bureauxMasques = {
  has: (cle: string): boolean => cle in lireMasques(),
  get: (cle: string): Set<string> | undefined => {
    const ids = lireMasques()[cle]
    return ids ? new Set(ids) : undefined
  },
  set: (cle: string, ids: Set<string>): void => ecrireMasques({ ...lireMasques(), [cle]: [...ids] }),
  delete: (cle: string): void => {
    const { [cle]: _retire, ...reste } = lireMasques()
    ecrireMasques(reste)
  }
}
/** Cadence du guet quand la TV est masquee : la liste seule, jamais d'image. */
const GUET_MS = 5000
const cleMasquage = (conversationId?: string | null): string => conversationId ?? ''

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
  const [masquee, setMasquee] = useState(() => bureauxMasques.has(cleMasquage(conversationId)))
  const [grand, setGrand] = useState(false)
  const [dernierClic, setDernierClic] = useState<{ id: string; x: number; y: number } | null>(null)
  const [texte, setTexte] = useState('')
  const [retourGeste, setRetourGeste] = useState<string | null>(null)
  const choisiRef = useRef<string | null>(null)
  const apiAct = (): HdeskTvApi['hdeskTvAct'] =>
    (api ?? (window as unknown as { api?: Partial<HdeskTvApi> }).api)?.hdeskTvAct
  // File des gestes : un geste attend la fin du précédent, sinon deux hdesk-act se chevauchent
  // dans le même bureau (clic du second pendant la frappe du premier).
  const fileRef = useRef<Promise<void>>(Promise.resolve())
  const rafraichirRef = useRef<(() => void) | null>(null)
  const envoyer = (geste: GesteTv): Promise<void> => {
    const agir = apiAct()
    if (!agir) return Promise.resolve()
    fileRef.current = fileRef.current.then(async () => {
      const r = await agir(geste).catch((e: unknown) => ({ ok: false as const, message: String(e) }))
      setRetourGeste(r.ok ? null : `Action refusée : ${r.message}`)
      // Rafraîchir tout de suite : sans cela l'effet du geste n'apparaît qu'au tour suivant de la boucle.
      rafraichirRef.current?.()
    })
    return fileRef.current
  }
  const apiBasculer = (): HdeskTvApi['hdeskTvBasculer'] =>
    (api ?? (window as unknown as { api?: Partial<HdeskTvApi> }).api)?.hdeskTvBasculer
  // Geste sur l'ÉCRAN RÉEL : confirmation explicite à chaque fois.
  const basculer = async (): Promise<void> => {
    const f = apiBasculer()
    if (!f || !choisi) return
    const ok = window.confirm(
      'Ton écran va afficher le bureau caché.\n' +
        'Pour revenir : bouton « Revenir à mon bureau », Ctrl+Alt+Origine, ou automatiquement après 2 minutes.\n' +
        'Continuer ?'
    )
    if (!ok) return
    const r = await f(choisi).catch((e: unknown) => ({ ok: false, message: String(e) }))
    setRetourGeste(r.ok ? null : `Bascule refusée : ${r.message ?? ''}`)
  }
  // Le clic dans l'image réduite est ramené aux coordonnées de la capture (x * largeur / largeur affichée).
  // fix-ok: cause mesurée — le clic sortait sur `statut !== 'ok'` alors qu'une page web sort unie (test image unie rouge→vert) ; la frappe remontait au chat faute de stopPropagation ; deux gestes se chevauchaient sans file (tests rouges reproduits puis verts).
  const cliquerImage = (e: React.MouseEvent<HTMLImageElement>): void => {
    if (image?.statut !== 'ok' && image?.statut !== 'uni') return
    // Une capture unie (page web) ne porte pas sa taille : on prend celle de l'image reçue.
    const largeur = image.statut === 'ok' ? image.width : e.currentTarget.naturalWidth
    const hauteur = image.statut === 'ok' ? image.height : e.currentTarget.naturalHeight
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height || !largeur || !hauteur) return
    const x = Math.round(((e.clientX - rect.left) * largeur) / rect.width)
    const y = Math.round(((e.clientY - rect.top) * hauteur) / rect.height)
    setDernierClic({ id: image.id, x, y })
    void envoyer({ id: image.id, x, y })
  }
  // La frappe vise la fenêtre du dernier point cliqué SANS recliquer : un reclic déplacerait le curseur
  // posé par les flèches ou Début/Fin entre deux frappes.
  const taper = (entree: boolean): void => {
    if (!dernierClic || (!texte && !entree)) return
    void envoyer({ ...dernierClic, texte, entree, sansClic: true })
    setTexte('')
  }
  // Molette sur l'image : 1 cran par tranche de 100 px de deltaY (bas = négatif, comme Windows).
  const molette = (e: React.WheelEvent<HTMLImageElement>): void => {
    if (image?.statut !== 'ok' && image?.statut !== 'uni') return
    const largeur = image.statut === 'ok' ? image.width : e.currentTarget.naturalWidth
    const hauteur = image.statut === 'ok' ? image.height : e.currentTarget.naturalHeight
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height || !largeur || !hauteur || !e.deltaY) return
    const crans = Math.max(-20, Math.min(20, -Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 100))))
    const x = Math.round(((e.clientX - rect.left) * largeur) / rect.width)
    const y = Math.round(((e.clientY - rect.top) * hauteur) / rect.height)
    void envoyer({ id: image.id, x, y, molette: crans })
  }
  const connusRef = useRef<BureauTv[]>([])

  useEffect(() => {
    const cible = api ?? (window as unknown as { api?: Partial<HdeskTvApi> }).api
    if (!cible?.hdeskTvBureaux || !cible.hdeskTvImage) return
    const a = cible as HdeskTvApi
    let actif = true
    let minuterie: ReturnType<typeof setTimeout> | null = null

    // TV masquee : on ne capture plus, on surveille seulement la LISTE (peu couteux) pour reapparaitre
    // quand un bureau jamais masque arrive.
    const guetter = async (): Promise<void> => {
      const deja = bureauxMasques.get(cleMasquage(conversationId)) ?? new Set<string>()
      const liste = await a.hdeskTvBureaux(conversationId ?? undefined).catch(() => [] as BureauTv[])
      if (!actif) return
      if (liste.some((b) => !deja.has(b.id))) {
        bureauxMasques.delete(cleMasquage(conversationId))
        setMasquee(false)
        return
      }
      minuterie = setTimeout(() => void guetter(), GUET_MS)
    }
    if (masquee) {
      minuterie = setTimeout(() => void guetter(), GUET_MS)
      return () => {
        actif = false
        if (minuterie) clearTimeout(minuterie)
      }
    }

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

    let enCours = false
    let encore = false
    const boucle = async (): Promise<void> => {
      if (enCours) {
        encore = true
        return
      }
      enCours = true
      if (minuterie) clearTimeout(minuterie)
      minuterie = null
      await tour()
      enCours = false
      if (!actif) return
      if (encore) {
        encore = false
        void boucle()
      } else minuterie = setTimeout(() => void boucle(), intervalleMs)
    }
    rafraichirRef.current = () => void boucle()
    void boucle()
    return () => {
      rafraichirRef.current = null
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
    bureauxMasques.set(
      cleMasquage(conversationId),
      new Set([...connusRef.current.map((b) => b.id), ...(ferme ? [ferme.id] : [])])
    )
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
          {apiBasculer() && choisi ? (
            <button
              type="button"
              onClick={() => void basculer()}
              style={BOUTON_TV}
              aria-label="Basculer mon écran sur ce bureau"
              title="Basculer mon écran sur ce bureau (retour : bouton Revenir, Ctrl+Alt+Origine ou 2 min)"
              data-testid="hdesk-tv-basculer"
            >
              ⇄
            </button>
          ) : null}
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
              opacity: image.statut === 'uni' ? 0.5 : 1,
              cursor: apiAct() ? 'crosshair' : undefined
            }}
            onClick={cliquerImage}
            onWheel={molette}
          />
        )}
        {(image?.statut === 'ok' || image?.statut === 'uni') && apiAct() && (
          <form
            data-testid="hdesk-tv-saisie"
            onSubmit={(e) => {
              e.preventDefault()
              taper(true)
            }}
            // La frappe destinée au bureau caché ne doit pas déclencher les raccourcis du chat.
            onKeyDown={(e) => {
              e.stopPropagation()
              const t = toucheTv(e, !texte)
              if (!t || !dernierClic || dernierClic.id !== image.id) return
              // Touche spéciale : le texte en cours part d'abord, la touche ensuite (ordre de frappe).
              e.preventDefault()
              if (texte) {
                void envoyer({ ...dernierClic, texte, sansClic: true })
                setTexte('')
              }
              void envoyer({ ...dernierClic, touche: t, sansClic: true })
            }}
            style={{ display: 'flex', gap: 4, marginTop: 4 }}
          >
            <input
              data-testid="hdesk-tv-texte"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              disabled={!dernierClic || dernierClic.id !== image.id}
              placeholder={
                dernierClic && dernierClic.id === image.id
                  ? 'Texte à taper au point cliqué (Entrée = valider)'
                  : "Clique d'abord dans l'image pour viser un champ"
              }
              style={{ flex: 1, fontSize: 12 }}
            />
            <button
              type="button"
              style={BOUTON_TV}
              data-testid="hdesk-tv-taper"
              disabled={!dernierClic || dernierClic.id !== image.id || !texte}
              onClick={() => taper(false)}
            >
              Taper
            </button>
          </form>
        )}
        {retourGeste && (
          <p data-testid="hdesk-tv-geste-erreur" style={{ margin: '4px 0' }}>
            {retourGeste}
          </p>
        )}
      </div>
    </section>
  )
}
