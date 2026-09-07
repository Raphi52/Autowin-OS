import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  compterFilsNonLus,
  formatExchangeDate,
  formatMessageDate,
  groupThreads,
  sortByName,
  splitByExchange,
  type FilConversation,
  type Interlocuteur,
  type MessageInterlocuteur
} from './outlook-model'
import { Spinner } from './Spinner'
import {
  basculerAlerte,
  ecrireAlertes,
  lireAlertes,
  messagesAAlerter,
  type AlertesInterlocuteurs
} from './outlook-alertes'
import { alerter, autoriserPopups } from './outlook-alerte-notif'

/**
 * La tuile Interlocuteurs, en TROIS écrans successifs dans la même tuile.
 *
 * L'ancienne version affichait une liste plate de contacts dont chaque ligne renvoyait ouvrir le
 * message DANS Outlook — donc quitter Autowin pour lire, et y revenir pour la suite. Demande de
 * l'utilisateur du 2026-09-03 : « une liste de mes interlocuteurs par nom ; un clic ouvre mes fils
 * avec cette personne ; un fil s'affiche comme une conversation Teams ; répondre envoie sur Outlook ;
 * à chaque étape un bouton précédent ».
 *
 * Trois écrans, un seul chemin, un retour à chaque cran :
 *   contacts → fils de cette personne → la conversation déroulée (et la réponse).
 *
 * Un QUATRIÈME cran s'ouvre depuis l'écran des fils, ajouté sur demande du 2026-09-07 : « quand on
 * sélectionne un interlocuteur, un bouton pour créer une nouvelle conversation, donc entrer un objet
 * et envoyer le premier message ». Il part de l'ADRESSE du contact et non d'un message existant :
 * c'est le seul écran où l'objet est saisi, puisqu'il n'y a pas de « RE: … » dont hériter.
 *
 * Deux règles qui ne doivent pas être « améliorées » par inadvertance :
 *  - l'ENVOI est irréversible : il demande une confirmation explicite, et l'échec est AFFICHÉ ;
 *  - une réponse s'accroche au dernier message REÇU. Répondre à son propre envoi n'adresse le message
 *    à personne, et un message parti nulle part se lirait comme un message envoyé.
 */

/** Où l'on se trouve dans la tuile. Un seul état : deux booléens auraient permis l'incohérent. */
type Etape =
  | { ecran: 'contacts' }
  | { ecran: 'fils'; contact: string }
  | { ecran: 'conversation'; contact: string; fil: string }
  /**
   * Écrire une conversation qui n'existe PAS encore. Demande du 2026-09-07. C'est un cran à part et
   * non un panneau greffé sur l'écran des fils : la tuile est étroite, et un formulaire ouvert
   * au-dessus de la liste aurait poussé les fils hors de vue à chaque fois.
   */
  | { ecran: 'nouveau'; contact: string }

