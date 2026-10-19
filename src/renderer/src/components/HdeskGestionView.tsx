/**
 * VUE « BUREAUX CACHÉS » (conv-951, 2026-10-16) : « j'aimerais une view dédiée pour gérer tous mes
 * Hdesk, pouvoir les fermer, les créer et tout ; j'adore cette feature mais y a pas d'interface pour
 * bien la gérer ». La petite TV du chat (HdeskTv) ne montre que les bureaux du fil ouvert ; ici, TOUS
 * les bureaux vivants, avec aperçu, Fermer, Afficher sur mon écran (⇄) et Créer.
 * Cas limites : aucun bureau -> état vide + bouton Créer ; liste illisible -> erreur dite, jamais une
 * liste vide ; bureau sans fiche -> listé « travail non relié », Fermer le ferme sans fiche (conv-344) ; fermeture en
 * cours -> bouton désactivé (double clic sans effet) ; saisie invalide -> refusée AVANT tout lancement ;
 * identifiant occupé -> l'identifiant libre est proposé, jamais relancé tout seul.
 */
import { useEffect, useRef, useState } from 'react'
import type { ImageTv } from '../../../main/hdesk-tv'
import {
  CREATION_ATTENTE_MS,
  FIL_MANUEL,
  refusCreation,
  type BureauGere,
  type DemandeCreationBureau,
  type ResultatCreationBureau,
  type ResultatFermetureGeree,
  type ResultatListeBureaux
} from '../../../shared/hdesk-gestion'
import { ViewTopBar } from './ViewTopBar'
import './ViewPage.css'
import './HdeskGestionView.css'

export interface HdeskGestionApi {
  hdeskGestionBureaux: () => Promise<ResultatListeBureaux>
  hdeskGestionFermer: (id: string) => Promise<ResultatFermetureGeree>
  hdeskGestionCreer: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  /** Aperçu et bascule : mêmes canaux que la petite TV du chat. */
  hdeskTvImage?: (id: string) => Promise<ImageTv>
  hdeskTvBasculer?: (id: string) => Promise<{ ok: boolean; message?: string }>
}

interface Props {
  active: boolean
  api?: HdeskGestionApi
  intervalleMs?: number
}

type Formulaire = Required<DemandeCreationBureau>
const FORMULAIRE_VIDE: Formulaire = {
  id: '',
  executable: '',
  arguments: '',
  travail: '',
  conversationId: ''
}

