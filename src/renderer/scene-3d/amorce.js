/*
 * AMORCE DE LA PAGE `scene-3d.html` — le seul script, avec le moteur three.js, que la page a le
 * droit d'executer (sa politique de securite n'autorise QUE ces deux scripts, par leur empreinte).
 *
 * Elle recoit le code d'un bloc ```threejs du fil, envoye par le cadre parent (`Bloc3D.tsx`), et
 * l'execute par `eval` DANS cette page. C'est voulu : une page qui n'accepte aucun script en ligne
 * empeche le code de la scene d'en fabriquer un ailleurs (cadre imbrique `srcdoc`, balise
 * `<script>` injectee, attribut `onerror`). Mesure du 2026-10-16 : avec `'unsafe-inline'`, un
 * cadre `srcdoc` imbrique retrouvait un `RTCPeerConnection` intact ; avec les empreintes, il ne
 * s'execute plus.
 *
 * Messages echanges avec le parent, tous `{ type: 'autowin-scene-3d', ... }` :
 *   page -> parent : `{ etat: 'pret' }`, puis `{ etat: 'lancee' }` ou `{ etat: 'erreur', message }` ;
 *   parent -> page : `{ code }`, accepte UNE seule fois et seulement du cadre parent.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript pose tel quel dans
   la page (son empreinte est calculee sur ce texte) : aucune annotation de type n'y a sa place. */
;(() => {
  'use strict'
  const TYPE = 'autowin-scene-3d'
  const parentWindow = window.parent

  const signaler = (contenu) => {
    try {
      parentWindow.postMessage(Object.assign({ type: TYPE }, contenu), '*')
    } catch {
      /* parent disparu : rien a prevenir */
    }
  }

  const afficherErreur = (message) => {
    const texte = String(message || 'Erreur inconnue')
    let cadre = document.getElementById('autowin-scene-3d-erreur')
    if (!cadre) {
      cadre = document.createElement('pre')
      cadre.id = 'autowin-scene-3d-erreur'
      document.body.appendChild(cadre)
    }
    cadre.textContent = texte
    signaler({ etat: 'erreur', message: texte })
  }

  // 1. GARDE : ce code n'a de sens que dans le fil, dans un cadre ISOLE (origine opaque, `sandbox`
  // sans `allow-same-origin`). Ouverte seule, ou dans un cadre non isole, la page aurait l'origine
  // de l'app — elle refuse alors de faire quoi que ce soit.
  if (self.origin !== 'null' || parentWindow === window) {
    document.body.textContent =
      'Scène 3D refusée : cette page ne s’exécute que dans un bloc isolé du fil d’Autowin.'
    return
  }

  // 2. PAS DE WEBRTC. La politique de securite coupe fetch, XHR, WebSocket, images et polices
  // externes, mais pas WebRTC, qui peut joindre un serveur sans passer par elle.
  const RTC = [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'RTCDataChannel',
    'RTCIceCandidate',
    'RTCSessionDescription',
    'RTCRtpSender',
    'RTCRtpReceiver',
    'RTCRtpTransceiver',
    'RTCIceTransport',
    'RTCDtlsTransport',
    'RTCSctpTransport',
    'RTCCertificate'
  ]
  for (const nom of RTC) {
    try {
      Object.defineProperty(window, nom, { value: undefined, configurable: false, writable: false })
    } catch {
      /* deja absent */
    }
  }

  window.addEventListener('error', (event) => {
    const ou = event.lineno ? ` (ligne ${event.lineno})` : ''
    afficherErreur(`${event.message || event.error}${ou}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    afficherErreur(`Promesse rejetée : ${event.reason}`)
  })

  // 3. LE CODE DE LA SCENE, une seule fois, et seulement depuis le cadre parent.
  let recu = false
  window.addEventListener('message', (event) => {
    if (recu || event.source !== parentWindow) return
    const donnees = event.data
    if (!donnees || donnees.type !== TYPE || typeof donnees.code !== 'string') return
    recu = true
    try {
      ;(0, eval)(`${donnees.code}\n//# sourceURL=scene-3d.js`)
      signaler({ etat: 'lancee' })
    } catch (erreur) {
      const pile = erreur && erreur.stack ? String(erreur.stack).split('\n').slice(0, 3) : []
      afficherErreur(pile.join('\n') || String(erreur))
    }
  })

  signaler({ etat: 'pret' })
})()
