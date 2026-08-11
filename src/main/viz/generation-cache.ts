/** Barrière légère pour rejeter une réponse démarrée avant la dernière invalidation. */
export class GenerationFence {
  private epoch = 0

  capture(): number {
    return this.epoch
  }

  invalidate(): void {
    this.epoch += 1
  }

  isCurrent(capturedEpoch: number): boolean {
    return capturedEpoch === this.epoch
  }
}
