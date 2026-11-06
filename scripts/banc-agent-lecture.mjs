#!/usr/bin/env node
/**
 * banc-agent-lecture — le chat doit-il charger `Agent` avec un sous-agent de lecture ?
 *
 * Pourquoi (lot 7 du plan de conv-1370, conv-1377, 2026-10-31) : un tour de chat relit environ
 * 270 000 jetons par étape, et ce qu'il lit reste dans le fil (note Brain « le coût d'un tour de chat
 * vient des outils du CLI »). `--agents` n'est utilisé nulle part. L'hypothèse à mesurer : un
 * sous-agent moins cher lit à la place du fil principal, le contenu lu n'y reste pas, et le gain vient
 * surtout des tours d'APRÈS. Le risque à mesurer aussi : une synthèse moins riche oblige à relire, ou
 * rend une réponse fausse. Ce banc répond par des chiffres ; il ne change aucun code de l'app.
 *
 * Méthode :
 *  - mêmes options que le tour de chat réel (`src/main/providers/claude.ts`, branche du chat) : même
 *    `--tools` que `OUTILS_TOUR_DE_CHAT`, même modèle et même effort (`agent-topology.json`), mêmes
 *    `--permission-mode`, `--settings` (copie des réglages et gardes d'un tour vivant), même prompt
 *    système réel. Seule différence entre variantes : `Agent` et `--agents` ;
 *  - un fil = 3 tours enchaînés par `--resume` : une question qui oblige à lire beaucoup, puis deux
 *    suites courtes ;
 *  - copie stable du dépôt : `git worktree` au commit `COMMIT` sous `.autowin-tmp/`, supprimée à la fin ;
 *  - coût du tour = `model_usage_since_last_result` du `result`, recoupé avec la différence de
 *    `total_cost_usd`, qui est un CUMUL sur une session reprise (note Brain, conv-733) ;
 *  - qualité = faits attendus établis AVANT le banc en lisant le code. Chaque fait porte sa source
 *    (fichier + extrait exact), que `--verifier` contrôle sur le commit sans appeler de modèle.
 *    Un sous-agent moins cher qui répond faux n'est pas un gain.
 *
 * MESURÉ par sonde le 2026-10-31 (CLI 2.1.314) sur ce qu'expose le flux avec un sous-agent :
 *  - `result.usage` ne compte QUE le fil principal ; `result.modelUsage` et
 *    `model_usage_since_last_result` comptent aussi le sous-agent, avec `costUSD` par modèle ;
 *  - le flux ne montre pas le DERNIER appel d'un sous-agent : ses appels se lisent dans
 *    `<config>/projects/<dossier>/<session>/subagents/agent-*.jsonl` ;
 *  - le fil principal écrit son cache pour 1 h, le sous-agent pour 5 min.
 *
 * MESURÉ par la première paire réelle (2026-10-31, pieces-jointes-b-sonnet-1) : `Agent` et `lecteur`
 * sont bien chargés (+2 400 jetons au premier appel) et le modèle ne délègue JAMAIS : 26 Read et 22
 * Grep faits par lui-même au tour 1, zéro sous-agent en trois tours. La consigne du chat lui dit
 * d'analyser avec ses propres outils de lecture (`chat-pilotage-prompt.ts`, RÈGLE PREMIÈRE). Les
 * variantes C ajoutent donc UNE consigne de délégation, dans la copie du prompt propre au banc :
 * sans elle, comparer A et B ne mesure rien.
 *
 * Usage :
 *   node scripts/banc-agent-lecture.mjs --verifier
 *   node scripts/banc-agent-lecture.mjs --lancer [--plafond 40] [--repliques 2] [--parallele 4]
 *        [--variantes a,b-sonnet,c-sonnet,c-haiku] [--sujets pieces-jointes,reservation,cout]
 *        [--repliques-depuis 2] [--systeme <system.md>]
 *        [--gardes <dossier>] [--dossier <résultats d'un banc à compléter>]
 *   node scripts/banc-agent-lecture.mjs --rejuger <dossier-de-resultats>   # aucun appel de modèle
 *   node scripts/banc-agent-lecture.mjs --tableau <dossier-de-resultats>   # aucun appel de modèle
 * Résultats : `.autowin-data/autowin-os/banc-agent-lecture/<horodatage>/`.
 * Exit 0 = joué (ou vérifié) · 1 = vérification rouge · 2 = entrée illisible.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { environnementPropre, resoudreClaude } from './banc-modeles-petits-defauts.mjs'

const DEPOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Le commit figé : les faits attendus ne valent que pour lui. */
export const COMMIT = 'e34e1431fbf090949b238fea8d384abeca89b14c'

/** `OUTILS_TOUR_DE_CHAT` au commit figé ; `--verifier` le recompare à la source. */
export const OUTILS_CHAT =
  'Read,Grep,Glob,Bash,Write,Edit,MultiEdit,WebFetch,WebSearch,TaskCreate,TaskUpdate,TaskList'

/** Réglage du chat : `.autowin-data/autowin-os/agent-topology.json`, slot orchestrator. */
export const MODELE_CHAT = 'claude-opus-5-5'
export const EFFORT_CHAT = 'xhigh'

/** Le sous-agent demandé : rien d'autre que ses trois outils de lecture et son modèle. */
export function definitionLecteur(modele) {
  return {
    lecteur: {
      description:
        "Lecteur de code en lecture seule. À utiliser pour toute question qui oblige à lire plus de trois fichiers : il fait les lectures et rend une synthèse courte, pour que le contenu lu n'alourdisse pas le fil principal.",
      prompt:
        "Tu es un lecteur de code en lecture seule. Lis ce qu'il faut avec Read, Grep et Glob, de façon ciblée, jamais tout l'arbre. Rends une synthèse factuelle en français : chaque fait avec son fichier:ligne et les noms exacts (fonctions, constantes, valeurs). Cite les valeurs exactes au lieu de les résumer. N'écris aucun fichier.",
      tools: ['Read', 'Grep', 'Glob'],
      model: modele
    }
  }
}

/** A = le chat d'aujourd'hui. Les B ne diffèrent que par `Agent` et `--agents`. */
export const VARIANTES = {
  a: { nom: 'A sans Agent', lecteur: null },
  'b-sonnet': { nom: 'B Agent + lecteur sonnet', lecteur: 'sonnet' },
  'b-haiku': { nom: 'B Agent + lecteur haiku', lecteur: 'haiku' },
  'c-sonnet': { nom: 'C B + consigne, sonnet', lecteur: 'sonnet', consigne: true },
  'c-haiku': { nom: 'C B + consigne, haiku', lecteur: 'haiku', consigne: true }
}

/** Ajoutée au prompt système dans la copie du banc seulement : aucun code de l'app ne change. */
export const CONSIGNE_DELEGATION = `LECTURE DÉLÉGUÉE — cette règle prime sur tout ce qui précède à propos des outils de lecture. Au moment où une question oblige à lire plus de trois fichiers, ne lis pas toi-même : confie la lecture au sous-agent \`lecteur\` avec l'outil Agent, en un seul appel qui dit précisément ce qu'il doit rapporter, puis réponds à partir de sa synthèse. Aux tours suivants, repars de cette synthèse ; si un point y manque, relance \`lecteur\` sur ce point, ou lis toi-même seulement si un ou deux fichiers suffisent.`

/**
 * Tarifs en $ par million de jetons, pour le coût PAR APPEL (le coût du tour, lui, vient du CLI).
 * Source : https://platform.claude.com/docs/en/about-claude/pricing (lu le 2026-10-31). Ils diffèrent
 * de `src/shared/cost-estimate.ts`, resté aux tarifs d'Opus 5 : recoupés ici au centime sur les six
 * premiers tours (1,61338 $ = 16 × 4 + 21 705 × 20 + 609 840 × 0,20 + 132 156 × 8). Haiku 5.5 change
 * de palier au-delà de 100 000 jetons de prompt. Le banc écrit l'écart avec le montant du CLI.
 */
export const TARIFS = {
  opus: { entree: 4, ecrit5m: 5, ecrit1h: 8, relu: 0.2, sortie: 20 },
  sonnet: { entree: 2, ecrit5m: 2.5, ecrit1h: 4, relu: 0.1, sortie: 10 },
  haiku: { entree: 0.1, ecrit5m: 0.125, ecrit1h: 0.2, relu: 0.01, sortie: 0.5 }
}

