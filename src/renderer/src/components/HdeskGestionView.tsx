/**
 * VUE « BUREAUX CACHÉS » (conv-951, 2026-10-16) : « j'aimerais une view dédiée pour gérer tous mes
 * Hdesk, pouvoir les fermer, les créer et tout ». Refonte conv-1002 (même jour, skill draft, 5 tours
 * de maquettes) : « Régie » → « Antenne + moniteurs » → « Antenne pilotable » → bandeau « Tu pilotes »
 * à hachures + rendu automatique, « en fonction du thème » (aucune couleur en dur : variables du thème).
 *
 * Un bureau À L'ANTENNE, en grand ; les autres en MONITEURS dessous (un clic = passer à l'antenne).
 * L'antenne est en mode REGARDER par défaut : un clic dans l'image ne fait rien. PILOTER envoie clics,
 * molette et frappe au bureau caché (mêmes canaux que la TV du fil, scripts/hdesk-act.ps1) sous un
 * bandeau qui le dit ; sans geste pendant `delaiPilotageMs`, la vue repasse seule en Regarder.
 * Échap ne sert PAS à sortir du pilotage : il part au bureau caché (hdesk-tv-touches.ts).
 * PAS DE JOURNAL DES GESTES ici (conv-1010, 2026-10-16) : « tes gestes je m'en fous de logger ça dans
 * mes bureaux cachés ». La liste « Tes gestes » et ses repères numérotés, ajoutés par conv-1002, ont
 * été retirés ; un geste refusé reste dit sur une seule ligne (hdesk-retour-geste).
 * Cas limites : aucun bureau -> état vide + Créer ; liste illisible -> erreur dite ; bureau sans fiche
 * -> « travail non relié », Fermer rend le refus ; antenne fermée -> l'antenne passe au premier bureau
 * et le pilotage s'arrête ; changer d'antenne -> retour en Regarder ; saisie de création invalide ->
 * refusée AVANT tout lancement ; identifiant occupé -> l'identifiant libre est proposé, jamais relancé.
 * REPRIS DE conv-344 (aperçu agrandi, écarté au profit de l'Antenne le 2026-10-19, conv-1023) : ce qui
 * ne dépend pas de la façon de montrer les bureaux — « Parcourir… » + identifiant proposé, « Récents /
 * Relancer », et le fil affiché par son titre, cliquable. Le journal des gestes de conv-344 reste dehors.
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
  type LancementRecent,
  type ResultatChoixExe,
  type ResultatCreationBureau,
  type ResultatFermetureGeree,
  type ResultatListeBureaux
} from '../../../shared/hdesk-gestion'
import { toucheTv } from './hdesk-tv-touches'
import { ViewTopBar } from './ViewTopBar'
import './ViewPage.css'
import './HdeskGestionView.css'

export interface HdeskGestionApi {
  hdeskGestionBureaux: () => Promise<ResultatListeBureaux>
  hdeskGestionFermer: (id: string) => Promise<ResultatFermetureGeree>
  hdeskGestionCreer: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  /** « Parcourir… » : sélecteur natif filtré sur les .exe (conv-344). Absent = pas de bouton. */
  hdeskGestionChoisirExe?: () => Promise<ResultatChoixExe>
  /** Aperçu, bascule et gestes : mêmes canaux que la petite TV du chat. */
  hdeskTvImage?: (id: string) => Promise<ImageTv>
  hdeskTvBasculer?: (id: string) => Promise<{ ok: boolean; message?: string }>
  hdeskTvAct?: (geste: GesteTv) => Promise<ResultatGeste>
  /** Titres des fils (conv-344) : le fil s'affichait comme un identifiant brut. */
  conversations?: () => Promise<Array<{ id: string; title?: string }>>
}