export function InterlocuteursWidget({
  fils,
  now,
  onOuvrir,
  ouvertureEnCours,
  onRepondre,
  onNouvelleConversation,
  onMarquerLu
}: {
  fils: Interlocuteur[]
  now: number
  onOuvrir: (id: string) => Promise<void>
  ouvertureEnCours: string | null
  onRepondre: (id: string, corps: string) => Promise<{ ok: boolean; erreur?: string }>
  /**
   * ENVOIE un message NEUF : une adresse, un objet, un premier message.
   *
   * Distinct de `onRepondre` : celui-ci part d'un message existant dont Outlook tire destinataire et
   * objet « RE: … ». Ici il n'y a aucun message de départ, donc l'objet est SAISI.
   */
  onNouvelleConversation: (
    adresse: string,
    objet: string,
    corps: string
  ) => Promise<{ ok: boolean; erreur?: string }>
  /**
   * Marque des messages comme LUS dans Outlook. Ecrit dans la boite reelle.
   *
   * Appele par l'ouverture d'un fil, jamais par l'affichage de la liste : c'est le geste d'ouvrir qui
   * vaut lecture. La relecture periodique, elle, ne doit RIEN marquer -- sinon la boite se viderait de
   * ses non-lus pendant que l'utilisateur regarde ailleurs.
   */
  onMarquerLu: (ids: string[]) => Promise<{ ok: boolean; erreur?: string }>
}): React.JSX.Element {
  const [etape, setEtape] = useState<Etape>({ ecran: 'contacts' })

  /**
   * Les interlocuteurs dont l'utilisateur veut être ALERTÉ (popup + son), relus au montage depuis le
   * poste : un réglage qu'il faudrait recocher à chaque démarrage ne serait pas un réglage.
   */
  const [alertes, setAlertes] = useState<AlertesInterlocuteurs>(() =>
    lireAlertes(window.localStorage)
  )
  const basculer = useCallback((cle: string) => {
    setAlertes((courantes) => {
      const suivantes = basculerAlerte(courantes, cle)
      ecrireAlertes(window.localStorage, suivantes)
      // L'autorisation système n'est demandée qu'au moment où quelqu'un ACTIVE une alerte : la
      // réclamer au chargement de l'accueil ferait surgir une demande que personne n'a provoquée.
      if (suivantes.has(cle)) void autoriserPopups()
      return suivantes
    })
  }, [])

  /**
   * Les messages DÉJÀ annoncés. Une référence, pas un état : elle ne doit rien re-rendre, et elle
   * doit survivre au rendu que déclenche la relecture d'Outlook — sinon la même popup repartirait
   * toutes les deux minutes jusqu'à ce que le message soit lu.
   */
  const dejaAnnonces = useRef<Set<string>>(new Set())
  /**
   * Le premier instantané ne SONNE PAS : à l'ouverture de l'accueil, tous les non-lus de la boîte
   * sont « nouveaux » et feraient partir une rafale de popups pour des messages parfois vieux de
   * plusieurs jours. On l'enregistre comme déjà vu, et on n'alerte qu'à partir de ce qui ARRIVE.
   */
  const amorce = useRef(false)
  useEffect(() => {
    const nouveaux = messagesAAlerter(fils, alertes, dejaAnnonces.current)
    for (const message of nouveaux) dejaAnnonces.current.add(message.id)
    if (!amorce.current) {
      amorce.current = true
      return
    }
    for (const message of nouveaux) alerter(message)
  }, [fils, alertes])

  // Le contact et le fil sont RETROUVÉS à chaque rendu depuis la liste fraîche, jamais recopiés dans
  // l'état. Outlook se relit toutes les deux minutes : une copie figée afficherait la conversation
  // d'il y a deux minutes, sans le nouveau message, et le rafraîchissement paraîtrait cassé.
  const contact = useMemo(
    () =>
      etape.ecran === 'contacts' ? null : (fils.find((fil) => fil.cle === etape.contact) ?? null),
    [etape, fils]
  )
  const conversations = useMemo(() => (contact ? groupThreads(contact) : []), [contact])
  const conversation = useMemo(
    () =>
      etape.ecran === 'conversation'
        ? (conversations.find((fil) => fil.cle === etape.fil) ?? null)
        : null,
    [etape, conversations]
  )

  const retour = useCallback(() => {
    setEtape((courant) => {
      if (courant.ecran === 'conversation' || courant.ecran === 'nouveau') {
        return { ecran: 'fils', contact: courant.contact }
      }
      return { ecran: 'contacts' }
    })
  }, [])

  // Le contact a disparu de la boîte entre deux lectures (message supprimé, déplacé) : on le DIT et
  // on offre le retour, au lieu d'afficher un écran vide qui se lirait comme une panne.
  if (etape.ecran !== 'contacts' && contact === null) {
    return (
      <div className="home-inter">
        <EnTete titre="Interlocuteur introuvable" onRetour={retour} />
        <p className="home-hint">
          Ce contact n’est plus dans les messages lus. Actualisez, ou revenez à la liste.
        </p>
      </div>
    )
  }

  if (etape.ecran === 'contacts') {
    return (
      <EcranContacts
        fils={fils}
        alertes={alertes}
        onBasculerAlerte={basculer}
        onChoisir={(cle) => setEtape({ ecran: 'fils', contact: cle })}
      />
    )
  }

  if (etape.ecran === 'fils' && contact) {
    return (
      <div className="home-inter">
        <EnTete titre={contact.nom} sousTitre={contact.adresse} onRetour={retour} />
        <EcranFils
          conversations={conversations}
          contact={contact}
          now={now}
          onChoisir={(cle) => setEtape({ ecran: 'conversation', contact: contact.cle, fil: cle })}
          onNouveau={() => setEtape({ ecran: 'nouveau', contact: contact.cle })}
        />
      </div>
    )
  }

  if (etape.ecran === 'nouveau' && contact) {
    return (
      <div className="home-inter">
        <EnTete titre="Nouvelle conversation" sousTitre={contact.nom} onRetour={retour} />
        <EcranNouveau contact={contact} onEnvoyer={onNouvelleConversation} />
      </div>
    )
  }

  if (conversation === null || contact === null) {
    return (
      <div className="home-inter">
        <EnTete titre="Fil introuvable" onRetour={retour} />
        <p className="home-hint">Ce fil n’apparaît plus dans les messages lus.</p>
      </div>
    )
  }

  return (
    <div className="home-inter">
      <EnTete titre={conversation.sujet} sousTitre={contact.nom} onRetour={retour} />
      <EcranConversation
        conversation={conversation}
        contact={contact}
        onOuvrir={onOuvrir}
        ouvertureEnCours={ouvertureEnCours}
        onRepondre={onRepondre}
        onMarquerLu={onMarquerLu}
      />
    </div>
  )
}

