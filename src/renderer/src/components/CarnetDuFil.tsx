/**
 * CARNET VIVANT DU FIL (conv-1038, 2026-10-21) — le panneau repliable en haut du fil.
 *
 * Ce qu'il montre est calculé par `carnet-du-fil.ts`, sans rien inventer. Ici : l'affichage, la
 * lecture de la mémoire du fil et des fichiers touchés (relues à chaque tour fini), et les deux
 * gestes. Barrer ou corriger une ligne pose une correction dans la saisie, SANS envoyer :
 * l'utilisateur la relit, et elle part avec son message suivant. Barrer un fait retenu le retire
 * AUSSI de la mémoire de l'agent (`conversationOublierFait`), sinon il le relirait au tour suivant.
 *
 * « COMPACTER MONTRE CE QUI EST GARDÉ » (conv-1038, 2026-10-21 — idée 5) : après un compactage, le
 * carnet montre le résumé dont l'agent repart et combien de messages il ne relit plus
 * (`compactageDuFil`). Un compactage qui se TERMINE sous les yeux de l'utilisateur ouvre le carnet,
 * une fois, sans réécrire son choix replié/déplié.
 * check: CarnetDuFil.compactage.test.tsx — 5 cas rouges avant ce changement (aucune rubrique
 * « garde », aucune ouverture), dont le fil DÉJÀ compacté qui doit rester replié.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Msg, AsstMsg } from './chat-view-types'
import {
  LIBELLES_CARNET,
  compactageDuFil,
  lignesDuCarnet,
  resumeDAbsence,
  texteDeCorrection,
  type EtatCompactage,
  type FaitRetenu,
  type LigneCarnet,
  type ResumeAbsence,
  type RubriqueCarnet
} from './carnet-du-fil'
import './CarnetDuFil.css'

type TraceDeFichier = { timestamp: string; paths: string[] }

type Oubli = { etat: 'fait' } | { etat: 'rate'; raison: string }

/** Le choix replié/déplié suit l'utilisateur d'un fil à l'autre. */
const CLE_OUVERT = 'autowin.chat.carnet.ouvert'

const ORDRE: RubriqueCarnet[] = [
  'objectif',
  'question',
  'maintenant',
  'reste',
  'recommande',
  'fait',
  'retenu',
  'garde',
  'fichier'
]

/** Une question s'y répond dans le fil ; un fichier touché est un constat, pas une affirmation. */
const SANS_CORRECTION = new Set<RubriqueCarnet>(['question', 'fichier'])

function lireOuvert(): boolean {
  try {
    return window.localStorage.getItem(CLE_OUVERT) === '1'
  } catch {
    return false
  }
}

function ecrireOuvert(ouvert: boolean): void {
  try {
    window.localStorage.setItem(CLE_OUVERT, ouvert ? '1' : '0')
  } catch {
    /* un stockage plein ne doit pas empêcher de replier le carnet */
  }
}

/** Les fichiers distincts, du plus récemment touché au plus ancien. */
function fichiersDesTraces(traces: readonly TraceDeFichier[]): string[] {
  const tries = [...traces].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  return [...new Set(tries.flatMap((trace) => trace.paths))]
}

function phraseAbsence(resume: ResumeAbsence): string {
  const morceaux = [
    `${resume.tours} tour${resume.tours > 1 ? 's' : ''} fini${resume.tours > 1 ? 's' : ''}`
  ]
  if (resume.fichiers > 0)
    morceaux.push(
      `${resume.fichiers} fichier${resume.fichiers > 1 ? 's' : ''} modifié${resume.fichiers > 1 ? 's' : ''}`
    )
  if (resume.question) morceaux.push('une question t’attend')
  if (resume.coutUsd !== undefined)
    morceaux.push(`coût ${resume.coutPartiel ? 'd’au moins ' : ''}${resume.coutUsd.toFixed(2)} $`)
  return morceaux.join(' · ')
}

function phraseLaisses(laisses: number): string {
  return laisses > 1 ? `les ${laisses} messages d’avant` : `le message d’avant`
}

