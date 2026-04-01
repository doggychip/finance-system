import { Router } from 'express';
import Database from 'better-sqlite3';

export function invoiceRoutes(db: Database.Database): Router {
  const router = Router();

  // List invoices
  router.get('/', (req, res) => {
    const type = req.query.type as string | undefined;
    const state = req.query.state as string | undefined;
    let query = 'SELECT * FROM invoices WHERE 1=1';
    const params: string[] = [];

    if (type) { query += ' AND type = ?'; params.push(type); }
    if (state) { query += ' AND state = ?'; params.push(state); }
    query += ' ORDER BY date DESC';

    res.json(db.prepare(query).all(...params));
  });

  // Get single invoice
  router.get('/:id', (req, res) => {
    const id = req.params.id as string;
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  });

  // List payments
  router.get('/payments/list', (req, res) => {
    const state = req.query.state as string | undefined;
    let query = 'SELECT * FROM payments WHERE 1=1';
    const params: string[] = [];

    if (state) { query += ' AND state = ?'; params.push(state); }
    query += ' ORDER BY date DESC';

    res.json(db.prepare(query).all(...params));
  });

  // Get single payment
  router.get('/payments/:id', (req, res) => {
    const id = req.params.id as string;
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  });

  return router;
}