/**
 * La barre du haut d'un écran : le retour, puis où l'on est.
 *
 * Le bouton précédent est le PREMIER élément, à gauche, identique aux trois écrans. Un retour qui
 * change de place d'un écran à l'autre se cherche à chaque fois.
 */
function EnTete({
  titre,
  sousTitre,
  onRetour
}: {
  titre: string
  sousTitre?: string
  onRetour: () => void
}): React.JSX.Element {
  return (
    <div className="home-inter__bar">
      <button
        type="button"
        className="home-inter__back"
        onClick={onRetour}
        // Le geste qui déplace la tuile part d'un `pointerdown` sur la tuile : sans cet arrêt,
        // cliquer « Précédent » ferait aussi glisser la tuile sous le curseur.
        onPointerDown={(event) => event.stopPropagation()}
        title="Revenir à l’étape précédente"
        data-testid="home-inter-retour"
      >
        ‹ Précédent
      </button>
      <span className="home-inter__titre">
        <b title={titre}>{titre}</b>
        {sousTitre ? <em title={sousTitre}>{sousTitre}</em> : null}
      </span>
    </div>
  )
}

/**
 * Écran 1 — mes interlocuteurs, PAR NOM.
 *
 * Les personnes d'abord, les automates ensuite et nommés comme tels. Mesure du 2026-08-21 sur une
 * vraie boîte : sur 23 émetteurs, 3 étaient des personnes ; le reste était des codes à usage unique
 * et des robots de suivi. Les mélanger noierait la liste que l'utilisateur vient chercher.
 */