function resumeReplie(lignes: readonly LigneCarnet[], compactage: EtatCompactage | null): string {
  const compte = (rubrique: RubriqueCarnet): number =>
    lignes.filter((ligne) => ligne.rubrique === rubrique).length
  const morceaux: string[] = []
  if (compte('question') > 0) morceaux.push('une question en attente')
  if (compte('reste') > 0) morceaux.push(`${compte('reste')} à faire`)
  if (compte('retenu') > 0)
    morceaux.push(`${compte('retenu')} retenu${compte('retenu') > 1 ? 's' : ''}`)
  if (compactage?.etat === 'en-cours') morceaux.push('compactage en cours')
  else if (compte('garde') > 0) morceaux.push('résumé gardé')
  if (compte('fichier') > 0)
    morceaux.push(`${compte('fichier')} fichier${compte('fichier') > 1 ? 's' : ''}`)
  return morceaux.join(' · ')
}

export function CarnetDuFil({
  conversationId,
  fil,
  vueAvantOuverture,
  onCorrection
}: {
  conversationId: string
  fil: readonly Msg[]
  /** Repère « non lu » lu AVANT d'ouvrir le fil, seulement s'il était non lu. */
  vueAvantOuverture?: number
  onCorrection: (texte: string) => void
}): React.JSX.Element | null {
  const [retenus, setRetenus] = useState<FaitRetenu[]>([])
  const [traces, setTraces] = useState<TraceDeFichier[]>([])
  const [ouvert, setOuvert] = useState(lireOuvert)
  const [barrees, setBarrees] = useState<ReadonlySet<string>>(() => new Set())
  // Le sort de chaque oubli demandé à la mémoire de l'agent : la ligne barrée doit dire s'il a raté.
  const [oublis, setOublis] = useState<ReadonlyMap<string, Oubli>>(() => new Map())
  // Ce que le carnet n'a PAS pu lire : sans le dire, une lecture ratée se lisait « rien de retenu ».
  const [illisibles, setIllisibles] = useState<{ memoire?: string; fichiers?: string }>({})
  const [enCorrection, setEnCorrection] = useState<{ cle: string; texte: string } | null>(null)
  const [absenceFermee, setAbsenceFermee] = useState(false)
  const absenceDejaOuverte = useRef(false)

  /*
   * RELU À CHAQUE TOUR FINI : la mémoire et les fichiers bougent pendant un tour, mais un tour en
   * cours n'a rien conclu. La signature change à l'envoi puis à la fin du tour.
   */
  const dernier = fil.at(-1)
  const tourEnCours = dernier?.role === 'assistant' && (dernier as AsstMsg).status === 'streaming'
  const signature = `${fil.length}:${tourEnCours ? 'en-cours' : 'fini'}`
  useEffect(() => {
    let vivant = true
    const noterIllisible = (quoi: 'memoire' | 'fichiers', erreur?: unknown): void => {
      if (!vivant) return
      const raison =
        erreur === undefined ? undefined : erreur instanceof Error ? erreur.message : String(erreur)
      setIllisibles((actuels) =>
        actuels[quoi] === raison ? actuels : { ...actuels, [quoi]: raison }
      )
    }
    // Un pont d'avant redémarrage n'a pas ces canaux : rien à lire, ce n'est pas un échec.
    void Promise.resolve(window.api?.conversationMemoire?.(conversationId)).then(
      (faits) => {
        noterIllisible('memoire')
        if (vivant && Array.isArray(faits)) setRetenus(faits)
      },
      (erreur: unknown) => noterIllisible('memoire', erreur)
    )
    void Promise.resolve(window.api?.conversationFileTraces?.(conversationId)).then(
      (lues) => {
        noterIllisible('fichiers')
        if (vivant && Array.isArray(lues))
          setTraces(lues.map(({ timestamp, paths }) => ({ timestamp, paths })))
      },
      (erreur: unknown) => noterIllisible('fichiers', erreur)
    )
    return () => {
      vivant = false
    }
  }, [conversationId, signature])

  const lignes = useMemo(
    () => lignesDuCarnet({ fil, retenus, fichiers: fichiersDesTraces(traces) }),
    [fil, retenus, traces]
  )
  const absence = useMemo(
    () => resumeDAbsence({ fil, vueA: vueAvantOuverture, traces }),
    [fil, vueAvantOuverture, traces]
  )

  const compactage = useMemo(() => compactageDuFil(fil), [fil])
  // L'état vu au rendu précédent : seul le PASSAGE de « en cours » à « fait » ouvre le carnet. Un
  // fil déjà compacté à l'ouverture garde le choix replié de l'utilisateur.
  const compactageVu = useRef(compactage?.etat)
  useEffect(() => {
    const avant = compactageVu.current
    compactageVu.current = compactage?.etat
    if (avant === 'en-cours' && compactage?.etat === 'fait') setOuvert(true)
  }, [compactage?.etat])

  // Un fil non lu s'ouvre sur ce qui s'est passé : une fois, sans toucher au choix enregistré.
  useEffect(() => {
    if (absence && !absenceDejaOuverte.current) {
      absenceDejaOuverte.current = true
      setOuvert(true)
    }
  }, [absence])

  const lecturesRatees = [
    illisibles.memoire !== undefined && `mémoire de l’agent illisible (${illisibles.memoire})`,
    illisibles.fichiers !== undefined && `fichiers touchés illisibles (${illisibles.fichiers})`
  ].filter((texte): texte is string => typeof texte === 'string')

  if (lignes.length === 0 && !absence && lecturesRatees.length === 0 && !compactage) return null

  const cleDe = (ligne: LigneCarnet): string => `${ligne.cle}|${ligne.texte}`

  function basculer(): void {
    const suivant = !ouvert
    setOuvert(suivant)
    ecrireOuvert(suivant)
  }

  /*
   * L'OUBLI QUI ÉCHOUE SE VOIT (conv-1038, 2026-10-21). L'échec était avalé (`.catch(() =>
   * undefined)`) : la ligne paraissait barrée, l'utilisateur croyait l'agent délesté d'un fait qu'il
   * relisait encore. Un pont d'avant redémarrage, sans ce canal, ratait de la même façon, sans bruit.
   * `false` n'est pas un échec : le fait n'était déjà plus dans la mémoire, l'effet voulu est là.
   */
  function oublierSiRetenu(ligne: LigneCarnet): void {
    if (ligne.rubrique !== 'retenu' || !ligne.titreRetenu) return
    const cle = cleDe(ligne)
    const noter = (oubli: Oubli): void => setOublis((actuels) => new Map(actuels).set(cle, oubli))
    const oublier = window.api?.conversationOublierFait
    if (!oublier) {
      noter({ etat: 'rate', raison: 'Autowin doit redémarrer pour ce geste' })
      return
    }
    void oublier(conversationId, ligne.titreRetenu).then(
      () => noter({ etat: 'fait' }),
      (erreur: unknown) =>
        noter({ etat: 'rate', raison: erreur instanceof Error ? erreur.message : String(erreur) })
    )
  }

  function barrer(ligne: LigneCarnet): void {
    setBarrees((actuelles) => new Set(actuelles).add(cleDe(ligne)))
    oublierSiRetenu(ligne)
    onCorrection(texteDeCorrection(ligne))
  }

  function validerCorrection(ligne: LigneCarnet, nouveau: string): void {
    setEnCorrection(null)
    if (nouveau.trim() === ligne.texte.trim()) return
    setBarrees((actuelles) => new Set(actuelles).add(cleDe(ligne)))
    oublierSiRetenu(ligne)
    onCorrection(texteDeCorrection(ligne, nouveau))
  }

  const resume = resumeReplie(lignes, compactage)

  return (
    <section
      className={`carnet-du-fil${ouvert ? ' is-ouvert' : ''}`}
      data-origine="carnet-du-fil"
      aria-label="Carnet du fil"
    >
      <button
        type="button"
        className="carnet-bascule"
        aria-expanded={ouvert}
        title="Ce que le fil a établi jusqu’ici : barre ou corrige une ligne pour le dire à l’agent"
        onClick={basculer}
      >
        <span className="carnet-chevron" aria-hidden="true">
          {ouvert ? '▾' : '▸'}
        </span>
        <span className="carnet-titre">Carnet du fil</span>
        {resume && <span className="carnet-resume">{resume}</span>}
      </button>
      {ouvert && (
        <div className="carnet-corps">
          {absence && !absenceFermee && (
            <div className="carnet-absence" data-testid="carnet-absence" role="status">
              <strong>Pendant ton absence :</strong> {phraseAbsence(absence)}
              <button
                type="button"
                className="carnet-absence-fermer"
                aria-label="Fermer ce résumé"
                onClick={() => setAbsenceFermee(true)}
              >
                ✕
              </button>
            </div>
          )}
          {lecturesRatees.length > 0 && (
            <div className="carnet-lecture-ratee" role="status">
              {`Carnet incomplet : ${lecturesRatees.join(' · ')}.`}
            </div>
          )}
          {compactage?.etat === 'en-cours' && (
            <div className="carnet-compactage" data-testid="carnet-compactage" role="status">
              Compactage en cours : le résumé que l’agent gardera s’affichera ici dès qu’il sera
              écrit.
            </div>
          )}
          {compactage?.etat === 'fait' && !compactage.repondu && (
            <div
              className="carnet-compactage is-rate"
              data-testid="carnet-compactage"
              role="status"
            >
              {`Compactage raté : aucun résumé n’a été écrit, et l’agent ne relit pourtant plus ${phraseLaisses(compactage.laisses)}.`}
            </div>
          )}
          {ORDRE.map((rubrique) => {
            const dans = lignes.filter((ligne) => ligne.rubrique === rubrique)
            if (dans.length === 0) return null
            return (
              <div key={rubrique} className="carnet-rubrique" data-rubrique={rubrique}>
                <div className="carnet-rubrique-titre">{LIBELLES_CARNET[rubrique]}</div>
                {rubrique === 'garde' && compactage?.etat === 'fait' && (
                  <p className="carnet-garde-explication">
                    {`L’agent ne relit plus ${phraseLaisses(compactage.laisses)} : il repart de ce résumé et de ce qu’il a retenu.`}
                    {compactage.restantes > 0 &&
                      ` La suite du résumé (${compactage.restantes} ligne${compactage.restantes > 1 ? 's' : ''}) est dans le fil.`}
                  </p>
                )}
                <ul>
                  {dans.map((ligne) => {
                    const cle = cleDe(ligne)
                    const barree = barrees.has(cle)
                    const oubli = oublis.get(cle)
                    const edition = enCorrection?.cle === cle ? enCorrection : null
                    return (
                      <li
                        key={cle}
                        className={`carnet-ligne${barree ? ' is-barree' : ''}`}
                        data-rubrique={ligne.rubrique}
                        data-oubli={oubli?.etat}
                      >
                        {edition ? (
                          <input
                            className="carnet-correction"
                            aria-label="Nouvelle version de cette ligne"
                            value={edition.texte}
                            autoFocus
                            onChange={(event) =>
                              setEnCorrection({ cle, texte: event.currentTarget.value })
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                validerCorrection(ligne, edition.texte)
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                setEnCorrection(null)
                              }
                            }}
                            onBlur={() => setEnCorrection(null)}
                          />
                        ) : (
                          <span className="carnet-ligne-texte">{ligne.texte}</span>
                        )}
                        {oubli?.etat === 'rate' && (
                          <span className="carnet-oubli-rate" role="status">
                            {`encore dans la mémoire de l’agent (${oubli.raison}) : ta correction écrite part quand même`}
                          </span>
                        )}
                        {!SANS_CORRECTION.has(ligne.rubrique) && !barree && !edition && (
                          <span className="carnet-gestes">
                            <button
                              type="button"
                              aria-label="Corriger cette ligne"
                              title="Corriger : ta version part avec ton prochain message"
                              onClick={() => setEnCorrection({ cle, texte: ligne.texte })}
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              aria-label="Barrer cette ligne"
                              title={
                                ligne.rubrique === 'retenu'
                                  ? 'Barrer : l’agent l’oublie, et ta correction part avec ton prochain message'
                                  : 'Barrer : « ce n’est plus vrai » part avec ton prochain message'
                              }
                              onClick={() => barrer(ligne)}
                            >
                              ✕
                            </button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
