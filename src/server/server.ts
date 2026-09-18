import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { createDatabase } from '../storage/db.js';
import { Repository } from '../storage/repository.js';
import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'goalguru.db');

async function main() {
  const db = createDatabase(DB_PATH);
  const repo = new Repository(db);
  repo.initSchema();

  const app = buildApp({ repo });

  // Serve static files from public directory
  const publicDir = join(process.cwd(), 'public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url && req.raw.url.startsWith('/api')) {
      reply.status(404).send({ error: 'Endpoint not found' });
    } else {
      reply.sendFile('index.html');
    }
  });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🚀 Goal Guru is running at: http://localhost:${PORT}\n`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
