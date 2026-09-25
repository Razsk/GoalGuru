import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { GLOSSARY_TERMS, HELP_TOPICS } from '../../src/help/content.js';
import { buildApp } from '../../src/server/app.js';
import { createDatabase } from '../../src/storage/db.js';
import { Repository } from '../../src/storage/repository.js';

describe('Help & Glossary Domain Integrity', () => {
  const EXPECTED_CANONICAL_TERMS = [
    'user',
    'workspace',
    'goal',
    'milestone',
    'action',
    'dependency',
    'evidence',
    'proposal',
    'change-set',
    'mutation',
    'inverse-mutation',
    'temporary-reference',
    'request-mode',
    'subgraph-context',
    'asymmetric-pruning',
    'collision',
    'cycle',
    'status',
    'readiness',
    'archive',
  ];

  it('contains all 20 canonical domain terms from CONTEXT.md', () => {
    const presentIds = GLOSSARY_TERMS.map((t) => t.id);
    for (const expectedId of EXPECTED_CANONICAL_TERMS) {
      expect(presentIds).toContain(expectedId);
    }
    expect(GLOSSARY_TERMS.length).toBe(20);
  });

  it('ensures every glossary term has definitions, categories, and non-empty avoid lists', () => {
    for (const term of GLOSSARY_TERMS) {
      expect(term.term.length).toBeGreaterThan(0);
      expect(term.definition.length).toBeGreaterThan(10);
      expect(term.details.length).toBeGreaterThan(10);
      expect(term.avoid.length).toBeGreaterThan(0);
      expect(['Organization & Accounts', 'Core Language', 'Proposal & Exchange', 'Execution & Lifecycle']).toContain(
        term.category
      );
    }
  });

  it('has zero broken cross-links in glossary terms', () => {
    const validTermIds = new Set(GLOSSARY_TERMS.map((t) => t.id));
    const validTopicIds = new Set(HELP_TOPICS.map((t) => t.id));

    for (const term of GLOSSARY_TERMS) {
      for (const relTermId of term.relatedTermIds) {
        expect(validTermIds.has(relTermId)).toBe(true);
      }
      for (const relTopicId of term.relatedTopicIds) {
        expect(validTopicIds.has(relTopicId)).toBe(true);
      }
    }
  });

  it('has zero broken cross-links in help topics', () => {
    const validTermIds = new Set(GLOSSARY_TERMS.map((t) => t.id));
    const validTopicIds = new Set(HELP_TOPICS.map((t) => t.id));

    for (const topic of HELP_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.summary.length).toBeGreaterThan(10);
      expect(topic.sections.length).toBeGreaterThan(0);

      for (const relTopicId of topic.relatedTopicIds) {
        expect(validTopicIds.has(relTopicId)).toBe(true);
      }
      for (const relTermId of topic.relatedTermIds) {
        expect(validTermIds.has(relTermId)).toBe(true);
      }

      // Check inline markdown links in sections
      for (const section of topic.sections) {
        const termMatches = section.content.matchAll(/\(term:([a-z-]+)\)/g);
        for (const match of termMatches) {
          const linkedTermId = match[1];
          expect(validTermIds.has(linkedTermId)).toBe(true);
        }

        const topicMatches = section.content.matchAll(/\(topic:([a-z-]+)\)/g);
        for (const match of topicMatches) {
          const linkedTopicId = match[1];
          expect(validTopicIds.has(linkedTopicId)).toBe(true);
        }
      }
    }
  });
});

describe('Help & Glossary REST API Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const db = createDatabase(':memory:');
    const repo = new Repository(db);
    repo.initSchema();
    app = buildApp({ repo });
    await app.ready();
  });

  it('GET /api/help returns topics catalog and categories', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/help' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.topics)).toBe(true);
    expect(body.topics.length).toBe(HELP_TOPICS.length);
    expect(body.categories).toContain('Getting Started');
  });

  it('GET /api/help/topics/:id returns a single topic or 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/help/topics/getting-started' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('getting-started');
    expect(body.title).toContain('Overview');

    const res404 = await app.inject({ method: 'GET', url: '/api/help/topics/non-existent' });
    expect(res404.statusCode).toBe(404);
  });

  it('GET /api/help/glossary returns terms and supports filtering', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/help/glossary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.terms.length).toBe(20);

    // Filter by query
    const resSearch = await app.inject({ method: 'GET', url: '/api/help/glossary?q=readiness' });
    expect(resSearch.statusCode).toBe(200);
    const searchBody = JSON.parse(resSearch.body);
    expect(searchBody.terms.some((t: any) => t.id === 'readiness')).toBe(true);

    // Filter by category
    const resCat = await app.inject({ method: 'GET', url: '/api/help/glossary?category=Core%20Language' });
    expect(resCat.statusCode).toBe(200);
    const catBody = JSON.parse(resCat.body);
    expect(catBody.terms.every((t: any) => t.category === 'Core Language')).toBe(true);
  });

  it('GET /api/help/glossary/:id returns term details or 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/help/glossary/readiness' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('readiness');
    expect(body.avoid).toContain('Blocked status');

    const res404 = await app.inject({ method: 'GET', url: '/api/help/glossary/unknown-term' });
    expect(res404.statusCode).toBe(404);
  });
});