function EcranContacts({
  fils,
  alertes,
  onBasculerAlerte,
  onChoisir
}: {
  fils: Interlocuteur[]
  alertes: AlertesInterlocuteurs
  onBasculerAlerte: (cle: string) => void
  onChoisir: (cle: string) => void
}): React.JSX.Element {
  if (fils.length === 0) {
    return <p className="home-hint">Aucun message dans votre boîte de réception.</p>
  }
  const { personnes, automates, indistinct } = splitByExchange(fils)
  // Combien de fils ont du nouveau, en un coup d'œil : la pastille par contact dit « ici », ce
  // compteur dit « combien au total » sans avoir à parcourir la liste.
  const filsNonLus = compterFilsNonLus(fils)
  return (
    <>
      {filsNonLus > 0 ? (
        <p className="home-subhead" data-testid="home-inter-nonlus">
          <span className="home-threads__tally">{filsNonLus}</span> conversation
          {filsNonLus > 1 ? 's' : ''} avec du nouveau
        </p>
      ) : null}
      {personnes.length > 0 ? (
        <ListeContacts
          fils={sortByName(personnes)}
          alertes={alertes}
          onBasculerAlerte={onBasculerAlerte}
          onChoisir={onChoisir}
        />
      ) : null}
      {personnes.length === 0 && !indistinct ? (
        <p className="home-hint">
          Aucun message d’une personne à qui vous avez déjà écrit. Ci-dessous, les envois
          automatiques.
        </p>
      ) : null}
      {automates.length > 0 ? (
        <>
          {/* Nommé, pas masqué : ces messages existent, ils ne sont simplement pas des échanges. */}
          <p className="home-subhead">Envois automatiques</p>
          <ListeContacts
            fils={sortByName(automates)}
            alertes={alertes}
            onBasculerAlerte={onBasculerAlerte}
            onChoisir={onChoisir}
          />
        </>
      ) : null}
    </>
  )
}

