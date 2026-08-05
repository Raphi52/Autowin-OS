// Import de TYPE uniquement : effacé à la compilation, donc ce module reste utilisable des deux
// côtés (main et renderer) sans jamais tirer une dépendance Node dans le bundle du renderer.
import type { PipelinePhase } from '../main/skill-pipeline'

/**
 * La persona d'un membre de fan-out : l'ANGLE sous lequel il regarde.
 *
 * Un panel ne vaut pas par son nombre mais par sa DÉCORRÉLATION. Trois agents lancés sur un même
 * nœud avec le même prompt rendent trois fois le même avis — le fan-out coûte alors trois fois plus
 * cher sans rien apprendre de neuf. La persona est ce qui les sépare, et c'est pour cela qu'elle est
 * INJECTÉE dans le prompt système du membre : une persona seulement affichée à l'écran serait un
 * décor, et le pire des décors, puisqu'elle ferait croire à une diversité inexistante.
 */

export interface Persona {
  id: string
  /** Ce que l'utilisateur lit dans le sélecteur. */
  label: string
  /** La consigne injectée. Écrite à la 2e personne, comme les autres blocs système. */
  instruction: string
}

/**
 * Le catalogue, par phase. Volontairement COURT : une liste de trente angles ne serait pas choisie,
 * elle serait subie. Chaque entrée doit changer ce que l'agent REGARDE, pas seulement son ton.
 */
export const PERSONAS: Partial<Record<PipelinePhase, Persona[]>> = {
  scout: [
    {
      id: 'dette',
      label: 'Dette technique',
      instruction:
        'Tu cherches la DETTE : code mort, TODO périmés, contournements devenus permanents, duplications. Tu ignores les manques fonctionnels — un autre membre les couvre.'
    },
    {
      id: 'fragilite',
      label: 'Fragilité',
      instruction:
        'Tu cherches ce qui CASSE : cas limites non gérés, hypothèses implicites, gardes absentes, dépendances fragiles. Tu ignores le confort et l’esthétique.'
    },
    {
      id: 'usage',
      label: 'Usage réel',
      instruction:
        'Tu pars de l’UTILISATEUR : ce qui l’oblige à un détour, ce qu’il ne trouve pas, ce qu’il refait à la main. Tu ignores la qualité interne du code.'
    },
    {
      id: 'rupture',
      label: 'Rupture de prémisse',
      instruction:
        'Tu remets en cause la PRÉMISSE : et si ce module ne devait pas exister sous cette forme ? Propose la ré-imagination la plus ambitieuse défendable, pas l’amélioration incrémentale.'
    }
  ],
  frame: [
    {
      id: 'probleme',
      label: 'Problème derrière la demande',
      instruction:
        'Tu remontes de la SOLUTION demandée au PROBLÈME réel. Tu cherches surtout ce qui existe déjà et rendrait le travail inutile.'
    },
    {
      id: 'contraintes',
      label: 'Contraintes et risques',
      instruction:
        'Tu cadres par les CONTRAINTES : ce qui est irréversible, ce qui coûte cher, ce qui dépend d’un tiers. Tu ne proposes pas de solution.'
    }
  ],
  build: [
    {
      id: 'minimal',
      label: 'Fix minimal',
      instruction:
        'Tu corriges la cause NOMMÉE et rien d’autre. Aucun refactor opportuniste, aucune amélioration de passage.'
    },
    {
      id: 'preuve',
      label: 'Preuve d’abord',
      instruction:
        'Tu écris le test ROUGE avant la correction, et tu nommes l’entrée qui devrait faire échouer ce test si la correction était fausse.'
    }
  ],
  judge: [
    {
      id: 'correcteur',
      label: 'Correcteur',
      instruction:
        'Tu ne juges QUE la correction et les cas limites. Tu cherches le contre-exemple qui casse. Tu es muet sur le style, la performance et les conventions.'
    },
    {
      id: 'gardien',
      label: 'Gardien',
      instruction:
        'Tu ne juges QUE la sécurité : données sensibles, abus possibles, élargissement de droits, effets destructeurs. Tu es muet sur le reste.'
    },
    {
      id: 'lean',
      label: 'Lean',
      instruction:
        'Tu ne juges QUE la sur-ingénierie : code mort, duplication d’un existant, abstraction à un seul usage. Pour chaque défaut, nomme le remplacement. Tu es muet sur le style.'
    },
    {
      id: 'fidele',
      label: 'Fidèle au besoin',
      instruction:
        'Tu ne juges QUE la fidélité au besoin. Tu confrontes chaque critère à sa preuve, et tu as le droit de déclarer le besoin lui-même périmé.'
    },
    {
      id: 'naif',
      label: 'Lecteur naïf',
      instruction:
        'Tu n’as AUCUNE connaissance préalable du domaine. Tu signales tout ce qui n’est compréhensible que si l’on connaît déjà la réponse.'
    }
  ]
}

/** Les personas proposables pour une phase. Vide = fan-out sans angle imposé, ce qui reste licite. */
export function personasFor(phase: PipelinePhase): Persona[] {
  return PERSONAS[phase] ?? []
}

/**
 * Le bloc système d'une persona, ou une chaîne vide.
 *
 * Accepte un id du catalogue OU un texte libre : imposer le catalogue empêcherait de composer un
 * angle que personne n'avait prévu, ce qui est justement l'intérêt de pouvoir en choisir un.
 */
export function personaInstruction(persona?: string): string {
  if (!persona || !persona.trim()) return ''
  const connue = Object.values(PERSONAS)
    .flat()
    .find((p) => p.id === persona)
  const texte = connue?.instruction ?? persona.trim()
  return `\n=== ANGLE IMPOSÉ À CE MEMBRE ===\n${texte}\nTu tiens CET angle et lui seul : un autre membre du panel couvre les autres. Un panel où tout le monde regarde la même chose ne vaut pas mieux qu'un seul avis.\n`
}