const quand = (iso?: string): string => {
  if (!iso) return 'inconnu'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

const nomDeFichier = (chemin: string): string => chemin.split(/[\\/]/).pop() || chemin

/** La prop `api` (tests) ou le pont réel. */
const cibleDe = (api?: HdeskGestionApi): Partial<HdeskGestionApi> | undefined =>
  api ?? (window as unknown as { api?: Partial<HdeskGestionApi> }).api

export function HdeskGestionView({ active, api, intervalleMs = 4000 }: Props): React.JSX.Element {
  const cible = (): Partial<HdeskGestionApi> | undefined => cibleDe(api)
  const [liste, setListe] = useState<ResultatListeBureaux | null>(null)
  const [images, setImages] = useState<Record<string, ImageTv>>({})
  const [enFermeture, setEnFermeture] = useState<ReadonlySet<string>>(new Set())
  const [retours, setRetours] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [formOuvert, setFormOuvert] = useState(false)
  const [form, setForm] = useState<Formulaire>(FORMULAIRE_VIDE)
  const [creationEnCours, setCreationEnCours] = useState(false)
  const [retourCreation, setRetourCreation] = useState<ResultatCreationBureau | null>(null)
  const rafraichirRef = useRef<(() => void) | null>(null)
  // fix-ok: pont absent = fait DÉRIVÉ du rendu, pas un état posé dans l'effet (lint 2026-10-16 :
  // setState synchrone dans un effet, rendus en cascade).
  const indisponible = !cibleDe(api)?.hdeskGestionBureaux
  const etatListe: ResultatListeBureaux | null = indisponible
    ? { ok: false, message: 'Bureaux cachés indisponibles dans cette version.' }
    : liste

  useEffect(() => {
    if (!active) return
    const a = cibleDe(api)
    if (!a?.hdeskGestionBureaux) return
    let actif = true
    let minuterie: ReturnType<typeof setTimeout> | null = null
    let enCours = false
    let encore = false

    const tour = async (): Promise<void> => {
      if (typeof document !== 'undefined' && document.hidden) return
      const r = await a.hdeskGestionBureaux!().catch((e: unknown): ResultatListeBureaux => ({
        ok: false,
        message: String(e)
      }))
      if (!actif) return
      setListe(r)
      if (!r.ok || !a.hdeskTvImage) return
      // Aperçus l'un après l'autre : le processus de capture répond à une demande à la fois.
      for (const b of r.bureaux) {
        const img = await a
          .hdeskTvImage(b.id)
          .catch((e: unknown): ImageTv => ({ statut: 'erreur', id: b.id, message: String(e) }))
        if (!actif) return
        setImages((avant) => ({ ...avant, [b.id]: img }))
      }
    }
    // Boucle SANS chevauchement, comme la TV : le tour suivant part quand le précédent est rendu.
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
      actif = false
      rafraichirRef.current = null
      if (minuterie) clearTimeout(minuterie)
    }
  }, [active, api, intervalleMs])

  const fermer = async (b: BureauGere): Promise<void> => {
    const f = cible()?.hdeskGestionFermer
    if (!f || enFermeture.has(b.id)) return
    const ok = window.confirm(
      `Fermer l'application du bureau « ${b.travail} » ?\n` +
        "Ce qui n'est pas enregistré dans cette application sera perdu."
    )
    if (!ok) return
    setEnFermeture((avant) => new Set(avant).add(b.id))
    setRetours((avant) => ({ ...avant, [b.id]: { ok: true, message: 'Fermeture en cours…' } }))
    const r = await f(b.id).catch((e: unknown): ResultatFermetureGeree => ({
      ok: false,
      code: null,
      message: String(e)
    }))
    setEnFermeture((avant) => {
      const suite = new Set(avant)
      suite.delete(b.id)
      return suite
    })
    setRetours((avant) => ({
      ...avant,
      [b.id]: { ok: r.ok, message: r.ok ? r.message : `Fermeture refusée : ${r.message}` }
    }))
    rafraichirRef.current?.()
  }

  // Geste sur l'ÉCRAN RÉEL : confirmation explicite à chaque fois, même texte que la TV.
  const basculer = async (b: BureauGere): Promise<void> => {
    const f = cible()?.hdeskTvBasculer
    if (!f) return
    const ok = window.confirm(
      'Ton écran va afficher le bureau caché.\n' +
        'Pour revenir : bouton « Revenir à mon bureau », Échap, ou automatiquement après 2 minutes.\n' +
        'Continuer ?'
    )
    if (!ok) return
    const r = await f(b.id).catch((e: unknown) => ({ ok: false, message: String(e) }))
    setRetours((avant) => ({
      ...avant,
      [b.id]: {
        ok: r.ok,
        message: r.ok ? 'Écran basculé.' : `Bascule refusée : ${r.message ?? ''}`
      }
    }))
  }

  const creer = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (creationEnCours) return
    const refus = refusCreation(form)
    if (refus) {
      setRetourCreation({ ok: false, code: null, message: refus })
      return
    }
    const f = cible()?.hdeskGestionCreer
    if (!f) return
    setCreationEnCours(true)
    setRetourCreation(null)
    const r = await f({ ...form }).catch((err: unknown): ResultatCreationBureau => ({
      ok: false,
      code: null,
      message: String(err)
    }))
    setCreationEnCours(false)
    setRetourCreation(r)
    if (r.ok) {
      setForm(FORMULAIRE_VIDE)
      setFormOuvert(false)
      rafraichirRef.current?.()
    }
  }

  const champ = (cle: keyof Formulaire, libelle: string, aide: string): React.JSX.Element => (
    <label className="hdesk-champ">
      <span>{libelle}</span>
      <input
        data-testid={`hdesk-champ-${cle}`}
        value={form[cle]}
        placeholder={aide}
        onChange={(e) => setForm((avant) => ({ ...avant, [cle]: e.target.value }))}
      />
    </label>
  )

  const apercu = (b: BureauGere): React.JSX.Element => {
    const img = images[b.id]
    if (img?.statut === 'ok' || img?.statut === 'uni')
      return (
        <>
          <img src={img.dataUrl} alt={`Aperçu du bureau ${b.id}`} />
          {img.statut === 'uni' && <span className="hdesk-apercu-note">Image unie</span>}
        </>
      )
    if (img?.statut === 'ferme') return <span>Bureau fermé</span>
    if (img?.statut === 'erreur') return <span title={img.message}>Aperçu impossible</span>
    return <span>Capture…</span>
  }

  return (
    <section className="view-page hdesk-gestion-view" data-testid="hdesk-view" data-active={active}>
      <ViewTopBar
        eyebrow="OUTILS"
        title="Bureaux cachés"
        description="Les bureaux Windows invisibles où les agents (et toi) lancent des applications sans toucher ton écran."
        actions={
          <button
            type="button"
            data-testid="hdesk-nouveau"
            onClick={() => {
              setFormOuvert((o) => !o)
              setRetourCreation(null)
            }}
          >
            {formOuvert ? 'Annuler' : '+ Nouveau bureau'}
          </button>
        }
      />

      {formOuvert && (
        <form className="hdesk-formulaire" data-testid="hdesk-formulaire" onSubmit={creer}>
          {champ('id', 'Identifiant', 'ex. appli-essai')}
          {champ('executable', 'Application (.exe)', 'C:\\chemin\\vers\\application.exe')}
          {champ('arguments', 'Arguments (facultatif)', 'ex. /mode test')}
          {champ('travail', 'Ce que tu y fais', 'ex. Essai de mon appli sur une branche de test')}
          {champ('conversationId', 'Fil (facultatif)', FIL_MANUEL)}
          <button type="submit" data-testid="hdesk-creer" disabled={creationEnCours}>
            {creationEnCours
              ? `Création… (jusqu’à ${Math.round(CREATION_ATTENTE_MS / 1000)} s)`
              : 'Créer le bureau'}
          </button>
        </form>
      )}

      {retourCreation && (
        <div
          className={`hdesk-retour ${retourCreation.ok ? 'is-ok' : 'is-erreur'}`}
          data-testid="hdesk-retour-creation"
          role={retourCreation.ok ? 'status' : 'alert'}
        >
          {retourCreation.ok
            ? retourCreation.message
            : `Création refusée : ${retourCreation.message}`}
          {!retourCreation.ok && retourCreation.idLibre && (
            <button
              type="button"
              data-testid="hdesk-id-libre"
              onClick={() => {
                setForm((avant) => ({ ...avant, id: retourCreation.idLibre! }))
                setFormOuvert(true)
              }}
            >
              Utiliser « {retourCreation.idLibre} »
            </button>
          )}
        </div>
      )}

      {etatListe === null ? (
        <p className="hdesk-etat">Lecture des bureaux…</p>
      ) : !etatListe.ok ? (
        <p className="hdesk-etat hdesk-retour is-erreur" role="alert" data-testid="hdesk-erreur">
          Liste des bureaux impossible : {etatListe.message}
        </p>
      ) : etatListe.bureaux.length === 0 ? (
        <div className="hdesk-etat" data-testid="hdesk-vide">
          <p>Aucun bureau caché ouvert.</p>
          {!formOuvert && (
            <button type="button" onClick={() => setFormOuvert(true)}>
              Créer un bureau
            </button>
          )}
        </div>
      ) : (
        <ul className="hdesk-liste" data-testid="hdesk-liste">
          {etatListe.bureaux.map((b) => {
            const retour = retours[b.id]
            const occupe = enFermeture.has(b.id)
            return (
              <li key={b.id} className="hdesk-carte" data-testid={`hdesk-bureau-${b.id}`}>
                <div className="hdesk-apercu">{apercu(b)}</div>
                <div className="hdesk-infos">
                  <strong className={b.relie ? '' : 'hdesk-non-relie'}>{b.travail}</strong>
                  <span>Bureau : {b.id}</span>
                  <span>Fil : {b.conversationId ?? 'aucun'}</span>
                  <span>Lancé : {quand(b.lanceLe)}</span>
                  {b.executable && <span title={b.executable}>{nomDeFichier(b.executable)}</span>}
                </div>
                <div className="hdesk-gestes">
                  <button
                    type="button"
                    data-testid={`hdesk-basculer-${b.id}`}
                    title="Afficher ce bureau sur mon écran"
                    onClick={() => void basculer(b)}
                  >
                    ⇄ Afficher
                  </button>
                  <button
                    type="button"
                    data-testid={`hdesk-fermer-${b.id}`}
                    disabled={occupe}
                    onClick={() => void fermer(b)}
                  >
                    {occupe ? 'Fermeture…' : 'Fermer'}
                  </button>
                </div>
                {retour && (
                  <p
                    className={`hdesk-retour ${retour.ok ? 'is-ok' : 'is-erreur'}`}
                    role={retour.ok ? 'status' : 'alert'}
                    data-testid={`hdesk-retour-${b.id}`}
                  >
                    {retour.message}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