interface Props {
  active: boolean
  api?: HdeskGestionApi
  /** Ouvre la conversation d'un fil (App.tsx : openTaskConversation). Absent = fil non cliquable. */
  onOpenConversation?: (target: { conversationId: string }) => void
  /** Cadence de la liste et de TOUS les aperçus, en Regarder. */
  intervalleMs?: number
  /** Cadence de l'antenne seule, en Piloter (les moniteurs ne sont plus capturés). */
  intervallePiloteMs?: number
  /** Sans geste pendant ce délai, la vue repasse seule en Regarder. */
  delaiPilotageMs?: number
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

const secondes = (ms: number): string =>
  `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`

const minutesSecondes = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** La prop `api` (tests) ou le pont réel. */
const cibleDe = (api?: HdeskGestionApi): Partial<HdeskGestionApi> | undefined =>
  api ?? (window as unknown as { api?: Partial<HdeskGestionApi> }).api

const imageVisible = (img?: ImageTv): img is Extract<ImageTv, { statut: 'ok' | 'uni' }> =>
  img?.statut === 'ok' || img?.statut === 'uni'

/** Point de l'image affichée ramené aux pixels de la capture (même règle que la TV du fil). */
function pointCapture(
  e: React.MouseEvent<HTMLImageElement>,
  img: Extract<ImageTv, { statut: 'ok' | 'uni' }>
): { x: number; y: number } | null {
  // Une capture unie (page web) ne porte pas sa taille : on prend celle de l'image reçue.
  const largeur = img.statut === 'ok' ? img.width : e.currentTarget.naturalWidth
  const hauteur = img.statut === 'ok' ? img.height : e.currentTarget.naturalHeight
  const rect = e.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height || !largeur || !hauteur) return null
  return {
    x: Math.round(((e.clientX - rect.left) * largeur) / rect.width),
    y: Math.round(((e.clientY - rect.top) * hauteur) / rect.height)
  }
}

