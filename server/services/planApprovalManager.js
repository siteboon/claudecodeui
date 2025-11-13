import { EventEmitter } from 'events';
import crypto from 'crypto';
import { PERMISSION_TIMEOUT_MS } from './permissionTypes.js';

class PlanApprovalManager extends EventEmitter {
  constructor() {
    super();
    this.pendingPlan = null;
    this.statistics = {
      totalRequests: 0,
      approved: 0,
      rejected: 0,
      timedOut: 0
    };
  }

  async requestPlanApproval(planContent, sessionId) {
    if (this.pendingPlan) {
      throw new Error('Another plan is already pending approval');
    }

    const planId = crypto.randomUUID();
    const timestamp = Date.now();
    const expiresAt = timestamp + PERMISSION_TIMEOUT_MS;

    console.log(`📋 [PlanApproval] Requesting approval for plan ${planId}`);

    return new Promise((resolve, reject) => {
      this.pendingPlan = {
        planId,
        content: planContent,
        sessionId,
        timestamp,
        expiresAt,
        resolve,
        reject
      };

      this.statistics.totalRequests++;

      this.emit('plan-request', {
        planId,
        content: planContent,
        sessionId,
        timestamp,
        expiresAt
      });

      const timeoutHandle = setTimeout(() => {
        if (this.pendingPlan && this.pendingPlan.planId === planId) {
          console.log(`⏱️  [PlanApproval] Plan ${planId} timed out`);
          this.statistics.timedOut++;
          this.emit('plan-timeout', { planId });
          this.pendingPlan.reject(new Error('Plan approval timed out'));
          this.pendingPlan = null;
        }
      }, PERMISSION_TIMEOUT_MS);

      this.pendingPlan.timeoutHandle = timeoutHandle;
    });
  }

  resolvePlanApproval(planId, permissionMode = 'default') {
    if (!this.pendingPlan || this.pendingPlan.planId !== planId) {
      console.warn(`⚠️  [PlanApproval] No pending plan found with ID ${planId}`);
      return false;
    }

    console.log(`✅ [PlanApproval] Plan ${planId} approved with mode: ${permissionMode}`);

    clearTimeout(this.pendingPlan.timeoutHandle);
    this.statistics.approved++;

    const result = {
      approved: true,
      permissionMode
    };

    this.pendingPlan.resolve(result);
    this.pendingPlan = null;

    return true;
  }

  rejectPlanApproval(planId, reason = 'Plan rejected by user') {
    if (!this.pendingPlan || this.pendingPlan.planId !== planId) {
      console.warn(`⚠️  [PlanApproval] No pending plan found with ID ${planId}`);
      return false;
    }

    console.log(`❌ [PlanApproval] Plan ${planId} rejected: ${reason}`);

    clearTimeout(this.pendingPlan.timeoutHandle);
    this.statistics.rejected++;

    this.pendingPlan.reject(new Error(reason));
    this.pendingPlan = null;

    return true;
  }

  hasPendingPlan() {
    return this.pendingPlan !== null;
  }

  getPendingPlan() {
    return this.pendingPlan ? {
      planId: this.pendingPlan.planId,
      content: this.pendingPlan.content,
      sessionId: this.pendingPlan.sessionId,
      timestamp: this.pendingPlan.timestamp,
      expiresAt: this.pendingPlan.expiresAt
    } : null;
  }

  getStatistics() {
    return { ...this.statistics };
  }

  clearPendingPlan() {
    if (this.pendingPlan) {
      clearTimeout(this.pendingPlan.timeoutHandle);
      this.pendingPlan.reject(new Error('Plan approval cancelled'));
      this.pendingPlan = null;
    }
  }
}

let planApprovalManagerInstance = null;

export function getPlanApprovalManager() {
  if (!planApprovalManagerInstance) {
    planApprovalManagerInstance = new PlanApprovalManager();
  }
  return planApprovalManagerInstance;
}

export { PlanApprovalManager };
