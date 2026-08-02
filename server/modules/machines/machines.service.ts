import crypto from 'node:crypto';

import {
  machinesDb,
  type PublicMachineRecord,
} from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';
import type {
  AuthenticatedWorkerMachine,
  ControlPlaneMachine,
} from '@/shared/types.js';

type MachinesServiceDependencies = {
  createId(): string;
  generateToken(): string;
  hashToken(token: string): string;
  createMachine(input: {
    id: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
  }): PublicMachineRecord;
  listMachines(): PublicMachineRecord[];
  getMachineById(machineId: string): PublicMachineRecord | null;
  findActiveMachineByToken(token: string): PublicMachineRecord | null;
  renameMachine(machineId: string, name: string): PublicMachineRecord | null;
  revokeMachine(machineId: string): boolean;
  markOnline(machineId: string, hostname?: string | null): PublicMachineRecord | null;
  markOffline(machineId: string): PublicMachineRecord | null;
  touchHeartbeat(machineId: string): void;
};

const defaultDependencies: MachinesServiceDependencies = {
  createId: () => crypto.randomUUID(),
  generateToken: () => machinesDb.generateMachineToken(),
  hashToken: (token) => machinesDb.hashMachineToken(token),
  createMachine: (input) => machinesDb.createMachine(input),
  listMachines: () => machinesDb.listMachines(),
  getMachineById: (machineId) => machinesDb.getMachineById(machineId),
  findActiveMachineByToken: (token) => machinesDb.findActiveMachineByToken(token),
  renameMachine: (machineId, name) => machinesDb.renameMachine(machineId, name),
  revokeMachine: (machineId) => machinesDb.revokeMachine(machineId),
  markOnline: (machineId, hostname) => machinesDb.markOnline(machineId, hostname),
  markOffline: (machineId) => machinesDb.markOffline(machineId),
  touchHeartbeat: (machineId) => machinesDb.touchHeartbeat(machineId),
};

function toControlPlaneMachine(record: PublicMachineRecord): ControlPlaneMachine {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    status: record.status,
    lastSeenAt: record.lastSeenAt,
    hostname: record.hostname,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

/**
 * Creates the machines application service used by HTTP routes and the worker
 * gateway for registration, token auth, and presence updates.
 */
export function createMachinesService(
  dependencyOverrides: Partial<MachinesServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return {
    listMachines(): ControlPlaneMachine[] {
      return dependencies.listMachines().map(toControlPlaneMachine);
    },

    createMachine(rawName: unknown): {
      machine: ControlPlaneMachine;
      token: string;
    } {
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!name) {
        throw new AppError('Machine name is required', {
          code: 'MACHINE_NAME_REQUIRED',
          statusCode: 400,
        });
      }

      const token = dependencies.generateToken();
      const machine = toControlPlaneMachine(
        dependencies.createMachine({
          id: dependencies.createId(),
          name,
          tokenHash: dependencies.hashToken(token),
          tokenPrefix: token.slice(0, 11),
        }),
      );

      return { machine, token };
    },

    renameMachine(machineId: string, rawName: unknown): ControlPlaneMachine {
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!name) {
        throw new AppError('Machine name is required', {
          code: 'MACHINE_NAME_REQUIRED',
          statusCode: 400,
        });
      }

      const machine = dependencies.renameMachine(machineId, name);
      if (!machine) {
        throw new AppError('Machine not found', {
          code: 'MACHINE_NOT_FOUND',
          statusCode: 404,
        });
      }
      return toControlPlaneMachine(machine);
    },

    revokeMachine(machineId: string): void {
      const revoked = dependencies.revokeMachine(machineId);
      if (!revoked) {
        throw new AppError('Machine not found', {
          code: 'MACHINE_NOT_FOUND',
          statusCode: 404,
        });
      }
    },

    /**
     * Validates a worker websocket token. Used by websocket verifyClient for
     * `/worker` upgrades.
     */
    authenticateWorkerToken(token: string | null): AuthenticatedWorkerMachine | null {
      if (!token || !token.startsWith('mw_')) {
        return null;
      }

      const machine = dependencies.findActiveMachineByToken(token);
      if (!machine) {
        return null;
      }

      return { id: machine.id, name: machine.name };
    },

    markOnline(machineId: string, hostname?: string | null): ControlPlaneMachine | null {
      const machine = dependencies.markOnline(machineId, hostname);
      return machine ? toControlPlaneMachine(machine) : null;
    },

    markOffline(machineId: string): ControlPlaneMachine | null {
      const machine = dependencies.markOffline(machineId);
      return machine ? toControlPlaneMachine(machine) : null;
    },

    touchHeartbeat(machineId: string): void {
      dependencies.touchHeartbeat(machineId);
    },

    getMachine(machineId: string): ControlPlaneMachine | null {
      const machine = dependencies.getMachineById(machineId);
      return machine && !machine.revokedAt ? toControlPlaneMachine(machine) : null;
    },
  };
}

export type MachinesService = ReturnType<typeof createMachinesService>;