export function HdeskGestionView({
  active,
  api,
  intervalleMs = 4000,
  intervallePiloteMs = 1500,
  delaiPilotageMs = 60_000,
  onOpenConversation
}: Props): React.JSX.Element {
  const cible = (): Partial<HdeskGestionApi> | undefined => cibleDe(api)
  const [liste, setListe] = useState<ResultatListeBureaux | null>(null)
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
  // Antenne et pilotage : l'état pour le rendu, la référence pour la boucle de capture.
  const [antenneId, setAntenneId] = useState<string | null>(null)
  const [pilote, setPilote] = useState(false)
  const [echeance, setEcheance] = useState<number | null>(null)
  const [maintenant, setMaintenant] = useState(0)
  const [dernierClic, setDernierClic] = useState<{ id: string; x: number; y: number } | null>(null)
  const [texte, setTexte] = useState('')
  const [retourGeste, setRetourGeste] = useState<string | null>(null)
  const antenneRef = useRef<string | null>(null)
  const piloteRef = useRef(false)
  const rafraichirRef = useRef<(() => void) | null>(null)
  // File des gestes : un geste attend la fin du précédent, sinon deux hdesk-act se chevauchent.
  const fileRef = useRef<Promise<void>>(Promise.resolve())
  // fix-ok: pont absent = fait DÉRIVÉ du rendu, pas un état posé dans l'effet (lint 2026-10-16 :
  // setState synchrone dans un effet, rendus en cascade).
  const indisponible = !cibleDe(api)?.hdeskGestionBureaux
  const etatListe: ResultatListeBureaux | null = indisponible
    ? { ok: false, message: 'Bureaux cachés indisponibles dans cette version.' }
    : liste

  const quitterPilotage = (): void => {
    piloteRef.current = false
    setPilote(false)
    setEcheance(null)
    setDernierClic(null)
    setTexte('')
  }

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
      if (!r.ok) return
      // L'antenne survit tant que son bureau vit ; sinon elle passe au premier, sans pilotage.
      const ids = r.bureaux.map((b) => b.id)
      const avant = antenneRef.current
      const courant = avant && ids.includes(avant) ? avant : (ids[0] ?? null)
      if (courant !== avant) {
        antenneRef.current = courant
        setAntenneId(courant)
        piloteRef.current = false
        setPilote(false)
        setEcheance(null)
        setDernierClic(null)
      }
      if (!a.hdeskTvImage) return
      // Antenne d'abord. En Piloter, elle seule : c'est elle qu'on regarde au rythme des gestes.
      const ordre = piloteRef.current
        ? ids.filter((id) => id === courant)
        : [...ids.filter((id) => id === courant), ...ids.filter((id) => id !== courant)]
      // Aperçus l'un après l'autre : le processus de capture répond à une demande à la fois.
      for (const id of ordre) {
        const img = await a
          .hdeskTvImage(id)
          .catch((e: unknown): ImageTv => ({ statut: 'erreur', id, message: String(e) }))
        if (!actif) return
        setImages((prec) => ({ ...prec, [id]: img }))
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
      } else
        minuterie = setTimeout(
          () => void boucle(),
          piloteRef.current ? intervallePiloteMs : intervalleMs
        )
    }
    rafraichirRef.current = () => void boucle()
    void boucle()
    return () => {
      actif = false
      rafraichirRef.current = null
      if (minuterie) clearTimeout(minuterie)
    }
  }, [active, api, intervalleMs, intervallePiloteMs])

  // Titres des fils, relus à chaque ouverture de la vue (conv-344). Échec = l'identifiant reste affiché.
  useEffect(() => {
    if (!active) return
    const lire = cibleDe(api)?.conversations
    if (!lire) return
    let actif = true
    lire()
      .then((convs) => {
        if (!actif || !Array.isArray(convs)) return
        setTitres(
          Object.fromEntries(
            convs
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

  /** Le fil par son titre ; un clic ouvre la conversation (conv-344). « manuel » ou absent : texte. */
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

  // Compte à rebours du pilotage : l'horloge n'avance que dans le rappel, jamais au rendu.
  useEffect(() => {
    if (!pilote || echeance === null) return
    const minuterie = setInterval(() => {
      const t = Date.now()
      if (t >= echeance) {
        piloteRef.current = false
        setPilote(false)
        setEcheance(null)
        setDernierClic(null)
        setTexte('')
      } else setMaintenant(t)
    }, 1000)
    return () => clearInterval(minuterie)
  }, [pilote, echeance])

  /** Chaque geste repousse le retour automatique en Regarder. */
  const prolonger = (): void => {
    if (!piloteRef.current) return
    const t = Date.now()
    setMaintenant(t)
    setEcheance(t + delaiPilotageMs)
  }

  const piloter = (): void => {
    const t = Date.now()
    piloteRef.current = true
    setPilote(true)
    setMaintenant(t)
    setEcheance(t + delaiPilotageMs)
    setRetourGeste(null)
    // La cadence change (antenne seule, plus vite) : on relance la boucle tout de suite.
    rafraichirRef.current?.()
  }

  const choisir = (id: string): void => {
    if (id === antenneRef.current) return
    antenneRef.current = id
    setAntenneId(id)
    quitterPilotage()
    setRetourGeste(null)
    rafraichirRef.current?.()
  }

  const envoyer = (geste: GesteTv): Promise<void> => {
    const agir = cible()?.hdeskTvAct
    if (!agir) return Promise.resolve()
    prolonger()
    fileRef.current = fileRef.current.then(async () => {
      const r = await agir(geste).catch((e: unknown) => ({
        ok: false as const,
        message: String(e)
      }))
      setRetourGeste(r.ok ? null : `Action refusée : ${r.message}`)
      // Rafraîchir tout de suite : sans cela l'effet du geste n'apparaît qu'au tour suivant.
      rafraichirRef.current?.()
    })
    return fileRef.current
  }

  const cliquerImage = (e: React.MouseEvent<HTMLImageElement>): void => {
    const img = antenneId ? images[antenneId] : undefined
    if (!pilote || !imageVisible(img)) return
    const p = pointCapture(e, img)
    if (!p) return
    setDernierClic({ id: img.id, ...p })
    void envoyer({ id: img.id, ...p })
  }

  // Molette : 1 cran par tranche de 100 px de deltaY (bas = négatif, comme Windows).
  const molette = (e: React.WheelEvent<HTMLImageElement>): void => {
    const img = antenneId ? images[antenneId] : undefined
    if (!pilote || !imageVisible(img) || !e.deltaY) return
    const p = pointCapture(e, img)
    if (!p) return
    const crans = Math.max(
      -20,
      Math.min(20, -Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 100)))
    )
    void envoyer({ id: img.id, ...p, molette: crans })
  }

  // La frappe vise le dernier point cliqué SANS recliquer (un reclic déplacerait le curseur).
  const taper = (entree: boolean): void => {
    if (!dernierClic || dernierClic.id !== antenneId || (!texte && !entree)) return
    void envoyer({ ...dernierClic, texte, entree, sansClic: true })
    setTexte('')
  }

  const fermer = async (b: BureauGere): Promise<void> => {
    const f = cible()?.hdeskGestionFermer
    if (!f || enFermeture.has(b.id)) return
    const ok = window.confirm(
      `Fermer l'application du bureau « ${b.travail} » ?\n` +
        "Ce qui n'est pas enregistré dans cette application sera perdu."
    )
    if (!ok) return
    setEnFermeture((prec) => new Set(prec).add(b.id))
    setRetours((prec) => ({ ...prec, [b.id]: { ok: true, message: 'Fermeture en cours…' } }))
    const r = await f(b.id).catch((e: unknown): ResultatFermetureGeree => ({
      ok: false,
      code: null,
      message: String(e)
    }))
    setEnFermeture((prec) => {
      const suite = new Set(prec)
      suite.delete(b.id)
      return suite
    })
    setRetours((prec) => ({
      ...prec,
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
    setRetours((prec) => ({
      ...prec,
      [b.id]: {
        ok: r.ok,
        message: r.ok ? 'Écran basculé.' : `Bascule refusée : ${r.message ?? ''}`
      }
    }))
  }

  // Création par le formulaire OU par « Relancer » (Récents, conv-344) : même chemin, même refus
  // avant tout lancement.
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
    setForm((prec) => ({
      ...prec,
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
          setForm((prec) => ({ ...prec, [cle]: v }))
        }}
      />
    </label>
  )

  /** Contenu d'un écran (antenne ou moniteur) selon le statut de sa dernière capture. */
  const ecran = (b: BureauGere, grand: boolean): React.JSX.Element => {
    const img = images[b.id]
    if (imageVisible(img))
      return (
        <>
          <img
            src={img.dataUrl}
            alt={`Aperçu du bureau ${b.id}`}
            data-testid={grand ? 'hdesk-antenne-image' : undefined}
            className={img.statut === 'uni' ? 'is-uni' : undefined}
            onClick={grand ? cliquerImage : undefined}
            onWheel={grand ? molette : undefined}
          />
          {img.statut === 'uni' && <span className="hdesk-ecran-note">Image unie</span>}
        </>
      )
    if (img?.statut === 'ferme') return <span>Bureau fermé</span>
    if (img?.statut === 'erreur') return <span title={img.message}>Aperçu impossible</span>
    return <span>Capture…</span>
  }

  const bureaux = etatListe?.ok ? etatListe.bureaux : []
  const antenne = bureaux.find((b) => b.id === antenneId) ?? bureaux[0]
  const imageAntenne = antenne ? images[antenne.id] : undefined
  const pilotable = Boolean(cible()?.hdeskTvAct) && imageVisible(imageAntenne)
  const restantMs = echeance === null ? delaiPilotageMs : Math.max(0, echeance - maintenant)
  const visePret = Boolean(antenne && dernierClic && dernierClic.id === antenne.id)
  const sansFil = bureaux.filter((b) => !b.conversationId).length
  const retoursOrphelins = Object.entries(retours).filter(([id]) => !antenne || id !== antenne.id)

  return (
    <section className="view-page hdesk-gestion-view" data-testid="hdesk-view" data-active={active}>
      <ViewTopBar
        eyebrow="OUTILS"
        title="Bureaux cachés"
        description="Les bureaux Windows invisibles où les agents (et toi) lancent des applications sans toucher ton écran."
        actions={
          <button
            type="button"
            className="btn btn-accent"
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
          {/* L'application d'abord : l'identifiant se propose à partir d'elle (conv-344). */}
          <div className="hdesk-champ-exe">
            {champ('executable', 'Application (.exe)', 'C:\\chemin\\vers\\application.exe')}
            {cible()?.hdeskGestionChoisirExe && (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="hdesk-parcourir"
                onClick={() => void parcourir()}
              >
                Parcourir…
              </button>
            )}
          </div>
          {champ('id', 'Identifiant', 'proposé à partir de l’application')}
          {champ('arguments', 'Arguments (facultatif)', 'ex. /mode test')}
          {champ('travail', 'Ce que tu y fais', 'ex. Essai de mon appli sur une branche de test')}
          {champ('conversationId', 'Fil (facultatif)', FIL_MANUEL)}
          <button
            type="submit"
            className="btn btn-accent"
            data-testid="hdesk-creer"
            disabled={creationEnCours}
          >
            {/* conv-344 : l'écran disait « 40 s » alors que l'application attend CREATION_ATTENTE_MS. */}
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
              className="btn btn-sm"
              data-testid="hdesk-id-libre"
              onClick={() => {
                setForm((prec) => ({ ...prec, id: retourCreation.idLibre! }))
                setFormOuvert(true)
              }}
            >
              Utiliser « {retourCreation.idLibre} »
            </button>
          )}
        </div>
      )}

      {retoursOrphelins.map(([id, r]) => (
        <p
          key={id}
          className={`hdesk-retour ${r.ok ? 'is-ok' : 'is-erreur'}`}
          role={r.ok ? 'status' : 'alert'}
          data-testid={`hdesk-retour-${id}`}
        >
          {id} : {r.message}
        </p>
      ))}

      {etatListe === null ? (
        <p className="hdesk-etat">Lecture des bureaux…</p>
      ) : !etatListe.ok ? (
        <p className="hdesk-etat hdesk-retour is-erreur" role="alert" data-testid="hdesk-erreur">
          Liste des bureaux impossible : {etatListe.message}
        </p>
      ) : !antenne ? (
        <div className="hdesk-etat" data-testid="hdesk-vide">
          <p>Aucun bureau caché ouvert.</p>
          {!formOuvert && (
            <button type="button" className="btn" onClick={() => setFormOuvert(true)}>
              Créer un bureau
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="hdesk-direct" data-testid="hdesk-direct">
            <span className="hdesk-direct-rec">En direct</span>
            <span>
              <b>{bureaux.length}</b> {bureaux.length > 1 ? 'bureaux' : 'bureau'}
            </span>
            {sansFil > 0 && (
              <span className="hdesk-direct-alerte">
                <b>{sansFil}</b> sans fil
              </span>
            )}
            <span className="hdesk-direct-cadence">
              {pilote
                ? `image toutes les ${secondes(intervallePiloteMs)} à l'antenne`
                : `image toutes les ${secondes(intervalleMs)}`}
            </span>
          </div>

          <article className="hdesk-antenne" data-testid="hdesk-antenne" data-bureau={antenne.id}>
            <header className="hdesk-antenne-tete">
              <span className="hdesk-tag-antenne">À l&apos;antenne</span>
              <strong className={antenne.relie ? '' : 'hdesk-non-relie'}>{antenne.travail}</strong>
              <span className="hdesk-gestes">
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid={`hdesk-basculer-${antenne.id}`}
                  title="Afficher ce bureau sur mon écran (retour : bouton Revenir, Échap ou 2 min)"
                  onClick={() => void basculer(antenne)}
                >
                  ⇄ Afficher sur mon écran
                </button>
                <button
                  type="button"
                  className="btn btn-sm hdesk-btn-danger"
                  data-testid={`hdesk-fermer-${antenne.id}`}
                  disabled={enFermeture.has(antenne.id)}
                  onClick={() => void fermer(antenne)}
                >
                  {enFermeture.has(antenne.id) ? 'Fermeture…' : 'Fermer'}
                </button>
              </span>
            </header>
            <p className="hdesk-fiche">
              <span>Bureau : {antenne.id}</span>
              <span>Fil : {fil(antenne)}</span>
              <span>Lancé : {quand(antenne.lanceLe)}</span>
              {antenne.executable && (
                <span title={antenne.executable}>{nomDeFichier(antenne.executable)}</span>
              )}
            </p>
            {retours[antenne.id] && (
              <p
                className={`hdesk-retour ${retours[antenne.id].ok ? 'is-ok' : 'is-erreur'}`}
                role={retours[antenne.id].ok ? 'status' : 'alert'}
                data-testid={`hdesk-retour-${antenne.id}`}
              >
                {retours[antenne.id].message}
              </p>
            )}

            {/* LA TV (conv-1002) : bandeau + écran dans un seul cadre holographique, orange sous
                Ninja Claude ; voir `.hdesk-tv` dans la feuille. */}
            <div className={`hdesk-tv${pilote ? ' is-pilote' : ''}`} data-testid="hdesk-tv">
              {pilote ? (
                <div className="hdesk-bandeau is-pilote" data-testid="hdesk-bandeau">
                  <strong>Tu pilotes ce bureau</strong>
                  <span>
                    tes clics et ta frappe partent dans le bureau caché · retour en Regarder dans{' '}
                    <b data-testid="hdesk-compte-a-rebours">{minutesSecondes(restantMs)}</b> sans
                    geste
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    data-testid="hdesk-regarder"
                    onClick={quitterPilotage}
                  >
                    Regarder
                  </button>
                  <span className="hdesk-bandeau-jauge" aria-hidden="true">
                    <i style={{ width: `${(restantMs / delaiPilotageMs) * 100}%` }} />
                  </span>
                </div>
              ) : (
                <div className="hdesk-bandeau is-regarde" data-testid="hdesk-bandeau">
                  <strong>Regarder</strong>
                  <span>lecture seule · un clic dans l&apos;image ne fait rien</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-accent"
                    data-testid="hdesk-piloter"
                    disabled={!pilotable}
                    title={pilotable ? undefined : 'Pas d’image à piloter pour l’instant'}
                    onClick={piloter}
                  >
                    Piloter
                  </button>
                </div>
              )}

              <div className="hdesk-ecran">{ecran(antenne, true)}</div>
            </div>

            {pilote && (
              <form
                className="hdesk-dock"
                data-testid="hdesk-saisie"
                onSubmit={(e) => {
                  e.preventDefault()
                  taper(true)
                }}
                // La frappe destinée au bureau caché ne doit pas déclencher les raccourcis de l'app.
                onKeyDown={(e) => {
                  e.stopPropagation()
                  const t = toucheTv(e, !texte)
                  if (!t || !dernierClic || dernierClic.id !== antenne.id) return
                  // Touche spéciale : le texte en cours part d'abord, la touche ensuite.
                  e.preventDefault()
                  if (texte) {
                    void envoyer({ ...dernierClic, texte, sansClic: true })
                    setTexte('')
                  }
                  void envoyer({ ...dernierClic, touche: t, sansClic: true })
                }}
              >
                {visePret && dernierClic && (
                  <span className="hdesk-vise" title="Point visé, en pixels de la capture">
                    ({dernierClic.x}, {dernierClic.y})
                  </span>
                )}
                <input
                  data-testid="hdesk-texte"
                  value={texte}
                  onChange={(e) => setTexte(e.target.value)}
                  disabled={!visePret}
                  placeholder={
                    visePret
                      ? 'Texte à taper au point cliqué (Entrée = valider)'
                      : "Clique d'abord dans l'image pour viser un champ"
                  }
                />
                <button
                  type="button"
                  className="btn btn-sm btn-accent"
                  data-testid="hdesk-taper"
                  disabled={!visePret || !texte}
                  onClick={() => taper(false)}
                >
                  Taper
                </button>
              </form>
            )}
            {retourGeste && (
              <p className="hdesk-retour is-erreur" role="alert" data-testid="hdesk-retour-geste">
                {retourGeste}
              </p>
            )}
          </article>

          <ul className="hdesk-moniteurs" data-testid="hdesk-liste">
            {bureaux.map((b) => {
              const img = images[b.id]
              const surAntenne = b.id === antenne.id
              const enCours = enFermeture.has(b.id)
              return (
                <li key={b.id} className={`hdesk-moniteur-case${enCours ? ' is-fermeture' : ''}`}>
                  <button
                    type="button"
                    className={`hdesk-moniteur${surAntenne ? ' is-antenne' : ''}`}
                    data-testid={`hdesk-moniteur-${b.id}`}
                    aria-pressed={surAntenne}
                    title={surAntenne ? 'À l’antenne' : 'Passer ce bureau à l’antenne'}
                    onClick={() => choisir(b.id)}
                  >
                    <span className="hdesk-moniteur-ecran">{ecran(b, false)}</span>
                    <span className="hdesk-moniteur-legende">
                      {surAntenne && <span className="hdesk-tag-antenne is-petit">Antenne</span>}
                      <span className={b.relie ? '' : 'hdesk-non-relie'}>{b.travail}</span>
                    </span>
                    {img?.statut === 'uni' && (
                      <span className="hdesk-moniteur-etat is-alerte">image unie</span>
                    )}
                    {!b.conversationId && <span className="hdesk-moniteur-etat">sans fil</span>}
                  </button>
                  {/* LA CROIX (conv-1002) : « met des croix sur les ptites box en bas pour fermer les
                      hdesk ». Bouton FRÈRE du moniteur (un bouton ne peut pas en contenir un autre) ;
                      même fermeture que l'antenne, donc même confirmation avant toute perte. */}
                  <button
                    type="button"
                    className="hdesk-moniteur-fermer"
                    data-testid={`hdesk-fermer-moniteur-${b.id}`}
                    aria-label={`Fermer le bureau « ${b.travail} »`}
                    title={enCours ? 'Fermeture…' : 'Fermer ce bureau caché'}
                    disabled={enCours}
                    onClick={() => void fermer(b)}
                  >
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* « Récents » (conv-344) : relancer un bureau fermé sans rien retaper — aussi quand plus aucun
          bureau n'est ouvert, c'est même là qu'il sert le plus. */}
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
                  className="btn btn-sm"
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
