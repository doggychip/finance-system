import { Router } from 'express';
import Database from 'better-sqlite3';
import { AccountService } from '../services/account-service';

export function accountRoutes(db: Database.Database): Router {
  const router = Router();
  const service = new AccountService(db);

  router.get('/', (req, res) => {
    const type = req.query.type as string | undefined;
    res.json(service.getAll(type));
  });

  router.post('/', (req, res) => {
    try {
      const account = service.create(req.body);
      res.status(201).json(account);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  router.get('/:id', (req, res) => {
    const id = req.params.id as string;
    const account = service.getById(id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json(account);
  });

  router.patch('/:id', (req, res) => {
    try {
      const id = req.params.id as string;
      const account = service.update(id, req.body);
      res.json(account);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const id = req.params.id as string;
      service.delete(id);
      res.status(204).send();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  return router;
}
