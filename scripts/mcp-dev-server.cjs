#!/usr/bin/env node

/**
 * Goal Guru MCP Dev Error Server
 * Connects Antigravity directly to Goal Guru SQLite error telemetry via JSON-RPC 2.0 over stdio.
 */

const readline = require('readline');
const path = require('path');
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'goalguru.db');

let _db = null;
function getDb() {
  if (!_db) {
    try {
      _db = new DatabaseSync(DB_PATH);
      _db.exec('PRAGMA foreign_keys = ON;');
      _db.exec('PRAGMA journal_mode = WAL;');
      _db.exec(`
        CREATE TABLE IF NOT EXISTS dev_errors (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          category TEXT NOT NULL,
          message TEXT NOT NULL,
          stack TEXT,
          context_json TEXT,
          status TEXT NOT NULL DEFAULT 'unresolved',
          fix_notes TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL
        );
      `);
      try {
        _db.exec('ALTER TABLE dev_errors ADD COLUMN fix_notes TEXT;');
      } catch {}
      try {
        _db.exec('ALTER TABLE dev_errors ADD COLUMN resolved_at TEXT;');
      } catch {}
    } catch (err) {
      console.error('[Goal Guru MCP] DB connection error:', err.message);
      throw err;
    }
  }
  return _db;
}

const SERVER_NAME = 'goalguru-dev-errors';
const SERVER_VERSION = '1.0.0';

const TOOLS = [
  {
    name: 'poll_dev_errors',
    description: 'Poll for development errors captured in dev mode. Returns a brief one-line status summary, adaptive polling recommendations (suggesting backoff intervals or hibernation when clean), and a list of unresolved errors waiting to be fixed.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of error records to return.',
          default: 10,
        },
        status: {
          type: 'string',
          enum: ['unresolved', 'in_progress', 'active', 'resolved', 'ignored', 'all'],
          description: 'Filter by error status. Defaults to "unresolved" for active fixing.',
          default: 'unresolved',
        },
      },
    },
  },
  {
    name: 'get_error_details',
    description: 'Get deep stack trace, location, request context JSON, occurrence history, and fix notes for a specific error by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The error ID (e.g. err_123).',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'mark_error_status',
    description: 'Update the resolution status of an error (unresolved, in_progress, resolved, ignored) and log fix notes explaining the solution.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The error ID to update.',
        },
        status: {
          type: 'string',
          enum: ['unresolved', 'in_progress', 'resolved', 'ignored'],
          description: 'New status for the error.',
        },
        fixNotes: {
          type: 'string',
          description: 'Explanation of what was fixed or why this error was ignored.',
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'verify_fix',
    description: 'Run project-wide test suite (vitest) and TypeScript check (tsc --noEmit) to verify code health after applying code fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Verification command to run. Defaults to "npm test".',
          default: 'npm test',
        },
      },
    },
  },
  {
    name: 'get_error_stats',
    description: 'Get an aggregated summary of error counts categorized by status (unresolved, in_progress, resolved, ignored, total).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'clear_resolved_errors',
    description: 'Purge resolved and ignored errors from the SQLite database to keep telemetry clean.',
    inputSchema: {
      type: 'object',
      properties: {
        keepRecentDays: {
          type: 'number',
          description: 'Keep resolved errors from the last N days (0 = clear all resolved).',
          default: 0,
        },
      },
    },
  },
];

function getOneLineSummary(db) {
  const rows = db
    .prepare('SELECT status, COUNT(*) as count FROM dev_errors GROUP BY status')
    .all();
  const counts = { unresolved: 0, in_progress: 0, resolved: 0, ignored: 0 };
  for (const r of rows) {
    if (r.status in counts) counts[r.status] = r.count;
  }

  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  if (counts.unresolved === 0 && counts.in_progress === 0) {
    return `[Poll @ ${now}] Clean - 0 active errors | ${counts.resolved} resolved | ${counts.ignored} ignored`;
  }

  const top = db
    .prepare('SELECT message, category, id FROM dev_errors WHERE status = ? ORDER BY created_at DESC LIMIT 1')
    .get('unresolved');

  if (top) {
    const extra = counts.unresolved > 1 ? ` (+${counts.unresolved - 1} more)` : '';
    return `[Poll @ ${now}] ${counts.unresolved} unresolved: [${top.category}] ${top.message}${extra} [id:${top.id}] | ${counts.resolved} resolved | ${counts.in_progress} in progress`;
  }

  return `[Poll @ ${now}] ${counts.in_progress} in-progress fixes | ${counts.resolved} resolved | 0 unresolved`;
}

