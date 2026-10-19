/**
 * VUE « BUREAUX CACHÉS » (conv-951, 2026-10-16) : « j'aimerais une view dédiée pour gérer tous mes
 * Hdesk, pouvoir les fermer, les créer et tout ; j'adore cette feature mais y a pas d'interface pour
 * bien la gérer ». La petite TV du chat (HdeskTv) ne montre que les bureaux du fil ouvert ; ici, TOUS
 * les bureaux vivants, avec aperçu, Fermer, Afficher sur mon écran (⇄) et Créer.
 * Cas limites : aucun bureau -> état vide + bouton Créer ; liste illisible -> erreur dite, jamais une
 * liste vide ; bureau sans fiche -> listé « travail non relié », Fermer le ferme sans fiche (conv-344) ; fermeture en
 * cours -> bouton désactivé (double clic sans effet) ; saisie invalide -> refusée AVANT tout lancement ;
 * identifiant occupé -> l'identifiant libre est proposé, jamais relancé tout seul.
 * conv-344 : la petite image AGRANDIT l'aperçu (aucun geste par mégarde) ; dans l'aperçu agrandi,
 * clic / frappe / molette partent au bureau caché sans basculer l'écran réel, l'un après l'autre.
 */
import { useEffect, useRef, useState } from 'react'
import type { GesteTv, ImageTv, ResultatGeste } from '../../../main/hdesk-tv'
import {
  CREATION_ATTENTE_MS,
  FIL_MANUEL,
  proposerIdentifiant,
  refusCreation,
  type BureauGere,
  type DemandeCreationBureau,
  type GesteJournal,
  type LancementRecent,
  type ResultatChoixExe,
  type ResultatCreationBureau,
  type ResultatFermetureGeree,
  type ResultatListeBureaux
} from '../../../shared/hdesk-gestion'
import { ViewTopBar } from './ViewTopBar'
import { cransMolette, enfilerGeste, pointDansImage } from './hdesk-gestes'
import { toucheTv } from './hdesk-tv-touches'
import './ViewPage.css'
import './HdeskGestionView.css'

export interface HdeskGestionApi {
  hdeskGestionBureaux: () => Promise<ResultatListeBureaux>
  hdeskGestionFermer: (id: string) => Promise<ResultatFermetureGeree>
  hdeskGestionCreer: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  /** « Parcourir… » : sélecteur natif filtré sur les .exe (conv-344). Absent = pas de bouton. */
  hdeskGestionChoisirExe?: () => Promise<ResultatChoixExe>
  /** Aperçu et bascule : mêmes canaux que la petite TV du chat. */
  hdeskTvImage?: (id: string) => Promise<ImageTv>
  hdeskTvBasculer?: (id: string) => Promise<{ ok: boolean; message?: string }>
  /** Gestes dans l'aperçu agrandi (conv-344) : même canal que la petite TV (hdesk-act). */
  hdeskTvAct?: (geste: GesteTv) => Promise<ResultatGeste>
  /** Titres des fils (conv-344) : le fil s'affichait comme un identifiant brut. */
  conversations?: () => Promise<Array<{ id: string; title?: string }>>
}

interface Props {
  active: boolean
  api?: HdeskGestionApi
  intervalleMs?: number
  /** Ouvre la conversation d'un fil (App.tsx : openTaskConversation). Absent = fil non cliquable. */
  onOpenConversation?: (target: { conversationId: string }) => void
}

/** Âge maximal d'un geste du journal pour montrer son point sur l'aperçu agrandi. */
const POINT_RECENT_MS = 5000

const heure = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('fr-FR')
}

/** Une ligne du journal dite pour un humain — jamais le texte tapé, que le journal ne garde pas. */
function decrireGeste(g: GesteJournal): string {
  if (!g.ok) return `refusé : ${g.erreur ?? 'raison inconnue'}`
  const parts: string[] = []
  if (g.clic && typeof g.x === 'number' && typeof g.y === 'number') parts.push(`clic ${g.x},${g.y}`)
  if (g.caracteres) parts.push(`${g.caracteres} caractères${g.entree ? ' + Entrée' : ''}`)
  else if (g.entree) parts.push('Entrée')
  if (g.touche) parts.push(`touche ${g.touche}`)
  if (g.molette) parts.push(`molette ${g.molette > 0 ? '+' : ''}${g.molette}`)
  if (g.touches) parts.push(`${g.touches} touche(s)`)
  return parts.join(' · ') || 'geste'
}

interface PropsAgrandi {
  bureau: BureauGere
  image: ImageTv | undefined
  /** Heure de réception de la liste : âge des gestes du journal (pas d'horloge lue au rendu). */
  recuLe: number
  agir?: (g: GesteTv) => Promise<ResultatGeste>
  apresGeste: () => void
  fermer: () => void
}

