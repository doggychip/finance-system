import { Router } from 'express';
import Database from 'better-sqlite3';

export function alertsTasksRoutes(db: Database.Database): Router {
  const router = Router();

  // ── Alerts CRUD ──

  // List alerts
  router.get('/alerts', (req, res) => {
    const resolved = req.query.resolved as string | undefined;
    const severity = req.query.severity as string | undefined;
    let query = 'SELECT * FROM alerts WHERE 1=1';
    const params: any[] = [];
    if (resolved !== undefined) { query += ' AND is_resolved = ?'; params.push(resolved === 'true' ? 1 : 0); }
    if (severity) { query += ' AND severity = ?'; params.push(severity); }
    query += ' ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, created_at DESC';
    res.json(db.prepare(query).all(...params));
  });

  // Create alert
  router.post('/alerts', (req, res) => {
    const { title, message, severity, category, entity } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const result = db.prepare(
      'INSERT INTO alerts (title, message, severity, category, entity) VALUES (?, ?, ?, ?, ?)'
    ).run(title, message || '', severity || 'info', category || 'general', entity || '');
    res.status(201).json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid));
  });

  // Update alert
  router.patch('/alerts/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as any;
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    const { title, message, severity, category, entity, is_read, is_resolved, resolved_by } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (message !== undefined) { updates.push('message = ?'); values.push(message); }
    if (severity !== undefined) { updates.push('severity = ?'); values.push(severity); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (entity !== undefined) { updates.push('entity = ?'); values.push(entity); }
    if (is_read !== undefined) { updates.push('is_read = ?'); values.push(is_read ? 1 : 0); }
    if (is_resolved !== undefined) {
      updates.push('is_resolved = ?'); values.push(is_resolved ? 1 : 0);
      if (is_resolved) {
        updates.push("resolved_at = datetime('now')");
        if (resolved_by) { updates.push('resolved_by = ?'); values.push(resolved_by); }
      } else {
        updates.push('resolved_at = NULL');
        updates.push('resolved_by = NULL');
      }
    }
    if (updates.length === 0) return res.json(alert);
    updates.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE alerts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(id));
  });

  // Delete alert
  router.delete('/alerts/:id', (req, res) => {
    db.prepare('DELETE FROM alerts WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ── Bulk operations ──

  // Bulk create alerts
  router.post('/alerts/bulk', (req, res) => {
    const { alerts } = req.body;
    if (!Array.isArray(alerts)) return res.status(400).json({ error: 'alerts array required' });
    const insert = db.prepare('INSERT INTO alerts (title, message, severity, category, entity) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction((items: any[]) => {
      const ids: number[] = [];
      for (const a of items) {
        if (!a.title) continue;
        const r = insert.run(a.title, a.message || '', a.severity || 'info', a.category || 'general', a.entity || '');
        ids.push(r.lastInsertRowid as number);
      }
      return ids;
    });
    const ids = tx(alerts);
    res.status(201).json({ created: ids.length, ids });
  });

  // Bulk resolve alerts
  router.post('/alerts/bulk-resolve', (req, res) => {
    const { ids, resolved_by } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
    const stmt = db.prepare("UPDATE alerts SET is_resolved = 1, resolved_at = datetime('now'), resolved_by = ?, updated_at = datetime('now') WHERE id = ?");
    const tx = db.transaction((alertIds: number[]) => {
      for (const id of alertIds) stmt.run(resolved_by || null, id);
    });
    tx(ids);
    res.json({ resolved: ids.length });
  });

  // Bulk update tasks
  router.post('/tasks/bulk-update', (req, res) => {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || !status) return res.status(400).json({ error: 'ids array and status required' });
    const completedClause = status === 'done' ? ", completed_at = datetime('now')" : ', completed_at = NULL';
    const stmt = db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now')${completedClause} WHERE id = ?`);
    const tx = db.transaction((taskIds: number[]) => {
      for (const id of taskIds) stmt.run(status, id);
    });
    tx(ids);
    res.json({ updated: ids.length });
  });

  // ── Health status ──

  router.get('/health-status', (_req, res) => {
    const totalTasks = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status != 'cancelled'").get() as any).c;
    const doneTasks = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").get() as any).c;
    const overdueTasks = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo','in_progress') AND due_date < date('now')").get() as any).c;
    const urgentTasks = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo','in_progress') AND priority = 'urgent'").get() as any).c;

    const totalAlerts = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE is_resolved = 0").get() as any).c;
    const criticalAlerts = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE is_resolved = 0 AND severity = 'critical'").get() as any).c;
    const warningAlerts = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE is_resolved = 0 AND severity = 'warning'").get() as any).c;

    // Health score: 100 = perfect, deductions for issues
    let score = 100;
    if (totalTasks > 0) {
      const completionRate = doneTasks / totalTasks;
      score -= Math.round((1 - completionRate) * 20); // up to -20 for incomplete tasks
    }
    score -= criticalAlerts * 15;   // -15 per critical alert
    score -= warningAlerts * 5;     // -5 per warning alert
    score -= overdueTasks * 10;     // -10 per overdue task
    score -= urgentTasks * 5;       // -5 per urgent task
    score = Math.max(0, Math.min(100, score));

    let status: string;
    if (score >= 80) status = 'healthy';
    else if (score >= 50) status = 'warning';
    else status = 'critical';

    res.json({
      score,
      status,
      tasks: { total: totalTasks, done: doneTasks, overdue: overdueTasks, urgent: urgentTasks },
      alerts: { open: totalAlerts, critical: criticalAlerts, warning: warningAlerts },
    });
  });

  return router;
}