export function coutAppel(a) {
  const famille = Object.keys(TARIFS).find((f) => String(a.modele).includes(f))
  if (!famille) return null
  const p = TARIFS[famille]
  const palier = famille === 'haiku' && a.entree + a.relu + a.ecrit5m + a.ecrit1h > 100_000 ? 5 : 1
  return (
    (palier *
      (a.entree * p.entree +
        a.relu * p.relu +
        a.ecrit5m * p.ecrit5m +
        a.ecrit1h * p.ecrit1h +
        a.sortie * p.sortie)) /
    1_000_000
  )
}

/**
 * Les trois sujets. `accepte` joue sur le texte NORMALISÉ (minuscules, sans accents) : tout en
 * minuscules et sans accent dans les motifs. `source` = [fichier, extrait exact au commit figé].
 * `faux` = une affirmation qui contredit le code : elle compte comme erreur même si le reste est bon.
 */
export const SUJETS = {
  'pieces-jointes': {
    tours: [
      {
        question:
          'Comment une pièce jointe suit un tour de chat, de bout en bout ? Du dépôt du fichier dans le chat jusqu’au moment où le modèle le lit.',
        faits: [
          {
            id: 'encodage',
            dit: 'l’interface encode la pièce (texte tel quel, sinon base64)',
            accepte: /encodeattachment|chat-attachments|base64/,
            source: [
              'src/renderer/src/components/chat-attachments.ts',
              'export async function encodeAttachment'
            ]
          },
          {
            id: 'huit-pieces',
            dit: 'plafond de 8 pièces',
            accepte:
              /\b8\b[^.\n]{0,40}(pieces|fichiers)|(max|plafond|maximum|limite)[^.\n]{0,40}\b8\b|max_attachments|huit pieces/,
            source: ['src/renderer/src/components/ChatView.tsx', 'const MAX_ATTACHMENTS = 8']
          },
          {
            id: 'tailles',
            dit: 'plafonds de 10 Mo par fichier ou 20 Mo au total',
            accepte: /\b(10|20) ?(mo|mb)\b/,
            source: [
              'src/renderer/src/components/ChatView.tsx',
              'const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024'
            ]
          },
          {
            id: 'garde-ipc',
            dit: 'le processus principal revalide les pièces à l’entrée (guardAttachments)',
            accepte: /guardattachments|ipc-guards|revalid|refait les controles|second controle/,
            source: ['src/main/ipc/ipc-guards.ts', 'export function guardAttachments']
          },
          {
            id: 'original-durable',
            dit: 'l’original est écrit dans le stockage des artefacts à l’envoi',
            accepte:
              /metasdurablesdespieces|pieces-jointes-durables|chat-artifacts|materializeuser(image|attachment)artifact/,
            source: [
              'src/main/chat/pieces-jointes-durables.ts',
              'export function metasDurablesDesPieces'
            ]
          },
          {
            id: 'tout-le-fil',
            dit: 'agent-pilot reprend les pièces de tout le fil, pas seulement du dernier message',
            accepte:
              /currentattachments|max_pieces_jointes_du_fil|tout le fil|fil entier|tout l'historique|tours? (anterieurs?|precedents?)|messages? (passes?|precedents?)/,
            source: ['src/main/agent-pilot/agent-pilot.ts', 'const MAX_PIECES_JOINTES_DU_FIL = 8']
          },
          {
            id: 'dossier-temporaire',
            dit: 'claude.ts écrit les pièces dans un dossier temporaire',
            accepte:
              /materializeclaudeattachments|autowin-os-attachments|(dossier|copie|fichier)s? temporaires?/,
            source: [
              'src/main/providers/claude.ts',
              "mkdtempSync(join(tmpdir(), 'autowin-os-attachments-'))"
            ]
          },
          {
            id: 'add-dir',
            dit: 'ce dossier est ouvert au CLI par --add-dir',
            accepte: /--add-dir/,
            source: [
              'src/main/providers/claude.ts',
              "...(materialized ? ['--add-dir', materialized.dir] : [])"
            ]
          },
          {
            id: 'suffixe',
            dit: 'le prompt reçoit la liste des chemins (promptSuffix)',
            accepte:
              /promptsuffix|pieces jointes de ton message|chemin[^\n]{0,100}(prompt|message)|(prompt|message)[^\n]{0,100}chemin/,
            source: ['src/main/providers/claude.ts', 'PIÈCES JOINTES DE TON MESSAGE CI-DESSUS']
          },
          {
            id: 'nettoyage',
            dit: 'le dossier temporaire est supprimé à la fin de l’appel',
            accepte: /cleanup|nettoy|supprim/,
            source: ['src/main/providers/claude.ts', 'await materialized?.cleanup()']
          }
        ],
        faux: []
      },
      {
        question:
          'Et si l’app a redémarré depuis, une image jointe à un tour précédent : le modèle relit l’original ou la miniature ?',
        faits: [
          {
            id: 'original',
            dit: 'l’original est relu depuis le stockage sur disque',
            accepte:
              /original[^\n]{0,160}(disque|stockage|artefact|chat-artifacts)|(disque|stockage|artefact|chat-artifacts)[^\n]{0,160}original/,
            source: ['src/main/chat/pieces-jointes-durables.ts', 'le stockage fait foi']
          },
          {
            id: 'fonction',
            dit: 'piecesJointesPourLeModele ou rechargerContenuPieceJointe',
            accepte:
              /piecesjointespourlemodele|rechargercontenupiecejointe|pieces-jointes-durables/,
            source: [
              'src/main/chat/pieces-jointes-durables.ts',
              'export function piecesJointesPourLeModele'
            ]
          },
          {
            id: 'repli',
            dit: 'repli sur la miniature si l’original a disparu',
            accepte:
              /(repli|replie|retombe|efface|absent|introuvable|manquant|disparu|sinon|supprime)[^\n]{0,160}miniature|miniature[^\n]{0,160}(repli|secours|efface|absent|introuvable|manquant|disparu|si l'original|degrade)/,
            source: ['src/main/agent-pilot/agent-pilot.ts', 'replierSurLaMiniature(brute)']
          },
          {
            id: 'provenance',
            dit: 'elle est marquée comme venant d’un message précédent',
            accepte:
              /jointe a un message precedent|tour-precedent-|message-precedent|tour anterieur|message precedent/,
            source: ['src/main/agent-pilot/agent-pilot.ts', '(jointe a un message precedent)']
          }
        ],
        faux: [
          {
            id: 'miniature-seule',
            dit: 'le modèle ne verrait que la miniature',
            motif:
              /(relit|recoit|voit|lit) (seulement|uniquement) la miniature|ne (relit|recoit|voit|lit) que la miniature/
          }
        ]
      },
      {
        question: 'Et si le fil contient dix pièces jointes, lesquelles partent au modèle ?',
        faits: [
          {
            id: 'huit',
            dit: 'huit au plus',
            accepte: /\b8\b|huit/,
            source: [
              'src/main/agent-pilot/agent-pilot.ts',
              'if (retenues.length >= MAX_PIECES_JOINTES_DU_FIL) return retenues'
            ]
          },
          {
            id: 'recentes',
            dit: 'les plus récentes d’abord',
            accepte: /plus recente?s?|les dernieres|en partant de la fin|du plus recent/,
            source: ['src/main/agent-pilot/agent-pilot.ts', "Le plus RECENT d'abord, puis on borne"]
          },
          {
            id: 'anciennes-sacrifiees',
            dit: 'les plus anciennes sont sacrifiées',
            accepte:
              /(anciennes?|ancien)[^\n]{0,100}(sacrifi|perdu|ecart|jet|laiss|tomb|exclu|ignor|abandonn|coup|retir|ne partent pas|hors)|(sacrifi|ecart|jet|laiss|exclu|ignor|abandonn|coup)[^\n]{0,100}(anciennes?|ancien)/,
            source: ['src/main/agent-pilot/agent-pilot.ts', 'Sacrifier la plus ancienne est']
          },
          {
            id: 'doublons',
            dit: 'dédoublonnage par nom et contenu',
            accepte: /dedoublonn|doublon|en double|meme nom et (le )?meme contenu/,
            source: ['src/main/agent-pilot/agent-pilot.ts', 'Dedoublonnage par (nom, contenu)']
          }
        ],
        faux: []
      }
    ]
  },
  reservation: {
    tours: [
      {
        question:
          'Comment marche la réservation des fichiers entre fils de chat, de bout en bout : qui réserve, où c’est stocké, qui est refusé, quand ça tombe ?',
        faits: [
          {
            id: 'fonction',
            dit: 'reserverOuRefuser, dans shared/reservation-fichiers.ts',
            accepte: /reserverourefuser|reservation-fichiers/,
            source: ['src/shared/reservation-fichiers.ts', 'export function reserverOuRefuser']
          },
          {
            id: 'hook',
            dit: 'hook PreToolUse des agents Claude',
            accepte:
              /pretooluse|\bhook\b|controle automatique|avant chaque (edit|ecriture)|garde-git-destructeur/,
            source: [
              'src/shared/garde-git-destructeur.ts',
              'const reserverOuRefuser = ${reserverOuRefuser.toString()};'
            ]
          },
          {
            id: 'outils',
            dit: 'avant Edit, Write, MultiEdit, NotebookEdit',
            accepte:
              /notebookedit|multiedit|\bedit\b[^\n]{0,30}\bwrite\b|\bwrite\b[^\n]{0,30}\bedit\b/,
            source: [
              'src/shared/reservation-fichiers.ts',
              'Edit, Write, MultiEdit, NotebookEdit des agents CLAUDE'
            ]
          },
          {
            id: 'fil-du-lancement',
            dit: 'le fil est posé par claude.ts dans reservation.json',
            accepte:
              /reservation\.json|confreservationfichiers|(id|nom) du fil[^\n]{0,80}claude\.ts/,
            source: ['src/main/providers/claude.ts', "join(settingsDir, 'reservation.json')"]
          },
          {
            id: 'registre',
            dit: 'registre unique reservations-fichiers.json',
            accepte: /reservations-fichiers\.json|cheminregistrereservations/,
            source: [
              'src/main/fichiers/reservation-fichiers-app.ts',
              "join(racine, 'reservations-fichiers.json')"
            ]
          },
          {
            id: 'bail',
            dit: 'bail de 30 minutes',
            accepte: /\b30 ?(min|minutes)\b|1[ _]?800[ _]?000/,
            source: [
              'src/shared/reservation-fichiers.ts',
              'export const BAIL_RESERVATION_MS = 30 * 60_000'
            ]
          },
          {
            id: 'renouvele',
            dit: 'chaque édition renouvelle le bail',
            accepte: /renouvel|prolong|rafraich|repart a zero|remet (le|a)|relance les 30/,
            source: [
              'src/shared/reservation-fichiers.ts',
              'chacune de ses éditions renouvelle le bail'
            ]
          },
          {
            id: 'commit-libere',
            dit: 'elle tombe dès que le fichier est commité',
            accepte:
              /(tombe|libere|leve|expire|fin)[^\n]{0,160}commit|commit[^\n]{0,160}(tombe|libere|leve|expire)|estpropre|tant que[^\n]{0,60}commit/,
            source: [
              'src/shared/reservation-fichiers.ts',
              'la réservation tombe dès que le fichier est commité'
            ]
          },
          {
            id: 'proprietaire-nomme',
            dit: 'le refus nomme le fil propriétaire',
            accepte: /proprietaire|nomm\w* (le|du|son) fil|nom du fil|ecrire_a_un_fil/,
            source: ['src/shared/reservation-fichiers.ts', 'Fichier réservé par ${entree.fil}']
          },
          {
            id: 'edit-file',
            dit: 'la commande edit_file de l’app applique la même règle',
            accepte: /edit_file|runtracededitfile|refusreservationedition/,
            source: [
              'src/main/commands/commands.ts',
              'refusReservationEdition(conversationId, baseDecision.absolutePath)'
            ]
          },
          {
            id: 'commit-refuse',
            dit: 'un git commit qui emporterait le fichier d’un autre est refusé',
            accepte:
              /refuscommitreserve|refuscommitdefichierreserve|commit[^\n]{0,100}refus|refus[^\n]{0,100}commit/,
            source: ['src/shared/reservation-fichiers.ts', 'export function refusCommitReserve']
          }
        ],
        faux: []
      },
      {
        question: 'Un `sed -i` lancé dans le terminal sur un fichier réservé, c’est bloqué ?',
        faits: [
          {
            id: 'non-bloque',
            dit: 'non : ni vu ni bloqué',
            accepte:
              /ni vue? ni bloquee?|^\W*non\b|n'est (ni|pas)[^.\n]{0,40}(vue?|bloquee?)|pas bloquee?|ne (le )?bloque pas|n'est pas (vu|intercepte|detecte)|limite connue/,
            source: [
              'src/shared/reservation-fichiers.ts',
              "une écriture par le terminal (`sed -i`, `>`) n'est ni vue ni bloquée"
            ]
          },
          {
            id: 'perimetre',
            dit: 'seuls les outils d’édition passent par la réservation',
            accepte: /\bedit\b|\bwrite\b|multiedit|outils? d'edition|edit_file/,
            source: [
              'src/shared/reservation-fichiers.ts',
              'Edit, Write, MultiEdit, NotebookEdit des agents CLAUDE'
            ]
          }
        ],
        faux: [{ id: 'oui', dit: 'oui, c’est bloqué', motif: /^\W*oui\b/ }]
      },
      {
        question:
          'Et `git commit -m x -- mes/fichiers`, alors qu’un autre fil tient un autre fichier déjà indexé : ça passe ?',
        faits: [
          {
            id: 'passe',
            dit: 'oui, ça passe',
            accepte: /^\W*oui\b|\bca passe\b|\bil passe\b|n'est pas refuse|pas de refus|autorise/,
            source: [
              'src/shared/reservation-fichiers.ts',
              "Un commit `git commit -m … -- <mes chemins>` n'emporte que ces chemins : il passe."
            ]
          },
          {
            id: 'seulement-chemins',
            dit: 'il n’emporte que les chemins nommés',
            accepte:
              /n'emporte que|seulement (ces|les) (chemins|fichiers)|uniquement (ces|les) (chemins|fichiers)|que (ces|les) chemins|seuls? (ces|les) (chemins|fichiers)|limite aux chemins|avecchemins|ignore ce qui est indexe/,
            source: ['src/shared/reservation-fichiers.ts', 'const avecChemins =']
          },
          {
            id: 'balayage-refuse',
            dit: 'un balayage (-a, --all, git add -A) serait refusé',
            accepte: /commit -a|--all|add -a|add \.|balayage|\bbalaye/,
            source: ['src/shared/reservation-fichiers.ts', '« Emporter » = un balayage']
          }
        ],
        faux: [{ id: 'non', dit: 'non, ce commit est refusé', motif: /^\W*non\b/ }]
      }
    ]
  },
  cout: {
    tours: [
      {
        question:
          'Comment le coût d’un tour de chat est-il calculé puis affiché, de bout en bout, du CLI Claude jusqu’à l’indicateur de coût de l’interface ?',
        faits: [
          {
            id: 'cumul-cli',
            dit: 'total_cost_usd est le cumul de la session',
            accepte: /total_cost_usd[^\n]{0,200}cumul|cumul[^\n]{0,200}total_cost_usd/,
            source: ['src/main/providers/claude.ts', '`total_cost_usd` est le CUMUL DE LA SESSION']
          },
          {
            id: 'decumul',
            dit: 'claude-session-cost.ts le dé-cumule',
            accepte: /coutdutourdepuiscumul|perturncostusd|claude-session-cost/,
            source: [
              'src/main/providers/claude-session-cost.ts',
              'export function coutDuTourDepuisCumul'
            ]
          },
          {
            id: 'soustraction',
            dit: 'par soustraction du dernier cumul de la même session',
            accepte: /soustrai|de-?cumul|difference|retire ce qui|\bmoins\b le (dernier )?cumul/,
            source: [
              'src/main/providers/claude-session-cost.ts',
              'return reportedTotalUsd - previous.lastTotalUsd'
            ]
          },
          {
            id: 'magasin',
            dit: 'le dernier cumul est gardé sur disque',
            accepte: /claude-session-cost\.json|sur (le )?disque|magasin|survit? au redemarrage/,
            source: [
              'src/main/providers/claude-session-cost.ts',
              "join(ensureAutowinAppData(), 'claude-session-cost.json')"
            ]
          },
          {
            id: 'recorder',
            dit: 'ChatTurnCostRecorder enregistre le coût du tour',
            accepte: /chatturncostrecorder|chat-cost-recording/,
            source: ['src/main/chat/chat-cost-recording.ts', 'export class ChatTurnCostRecorder']
          },
          {
            id: 'delta',
            dit: 'seul le delta des instantanés est écrit',
            accepte: /delta|instantane|\becart\b/,
            source: ['src/main/chat/chat-cost-recording.ts', "n'enregistre donc que le DELTA"]
          },
          {
            id: 'cost-jsonl',
            dit: 'le journal cost.jsonl',
            accepte: /cost\.jsonl/,
            source: ['src/main/chat/chat-cost-recording.ts', '`cost.jsonl`']
          },
          {
            id: 'activity',
            dit: 'le journal d’activité',
            accepte: /\bactivity\b|journal d'activite/,
            source: ['src/renderer/src/components/conversation-cost.ts', "journal d'activité"]
          },
          {
            id: 'canal',
            dit: 'le canal os:costBreakdown',
            accepte: /costbreakdown/,
            source: ['src/preload/index.ts', "ipcRenderer.invoke('os:costBreakdown'"]
          },
          {
            id: 'resume-interface',
            dit: 'summarizeConversationCost résume sans recalculer',
            accepte: /summarizeconversationcost|conversation-cost/,
            source: [
              'src/renderer/src/components/conversation-cost.ts',
              'export function summarizeConversationCost'
            ]
          }
        ],
        faux: []
      },
      {
        question:
          'Et si le CLI meurt avant son événement `result`, que devient le coût de ce tour ?',
        faits: [
          {
            id: 'recovery',
            dit: 'cli-usage-recovery.ts le récupère',
            accepte: /cli-usage-recovery|recoverprovider|recuper/,
            source: [
              'src/main/activity/cli-usage-recovery.ts',
              'export interface RecoveredCallUsage'
            ]
          },
          {
            id: 'transcript',
            dit: 'dans le transcript de session écrit par le CLI',
            accepte: /transcript|projects\/|\.jsonl de (la )?session/,
            source: [
              'src/main/activity/cli-usage-recovery.ts',
              '`~/.claude/projects/<projet>/<session>.jsonl`'
            ]
          },
          {
            id: 'estime',
            dit: 'tarifé au tarif public, comme une estimation',
            accepte: /tarif public|estimatedusd|estimat?ion|estime/,
            source: [
              'src/main/activity/cli-usage-recovery.ts',
              'Tarif PUBLIC appliqué aux tokens récupérés'
            ]
          },
          {
            id: 'libelle',
            dit: 'affiché « ≈ … estimés », ou appel non chiffré si rien n’est récupérable',
            accepte: /≈|estimes|non chiffre/,
            source: ['src/renderer/src/components/conversation-cost.ts', '≈ 8,43 $ estimés']
          }
        ],
        faux: []
      },
      {
        question: 'Un tour sans prix connu compte-t-il pour 0 $ dans le budget ?',
        faits: [
          {
            id: 'non-tarife',
            dit: 'il reste non tarifé : aucun costUsd n’est posé',
            accepte:
              /non tarife|sans costusd|pas de costusd|aucun costusd|sans prix|non chiffre|costusd[^\n]{0,80}(absent|omis|pas pose|non pose)/,
            source: [
              'src/main/chat/chat-cost-recording.ts',
              'Un tour NON TARIFE doit rester non tarife'
            ]
          },
          {
            id: 'compteur',
            dit: 'il est compté à part (unpricedTurns)',
            accepte: /unpricedturns|unpricedcalls/,
            source: ['src/main/dashboards/cost.ts', 'unpricedTurns: number']
          },
          {
            id: 'plancher',
            dit: 'le total devient un plancher (spentIsPartial)',
            accepte: /plancher|spentispartial|partiel/,
            source: ['src/main/dashboards/cost.ts', 'spentIsPartial: boolean']
          },
          {
            id: 'estimation',
            dit: 'une estimation au tarif public est possible si le modèle est connu',
            accepte: /coverage|couverture|estim/,
            source: ['src/main/dashboards/cost.ts', 'coverage: CostCoverage']
          }
        ],
        faux: []
      }
    ]
  }
}

/** Le texte tel que les motifs le voient : minuscules, sans accents, apostrophes droites. */
export function normaliser(texte) {
  return String(texte)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’ʼ]/g, "'")
    .replace(/`|\*\*/g, '')
    .toLowerCase()
    .trim()
}

/** Juge UNE réponse sur les faits d'un tour : déterministe, rejouable sans appeler de modèle. */
export function juger(tour, texte) {
  const t = normaliser(texte)
  const trouves = tour.faits.filter((f) => f.accepte.test(t)).map((f) => f.id)
  const manquants = tour.faits.filter((f) => !f.accepte.test(t)).map((f) => f.id)
  const faux = (tour.faux ?? []).filter((f) => f.motif.test(t)).map((f) => f.id)
  return { attendus: tour.faits.length, trouves, manquants, faux }
}

/** Écart type d'échantillon ; `null` sous deux valeurs, jamais un 0 trompeur. */
export function ecartType(valeurs) {
  if (valeurs.length < 2) return null
  const m = valeurs.reduce((s, v) => s + v, 0) / valeurs.length
  return Math.sqrt(valeurs.reduce((s, v) => s + (v - m) ** 2, 0) / (valeurs.length - 1))
}

const moyenne = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null)

const git = (cwd, args, opts = {}) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts
  })

/** Contrôle hors modèle : les faits et les options du banc tiennent-ils au commit figé ? */
export function verifier() {
  let rouges = 0
  const rouge = (m) => {
    rouges += 1
    console.log(`ROUGE ${m}`)
  }
  const fichiers = new Map()
  const lire = (f) => {
    if (!fichiers.has(f)) fichiers.set(f, git(DEPOT, ['show', `${COMMIT}:${f}`]))
    return fichiers.get(f)
  }
  let faits = 0
  for (const [sujet, s] of Object.entries(SUJETS))
    for (const [i, tour] of s.tours.entries())
      for (const fait of tour.faits) {
        faits += 1
        const [fichier, extrait] = fait.source
        if (!lire(fichier).includes(extrait))
          rouge(`${sujet}/t${i + 1}/${fait.id} : « ${extrait} » absent de ${fichier}`)
      }
  const claude = lire('src/main/providers/claude.ts')
  const etapes = /OUTILS_ETAPES = '([^']+)'/.exec(lire('src/main/providers/claude-etapes.ts'))?.[1]
  // Au commit figé, la liste est écrite en ligne : `OUTILS_TOUR_DE_CHAT` n'existe qu'après lui.
  const tete =
    /'--tools',\s*'(Read,Grep,Glob,Bash,Write,Edit,MultiEdit,)' \+ OUTILS_WEB \+ ',' \+ OUTILS_ETAPES/.exec(
      claude
    )?.[1]
  const web = /const OUTILS_WEB = '([^']+)'/.exec(claude)?.[1]
  if (`${tete}${web},${etapes}` !== OUTILS_CHAT)
    rouge(`OUTILS_CHAT diffère de la source : ${tete}${web},${etapes}`)
  // Le juge lui-même : une réponse témoin complète passe, une réponse vide ne passe pas.
  for (const [sujet, s] of Object.entries(SUJETS))
    for (const [i, tour] of s.tours.entries()) {
      const vide = juger(tour, 'Je ne sais pas.')
      if (vide.trouves.length) rouge(`${sujet}/t${i + 1} : réponse vide créditée ${vide.trouves}`)
    }
  const temoin = SUJETS.reservation.tours[1]
  if (juger(temoin, 'Oui, c’est bloqué.').faux[0] !== 'oui')
    rouge('le juge ne voit pas une réponse fausse')
  if (juger(temoin, 'Non : ni vue ni bloquée, seul Edit passe par là.').manquants.length)
    rouge('le juge refuse une réponse juste')
  if (normaliser('**`git add -A`** — réservée’') !== "git add -a — reservee'")
    rouge(`normaliser : ${normaliser('**`git add -A`** — réservée’')}`)
  console.log(
    `${rouges ? 'ROUGE' : 'VERT'} : ${faits} faits tracés au commit ${COMMIT.slice(0, 8)}, ${fichiers.size} fichiers lus`
  )
  return rouges === 0
}

/** Refuse toute écriture et les commandes qui modifient : le banc est en lecture seule. */
const SCRIPT_LECTURE_SEULE = `// Garde du banc-agent-lecture : aucune écriture, quoi que décide le modèle.
const lire = () => new Promise((r) => { let t = ''; process.stdin.on('data', (b) => (t += b)); process.stdin.on('end', () => r(t)) })
const refuser = (motif) => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motif } })); process.exit(0) }
const j = JSON.parse((await lire()) || '{}')
const outil = String(j.tool_name || '')
if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(outil)) refuser('Banc en lecture seule : aucune écriture.')
const c = String(j.tool_input?.command || '')
if (/(^|[;&|(]\\s*)(rm|rmdir|mv|cp|del|touch|mkdir|tee|npm|npx|pnpm|yarn|Remove-Item|Move-Item|Set-Content|New-Item)\\b/i.test(c)) refuser('Banc en lecture seule : commande refusée.')
if (/\\bgit\\b[^;&|]*\\b(commit|push|reset|checkout|switch|stash|clean|merge|rebase|worktree|apply|restore|rm|mv|add|pull|fetch)\\b/i.test(c)) refuser('Banc en lecture seule : commande git refusée.')
if (/(^|[^0-9&])>{1,2}\\s*(?!\\/dev\\/null|NUL|&)/i.test(c)) refuser('Banc en lecture seule : redirection vers un fichier refusée.')
if (/\\bsed\\b[^;&|]*\\s-i/.test(c)) refuser('Banc en lecture seule : sed -i refusé.')
`

/**
 * Les vrais réglages d'un tour de chat vivant, copiés pour ce banc : leur forme vient de
 * `reglagesCliAutowin`, qu'un script `.mjs` ne peut pas importer. Seuls les chemins des gardes changent,
 * et la garde de lecture seule passe en tête. Le système et les gardes sont figés UNE fois : les
 * variantes reçoivent exactement les mêmes.
 */
function chercherDernier(prefixe, garder) {
  const tmp = os.tmpdir()
  const candidats = readdirSync(tmp)
    .filter((n) => n.startsWith(prefixe))
    .map((n) => path.join(tmp, n))
    .filter(garder)
    .map((d) => ({ d, t: statSync(d).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  if (!candidats.length) throw new Error(`aucun dossier ${prefixe}* exploitable dans ${tmp}`)
  return candidats[0].d
}

export function figerEntrees(racine, { systeme, gardes } = {}) {
  const sourceSysteme =
    systeme ??
    path.join(
      chercherDernier('autowin-os-system-', (d) => {
        const f = path.join(d, 'system.md')
        return (
          existsSync(f) && readFileSync(f, 'utf8').includes('=== CONTEXTE PROJET (AGENTS.md) ===')
        )
      }),
      'system.md'
    )
  const dossierGardes =
    gardes ??
    chercherDernier('autowin-os-settings-', (d) =>
      ['settings.json', 'garde-git-destructeur.mjs', 'garde-npm-modules.mjs'].every((f) =>
        existsSync(path.join(d, f))
      )
    )
  const entrees = path.join(racine, 'entrees')
  mkdirSync(entrees, { recursive: true })
  const fSysteme = path.join(entrees, 'system.md')
  copyFileSync(sourceSysteme, fSysteme)
  for (const f of ['garde-git-destructeur.mjs', 'garde-npm-modules.mjs', 'tests-non-comptes.mjs'])
    if (existsSync(path.join(dossierGardes, f)))
      copyFileSync(path.join(dossierGardes, f), path.join(entrees, f))
  writeFileSync(path.join(entrees, 'lecture-seule.mjs'), SCRIPT_LECTURE_SEULE)
  const avant = readFileSync(path.join(dossierGardes, 'settings.json'), 'utf8')
  const nouveau = entrees.split('\\').join('/')
  const reglages = JSON.parse(
    avant.replace(/"node \\"[^"]*?\/([\w-]+\.mjs)\\""/g, `"node \\"${nouveau}/$1\\""`)
  )
  const blocEcriture = reglages.hooks?.PreToolUse?.find((b) => /Edit/.test(b.matcher))
  if (!blocEcriture)
    throw new Error('réglages du chat : garde PreToolUse des écritures introuvable')
  blocEcriture.hooks.unshift({
    type: 'command',
    command: `node "${nouveau}/lecture-seule.mjs"`,
    onFailure: 'block'
  })
  const fReglages = path.join(entrees, 'settings.json')
  writeFileSync(fReglages, JSON.stringify(reglages))
  const fConsigne = path.join(entrees, 'system-consigne.md')
  writeFileSync(fConsigne, `${readFileSync(fSysteme, 'utf8')}\n\n${CONSIGNE_DELEGATION}\n`)
  return {
    systeme: fSysteme,
    systemeConsigne: fConsigne,
    reglages: fReglages,
    empreinteSysteme: createHash('sha256')
      .update(readFileSync(fSysteme))
      .digest('hex')
      .slice(0, 16),
    octetsSysteme: statSync(fSysteme).size
  }
}

/** Les arguments du tour de chat réel, dans l'ordre de `claude.ts`, avec `Agent` pour les B. */
export function argumentsDuTour({ variante, copie, entrees, reprise, plafondUsd }) {
  const v = VARIANTES[variante]
  const outils = v.lecteur ? `${OUTILS_CHAT},Agent` : OUTILS_CHAT
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--thinking-display',
    'summarized',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--plugin-dir',
    path.join(copie, 'mods', 'autowin'),
    '--permission-mode',
    'bypassPermissions',
    '--add-dir',
    copie,
    '--tools',
    outils,
    '--allowedTools',
    ...outils.split(','),
    '--settings',
    entrees.reglages,
    '--system-prompt-file',
    v.consigne ? entrees.systemeConsigne : entrees.systeme
  ]
  if (v.lecteur) args.push('--agents', JSON.stringify(definitionLecteur(v.lecteur)))
  if (reprise) args.push('--resume', reprise, '--system-prompt-snapshot', 'off')
  args.push('--model', MODELE_CHAT, '--max-budget-usd', String(plafondUsd), '--effort', EFFORT_CHAT)
  return args
}

/** Le message du tour, enveloppé comme le chat le fait pour le modèle. */
export function messageDuTour(question) {
  return `ÉTAT DE L'APP:\n{"tab":"chat","activeConversationId":"conv-banc"}\n\nUTILISATEUR: <message_utilisateur>${question}</message_utilisateur>\n\n(Réponds à l'utilisateur / agis.)`
}

const entiers = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function appelDepuisUsage(id, modele, role, usage, sortieFinale) {
  const creation = usage?.cache_creation ?? {}
  const ecritTotal = entiers(usage?.cache_creation_input_tokens)
  const ecrit5m = entiers(creation.ephemeral_5m_input_tokens)
  const ecrit1h = entiers(creation.ephemeral_1h_input_tokens)
  const a = {
    id,
    modele,
    role,
    entree: entiers(usage?.input_tokens),
    relu: entiers(usage?.cache_read_input_tokens),
    ecrit5m: ecrit5m + ecrit1h === ecritTotal ? ecrit5m : ecritTotal,
    ecrit1h: ecrit5m + ecrit1h === ecritTotal ? ecrit1h : 0,
    sortie: entiers(sortieFinale ?? usage?.output_tokens)
  }
  return { ...a, coutUsd: coutAppel(a) }
}

/** Lit le flux d'UN tour : appels du fil principal, outils, texte, résultat du CLI. */
export function lireFlux(brut) {
  const appels = new Map()
  const appelEnCours = []
  const outils = []
  const textes = []
  const taches = []
  let resultat = null
  let init = null
  for (const ligne of brut.split('\n')) {
    if (!ligne.trim()) continue
    let e
    try {
      e = JSON.parse(ligne)
    } catch {
      continue
    }
    if (e.type === 'system' && e.subtype === 'init') init = e
    if (e.type === 'system' && e.subtype === 'task_started')
      taches.push({
        type: e.subagent_type,
        id: e.task_id,
        consigne: String(e.prompt ?? '').slice(0, 400)
      })
    if (e.type === 'stream_event' && e.event?.type === 'message_start' && !e.parent_tool_use_id) {
      const m = e.event.message
      appels.set(m.id, appelDepuisUsage(m.id, m.model, 'principal', m.usage))
      appelEnCours.push(m.id)
    }
    if (e.type === 'stream_event' && e.event?.type === 'message_delta' && !e.parent_tool_use_id) {
      const id = appelEnCours.at(-1)
      const a = id && appels.get(id)
      if (a) {
        a.sortie = entiers(e.event.usage?.output_tokens)
        a.coutUsd = coutAppel(a)
      }
    }
    if (e.type === 'assistant' && !e.parent_tool_use_id && e.message?.model !== '<synthetic>')
      for (const b of e.message?.content ?? []) {
        if (b.type === 'text' && b.text) textes.push(b.text)
        if (b.type === 'tool_use') outils.push({ nom: b.name, entree: b.input })
      }
    if (e.type === 'result') resultat = e
  }
  return {
    appels: [...appels.values()],
    outils,
    texte: textes.join('\n\n'),
    taches,
    resultat,
    init
  }
}

/** Appels des sous-agents : le flux n'en montre qu'une partie (voir l'en-tête), le journal tout. */
export function appelsDesSousAgents(dossierSession, dejaVus) {
  const dossier = path.join(dossierSession, 'subagents')
  if (!existsSync(dossier)) return { appels: [], outils: [] }
  const appels = new Map()
  const outils = []
  for (const f of readdirSync(dossier).filter((n) => n.endsWith('.jsonl'))) {
    const meta = path.join(dossier, f.replace(/\.jsonl$/, '.meta.json'))
    let type = 'inconnu'
    try {
      type = JSON.parse(readFileSync(meta, 'utf8')).agentType ?? type
    } catch {
      /* méta absente : l'appel compte quand même, sous « inconnu » */
    }
    for (const ligne of readFileSync(path.join(dossier, f), 'utf8').split('\n')) {
      if (!ligne.includes('"assistant"')) continue
      let e
      try {
        e = JSON.parse(ligne)
      } catch {
        continue
      }
      const m = e.message
      if (e.type !== 'assistant' || !m?.id || m.model === '<synthetic>' || dejaVus.has(m.id))
        continue
      appels.set(m.id, appelDepuisUsage(m.id, m.model, `sous-agent:${type}`, m.usage))
      for (const b of m.content ?? [])
        if (b.type === 'tool_use') outils.push({ nom: b.name, entree: b.input, agent: type })
    }
  }
  return { appels: [...appels.values()], outils }
}

/** Le coût du tour selon le CLI, par modèle. `modelUsage` compte aussi les sous-agents. */
function coutParModele(depuis) {
  const lignes = {}
  for (const [modele, u] of Object.entries(depuis ?? {}))
    lignes[modele] = {
      coutUsd: entiers(u.costUSD),
      entree: entiers(u.inputTokens),
      sortie: entiers(u.outputTokens),
      relu: entiers(u.cacheReadInputTokens),
      ecrit5m: entiers(u.cacheCreationEphemeral5mInputTokens),
      ecrit1h: entiers(u.cacheCreationEphemeral1hInputTokens)
    }
  return lignes
}

function resumeOutils(outils) {
  const n = {}
  for (const o of outils) n[o.nom] = (n[o.nom] ?? 0) + 1
  return n
}

/** Lance UN tour du CLI ; le message passe par l'entrée standard, comme dans l'app. */
function lancerTour({ args, copie, texte, sortie, delaiMs }) {
  return new Promise((resolve) => {
    const debut = Date.now()
    const env = {
      ...environnementPropre(),
      GIT_PAGER: 'cat',
      PAGER: 'cat',
      GIT_TERMINAL_PROMPT: '0'
    }
    const p = spawn(resoudreClaude(), args, { cwd: copie, env, windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => (out += b))
    p.stderr.on('data', (b) => (err += b))
    let coupe = false
    const minuteur = setTimeout(() => {
      coupe = true
      p.kill()
    }, delaiMs)
    p.on('error', (e) => {
      clearTimeout(minuteur)
      resolve({
        code: -1,
        coupe,
        dureeMs: Date.now() - debut,
        brut: out,
        stderr: String(e.message)
      })
    })
    p.on('close', (code) => {
      clearTimeout(minuteur)
      writeFileSync(sortie, out)
      if (err) writeFileSync(`${sortie}.err`, err)
      resolve({ code, coupe, dureeMs: Date.now() - debut, brut: out, stderr: err.slice(-800) })
    })
    // Un CLI mort avant d'avoir lu son message rend EPIPE ici : son code de sortie le dira.
    p.stdin.on('error', () => undefined)
    p.stdin.end(texte)
  })
}

/** Un fil complet : les tours du sujet, enchaînés par `--resume`, avec arrêt au plafond. */
async function unFil({
  sujet,
  variante,
  replique,
  copie,
  entrees,
  racine,
  caisse,
  dossierProjets
}) {
  const nom = `${sujet}-${variante}-${replique}`
  const dossier = path.join(racine, nom)
  mkdirSync(dossier, { recursive: true })
  const fil = { nom, sujet, variante, replique, tours: [], complet: false }
  let session = null
  let cumulAvant = 0
  const vus = new Set()
  for (const [i, tour] of SUJETS[sujet].tours.entries()) {
    const part = caisse.autoriser()
    if (part === null) {
      fil.arret = `plafond global atteint avant le tour ${i + 1}`
      break
    }
    const r = await lancerTour({
      // Le CLI reprend son cumul avec la session : la part de ce tour s'ajoute à ce cumul.
      args: argumentsDuTour({
        variante,
        copie,
        entrees,
        reprise: session,
        plafondUsd: Number((cumulAvant + part).toFixed(2))
      }),
      copie,
      texte: messageDuTour(tour.question),
      sortie: path.join(dossier, `t${i + 1}.jsonl`),
      delaiMs: 25 * 60 * 1000
    })
    const flux = lireFlux(r.brut)
    const res = flux.resultat
    session = res?.session_id ?? session
    const dossierSession = session ? path.join(dossierProjets, session) : ''
    for (const a of flux.appels) vus.add(a.id)
    const sous = session ? appelsDesSousAgents(dossierSession, vus) : { appels: [], outils: [] }
    for (const a of sous.appels) vus.add(a.id)
    const parModele = coutParModele(res?.model_usage_since_last_result)
    const coutCli = Object.values(parModele).reduce((s, m) => s + m.coutUsd, 0)
    const cumul = entiers(res?.total_cost_usd)
    const coutDifference = cumul - cumulAvant
    cumulAvant = cumul
    const coutTour = coutCli > 0 ? coutCli : coutDifference
    caisse.depenser(coutTour)
    const appels = [...flux.appels, ...sous.appels]
    const dernier = flux.appels.at(-1)
    const taille = (a) => a.entree + a.relu + a.ecrit5m + a.ecrit1h
    const contexte = dernier ? taille(dernier) : null
    const coutAppels = appels.reduce((s, a) => s + (a.coutUsd ?? 0), 0)
    const lectures = /^(Read|Grep|Glob|Bash)$/
    const ligne = {
      tour: i + 1,
      session,
      code: r.code,
      coupe: r.coupe,
      sousType: res?.subtype ?? null,
      erreur: res?.is_error ?? null,
      coutUsd: coutTour,
      coutDifferenceCumulUsd: coutDifference,
      coutSommeAppelsUsd: coutAppels,
      coutSousAgentsUsd: sous.appels.reduce((s, a) => s + (a.coutUsd ?? 0), 0),
      dureeMs: r.dureeMs,
      etapesPrincipal: flux.appels.length,
      appelsSousAgents: sous.appels.length,
      sousAgents: flux.taches.map((t) => t.type),
      consignes: flux.taches.map((t) => t.consigne),
      parModele,
      outilsPrincipal: resumeOutils(flux.outils),
      outilsSousAgents: resumeOutils(sous.outils),
      lecturesPrincipal: flux.outils.filter((o) => lectures.test(o.nom)).length,
      contexteDebutTour: flux.appels[0] ? taille(flux.appels[0]) : null,
      contexteFinTour: contexte,
      horsCopie: [...flux.outils, ...sous.outils]
        .map((o) => String(o.entree?.file_path ?? o.entree?.path ?? ''))
        .filter(
          (p) =>
            /^[a-z]:[\\/]/i.test(p) &&
            !p.replace(/\//g, '\\').toLowerCase().startsWith(copie.toLowerCase())
        ),
      refus: (res?.permission_denials ?? []).length,
      modeleInit: flux.init?.model ?? null,
      versionCli: flux.init?.claude_code_version ?? null,
      qualite: juger(tour, flux.texte),
      stderr: r.stderr
    }
    fil.tours.push(ligne)
    writeFileSync(path.join(dossier, `t${i + 1}-reponse.md`), flux.texte)
    writeFileSync(
      path.join(dossier, `t${i + 1}-appels.jsonl`),
      appels.map((a) => JSON.stringify(a)).join('\n') + '\n'
    )
    writeFileSync(path.join(dossier, 'fil.json'), JSON.stringify(fil, null, 2))
    console.log(
      `${nom} t${i + 1} · ${coutTour.toFixed(2)} $ · ${Math.round(r.dureeMs / 1000)} s · étapes ${ligne.etapesPrincipal}+${ligne.appelsSousAgents} · contexte ${contexte ?? '?'} · faits ${ligne.qualite.trouves.length}/${ligne.qualite.attendus}${ligne.qualite.faux.length ? ` · FAUX ${ligne.qualite.faux}` : ''} · dépensé ${caisse.depense().toFixed(2)} $`
    )
    if (!res || res.is_error || r.coupe || r.code !== 0) {
      fil.arret = `tour ${i + 1} en échec : code ${r.code}, ${res?.subtype ?? 'sans résultat'}${r.coupe ? ', coupé au délai' : ''} ${String(res?.result ?? r.stderr).slice(0, 300)}`
      if (/limit|quota/i.test(`${res?.result ?? ''} ${r.stderr}`)) caisse.fermer(fil.arret)
      break
    }
  }
  fil.complet = fil.tours.length === SUJETS[sujet].tours.length && !fil.arret
  fil.propre = !git(copie, ['status', '--porcelain']).trim()
  writeFileSync(path.join(dossier, 'fil.json'), JSON.stringify(fil, null, 2))
  return fil
}

/**
 * La caisse : ce plafond global est un ordre. Une paire ne part que si le reste couvre son coût
 * attendu (la plus chère vue jusque-là) en plus de celles en cours ; chaque CLI reçoit ensuite
 * `--max-budget-usd` à hauteur de sa part du reste, pour que le plafond tienne même à la dernière.
 */
export function ouvrirCaisse(plafond, { depenseInitiale = 0, coutPaire = 9 } = {}) {
  let depense = depenseInitiale
  let enCours = 0
  let pairesEnCours = 0
  let plusChere = null
  let ferme = null
  return {
    ouvrirPaire() {
      if (ferme || depense + (pairesEnCours + 1) * (plusChere ?? coutPaire) > plafond) return false
      pairesEnCours += 1
      return true
    },
    fermerPaire(coutReel, complete) {
      pairesEnCours = Math.max(0, pairesEnCours - 1)
      if (complete && coutReel > 0) plusChere = Math.max(plusChere ?? 0, coutReel)
    },
    autoriser() {
      if (ferme) return null
      const part = (plafond - depense) / (enCours + 1)
      if (part < 0.25) return null
      enCours += 1
      return part
    },
    depenser(usd) {
      depense += usd
      enCours = Math.max(0, enCours - 1)
    },
    fermer(motif) {
      ferme = motif
    },
    depense: () => depense,
    motif: () => ferme
  }
}

/** Dossier où le CLI range les sessions d'un cwd : `:\` `\` `.` deviennent des tirets. */
export function dossierProjetsDe(copie) {
  const racine = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
  return path.join(racine, 'projects', copie.replace(/[^a-zA-Z0-9]/g, '-'))
}

async function lancer(o) {
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const racine =
    o.dossier ?? path.join(DEPOT, '.autowin-data', 'autowin-os', 'banc-agent-lecture', horodatage)
  mkdirSync(racine, { recursive: true })
  const copie = path.join(DEPOT, '.autowin-tmp', `banc-agent-lecture-${horodatage}`, 'copie')
  mkdirSync(path.dirname(copie), { recursive: true })
  git(DEPOT, ['worktree', 'add', '--detach', '--quiet', copie, COMMIT])
  const dossierProjets = dossierProjetsDe(copie)
  // Reprise d'un banc commencé : ce qui est déjà joué compte au plafond et ne se rejoue pas.
  const dejaJoues = chargerFils(racine)
  const caisse = ouvrirCaisse(o.plafond, {
    depenseInitiale: dejaJoues.flatMap((f) => f.tours).reduce((s, t) => s + t.coutUsd, 0),
    coutPaire: o.coutPaire
  })
  const fait = (sujet, variante, replique) =>
    dejaJoues.some(
      (f) => f.sujet === sujet && f.variante === variante && f.replique === replique && f.complet
    )
  try {
    const entrees = figerEntrees(racine, o)
    writeFileSync(
      path.join(racine, `conditions-${horodatage}.json`),
      JSON.stringify(
        {
          commit: COMMIT,
          modele: MODELE_CHAT,
          effort: EFFORT_CHAT,
          outils: OUTILS_CHAT,
          systeme: { empreinte: entrees.empreinteSysteme, octets: entrees.octetsSysteme },
          plafond: o.plafond,
          repliques: o.repliques,
          parallele: o.parallele,
          variantes: o.variantes,
          sujets: o.sujets
        },
        null,
        2
      )
    )
    // Une paire A/B d'un même sujet part ENSEMBLE : mêmes conditions, ni l'une ni l'autre ne profite
    // du cache que l'autre vient d'écrire. Le fil suivant ne part que si une paire entière peut partir.
    const paires = []
    for (let replique = o.repliquesDepuis; replique <= o.repliques; replique++)
      for (const sujet of o.sujets) {
        const restent = o.variantes.filter((v) => !fait(sujet, v, replique))
        if (restent.length) paires.push({ sujet, replique, variantes: restent })
      }
    console.log(
      `banc : ${paires.length} paires, ${o.variantes.length} variantes, plafond ${o.plafond} $`
    )
    console.log(`résultats : ${racine}`)
    const fils = []
    let i = 0
    const ouvrier = async () => {
      while (i < paires.length && !caisse.motif() && caisse.ouvrirPaire()) {
        const { sujet, replique, variantes } = paires[i++]
        const issus = await Promise.all(
          variantes.map((variante) =>
            unFil({
              sujet,
              replique,
              variante,
              copie,
              entrees,
              racine,
              caisse,
              dossierProjets
            }).catch((e) => ({
              nom: `${sujet}-${variante}-${replique}`,
              sujet,
              variante,
              replique,
              tours: [],
              complet: false,
              arret: `casse : ${e.message}`
            }))
          )
        )
        fils.push(...issus)
        caisse.fermerPaire(
          issus.flatMap((f) => f.tours).reduce((s, t) => s + t.coutUsd, 0),
          issus.every((f) => f.complet)
        )
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.floor(o.parallele / o.variantes.length)) }, ouvrier)
    )
    if (i < paires.length)
      console.log(`ARRÊT avant la fin : ${paires.length - i} paires non lancées`)
    console.log(tableau(racine))
  } finally {
    nettoyerCopie(copie, dossierProjets)
    const brut = path.join(racine, 'entrees')
    if (existsSync(brut)) rmSync(brut, { recursive: true, force: true })
  }
  console.log(
    `dépensé : ${caisse.depense().toFixed(2)} $ sur ${o.plafond} $${caisse.motif() ? ` — arrêt : ${caisse.motif()}` : ''}`
  )
}

/** Retire la copie et les sessions du CLI nées d'elle : leur dossier porte le nom de la copie. */
function nettoyerCopie(copie, dossierProjets) {
  try {
    git(DEPOT, ['worktree', 'remove', '--force', copie])
  } catch (e) {
    console.log(`copie non retirée : ${copie} — ${e.message}`)
  }
  const parent = path.dirname(copie)
  if (existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true })
  if (existsSync(dossierProjets) && path.basename(dossierProjets).includes('banc-agent-lecture'))
    rmSync(dossierProjets, { recursive: true, force: true })
  const nom = path.basename(dossierProjets)
  const temporaires = path.join(os.tmpdir(), 'claude', nom)
  if (nom.includes('banc-agent-lecture') && existsSync(temporaires))
    rmSync(temporaires, { recursive: true, force: true })
}

/** Rejuge les réponses gardées, sans appeler de modèle : les motifs ont pu être corrigés. */
export function rejuger(racine) {
  let n = 0
  for (const nom of readdirSync(racine)) {
    const f = path.join(racine, nom, 'fil.json')
    if (!existsSync(f)) continue
    const fil = JSON.parse(readFileSync(f, 'utf8'))
    for (const t of fil.tours) {
      const texte = readFileSync(path.join(racine, nom, `t${t.tour}-reponse.md`), 'utf8')
      t.qualite = juger(SUJETS[fil.sujet].tours[t.tour - 1], texte)
      // Le tarif par appel a pu être corrigé depuis le lancement : les jetons, eux, sont gardés.
      const appels = readFileSync(path.join(racine, nom, `t${t.tour}-appels.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
      t.coutSommeAppelsUsd = appels.reduce((s, a) => s + (coutAppel(a) ?? 0), 0)
      t.coutSousAgentsUsd = appels
        .filter((a) => a.role !== 'principal')
        .reduce((s, a) => s + (coutAppel(a) ?? 0), 0)
      n += 1
    }
    writeFileSync(f, JSON.stringify(fil, null, 2))
  }
  return n
}

