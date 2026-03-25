import express from 'express';

const app = express();

app.get('/ping', (_req: any, res: any) => {
  console.log('got /ping');
  res.send('pong');
});

app.get('/health', (_req: any, res: any) => {
  console.log('got /health');
  res.json({ status: 'ok' });
});

app.listen(3000, () => {
  console.log('Test server on port 3000');
});
