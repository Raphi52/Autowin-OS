export interface ObservatoryFocus {
  conversationId: string
  turnId: string
  requestId: number
}

export type InspectTurnTarget = Omit<ObservatoryFocus, 'requestId'>