function chargerFils(racine) {
  return readdirSync(racine)
    .map((nom) => path.join(racine, nom, 'fil.json'))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, 'utf8')))
}

/**
 * Ce que coûterait le même fil sur un fil réel. Le banc part d'un fil neuf, le chat d'un fil de
 * 270 000 jetons : chaque étape du fil PRINCIPAL relirait la différence (0,20 $ le million relu sur
 * Opus 5.5). Un sous-agent part de son propre contexte : il ne la paie pas. C'est un CALCUL sur les étapes
 * mesurées, pas une mesure, et il se nomme ainsi partout où il s'affiche.
 */
export const CONTEXTE_FIL_REEL = 270_000
export function coutProjete(fil) {
  const mesure = fil.tours.reduce((s, t) => s + t.coutUsd, 0)
  const etapes = fil.tours.reduce((s, t) => s + t.etapesPrincipal, 0)
  const base = fil.tours[0]?.contexteDebutTour ?? 0
  return mesure + (etapes * Math.max(0, CONTEXTE_FIL_REEL - base) * TARIFS.opus.relu) / 1_000_000
}

/** Le tableau par variante, sur les fils COMPLETS seulement, puis les paires A/B. */
export function tableau(racine) {
  const fils = chargerFils(racine)
  const lignes = []
  const variantes = [...new Set(fils.map((f) => f.variante))].sort()
  const f2 = (v, n = 2) => (v === null || v === undefined ? '—' : v.toFixed(n))
  const entete = [
    'variante',
    'fils',
    'coût moyen $',
    'écart $',
    't1 $',
    't2 $',
    't3 $',
    'sous-ag. $',
    'étapes princ.',
    'appels sous-ag.',
    'lectures princ. t2+t3',
    'durée s',
    'contexte final',
    'qualité',
    'faux',
    'projeté 270k $'
  ]
  lignes.push(entete.join(' | '))
  const parVariante = {}
  for (const v of variantes) {
    const complets = fils.filter((f) => f.variante === v && f.complet)
    const cout = (f) => f.tours.reduce((s, t) => s + t.coutUsd, 0)
    const tourMoyen = (i) => moyenne(complets.map((f) => f.tours[i]?.coutUsd ?? 0))
    const faits = complets.flatMap((f) => f.tours.map((t) => t.qualite))
    const trouves = faits.reduce((s, q) => s + q.trouves.length, 0)
    const attendus = faits.reduce((s, q) => s + q.attendus, 0)
    const etapes = (f) => f.tours.reduce((s, t) => s + t.etapesPrincipal, 0)
    parVariante[v] = { complets, cout }
    lignes.push(
      [
        VARIANTES[v]?.nom ?? v,
        `${complets.length}/${fils.filter((f) => f.variante === v).length}`,
        f2(moyenne(complets.map(cout))),
        f2(ecartType(complets.map(cout))),
        f2(tourMoyen(0)),
        f2(tourMoyen(1)),
        f2(tourMoyen(2)),
        f2(moyenne(complets.map((f) => f.tours.reduce((s, t) => s + t.coutSousAgentsUsd, 0)))),
        f2(moyenne(complets.map(etapes)), 1),
        f2(moyenne(complets.map((f) => f.tours.reduce((s, t) => s + t.appelsSousAgents, 0))), 1),
        f2(
          moyenne(
            complets.map((f) => f.tours.slice(1).reduce((s, t) => s + t.lecturesPrincipal, 0))
          ),
          1
        ),
        f2(moyenne(complets.map((f) => f.tours.reduce((s, t) => s + t.dureeMs, 0) / 1000)), 0),
        f2(moyenne(complets.map((f) => f.tours.at(-1)?.contexteFinTour ?? 0)), 0),
        attendus ? `${trouves}/${attendus} (${Math.round((100 * trouves) / attendus)} %)` : '—',
        String(faits.reduce((s, q) => s + q.faux.length, 0)),
        f2(moyenne(complets.map(coutProjete)))
      ].join(' | ')
    )
  }
  const a = parVariante.a
  for (const v of variantes.filter((x) => x !== 'a')) {
    const b = parVariante[v]
    if (!a || !b) continue
    const ecarts = a.complets.flatMap((fa) => {
      const fb = b.complets.find((f) => f.sujet === fa.sujet && f.replique === fa.replique)
      return fb ? [b.cout(fb) - a.cout(fa)] : []
    })
    lignes.push(
      `paires ${v} - a : ${ecarts.length} · écart moyen ${f2(moyenne(ecarts))} $ · ${ecarts.map((e) => e.toFixed(2)).join(' ')}`
    )
  }
  const incoherents = fils
    .flatMap((f) => f.tours)
    .filter((t) => t.coutUsd > 0 && Math.abs(t.coutSommeAppelsUsd - t.coutUsd) / t.coutUsd > 0.03)
  const types = {}
  for (const f of fils)
    for (const t of f.tours) for (const s of t.sousAgents) types[s] = (types[s] ?? 0) + 1
  lignes.push(`sous-agents lancés : ${JSON.stringify(types)}`)
  lignes.push(`tours où la somme des appels s'écarte de plus de 3 % du CLI : ${incoherents.length}`)
  const pasPropres = fils.filter((f) => f.propre === false).length
  lignes.push(`fils qui ont laissé la copie modifiée : ${pasPropres}`)
  return lignes.join('\n')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2)
  const valeur = (nom) => {
    const k = args.indexOf(nom)
    return k >= 0 ? args[k + 1] : undefined
  }
  if (args[0] === '--verifier') process.exit(verifier() ? 0 : 1)
  else if (args[0] === '--rejuger' && args[1] && existsSync(args[1])) {
    console.log(`${rejuger(path.resolve(args[1]))} tours rejugés`)
    console.log(tableau(path.resolve(args[1])))
  } else if (args[0] === '--tableau' && args[1] && existsSync(args[1]))
    console.log(tableau(path.resolve(args[1])))
  else if (args[0] === '--lancer') {
    const variantes = (valeur('--variantes') ?? 'a,b-sonnet').split(',').filter(Boolean)
    const sujets = (valeur('--sujets') ?? Object.keys(SUJETS).join(',')).split(',').filter(Boolean)
    const inconnu = [...variantes.filter((v) => !VARIANTES[v]), ...sujets.filter((s) => !SUJETS[s])]
    if (inconnu.length) {
      console.error(`inconnu : ${inconnu.join(', ')}`)
      process.exit(2)
    }
    await lancer({
      plafond: Number(valeur('--plafond') ?? 40),
      repliques: Number(valeur('--repliques') ?? 2),
      repliquesDepuis: Number(valeur('--repliques-depuis') ?? 1),
      coutPaire: Number(valeur('--cout-paire') ?? 9),
      parallele: Number(valeur('--parallele') ?? 4),
      variantes,
      sujets,
      systeme: valeur('--systeme'),
      gardes: valeur('--gardes'),
      dossier: valeur('--dossier')
    })
  } else {
    console.error(
      'usage : --verifier | --lancer [options] | --rejuger <dossier> | --tableau <dossier>'
    )
    process.exit(2)
  }
}
