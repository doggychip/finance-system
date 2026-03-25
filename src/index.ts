import express from 'express';
import { initDb } from './db';
import { accountRoutes } from './routes/accounts';
import { journalRoutes } from './routes/journal';
import { reportRoutes } from './routes/reports';

const app = express();
app.use(express.json());

const db = initDb();

app.use('/api/accounts', accountRoutes(db));
app.use('/api/journal', journalRoutes(db));
app.use('/api/reports', reportRoutes(db));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Finance system running on port ${PORT}`);
});

export { app };
