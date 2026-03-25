import { Router } from 'express';
import Database from 'better-sqlite3';
import { JournalService } from '../services/journal-service';

export function journalRoutes(db: Database.Database): Router {
  const router = Router();
  const service = new JournalService(db);

  router.get('/', (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(service.getAll(status));
  });

  router.post('/', (req, res) => {
    try {
      const entry = service.create(req.body);
      res.status(201).json(entry);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  router.get('/:id', (req, res) => {
    const id = req.params.id as string;
    const entry = service.getById(id);
    if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
    res.json(entry);
  });

  router.post('/:id/post', (req, res) => {
    try {
      const id = req.params.id as string;
      const entry = service.post(id);
      res.json(entry);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  router.post('/:id/void', (req, res) => {
    try {
      const id = req.params.id as string;
      const reason = req.body.reason || 'No reason provided';
      const entry = service.void(id, reason);
      res.json(entry);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  return router;
}
