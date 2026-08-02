import express from 'express';

import {
  AppError,
  asyncHandler,
  createApiSuccessResponse,
} from '@/shared/utils.js';

import type { MachinesService } from './machines.service.js';

type MachinesRouterDependencies = {
  machinesService: MachinesService;
  pingMachine: (machineId: string) => Promise<{
    ok: boolean;
    latencyMs: number;
    payload: string;
  }>;
};

/**
 * Creates thin HTTP handlers for control-plane machine management.
 *
 * Consumed by the machines module composition root and mounted under
 * `/api/machines` by the server entrypoint.
 */
export function createMachinesRouter(
  dependencies: MachinesRouterDependencies,
): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(createApiSuccessResponse({
        machines: dependencies.machinesService.listMachines(),
      }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const result = dependencies.machinesService.createMachine(req.body?.name);
      res.status(201).json(createApiSuccessResponse({
        machine: result.machine,
        token: result.token,
      }));
    }),
  );

  router.patch(
    '/:machineId',
    asyncHandler(async (req, res) => {
      const machine = dependencies.machinesService.renameMachine(
        String(req.params.machineId),
        req.body?.name,
      );
      res.json(createApiSuccessResponse({ machine }));
    }),
  );

  router.delete(
    '/:machineId',
    asyncHandler(async (req, res) => {
      dependencies.machinesService.revokeMachine(String(req.params.machineId));
      res.json(createApiSuccessResponse({ revoked: true }));
    }),
  );

  router.post(
    '/:machineId/ping',
    asyncHandler(async (req, res) => {
      const machineId = String(req.params.machineId);
      const machine = dependencies.machinesService.getMachine(machineId);
      if (!machine) {
        throw new AppError('Machine not found', {
          code: 'MACHINE_NOT_FOUND',
          statusCode: 404,
        });
      }

      const result = await dependencies.pingMachine(machineId);
      res.json(createApiSuccessResponse({
        machineId,
        ...result,
      }));
    }),
  );

  return router;
}
