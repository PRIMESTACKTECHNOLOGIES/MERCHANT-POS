export class Pos1011ScalingLock {
  private firstRoundCompleted = false;
  private scalingApproved = false;

  ensureExecutionAllowed() {
    if (this.firstRoundCompleted && !this.scalingApproved) {
      throw new Error('Scaling not approved: first-round reconciliation is required');
    }
  }

  lockFirstRound(result: { status: string }) {
    this.firstRoundCompleted = true;
    this.scalingApproved = false;
  }

  approveScaling() {
    this.scalingApproved = true;
  }

  ensureScalingAllowed() {
    if (!this.scalingApproved) throw new Error('Scaling not approved');
  }
}

export const pos1011ScalingLock = new Pos1011ScalingLock();
