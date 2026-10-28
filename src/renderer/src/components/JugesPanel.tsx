import React, {
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { extraireVotesJuges, type StepDeRun, type VoteJuge } from './juges-votes'
import {
  blocDesJuges,
  blocDesJugesEnDirect,
  type BlocDesJuges,
  type BlocEnDirect,
  type JugeEnCours,
  type ObjectionDuJuge,
  type Suivi
} from './juges-bloc'
import { RunsEnDirect } from './runs-en-direct'
import { useRunReluDuDisque, type LecteurDuRunPerdu } from './run-relu-du-disque'
import {
  texteChatExecution as texte,
  useTextesChatExecution,
  type CleChatExecution
} from '../textes-ecrans/chat-execution'
import './JugesPanel.css'

/**
 * LE BLOC DES JUGES dans le fil — choix « 1 · Nacre » du /draft de conv-328 (2026-10-18), sur la
 * mise en page « Corrigé dans l'objection » : bandeau du verdict, objections À CORRIGER (adresse
 * dessous, déjà-corrigé accroché dedans, état du suivi à droite), juges en pied. Habit du bloc de
 * question : cadre nacre de 1 px, aplats gris sans bord, DÉFAUT en pastille rouge, NOUVELLE en
 * gel bleu → rose. Maquette : artifacts/draft-juges-chat/tour4.html, proposition 1.
 *
 * Le bloc montre le DERNIER passage jugé du run (juges-bloc.ts) : un run réparé porte un verdict
 * par passage, que l'ancien panneau listait comme autant de juges. Le verdict complet de chaque
 * juge reste à un clic, sur son nom en pied (demande du 14/08 : « rentrer dans le détail »).
 */
// Des CLÉS de texte, traduites à l'affichage (conv-1170).
const LIBELLE_VERDICT = {
  defaut: 'juges.verdict.defaut',
  valide: 'juges.verdict.valide',
  echec: 'juges.verdict.echec',
  // Un juge écrit en ce moment (conv-1021) : aucun verdict n'est encore rendu.
  encours: 'juges.verdict.encours'
} as const satisfies Record<string, CleChatExecution>
type Verdict = keyof typeof LIBELLE_VERDICT
const LIBELLE_SUIVI: Record<Suivi, CleChatExecution> = {
  partie: 'juges.suivi.partie',
  reprise: 'juges.suivi.reprise',
  nouvelle: 'juges.suivi.nouvelle'
}
/**
 * Une objection se replie sur 3 lignes et se déplie au clic. Sans moteur de mise en page (rendu
 * hors écran, tests), on ne peut pas mesurer la coupe : on la suppose au-delà de ce nombre de signes.
 */
const TEXTE_LONG = 240

/** « 1 reprise », « 2 reprises » : une clé par forme, chaque langue a ses pluriels. */
function pluriel(n: number, cleUn: CleChatExecution, clePlusieurs: CleChatExecution): string {
  return texte(n > 1 ? clePlusieurs : cleUn, { n })
}

/** Le texte du juge, ses `portions de code` en pastilles. */
function avecCode(texte: string): React.ReactNode {
  return texte.split(/(`[^`\n]+`)/g).map((morceau, i) =>
    /^`[^`\n]+`$/.test(morceau) ? (
      <code key={i} className="jpan-c">
        {morceau.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{morceau}</Fragment>
    )
  )
}

function IconeVerdict({ verdict }: { verdict: Verdict }): React.JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      {verdict === 'encours' ? (
        <circle className="jpan-pouls" cx="6" cy="6" r="3" fill="currentColor" />
      ) : verdict === 'valide' ? (
        <path
          d="M2.2 6.3 4.8 8.8 9.8 3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : verdict === 'defaut' ? (
        <path
          d="M3 3l6 6M9 3l-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M6 2.5v4.5M6 9.2v.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

const EPINGLE = (
  <svg className="jpan-epingle" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path
      d="M6 11s3.6-3.5 3.6-6.2A3.6 3.6 0 0 0 2.4 4.8C2.4 7.5 6 11 6 11z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="4.9" r="1.2" fill="currentColor" />
  </svg>
)
const COCHE = (
  <svg className="jpan-coche" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path
      d="M2.2 6.3 4.8 8.8 9.8 3.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** L'infobulle d'un état : à quel passage il se rapporte, en mots courants. */
function titreSuivi(suivi: Suivi, reparationPrecedente: number | undefined): string {
  const precedent =
    reparationPrecedente === undefined
      ? texte('juges.precedent.inconnu')
      : reparationPrecedente > 0
        ? texte('juges.precedent.reparation', { n: reparationPrecedente })
        : texte('juges.precedent.premier')
  if (suivi === 'nouvelle') return texte('juges.suivi.titre.nouvelle', { precedent })
  if (suivi === 'partie') return texte('juges.suivi.titre.partie', { precedent })
  return texte('juges.suivi.titre.reprise', { precedent })
}

function Objection({
  objection,
  reparationPrecedente,
  plusieursJuges
}: {
  objection: ObjectionDuJuge
  reparationPrecedente: number | undefined
  plusieursJuges: boolean
}): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const [deplie, setDeplie] = useState(false)
  const [coupe, setCoupe] = useState(false)
  const refTexte = useRef<HTMLParagraphElement>(null)
  // « Lire la suite » seulement si le repli coupe VRAIMENT le texte : un seuil en caractères le
  // montrait sous une objection qui tenait en 3 lignes (capture du 2026-10-18, 2e objection).
  useLayoutEffect(() => {
    const el = refTexte.current
    if (!el || deplie) return
    const mesurer = (): void => {
      const sansMiseEnPage = el.clientHeight === 0 && el.scrollHeight === 0
      setCoupe(
        sansMiseEnPage ? objection.texte.length > TEXTE_LONG : el.scrollHeight > el.clientHeight + 1
      )
    }
    mesurer()
    if (typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(el)
    return () => observateur.disconnect()
  }, [deplie, objection.texte])
  return (
    <div className="jpan-obj" data-testid="jpan-objection">
      <span className={`jpan-gravite is-${(objection.gravite ?? 'nue').toLowerCase()}`}>
        {objection.gravite ?? 'OBJECTION'}
      </span>
      <div className="jpan-obj-corps">
        <p ref={refTexte} className={`jpan-obj-texte${deplie ? '' : ' is-replie'}`}>
          {avecCode(objection.texte)}
        </p>
        {(coupe || deplie) && (
          <button
            type="button"
            className="jpan-suite"
            aria-expanded={deplie}
            onClick={() => setDeplie((valeur) => !valeur)}
          >
            {deplie ? t('juges.reduire') : t('juges.lire-la-suite')}
          </button>
        )}
        {objection.adresses.length > 0 && (
          <div className="jpan-adresses" data-testid="jpan-adresses">
            {objection.adresses.map((adresse) => (
              <span key={adresse.chemin} className="jpan-adresse" title={adresse.chemin}>
                {EPINGLE}
                <code className="jpan-c is-fichier">{adresse.affiche}</code>
                {(adresse.lieu || adresse.lignes) && (
                  <code className="jpan-c is-lieu">
                    {[adresse.lieu, adresse.lignes].filter(Boolean).join(' · ')}
                  </code>
                )}
              </span>
            ))}
          </div>
        )}
        {objection.corrige.length > 0 && (
          <div className="jpan-corrige" data-testid="jpan-corrige">
            <span className="jpan-corrige-titre">{t('juges.deja-corrige')}</span>
            {objection.corrige.map((element, i) => (
              <div key={i} className="jpan-corrige-ligne">
                {COCHE}
                <span>{avecCode(element)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="jpan-obj-droite">
        {objection.suivi && (
          <span
            className={`jpan-suivi is-${objection.suivi}`}
            title={titreSuivi(objection.suivi, reparationPrecedente)}
          >
            {t(LIBELLE_SUIVI[objection.suivi])}
          </span>
        )}
        {plusieursJuges && <span className="jpan-qui">{objection.juge}</span>}
      </span>
    </div>
  )
}

function sousTitre(bloc: BlocDesJuges, verdict: Verdict): string {
  const { objections } = bloc
  if (objections.length === 0) {
    if (verdict === 'valide' && bloc.constats > 0)
      return pluriel(bloc.constats, 'juges.constats.un', 'juges.constats.n')
    if (verdict === 'defaut') return texte('juges.detail-dessous')
    return ''
  }
  if (bloc.passagePrecedent) {
    const reprises = objections.filter((o) => o.suivi === 'partie' || o.suivi === 'reprise').length
    const nouvelles = objections.filter((o) => o.suivi === 'nouvelle').length
    const enPartie = objections.filter((o) => o.suivi === 'partie').length
    return [
      reprises > 0 ? pluriel(reprises, 'juges.reprises.un', 'juges.reprises.n') : '',
      nouvelles > 0 ? pluriel(nouvelles, 'juges.nouvelles.un', 'juges.nouvelles.n') : '',
      enPartie > 0 ? pluriel(enPartie, 'juges.en-partie.un', 'juges.en-partie.n') : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }
  const majeures = objections.filter((o) => o.gravite !== 'MINEUR').length
  const mineures = objections.length - majeures
  return [
    pluriel(majeures, 'juges.majeures.un', 'juges.majeures.n'),
    pluriel(mineures, 'juges.mineures.un', 'juges.mineures.n')
  ].join(' · ')
}

function dureeLisible(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

/** Le sous-titre pendant que le juge écrit : ce qu'on sait déjà, sans rien annoncer de plus. */
function sousTitreEnCours(enCours: JugeEnCours): string {
  if (!enCours.lisible) return texte('juges.plusieurs-ecrivent')
  return enCours.objections.length > 0 ? texte('juges.ecrit-encore') : texte('juges.aucune-encore')
}

/**
 * Le dessin du bloc, pour un verdict rendu (`bloc`) ou un juge qui écrit (`enCours`). Le second
 * prime : pendant qu'un passage est jugé, le verdict d'avant ne sert plus qu'au suivi de ses objections.
 */
function BlocJuges({ bloc, enCours, reparationEnCours }: BlocEnDirect): React.JSX.Element | null {
  const { t } = useTextesChatExecution()
  const [ouvert, setOuvert] = useState<number | 'direct' | null>(null)
  // Plié par défaut (conv-1081, « je veux que ce bloc soit plié par défaut et dépliable ») : le
  // bandeau suffit à lire le verdict ; objections et juges se déplient au clic sur lui.
  const [deplie, setDeplie] = useState(false)
  if (!enCours && (!bloc || bloc.votes.length === 0)) return null

  const votes = enCours ? [] : (bloc?.votes ?? [])
  const objections = enCours ? enCours.objections : (bloc?.objections ?? [])
  const valides = votes.filter((vote) => vote.vote === 'valide').length
  // Une objection MINEUR bloque la clôture même sous un VALIDE (décision conv-844) : le bandeau le dit.
  const verdict: Verdict = enCours
    ? 'encours'
    : votes.some((vote) => vote.vote === 'defaut') || objections.length > 0
      ? 'defaut'
      : valides > 0
        ? 'valide'
        : 'echec'
  const n = objections.length
  const titre =
    n > 0
      ? pluriel(n, 'juges.titre.objections.un', 'juges.titre.objections.n')
      : verdict === 'encours'
        ? t('juges.titre.relit')
        : verdict === 'valide'
          ? t('juges.titre.aucune')
          : verdict === 'defaut'
            ? t('juges.titre.refuse')
            : t('juges.titre.sans-verdict')
  const sous = enCours
    ? sousTitreEnCours(enCours)
    : [
        bloc ? sousTitre(bloc, verdict) : '',
        reparationEnCours ? t('juges.reparation-en-cours', { n: reparationEnCours }) : ''
      ]
        .filter(Boolean)
        .join(' · ')
  // Pendant le jugement, le passage d'avant est celui du DERNIER verdict rendu.
  const reparationPrecedente = enCours
    ? bloc
      ? bloc.reparation
      : undefined
    : bloc?.reparationPrecedente
  const juge: VoteJuge | undefined = typeof ouvert === 'number' ? votes[ouvert] : undefined

  return (
    <section
      className={`jpan${deplie ? ' is-deplie' : ''}`}
      data-testid="juges-panel"
      data-verdict={verdict}
    >
      <button
        type="button"
        className="jpan-bandeau"
        data-testid="jpan-bandeau"
        aria-expanded={deplie}
        title={deplie ? t('juges.replier-bloc') : t('juges.deplier-bloc')}
        onClick={() => setDeplie((valeur) => !valeur)}
      >
        <span className={`jpan-verdict is-${verdict}`}>
          <IconeVerdict verdict={verdict} />
          {t(LIBELLE_VERDICT[verdict])}
        </span>
        <span className="jpan-titre">
          <b>{titre}</b>
          {sous && <span className="jpan-sous">{sous}</span>}
        </span>
        {enCours ? (
          <span className="jpan-quorum" title={t('juges.passage-juge')}>
            {enCours.reparation > 0
              ? t('juges.reparation', { n: enCours.reparation })
              : t('juges.premier-passage')}
          </span>
        ) : (
          bloc && (
            <span
              className="jpan-quorum"
              title={
                bloc.reparation > 0
                  ? t('juges.quorum.titre.reparation', { n: bloc.reparation })
                  : t('juges.quorum.titre.premier')
              }
            >
              {t(valides > 1 ? 'juges.quorum.n' : 'juges.quorum.un', {
                valides,
                total: votes.length
              })}
            </span>
          )
        )}
        <svg className="jpan-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {deplie && n > 0 && (
        <>
          <div className="jpan-section">
            <span className="jpan-kicker">{t('juges.a-corriger')}</span>
            <span className="jpan-filet" />
          </div>
          {objections.map((objection, i) => (
            <Objection
              key={i}
              objection={objection}
              reparationPrecedente={reparationPrecedente}
              plusieursJuges={votes.length > 1}
            />
          ))}
        </>
      )}
      {deplie && (
        <div className="jpan-pied">
          {enCours ? (
            <button
              type="button"
              className={`jpan-juge is-encours${ouvert === 'direct' ? ' is-ouvert' : ''}`}
              data-testid="jpan-ligne"
              aria-expanded={ouvert === 'direct'}
              title={ouvert === 'direct' ? t('juges.replier-texte') : t('juges.lire-en-cours')}
              onClick={() => setOuvert((courant) => (courant === 'direct' ? null : 'direct'))}
            >
              <span className="jpan-juge-nom">{enCours.libelle}</span>
              <span className="jpan-juge-absent">{t('juges.ecrit')}</span>
            </button>
          ) : (
            votes.map((vote, index) => (
              <button
                key={`${vote.libelle}-${index}`}
                type="button"
                className={`jpan-juge is-${vote.vote}${ouvert === index ? ' is-ouvert' : ''}`}
                data-testid="jpan-ligne"
                aria-expanded={ouvert === index}
                title={ouvert === index ? t('juges.replier-verdict') : t('juges.lire-verdict')}
                onClick={() => setOuvert((courant) => (courant === index ? null : index))}
              >
                <span className="jpan-juge-nom">{vote.libelle}</span>
                {vote.vote === 'echec' ? (
                  <span className="jpan-juge-absent">{t('juges.pas-vote')}</span>
                ) : vote.score !== undefined ? (
                  <b className="jpan-score">{vote.score}</b>
                ) : (
                  <b className="jpan-score">
                    {t(vote.vote === 'valide' ? 'juges.verdict.valide' : 'juges.verdict.defaut')}
                  </b>
                )}
              </button>
            ))
          )}
        </div>
      )}
      {deplie && enCours && ouvert === 'direct' && (
        <div className="jpan-complet" data-testid="jpan-verdict">
          <span className="jpan-complet-tete">
            {t('juges.texte-en-cours', { juge: enCours.libelle })}
          </span>
          <p>{enCours.texte.trim() || t('juges.rien-ecrit')}</p>
        </div>
      )}
      {deplie && juge && (
        <div className="jpan-complet" data-testid="jpan-verdict">
          <span className="jpan-complet-tete">
            {t('juges.verdict-complet', { juge: juge.libelle })}
            {juge.costUsd !== undefined && ` · ${juge.costUsd.toFixed(2)} $`}
            {juge.durationMs !== undefined && ` · ${dureeLisible(juge.durationMs)}`}
          </span>
          <p>{juge.texte}</p>
        </div>
      )}
    </section>
  )
}

/** Le bloc d'un tour TERMINÉ : le verdict du run, relu dans sa trace sur disque. */
export function JugesPanel({
  conversationId,
  charger
}: {
  conversationId: string
  /** Injectable pour les tests : le vrai chargeur lit les runs de la conversation puis leur trace. */
  charger?: (conversationId: string) => Promise<readonly StepDeRun[]>
}): React.JSX.Element | null {
  const [bloc, setBloc] = useState<BlocDesJuges | null | undefined>()
  useEffect(() => {
    let vivant = true
    const chargeur = charger ?? chargerTraceParDefaut
    chargeur(conversationId)
      .then((steps) => {
        if (vivant) setBloc(blocDesJuges(steps))
      })
      .catch(() => {
        if (vivant) setBloc(null)
      })
    return () => {
      vivant = false
    }
  }, [conversationId, charger])
  return bloc ? <BlocJuges bloc={bloc} /> : null
}

/**
 * Le bloc d'un tour EN COURS, rempli en direct (conv-1021) : le dernier verdict rendu dès qu'il
 * tombe, puis, pendant qu'un juge écrit, ses objections au fur et à mesure qu'elles arrivent.
 * La source est ce que le fil reçoit en direct ; quand l'interface a perdu le run (rechargée en
 * plein run), c'est `trace.json`, que le main réécrit à chaque étape (`run-relu-du-disque.ts`).
 */
export function JugesPanelEnDirect({
  conversationId,
  lecteur
}: {
  conversationId: string
  /** Injectable pour les tests : le vrai lit les runs, `trace.json` et le bus de l'app. */
  lecteur?: LecteurDuRunPerdu
}): React.JSX.Element | null {
  const direct = useContext(RunsEnDirect)[conversationId]
  const relu = useRunReluDuDisque(conversationId, !direct, lecteur)
  const run = direct ?? relu
  const steps = run?.steps
  const tourne = run?.status === 'running'
  const phase = tourne ? run?.phase : undefined
  // Le texte streamé n'est celui du juge que pendant SA phase : avant, c'est celui du build.
  const texte = phase?.step === 'judge' ? run?.liveText : undefined
  const etat = useMemo(
    () => blocDesJugesEnDirect({ steps: steps ?? [], enCours: tourne, phase, texte }),
    [steps, tourne, phase, texte]
  )
  return run ? <BlocJuges {...etat} /> : null
}

/**
 * Le vrai chargeur : les runs de la conversation, du plus récent au plus ancien, et le PREMIER
 * qui porte des votes de juges gagne. « Le dernier run » ne suffisait pas : une conversation
 * porte souvent un run jugé ET un run annexe sans juge (mesuré sur conv-1122, deux runs).
 */
async function chargerTraceParDefaut(conversationId: string): Promise<StepDeRun[]> {
  const runs = (await window.api.conversationRuns?.(conversationId)) ?? []
  for (const run of runs) {
    if (!run?.path) continue
    const steps = (await window.api.runTrace?.(run.path).catch(() => null)) as StepDeRun[] | null
    if (steps && extraireVotesJuges(steps).length > 0) return steps
  }
  return []
}
