import assert from 'node:assert/strict';
import test from 'node:test';

import { createMachinesService } from '../machines.service.js';

function createHarness() {
  const machines = new Map<string, {
    id: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    status: 'online' | 'offline';
    lastSeenAt: string | null;
    hostname: string | null;
    createdAt: string;
    revokedAt: string | null;
  }>();
  const tokens = new Map<string, string>();

  const service = createMachinesService({
    createId: () => 'machine-1',
    generateToken: () => 'mw_test_token_value_0001',
    hashToken: (token) => `hash:${token}`,
    createMachine: (input) => {
      const record = {
        id: input.id,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenPrefix: input.tokenPrefix,
        status: 'offline' as const,
        lastSeenAt: null,
        hostname: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        revokedAt: null,
      };
      machines.set(record.id, record);
      tokens.set(input.tokenHash, record.id);
      return { ...record, tokenPrefix: record.tokenPrefix };
    },
    listMachines: () => [...machines.values()]
      .filter((row) => !row.revokedAt)
      .map((row) => ({ ...row })),
    getMachineById: (machineId) => {
      const row = machines.get(machineId);
      return row ? { ...row } : null;
    },
    findActiveMachineByToken: (token) => {
      const machineId = tokens.get(`hash:${token}`);
      if (!machineId) return null;
      const row = machines.get(machineId);
      return row && !row.revokedAt ? { ...row } : null;
    },
    renameMachine: (machineId, name) => {
      const row = machines.get(machineId);
      if (!row || row.revokedAt) return null;
      row.name = name;
      return { ...row };
    },
    revokeMachine: (machineId) => {
      const row = machines.get(machineId);
      if (!row || row.revokedAt) return false;
      row.revokedAt = '2026-01-02T00:00:00.000Z';
      row.status = 'offline';
      return true;
    },
    markOnline: (machineId, hostname) => {
      const row = machines.get(machineId);
      if (!row || row.revokedAt) return null;
      row.status = 'online';
      row.lastSeenAt = '2026-01-01T01:00:00.000Z';
      if (hostname) row.hostname = hostname;
      return { ...row };
    },
    markOffline: (machineId) => {
      const row = machines.get(machineId);
      if (!row || row.revokedAt) return null;
      row.status = 'offline';
      return { ...row };
    },
    touchHeartbeat: (machineId) => {
      const row = machines.get(machineId);
      if (row) row.lastSeenAt = '2026-01-01T02:00:00.000Z';
    },
  });

  return { service, machines };
}

test('createMachine returns plaintext token once and lists the machine', () => {
  const { service } = createHarness();
  const created = service.createMachine('laptop-a');
  assert.equal(created.token, 'mw_test_token_value_0001');
  assert.equal(created.machine.name, 'laptop-a');
  assert.equal(created.machine.status, 'offline');
  assert.equal(service.listMachines().length, 1);
});

test('authenticateWorkerToken accepts active tokens and rejects revoked ones', () => {
  const { service } = createHarness();
  const created = service.createMachine('laptop-a');
  const authed = service.authenticateWorkerToken(created.token);
  assert.deepEqual(authed, { id: 'machine-1', name: 'laptop-a' });

  service.revokeMachine('machine-1');
  assert.equal(service.authenticateWorkerToken(created.token), null);
});

test('markOnline updates presence used by the control-plane UI', () => {
  const { service } = createHarness();
  service.createMachine('laptop-a');
  const online = service.markOnline('machine-1', 'host-a');
  assert.equal(online?.status, 'online');
  assert.equal(online?.hostname, 'host-a');
});