function ListeContacts({
  fils,
  alertes,
  onBasculerAlerte,
  onChoisir
}: {
  fils: Interlocuteur[]
  alertes: AlertesInterlocuteurs
  onBasculerAlerte: (cle: string) => void
  onChoisir: (cle: string) => void
}): React.JSX.Element {
  return (
    <ul className="home-threads">
      {fils.map((fil) => (
        <li
          key={fil.cle}
          data-unread={fil.nonLus > 0 ? 'true' : undefined}
          // La pastille dorée est réservée aux PERSONNES : c'est cet attribut qui la porte, et
          // l'oublier repeindrait tout le monde en gris — y compris les vrais contacts.
          data-echange={fil.echange === true ? 'true' : undefined}
        >
          <button
            type="button"
            className="home-threads__ouvrir"
            onClick={() => onChoisir(fil.cle)}
            onPointerDown={(event) => event.stopPropagation()}
            title={`Voir mes fils avec ${fil.adresse || fil.nom}`}
            data-testid={`home-contact-${fil.cle}`}
          >
            <span className="home-threads__who" aria-hidden="true">
              {initiales(fil.nom)}
            </span>
            <span className="home-threads__lines">
              <span className="home-threads__name">
                <b>{fil.nom}</b>
              </span>
              <span className="home-threads__last">{fil.adresse || '—'}</span>
            </span>
            {fil.nonLus > 0 ? <span className="home-threads__tally">{fil.nonLus}</span> : null}
            <span className="home-threads__chevron" aria-hidden="true">
              ›
            </span>
          </button>
          {/* Le switch est HORS du bouton d'ouverture : imbriqué dedans, le basculer ouvrirait
              aussi le fil de la personne. */}
          <label
            className="home-threads__alerte"
            title={`Popup + son à chaque nouveau message de ${fil.nom}`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              role="switch"
              checked={alertes.has(fil.cle)}
              onChange={() => onBasculerAlerte(fil.cle)}
              data-testid={`home-contact-alerte-${fil.cle}`}
            />
            <span aria-hidden="true">Alerte</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/**
 * Écran 2 — les fils de discussion avec CETTE personne, le plus vivant en tête.
 *
 * Et le départ d'un fil qui n'existe pas encore. Le bouton est EN HAUT, avant la liste : c'est la
 * seule action de cet écran qui ne dépend d'aucune ligne, et la placer sous une liste de vingt fils
 * l'aurait rendue introuvable. Il manque quand le contact n'a pas d'adresse — un envoi sans
 * destinataire ne partirait nulle part, et un bouton qui échoue toujours se lit comme une panne.
 */
function EcranFils({
  conversations,
  contact,
  now,
  onChoisir,
  onNouveau
}: {
  conversations: FilConversation[]
  contact: Interlocuteur
  now: number
  onChoisir: (cle: string) => void
  onNouveau: () => void
}): React.JSX.Element {
  const depart =
    contact.adresse !== '' ? (
      <div className="home-chat__actions" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="home-chat__ouvrir"
          onClick={onNouveau}
          title={`Écrire un nouveau message à ${contact.adresse}`}
          data-testid="home-inter-nouveau"
        >
          + Nouvelle conversation
        </button>
      </div>
    ) : (
      <p className="home-hint">
        Aucune adresse connue pour ce contact : impossible de lui écrire un nouveau message.
      </p>
    )
  if (conversations.length === 0) {
    return (
      <>
        {depart}
        <p className="home-hint">Aucun fil de discussion avec cette personne.</p>
      </>
    )
  }
  return (
    <>
      {depart}
      <ul className="home-threads">
        {conversations.map((fil) => (
          <li key={fil.cle} data-unread={fil.nonLus > 0 ? 'true' : undefined}>
            <button
              type="button"
              className="home-threads__ouvrir"
              onClick={() => onChoisir(fil.cle)}
              onPointerDown={(event) => event.stopPropagation()}
              title={fil.sujet}
              data-testid={`home-fil-${fil.cle}`}
            >
              <span className="home-threads__lines">
                <span className="home-threads__name">
                  <b>{fil.sujet}</b>
                  <em>{formatExchangeDate(fil.dernierEchange, now)}</em>
                </span>
                <span className="home-threads__last">
                  {fil.messages.length} message{fil.messages.length > 1 ? 's' : ''}
                </span>
              </span>
              {fil.nonLus > 0 ? <span className="home-threads__tally">{fil.nonLus}</span> : null}
              <span className="home-threads__chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Écran 3 — la conversation déroulée, et la réponse.
 *
 * Mes messages à droite, les siens à gauche, du plus ancien en haut au plus récent en bas : la
 * disposition d'une messagerie instantanée, parce que c'est celle que l'utilisateur a demandée et
 * qu'elle dit qui parle sans avoir à lire une étiquette.
 */
function EcranConversation({
  conversation,
  contact,
  onOuvrir,
  ouvertureEnCours,
  onRepondre,
  onMarquerLu
}: {
  conversation: FilConversation
  contact: Interlocuteur
  onOuvrir: (id: string) => Promise<void>
  ouvertureEnCours: string | null
  onRepondre: (id: string, corps: string) => Promise<{ ok: boolean; erreur?: string }>
  onMarquerLu: (ids: string[]) => Promise<{ ok: boolean; erreur?: string }>
}): React.JSX.Element {
  const [brouillon, setBrouillon] = useState('')
  const [confirme, setConfirme] = useState(false)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoye, setEnvoye] = useState(false)
  const [erreurLu, setErreurLu] = useState<string | null>(null)
  /**
   * Les messages dont le marquage est DEJA parti. Une reference, pas un etat : elle ne doit rien
   * re-rendre, et elle doit survivre au rendu que declenche la relecture d'Outlook.
   *
   * Sans elle, la relecture periodique rend un instantane encore marque non lu (le temps qu'Outlook
   * enregistre), l'effet reconnait le meme message et relance un appel COM -- une boucle qui parle a
   * Outlook toutes les deux minutes pour rien.
   */
  const dejaDemandes = useRef<Set<string>>(new Set())

  /**
   * OUVRIR un fil vaut le LIRE : ses messages non lus passent en lu dans Outlook.
   *
   * Le defaut corrige, releve par l'utilisateur le 2026-09-04 : « la notif reste meme apres avoir lu
   * le message ». Le widget ne touchait rien dans la boite, donc la pastille ne partait qu'en ouvrant
   * Outlook lui-meme.
   *
   * Mes propres envois sont exclus : un message que j'ai ecrit n'est pas a lire, et le marquer
   * n'aurait aucun effet visible tout en parlant a Outlook pour rien.
   */
  useEffect(() => {
    const aMarquer = conversation.messages
      .filter((message) => message.nonLu && !message.deMoi && !dejaDemandes.current.has(message.id))
      .map((message) => message.id)
    if (aMarquer.length === 0) return
    for (const id of aMarquer) dejaDemandes.current.add(id)
    void (async () => {
      try {
        const resultat = await onMarquerLu(aMarquer)
        if (resultat.ok) {
          setErreurLu(null)
          return
        }
        // Un echec AFFICHE, et rejouable : sans le retrait ci-dessous, une panne passagere d'Outlook
        // condamnerait ces messages a rester non lus jusqu'au prochain demarrage de l'application.
        for (const id of aMarquer) dejaDemandes.current.delete(id)
        setErreurLu(resultat.erreur ?? "Outlook n'a pas pu marquer ces messages comme lus.")
      } catch (error) {
        for (const id of aMarquer) dejaDemandes.current.delete(id)
        setErreurLu(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [conversation, onMarquerLu])

  /**
   * Le message auquel la réponse s'accroche : le dernier message REÇU du fil.
   *
   * Et pas simplement le dernier. Répondre à son propre envoi produit un brouillon sans destinataire
   * — le script le vérifie et refuse alors d'envoyer (code 5). Quand le fil ne contient que des
   * envois, il n'y a rien à quoi répondre ici, et on le DIT plutôt que de laisser essayer.
   */
  const ancre = useMemo(
    () => [...conversation.messages].reverse().find((message) => !message.deMoi) ?? null,
    [conversation]
  )
  const dernier = conversation.messages[conversation.messages.length - 1] ?? null

  const envoyer = useCallback(async () => {
    if (!ancre) return
    const corps = brouillon.trim()
    if (corps === '') return
    setEnvoiEnCours(true)
    setErreur(null)
    try {
      const resultat = await onRepondre(ancre.id, corps)
      if (resultat.ok) {
        setBrouillon('')
        setConfirme(false)
        setEnvoye(true)
      } else {
        // La cause est AFFICHÉE : un envoi qui échoue en silence fait croire que le message est parti.
        setErreur(resultat.erreur ?? "Outlook n'a pas pu envoyer cette réponse.")
      }
    } catch (error) {
      setErreur(error instanceof Error ? error.message : String(error))
    } finally {
      setEnvoiEnCours(false)
    }
  }, [ancre, brouillon, onRepondre])

  const vide = brouillon.trim() === ''

  return (
    <>
      <ol className="home-chat" data-testid="home-inter-conversation">
        {conversation.messages.map((message) => (
          <Bulle key={message.id} message={message} contact={contact} />
        ))}
      </ol>
      {erreurLu !== null ? (
        // Nomme, pas avale : une pastille qui ne part pas se lit comme une panne du widget, alors que
        // c'est Outlook qui a refuse l'ecriture.
        <p className="home-error" role="status" data-testid="home-inter-lu-erreur">
          Ces messages restent non lus dans Outlook : {erreurLu}
        </p>
      ) : null}
      <div className="home-chat__repondre" onPointerDown={(event) => event.stopPropagation()}>
        {ancre === null ? (
          <p className="home-hint">
            Ce fil ne contient que vos envois : il n’y a pas de message auquel répondre.
          </p>
        ) : (
          <>
            <textarea
              className="home-chat__saisie"
              value={brouillon}
              onChange={(event) => {
                setBrouillon(event.target.value)
                // Modifier le texte ANNULE la confirmation : sans cela, on confirmerait un message
                // puis on en enverrait un autre.
                setConfirme(false)
                setEnvoye(false)
              }}
              placeholder={`Répondre à ${contact.nom}…`}
              rows={2}
              data-testid="home-inter-saisie"
            />
            <div className="home-chat__actions">
              {/* DEUX temps, à dessein : un envoi part chez quelqu'un et ne se rattrape pas. Le
                  premier clic annonce ce qui va se passer, le second le fait. */}
              {confirme ? (
                <>
                  <button
                    type="button"
                    className="home-chat__envoyer"
                    onClick={() => void envoyer()}
                    disabled={envoiEnCours || vide}
                    data-testid="home-inter-confirmer"
                  >
                    {envoiEnCours ? <Spinner /> : `Confirmer l’envoi à ${contact.nom}`}
                  </button>
                  <button
                    type="button"
                    className="home-chat__annuler"
                    onClick={() => setConfirme(false)}
                    disabled={envoiEnCours}
                  >
                    Annuler
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="home-chat__envoyer"
                  onClick={() => setConfirme(true)}
                  disabled={vide}
                  data-testid="home-inter-envoyer"
                >
                  Envoyer par Outlook
                </button>
              )}
              {dernier ? (
                <button
                  type="button"
                  className="home-chat__ouvrir"
                  onClick={() => void onOuvrir(dernier.id)}
                  disabled={ouvertureEnCours === dernier.id}
                  title="Ouvrir ce fil dans Outlook"
                >
                  {ouvertureEnCours === dernier.id ? 'Ouverture…' : 'Ouvrir dans Outlook'}
                </button>
              ) : null}
            </div>
            {erreur !== null ? (
              <p className="home-error" role="alert">
                {erreur}
              </p>
            ) : null}
            {envoye && erreur === null ? (
              <p className="home-hint" role="status">
                Réponse envoyée. Elle apparaîtra dans le fil à la prochaine actualisation.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

/**
 * Écran 4 — ouvrir une conversation qui n'existe pas encore.
 *
 * Demande de l'utilisateur du 2026-09-07 : depuis l'écran d'un interlocuteur, entrer un objet et
 * envoyer le premier message. Ce n'est pas une réponse : Outlook n'a aucun message d'où tirer le
 * destinataire ni l'objet, donc les deux viennent d'ici — l'adresse du contact affiché, et l'objet
 * saisi.
 *
 * Les mêmes deux règles que la réponse, pour la même raison : un envoi part chez quelqu'un et ne se
 * rattrape pas. Confirmation explicite en deux temps, et cause de l'échec AFFICHÉE.
 */
function EcranNouveau({
  contact,
  onEnvoyer
}: {
  contact: Interlocuteur
  onEnvoyer: (
    adresse: string,
    objet: string,
    corps: string
  ) => Promise<{ ok: boolean; erreur?: string }>
}): React.JSX.Element {
  const [objet, setObjet] = useState('')
  const [message, setMessage] = useState('')
  const [confirme, setConfirme] = useState(false)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoye, setEnvoye] = useState(false)

  // Les DEUX champs sont requis. Un message sans objet arrive chez le destinataire comme « (aucun
  // objet) » et se lit comme un envoi raté ; le script le refuse d'ailleurs (code 5).
  const incomplet = objet.trim() === '' || message.trim() === ''

  const envoyer = useCallback(async () => {
    if (incomplet) return
    setEnvoiEnCours(true)
    setErreur(null)
    try {
      const resultat = await onEnvoyer(contact.adresse, objet.trim(), message.trim())
      if (resultat.ok) {
        setObjet('')
        setMessage('')
        setConfirme(false)
        setEnvoye(true)
      } else {
        // La cause est AFFICHÉE : un envoi qui échoue en silence fait croire que le message est parti.
        setErreur(resultat.erreur ?? "Outlook n'a pas pu envoyer ce message.")
      }
    } catch (error) {
      setErreur(error instanceof Error ? error.message : String(error))
    } finally {
      setEnvoiEnCours(false)
    }
  }, [contact, objet, message, incomplet, onEnvoyer])

  // Toute frappe ANNULE la confirmation : sans cela, on confirmerait un message puis on en
  // enverrait un autre.
  const modifier = (appliquer: () => void): void => {
    appliquer()
    setConfirme(false)
    setEnvoye(false)
  }

  return (
    <div className="home-chat__repondre" onPointerDown={(event) => event.stopPropagation()}>
      <p className="home-hint">Nouveau message à {contact.adresse}</p>
      <input
        type="text"
        className="home-chat__saisie"
        value={objet}
        onChange={(event) => modifier(() => setObjet(event.target.value))}
        placeholder="Objet"
        maxLength={255}
        data-testid="home-inter-nouveau-objet"
      />
      <textarea
        className="home-chat__saisie"
        value={message}
        onChange={(event) => modifier(() => setMessage(event.target.value))}
        placeholder={`Premier message à ${contact.nom}…`}
        rows={3}
        data-testid="home-inter-nouveau-message"
      />
      <div className="home-chat__actions">
        {/* DEUX temps, comme la réponse : le premier clic annonce ce qui va se passer, le second le
            fait. Un envoi ne se rattrape pas. */}
        {confirme ? (
          <>
            <button
              type="button"
              className="home-chat__envoyer"
              onClick={() => void envoyer()}
              disabled={envoiEnCours || incomplet}
              data-testid="home-inter-nouveau-confirmer"
            >
              {envoiEnCours ? <Spinner /> : `Confirmer l’envoi à ${contact.nom}`}
            </button>
            <button
              type="button"
              className="home-chat__annuler"
              onClick={() => setConfirme(false)}
              disabled={envoiEnCours}
            >
              Annuler
            </button>
          </>
        ) : (
          <button
            type="button"
            className="home-chat__envoyer"
            onClick={() => setConfirme(true)}
            disabled={incomplet}
            data-testid="home-inter-nouveau-envoyer"
          >
            Envoyer par Outlook
          </button>
        )}
      </div>
      {erreur !== null ? (
        <p className="home-error" role="alert">
          {erreur}
        </p>
      ) : null}
      {envoye && erreur === null ? (
        <p className="home-hint" role="status">
          Message envoyé. La conversation apparaîtra dans la liste à la prochaine actualisation.
        </p>
      ) : null}
    </div>
  )
}

/** UN message du fil : qui, quand, et le texte. Côté droit si c'est moi. */
function Bulle({
  message,
  contact
}: {
  message: MessageInterlocuteur
  contact: Interlocuteur
}): React.JSX.Element {
  return (
    <li className="home-chat__ligne" data-moi={message.deMoi ? 'true' : undefined}>
      <span className="home-chat__meta">
        <b>{message.deMoi ? 'Moi' : contact.nom}</b>
        <em>{formatMessageDate(message.recuLe)}</em>
      </span>
      <span className="home-chat__bulle" data-unread={message.nonLu ? 'true' : undefined}>
        {message.corps !== '' ? (
          message.corps
        ) : (
          // Le corps n'a pas été lu (instantané d'une version antérieure du script, message vide) :
          // on montre l'objet plutôt qu'une bulle vide, et sans prétendre que c'est le texte.
          <i className="home-chat__sans-corps">{message.sujet}</i>
        )}
      </span>
    </li>
  )
}

/** Deux ou trois initiales tirées du nom affiché, pour tenir dans une pastille. */
function initiales(nom: string): string {
  const mots = nom
    .replace(/[<>()"]/g, ' ')
    .split(/[\s.,;]+/)
    .filter((mot) => mot.length > 0)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}
