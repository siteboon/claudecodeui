/**
 * Phase 4 — topic API.
 *
 * Endpoints (all under /api/topics, gated by authenticateToken in server/index.js):
 *
 *   GET  /                       List all assignments + per-project topic summaries.
 *   GET  /project/:slug          Same shape, scoped to one project.
 *   POST /assign                 Manual override (body: sessionId, projectKey, topic).
 *                                Pass topic=null to clear an existing manual tag.
 *   POST /cluster                Trigger a one-off full re-cluster (admin / debug).
 *   POST /cluster/project/:slug  Trigger re-cluster for one project.
 *
 * Manual assignments persist with method='manual' and survive automatic runs.
 * Bodies are validated minimally — these are authenticated-user endpoints.
 */

import express from 'express';

import { topicStore } from '../database/topic-store.js';
import {
  setManualTopic,
  clusterAllProjects,
  clusterLargeProject,
  backfillSmallProject,
  tagSessionWithHaiku,
} from '../services/topic-clusterer.js';

const router = express.Router();

function safeSlug(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('..')) return null;
  return trimmed;
}

function buildProjectSummary(slug) {
  const topics = topicStore.getTopicsForProject(slug);
  const assignments = topicStore.getForProject(slug);
  const assignmentMap = {};
  for (const a of assignments) {
    assignmentMap[a.sessionId] = { topic: a.topic, accent: a.accent, method: a.method };
  }
  return { topics, assignments: assignmentMap };
}

router.get('/', (_req, res) => {
  try {
    const all = topicStore.getAll();
    const byProject = {};
    for (const a of all) {
      const bucket =
        byProject[a.projectKey] ||
        (byProject[a.projectKey] = { topics: [], assignments: {} });
      bucket.assignments[a.sessionId] = {
        topic: a.topic,
        accent: a.accent,
        method: a.method,
      };
    }
    for (const slug of Object.keys(byProject)) {
      byProject[slug].topics = topicStore.getTopicsForProject(slug);
    }
    res.json({ byProject });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch topics', detail: err.message });
  }
});

router.get('/project/:slug', (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug) return res.status(400).json({ error: 'Invalid project slug' });
  try {
    res.json(buildProjectSummary(slug));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project topics', detail: err.message });
  }
});

router.post('/assign', (req, res) => {
  const { sessionId, projectKey, topic } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  const slug = safeSlug(projectKey);
  if (!slug) {
    return res.status(400).json({ error: 'projectKey (slug) is required' });
  }
  try {
    const result = setManualTopic({
      sessionId,
      slug,
      topic: topic ?? null,
    });
    res.json({ ok: true, result, project: buildProjectSummary(slug) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign topic', detail: err.message });
  }
});

router.post('/cluster', async (_req, res) => {
  try {
    const summary = await clusterAllProjects();
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ error: 'Cluster run failed', detail: err.message });
  }
});

router.post('/cluster/project/:slug', async (req, res) => {
  const slug = safeSlug(req.params.slug);
  if (!slug) return res.status(400).json({ error: 'Invalid project slug' });
  try {
    let result;
    const force = String(req.query.large || '').toLowerCase() === 'true';
    if (force) {
      result = await clusterLargeProject(slug);
    } else {
      const tagged = await backfillSmallProject(slug);
      result = { method: 'haiku', taggedCount: tagged };
    }
    res.json({ ok: true, slug, result, project: buildProjectSummary(slug) });
  } catch (err) {
    res.status(500).json({ error: 'Project cluster run failed', detail: err.message });
  }
});

router.post('/tag/session', async (req, res) => {
  const { sessionId, projectKey } = req.body || {};
  const slug = safeSlug(projectKey);
  if (!sessionId || !slug) {
    return res.status(400).json({ error: 'sessionId and projectKey required' });
  }
  try {
    const topic = await tagSessionWithHaiku({ sessionId, slug, force: true });
    res.json({ ok: true, sessionId, topic, project: buildProjectSummary(slug) });
  } catch (err) {
    res.status(500).json({ error: 'Tag failed', detail: err.message });
  }
});

export default router;
