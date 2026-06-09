import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { ENTITY_GROUPS } from '../config/entity-groups';

// Path for runtime overrides — stored in the persistent volume
const OVERRIDE_PATH = process.env.DB_PATH
  ? path.join(path.dirname(process.env.DB_PATH), 'entity-groups-override.json')
  : path.join(process.cwd(), 'entity-groups-override.json');

function loadEntityGroups() {
  try {
    if (fs.existsSync(OVERRIDE_PATH)) {
      const raw = fs.readFileSync(OVERRIDE_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_e) { /* fall through to default */ }
  return ENTITY_GROUPS;
}

function saveEntityGroups(groups: unknown[]) {
  fs.writeFileSync(OVERRIDE_PATH, JSON.stringify(groups, null, 2), 'utf8');
}

export function configRoutes(): Router {
  const router = Router();

  // GET /api/config/entity-groups — return current groups (override or default)
  router.get('/entity-groups', (_req, res) => {
    res.json(loadEntityGroups());
  });

  // POST /api/config/entity-groups — save new groups to override file
  router.post('/entity-groups', (req, res) => {
    const groups = req.body;
    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: 'Body must be an array of entity groups' });
    }
    try {
      saveEntityGroups(groups);
      res.json({ ok: true, saved: groups.length });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/config/entity-groups/reset — revert to code default
  router.delete('/entity-groups/reset', (_req, res) => {
    try {
      if (fs.existsSync(OVERRIDE_PATH)) fs.unlinkSync(OVERRIDE_PATH);
      res.json({ ok: true, message: 'Reset to default ENTITY_GROUPS' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
