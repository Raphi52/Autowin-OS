import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { skillRoots } from './native-registry'

/**
 * Charge le CORPS d'une skill (`skills/<nom>/SKILL.md`, racines de `skillRoots()`) quand le FIL la
 * demande : `/nom` ou le nom sans barre en tête du message (agent-pilot), l'outil `skill_charger`,
 * un nœud skill d'un workflow (`orchestrator.ts`, `chargerSkill`).
 *
 * Une ÉTAPE d'un run (scout, frame, build, clean, judge…) ne lit JAMAIS son SKILL.md : sa consigne
 * vient de `phase-briefs.ts` (`orchestrator.ts`, `corpsSkill` vaut '' pour une étape). L'ancien
 * chargeur d'étape (`phaseInstruction`, `engineForPhase`, `loadSkillText`, `loadEngineText`)
 * n'avait plus d'appelant depuis le commit c8c90007 du 09/08 : retiré le 05/11 (conv-1602).
 * fix-ok: cause mesurée — grep du dépôt : ces fonctions n'étaient appelées que par des tests.
 */
/**
 * RE-EXPORTÉ depuis `shared/pipeline-phases`, plus déclaré ici.
 *
 * Cette liste existait en DOUBLE : ici (huit phases) et dans `workflow-executability.ts` côté
 * renderer (sept, sans `remake`). La copie périmée faisait afficher à l'onglet Workflows un badge
 * d'anomalie sur un profil parfaitement jouable — celui-là même que `workflow-defaults.ts` livre par
 * défaut. Le renderer ne peut pas importer depuis `main/`, d'où le déplacement vers `shared/`, seul
 * endroit visible des deux côtés de la frontière Electron.
 *
 * Le re-export garde les ~10 appelants de `./skill-pipeline` inchangés.
 */
import { corrigeSkillMalTapee, resolveSkillAlias } from '../shared/skill-aliases'
import { skillNommeeEnTete } from '../shared/skill-nommee'

export {
  PIPELINE_PHASES,
  isPipelinePhase,
  isSkillNode,
  type PipelinePhase,
  type NodePhase
} from '../shared/pipeline-phases'