function getAdaptiveAdvice(db) {
  const unresolvedRow = db
    .prepare("SELECT COUNT(*) as count FROM dev_errors WHERE status IN ('unresolved', 'in_progress')")
    .get();
  const activeCount = unresolvedRow ? unresolvedRow.count : 0;

  if (activeCount > 0) {
    return {
      tier: 'active_fixing',
      recommendedIntervalSeconds: 60,
      shouldStop: false,
      reason: `${activeCount} active unresolved error(s). High frequency polling active (1m).`,
    };
  }

  return {
    tier: 'idle_backoff',
    recommendedIntervalSeconds: 900,
    shouldStop: false,
    reason: 'Zero active errors. System healthy. Backed off polling to 15m.',
  };
}

async function handleToolCall(name, args) {
  const db = getDb();

  switch (name) {
    case 'poll_dev_errors': {
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      const status = args.status || 'unresolved';

      let rows;
      if (status === 'all') {
        rows = db
          .prepare('SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors ORDER BY created_at DESC LIMIT ?')
          .all(limit);
      } else if (status === 'active') {
        rows = db
          .prepare("SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors WHERE status IN ('unresolved', 'in_progress') ORDER BY created_at DESC LIMIT ?")
          .all(limit);
      } else {
        rows = db
          .prepare('SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors WHERE status = ? ORDER BY created_at DESC LIMIT ?')
          .all(status, limit);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                summary: getOneLineSummary(db),
                advice: getAdaptiveAdvice(db),
                count: rows.length,
                errors: rows,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'get_error_details': {
      const targetId = args.id || args.errorId || args.idOrFingerprint;
      const row = db
        .prepare('SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors WHERE id = ?')
        .get(targetId);

      if (!row) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Error '${targetId}' not found.` }) }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(row, null, 2) }],
      };
    }

    case 'mark_error_status': {
      const targetId = args.id || args.errorId;
      const status = args.status;
      const fixNotes = args.fixNotes !== undefined ? args.fixNotes : args.resolutionNote;
      const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
      let res;
      if (fixNotes !== undefined) {
        res = db
          .prepare('UPDATE dev_errors SET status = ?, fix_notes = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?')
          .run(status, fixNotes, resolvedAt, targetId);
      } else {
        res = db
          .prepare('UPDATE dev_errors SET status = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?')
          .run(status, resolvedAt, targetId);
      }

      const updated = db
        .prepare('SELECT id, source, category, message, stack, context_json as contextJson, status, fix_notes as fixNotes, resolved_at as resolvedAt, created_at as createdAt FROM dev_errors WHERE id = ?')
        .get(targetId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: res.changes > 0,
                error: updated,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'verify_fix': {
      const startTime = Date.now();
      try {
        const testOutput = execSync('npm test', {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const typecheckOutput = execSync('npm run typecheck', {
          cwd: PROJECT_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  testsPassed: true,
                  typecheckPassed: true,
                  durationMs: Date.now() - startTime,
                  message: 'All unit tests and type checks passed cleanly.',
                  testOutput: testOutput.slice(-800),
                  typecheckOutput: typecheckOutput.slice(-800),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  testsPassed: false,
                  durationMs: Date.now() - startTime,
                  message: 'Verification failed with errors!',
                  error: err.message,
                  stdout: (err.stdout || '').toString().slice(-800),
                  stderr: (err.stderr || '').toString().slice(-800),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    case 'get_error_stats': {
      const rows = db
        .prepare('SELECT status, COUNT(*) as count FROM dev_errors GROUP BY status')
        .all();

      const stats = { total: 0, unresolved: 0, in_progress: 0, resolved: 0, ignored: 0 };
      for (const r of rows) {
        stats.total += r.count;
        if (r.status in stats) stats[r.status] = r.count;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }

    case 'clear_resolved_errors': {
      const keepRecentDays = args.keepRecentDays;
      let res;
      if (keepRecentDays && keepRecentDays > 0) {
        const cutoff = new Date(Date.now() - keepRecentDays * 86400000).toISOString();
        res = db
          .prepare("DELETE FROM dev_errors WHERE status IN ('resolved', 'ignored') AND resolved_at < ?")
          .run(cutoff);
      } else {
        res = db.prepare("DELETE FROM dev_errors WHERE status IN ('resolved', 'ignored')").run();
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, deletedCount: res.changes }, null, 2),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- Standard JSON-RPC 2.0 Line Protocol ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function sendResponse(id, result, error = null) {
  const payload = { jsonrpc: '2.0', id };
  if (error) {
    payload.error = error;
  } else {
    payload.result = result;
  }
  process.stdout.write(JSON.stringify(payload) + '\n');
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    sendResponse(null, null, { code: -32700, message: 'Parse error' });
    return;
  }

  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize': {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION,
          },
        });
        break;
      }

      case 'notifications/initialized': {
        break;
      }

      case 'tools/list': {
        sendResponse(id, { tools: TOOLS });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params;
        const res = await handleToolCall(name, args || {});
        sendResponse(id, res);
        break;
      }

      default:
        sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
        break;
    }
  } catch (err) {
    sendResponse(id, null, { code: -32603, message: err.message || 'Internal error' });
  }
});
