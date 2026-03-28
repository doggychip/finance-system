import { Router } from 'express';
import Database from 'better-sqlite3';

export function taskRoutes(db: Database.Database): Router {
  const router = Router();

  // Login
  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ? AND password = ?').get(username, password) as any;
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    res.json(user);
  });

  // List users
  router.get('/users', (_req, res) => {
    const users = db.prepare('SELECT id, username, display_name, role FROM users ORDER BY display_name').all();
    res.json(users);
  });

  // Add user
  router.post('/users', (req, res) => {
    const { username, password, display_name, role } = req.body;
    if (!username || !password || !display_name) return res.status(400).json({ error: 'Username, password, and display name required' });
    try {
      db.prepare('INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)').run(username, password, display_name, role || 'finance');
      const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?').get(username);
      res.status(201).json(user);
    } catch (e: any) {
      res.status(400).json({ error: 'Username already exists' });
    }
  });

  // Update user (change password or display name)
  router.patch('/users/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const { password, display_name } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    if (password) { updates.push('password = ?'); values.push(password); }
    if (display_name) { updates.push('display_name = ?'); values.push(display_name); }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    values.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(id);
    res.json(user);
  });

  // Delete user
  router.delete('/users/:id', (req, res) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // List tasks
  router.get('/tasks', (req, res) => {
    const userId = req.query.user_id as string | undefined;
    const status = req.query.status as string | undefined;

    let query = `
      SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN users c ON c.id = t.created_by
      WHERE 1=1`;
    const params: any[] = [];

    if (userId) { query += ' AND t.assigned_to = ?'; params.push(parseInt(userId)); }
    if (status) { query += ' AND t.status = ?'; params.push(status); }

    query += ' ORDER BY CASE t.priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, t.due_date ASC';

    res.json(db.prepare(query).all(...params));
  });

  // Create task
  router.post('/tasks', (req, res) => {
    const { title, description, due_date, priority, category, assigned_to, created_by } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const result = db.prepare(`
      INSERT INTO tasks (title, description, due_date, priority, category, assigned_to, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, description || '', due_date || null, priority || 'medium', category || 'general', assigned_to || null, created_by || null);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(task);
  });

  // Update task
  router.patch('/tasks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const { title, description, due_date, priority, status, category, assigned_to } = req.body;
    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (due_date !== undefined) { updates.push('due_date = ?'); values.push(due_date); }
    if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
    if (status !== undefined) {
      updates.push('status = ?'); values.push(status);
      if (status === 'done') updates.push("completed_at = datetime('now')");
      if (status !== 'done') updates.push('completed_at = NULL');
    }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }

    if (updates.length === 0) return res.json(task);

    updates.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare(`
      SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
      FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by
      WHERE t.id = ?
    `).get(id);
    res.json(updated);
  });

  // Delete task
  router.delete('/tasks/:id', (req, res) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // Dashboard summary
  router.get('/summary', (req, res) => {
    const userId = req.query.user_id as string | undefined;
    const filter = userId ? ' AND assigned_to = ?' : '';
    const params = userId ? [parseInt(userId)] : [];

    const total = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status != 'cancelled'${filter}`).get(...params) as any).c;
    const todo = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'todo'${filter}`).get(...params) as any).c;
    const inProgress = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'in_progress'${filter}`).get(...params) as any).c;
    const done = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done'${filter}`).get(...params) as any).c;
    const overdue = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo','in_progress') AND due_date < date('now')${filter}`).get(...params) as any).c;
    const dueToday = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo','in_progress') AND due_date = date('now')${filter}`).get(...params) as any).c;
    const urgent = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status IN ('todo','in_progress') AND priority = 'urgent'${filter}`).get(...params) as any).c;

    res.json({ total, todo, in_progress: inProgress, done, overdue, due_today: dueToday, urgent });
  });

  return router;
}
