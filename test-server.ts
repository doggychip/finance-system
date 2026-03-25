import express from 'express';

const app = express();

app.get('/ping', (_req, res) => {
  console.log('got /ping request');
  res.send('pong');
});

app.listen(3001, () => {
  console.log('Test server on port 3001');
});