/**
 * APERÇU AGRANDI (conv-344, scout n°2, 9) : agir dans l'appli cachée sans prendre l'écran réel. Mêmes
 * gestes que la petite TV (hdesk-gestes.ts) : clic ramené aux pixels de la capture, frappe au dernier
 * point cliqué SANS reclic, molette, touches spéciales. Un point montre le dernier clic — le tien, ou
 * celui d'un agent lu dans le journal des gestes s'il a moins de 5 s.
 */
function ApercuAgrandi({
  bureau,
  image,
  recuLe,
  agir,
  apresGeste,
  fermer
}: PropsAgrandi): React.JSX.Element {
  const fileRef = useRef<Promise<void>>(Promise.resolve())
  const [dernierClic, setDernierClic] = useState<{ x: number; y: number; quand: number } | null>(
    null
  )
  const [texte, setTexte] = useState('')
  const [retour, setRetour] = useState<string | null>(null)
  const [taille, setTaille] = useState<{ w: number; h: number } | null>(null)
  const envoyer = (g: GesteTv): Promise<void> =>
    enfilerGeste(fileRef, agir, g, (r) => {
      setRetour(r.ok ? null : `Action refusée : ${r.message}`)
      apresGeste()
    })
  const cliquable = Boolean(agir) && (image?.statut === 'ok' || image?.statut === 'uni')
  const cliquerImage = (e: React.MouseEvent<HTMLImageElement>): void => {
    const p = cliquable ? pointDansImage(e, image) : null
    if (!p) return
    setDernierClic({ ...p, quand: e.timeStamp })
    void envoyer({ id: bureau.id, ...p })
  }
  const molette = (e: React.WheelEvent<HTMLImageElement>): void => {
    const p = cliquable ? pointDansImage(e, image) : null
    const crans = cransMolette(e.deltaY)
    if (!p || !crans) return
    void envoyer({ id: bureau.id, ...p, molette: crans })
  }
  const taper = (entree: boolean): void => {
    if (!dernierClic || (!texte && !entree)) return
    void envoyer({
      id: bureau.id,
      x: dernierClic.x,
      y: dernierClic.y,
      texte,
      entree,
      sansClic: true
    })
    setTexte('')
  }
  // Point : ton dernier clic, sinon le dernier clic RÉCENT du journal (un agent qui agit).
  const duJournal = [...(bureau.gestes ?? [])]
    .reverse()
    .find(
      (g) =>
        g.ok &&
        g.clic &&
        typeof g.x === 'number' &&
        typeof g.y === 'number' &&
        recuLe - Date.parse(g.quand) < POINT_RECENT_MS
    )
  const point = dernierClic ?? (duJournal ? { x: duJournal.x!, y: duJournal.y! } : null)
  const largeur = image?.statut === 'ok' ? image.width : taille?.w
  const hauteur = image?.statut === 'ok' ? image.height : taille?.h
  return (
    <section className="hdesk-agrandi" data-testid="hdesk-agrandi" aria-label={bureau.travail}>
      <header>
        <strong>{bureau.travail}</strong>
        <span>{bureau.id}</span>
        <button type="button" data-testid="hdesk-agrandi-fermer" onClick={fermer}>
          Réduire
        </button>
      </header>
      {image?.statut === 'ok' || image?.statut === 'uni' ? (
        <div className="hdesk-agrandi-image">
          <img
            data-testid="hdesk-agrandi-image"
            src={image.dataUrl}
            alt={`Bureau caché ${bureau.id}`}
            className={cliquable ? 'is-cliquable' : ''}
            onLoad={(e) =>
              setTaille({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onClick={cliquerImage}
            onWheel={molette}
          />
          {point && largeur && hauteur ? (
            <span
              key={`${point.x},${point.y},${dernierClic?.quand ?? ''}`}
              className="hdesk-point"
              data-testid="hdesk-point"
              style={{
                left: `${(point.x / largeur) * 100}%`,
                top: `${(point.y / hauteur) * 100}%`
              }}
            />
          ) : null}
        </div>
      ) : (
        <p className="hdesk-etat">
          {image?.statut === 'ferme' ? 'Bureau fermé' : 'Capture en attente…'}
        </p>
      )}
      {agir && (
        <form
          className="hdesk-agrandi-saisie"
          data-testid="hdesk-agrandi-saisie"
          onSubmit={(e) => {
            e.preventDefault()
            taper(true)
          }}
          onKeyDown={(e) => {
            // La frappe destinée au bureau caché ne doit pas déclencher les raccourcis de l'app.
            e.stopPropagation()
            const t = toucheTv(e, !texte)
            if (!t || !dernierClic) return
            e.preventDefault()
            if (texte) {
              void envoyer({
                id: bureau.id,
                x: dernierClic.x,
                y: dernierClic.y,
                texte,
                sansClic: true
              })
              setTexte('')
            }
            void envoyer({
              id: bureau.id,
              x: dernierClic.x,
              y: dernierClic.y,
              touche: t,
              sansClic: true
            })
          }}
        >
          <input
            data-testid="hdesk-agrandi-texte"
            value={texte}
            maxLength={1000}
            disabled={!dernierClic}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={
              dernierClic
                ? 'Texte à taper au point cliqué (Entrée = valider)'
                : 'Clique d’abord dans l’image pour viser un champ'
            }
          />
          <button type="button" disabled={!dernierClic || !texte} onClick={() => taper(false)}>
            Taper
          </button>
        </form>
      )}
      {retour && (
        <p className="hdesk-retour is-erreur" role="alert">
          {retour}
        </p>
      )}
    </section>
  )
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

export function HdeskGestionView({
  active,
  api,
  intervalleMs = 4000,
  onOpenConversation
}: Props): React.JSX.Element {
  const cible = (): Partial<HdeskGestionApi> | undefined => cibleDe(api)
  const [liste, setListe] = useState<ResultatListeBureaux | null>(null)
  const [recuLe, setRecuLe] = useState(0)
  const [agrandi, setAgrandi] = useState<string | null>(null)
  const [titres, setTitres] = useState<Record<string, string>>({})
  const [images, setImages] = useState<Record<string, ImageTv>>({})
  const [enFermeture, setEnFermeture] = useState<ReadonlySet<string>>(new Set())
  const [retours, setRetours] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [formOuvert, setFormOuvert] = useState(false)
  const [form, setForm] = useState<Formulaire>(FORMULAIRE_VIDE)
  const [creationEnCours, setCreationEnCours] = useState(false)
  const [retourCreation, setRetourCreation] = useState<ResultatCreationBureau | null>(null)
  // Identifiant tapé à la main : la proposition tirée du nom de l'appli ne l'écrase jamais (conv-344).
  const [idTouche, setIdTouche] = useState(false)
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
      setRecuLe(Date.now())
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

  // Titres des fils, relus à chaque ouverture de la vue (conv-344). Échec = l'identifiant reste affiché.
  useEffect(() => {
    if (!active) return
    const lire = cibleDe(api)?.conversations
    if (!lire) return
    let actif = true
    lire()
      .then((liste) => {
        if (!actif || !Array.isArray(liste)) return
        setTitres(
          Object.fromEntries(
            liste
              .filter((c) => typeof c?.id === 'string' && typeof c.title === 'string' && c.title)
              .map((c) => [c.id, c.title as string])
          )
        )
      })
      .catch(() => undefined)
    return () => {
      actif = false
    }
  }, [active, api])

  const fil = (b: BureauGere): React.JSX.Element | string => {
    const id = b.conversationId
    if (!id) return 'aucun'
    if (id === FIL_MANUEL || !onOpenConversation) return id
    return (
      <button
        type="button"
        className="hdesk-lien"
        data-testid={`hdesk-fil-${b.id}`}
        title={id}
        onClick={() => onOpenConversation({ conversationId: id })}
      >
        {titres[id] ?? id}
      </button>
    )
  }

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

  // Création par le formulaire OU par « Relancer » (Récents) : même chemin, même refus avant lancement.
  const lancer = async (demande: DemandeCreationBureau): Promise<void> => {
    if (creationEnCours) return
    const refus = refusCreation(demande)
    if (refus) {
      setRetourCreation({ ok: false, code: null, message: refus })
      return
    }
    const f = cible()?.hdeskGestionCreer
    if (!f) return
    setCreationEnCours(true)
    setRetourCreation(null)
    const r = await f({ ...demande }).catch((err: unknown): ResultatCreationBureau => ({
      ok: false,
      code: null,
      message: String(err)
    }))
    setCreationEnCours(false)
    setRetourCreation(r)
    if (r.ok) {
      setForm(FORMULAIRE_VIDE)
      setIdTouche(false)
      setFormOuvert(false)
      rafraichirRef.current?.()
    }
  }

  const creer = (e: React.FormEvent): void => {
    e.preventDefault()
    void lancer(form)
  }

  const relancer = (r: LancementRecent): void =>
    void lancer({
      id: r.id,
      executable: r.executable,
      arguments: r.arguments,
      travail: r.travail,
      conversationId: r.conversationId
    })

  // Identifiants déjà vivants : la proposition les contourne (le lanceur reste juge, exit 5).
  const idsVivants = etatListe?.ok ? etatListe.bureaux.map((b) => b.id) : []
  const changerExecutable = (chemin: string): void =>
    setForm((avant) => ({
      ...avant,
      executable: chemin,
      ...(!idTouche && chemin.trim() ? { id: proposerIdentifiant(chemin, idsVivants) } : {})
    }))

  const parcourir = async (): Promise<void> => {
    const f = cible()?.hdeskGestionChoisirExe
    if (!f) return
    const r = await f().catch((e: unknown): ResultatChoixExe => ({ ok: false, message: String(e) }))
    if (r.ok) changerExecutable(r.chemin)
    else if (r.message) setRetourCreation({ ok: false, code: null, message: r.message })
  }

  const champ = (cle: keyof Formulaire, libelle: string, aide: string): React.JSX.Element => (
    <label className="hdesk-champ">
      <span>{libelle}</span>
      <input
        data-testid={`hdesk-champ-${cle}`}
        value={form[cle]}
        placeholder={aide}
        onChange={(e) => {
          const v = e.target.value
          if (cle === 'executable') return changerExecutable(v)
          if (cle === 'id') setIdTouche(v.trim() !== '')
          setForm((avant) => ({ ...avant, [cle]: v }))
        }}
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
          <div className="hdesk-champ-exe">
            {champ('executable', 'Application (.exe)', 'C:\\chemin\\vers\\application.exe')}
            {cible()?.hdeskGestionChoisirExe && (
              <button type="button" data-testid="hdesk-parcourir" onClick={() => void parcourir()}>
                Parcourir…
              </button>
            )}
          </div>
          {champ('id', 'Identifiant', 'proposé à partir de l’application')}
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
        <>
          {(() => {
            const b = etatListe.bureaux.find((x) => x.id === agrandi)
            return b ? (
              <ApercuAgrandi
                key={b.id}
                bureau={b}
                image={images[b.id]}
                recuLe={recuLe}
                agir={cible()?.hdeskTvAct}
                apresGeste={() => rafraichirRef.current?.()}
                fermer={() => setAgrandi(null)}
              />
            ) : null
          })()}
          <ul className="hdesk-liste" data-testid="hdesk-liste">
            {etatListe.bureaux.map((b) => {
              const retour = retours[b.id]
              const occupe = enFermeture.has(b.id)
              return (
                <li key={b.id} className="hdesk-carte" data-testid={`hdesk-bureau-${b.id}`}>
                  <button
                    type="button"
                    className="hdesk-apercu"
                    data-testid={`hdesk-apercu-${b.id}`}
                    title="Agrandir pour agir dans l’application, sans quitter ton écran"
                    aria-pressed={agrandi === b.id}
                    onClick={() => setAgrandi((a) => (a === b.id ? null : b.id))}
                  >
                    {apercu(b)}
                  </button>
                  <div className="hdesk-infos">
                    <strong className={b.relie ? '' : 'hdesk-non-relie'}>{b.travail}</strong>
                    <span>Bureau : {b.id}</span>
                    <span>Fil : {fil(b)}</span>
                    <span>Lancé : {quand(b.lanceLe)}</span>
                    {b.executable && <span title={b.executable}>{nomDeFichier(b.executable)}</span>}
                  </div>
                  {(b.gestes?.length ?? 0) > 0 && (
                    <ul className="hdesk-journal" data-testid={`hdesk-gestes-${b.id}`}>
                      {b.gestes!.map((g, i) => (
                        <li key={`${g.quand}-${i}`} className={g.ok ? '' : 'is-refuse'}>
                          {heure(g.quand)} · {decrireGeste(g)}
                        </li>
                      ))}
                    </ul>
                  )}
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
        </>
      )}

      {etatListe?.ok && (etatListe.recents?.length ?? 0) > 0 && (
        <section className="hdesk-recents" data-testid="hdesk-recents" aria-label="Récents">
          <h3>Récents</h3>
          <ul>
            {etatListe.recents!.map((r) => (
              <li
                key={`${r.id}|${r.executable}|${r.arguments}`}
                data-testid={`hdesk-recent-${r.id}`}
              >
                <strong>{r.travail}</strong>
                <span title={r.executable}>{nomDeFichier(r.executable)}</span>
                <span>{r.id}</span>
                <span>{quand(r.lanceLe)}</span>
                <button
                  type="button"
                  data-testid={`hdesk-relancer-${r.id}`}
                  disabled={creationEnCours}
                  onClick={() => relancer(r)}
                >
                  Relancer
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
