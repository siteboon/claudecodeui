import express from 'express';

import { createCrewAIRunner } from '../services/crewai-runner.service.js';
import { validateCrewAIConfig } from '../services/crewai-bridge.service.js';

const router = express.Router();
const runner = createCrewAIRunner();

router.get('/status', (_req, res) => {
  res.json({ activeRunIds: runner.getActiveRunIds() });
});

router.post('/start', async (req, res) => {
  try {
    const { config, options } = req.body;

    const validation = validateCrewAIConfig(config);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const result = await runner.startRun(config, options, {
      onAgentOutput: () => {},
      onCrewComplete: () => {},
      onCrewError: () => {},
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ runId: result.runId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start CrewAI run' });
  }
});

router.post('/abort/:runId', (req, res) => {
  const aborted = runner.abortRun(req.params.runId);
  if (!aborted) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }
  res.json({ aborted: true });
});

export default router;