function readIfExists(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

/**
 * Skill invoquée EN TÊTE d'un message (`/remake …`), sinon undefined.
 *
 * En tête seulement : une mention au fil du texte (« regarde /remake quand tu peux ») n'est pas une
 * invocation, et l'injecter ferait payer un corps de skill à chaque fois qu'on en parle.
 */
export function invokedSkillId(message: string): string | undefined {
  return /^\s*\/([a-z][a-z0-9-]*)\b/i.exec(message ?? '')?.[1]?.toLowerCase()
}

/**
 * Skill nommée SANS barre en tête du message (« draft des animations… »), sinon undefined.
 *
 * Même règle que la bulle du fil (`shared/skill-nommee.ts`), appliquée aux seules skills présentes
 * sur disque : la bulle « DRAFT » ne s'allume donc que sur un message dont le corps est réellement
 * chargé. Avant (conv-988, 2026-10-16), la consigne du chat disait « SKILL NOMMÉE = SKILL
 * INVOQUÉE » mais rien ne chargeait la procédure : l'agent ne l'a lue que 5 fois sur 169.
 */
export function skillNommeeSansBarre(message: string, roots = skillRoots()): string | undefined {
  const nommee = skillNommeeEnTete(message, dossiersDeSkills(roots))
  return nommee && !nommee.barre ? nommee.skill.toLowerCase() : undefined
}

/**
 * Corps injectable d'une skill DÉSIGNÉE PAR SON NOM, phase du pipeline ou non.
 *
 * L'ancien chargeur d'étape ne savait servir que les 7 `PipelinePhase` : c'est ce qui rendait `/remake`
 * inatteignable alors que l'entrée slash existait — le renderer promettait un contrat que le main ne
 * chargeait jamais. « Être une phase du pipeline » et « avoir un corps injectable » sont deux
 * propriétés distinctes ; les confondre a produit une étiquette qui mentait. Vide si introuvable :
 * une skill inconnue ne jette pas, elle n'ajoute simplement rien.
 */
/**
 * Forme admise d'un identifiant de skill. C'est un NOM DE DOSSIER, rien d'autre.
 *
 * Ce module `join()` l'identifiant dans un chemin. Tant que seuls les huit `PipelinePhase` et
 * `invokedSkillId` (deja borne par sa propre regex) l'atteignaient, la question ne se posait pas.
 * Depuis qu'un NOEUD DE GRAPHE peut porter un identifiant libre, elle se pose : `normalizeGraph`
 * accepte `value.nodes` TEL QUEL, donc un profil de workflow IMPORTE peut porter
 * `phase: "../../../ailleurs"`. Verifie par sonde : le corps d'un `SKILL.md` situe hors de toute
 * racine etait lu et INJECTE dans le prompt systeme d'un agent.
 *
 * On borne donc ici, au seul endroit qui construit le chemin — pas chez les appelants, qui
 * grandiront et en oublieront un.
 */
const ID_SKILL_VALIDE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** Noms de dossiers portant un SKILL.md dans les racines du kit (silencieux si illisible). */
export function dossiersDeSkills(roots: string[] = skillRoots()): string[] {
  const noms: string[] = []
  for (const root of roots) {
    try {
      for (const e of readdirSync(root, { withFileTypes: true })) {
        if (e.isDirectory() && existsSync(join(root, e.name, 'SKILL.md'))) noms.push(e.name)
      }
    } catch {
      /* racine absente : elle n'apporte simplement aucun nom */
    }
  }
  return noms
}

/**
 * UN `/nom` QUI N'EXISTE PAS DOIT LE DIRE — c'est la contrepartie de `skillInstruction`.
 *
 * `skillInstruction` rend '' pour DEUX causes qu'on ne distinguait pas : « cette skill n'existe
 * pas » et « son SKILL.md est vide ». Dans les deux cas le message partait comme du texte ordinaire
 * et PERSONNE ne savait que la commande n'avait pas pris — ni l'utilisateur, ni l'agent. Le
 * commentaire de `src/shared/skill-aliases.ts` posait pourtant la regle : « Un / mal tape doit
 * porter, pas echouer sans bruit ».
 *
 * Mesure du 2026-09-16 sur `conversations.json` : 12 invocations REELLEMENT tapees n'ont charge
 * aucune procedure — `/design` 6 fois (apres son retrait volontaire du 2026-09-03), `/skill` 3
 * fois, puis `/usage`, `/front-converge`, `/ingest`.
 *
 * Rend `undefined` quand la skill EXISTE : l'appelant n'a alors rien a signaler.
 */
export function noteSkillInconnue(id: string, roots = skillRoots()): string | undefined {
  if (!ID_SKILL_VALIDE.test(id)) return undefined
  const connus = dossiersDeSkills(roots)
  const cible = resolveSkillAlias(id)
  if (connus.some((nom) => nom.toLowerCase() === cible.toLowerCase())) return undefined
  if (corrigeSkillMalTapee(cible, connus)) return undefined
  // Les plus PROCHES par prefixe partage : « /desi… » ramene « draft » plutot qu'une liste de 20.
  const proches = connus
    .map((nom) => ({ nom, score: prefixeCommun(nom.toLowerCase(), cible.toLowerCase()) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => `/${c.nom}`)
  const piste =
    proches.length > 0
      ? ` Les plus proches : ${proches.join(', ')}.`
      : ` Les procédures disponibles : ${connus
          .slice(0, 12)
          .map((n) => `/${n}`)
          .join(', ')}.`
  return (
    `
=== COMMANDE INCONNUE ===
` +
    `L'utilisateur a tapé « /${id} », mais aucune procédure de ce nom n'existe : rien n'a été ` +
    `chargé.${piste}
Dis-le-lui en une ligne avant de répondre — sans quoi il croira que sa ` +
    `commande a pris. Puis traite son message comme une demande ordinaire.
`
  )
}

/** Longueur du préfixe commun à deux noms — suffisant pour classer des candidats courts. */
function prefixeCommun(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

export function skillInstruction(id: string, roots = skillRoots()): string {
  // La garde reste EN TÊTE : on ne résout un alias que sur une entrée déjà bornée, jamais l'inverse
  // (résoudre d'abord rouvrirait la traversée par une clé d'alias forgée).
  if (!ID_SKILL_VALIDE.test(id)) return ''
  let cible = resolveSkillAlias(id)
  if (!ID_SKILL_VALIDE.test(cible)) return ''
  let root = roots.find((candidate) => readIfExists(join(candidate, cible, 'SKILL.md')).length > 0)
  // `/draf` au lieu de `/draft` : sans ce rattrapage, on rend '' et la skill n'est jamais chargee,
  // en silence (cf. `uneSeuleFauteDeFrappe`). On ne corrige que vers un candidat UNIQUE.
  if (!root) {
    const corrige = corrigeSkillMalTapee(cible, dossiersDeSkills(roots))
    if (corrige && ID_SKILL_VALIDE.test(corrige)) {
      root = roots.find(
        (candidate) => readIfExists(join(candidate, corrige, 'SKILL.md')).length > 0
      )
      if (root) cible = corrige
    }
  }
  if (!root) return ''
  const body = stripSkillFrontmatter(readIfExists(join(root, cible, 'SKILL.md')))
  return body ? `\n=== SKILL ${cible.toUpperCase()} (kit) ===\n${body}\n` : ''
}

/**
 * Retire la frontmatter YAML (`---\n…\n---`) d'un SKILL.md. Ce bloc (`name:` + le long
 * `description:` d'heuristiques "Trigger on… / Do NOT use to…") sert au SÉLECTEUR de skill de
 * Claude Code, PAS à un sous-agent qui exécute déjà la phase imposée : l'injecter est du bruit
 * (tokens gaspillés + risque de confusion). On ne garde que le CORPS (les vraies instructions).
 */
export function stripSkillFrontmatter(text: string): string {
  const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return m ? text.slice(m[0].length).replace(/^\s+/, '') : text
}
