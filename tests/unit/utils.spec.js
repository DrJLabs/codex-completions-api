import { describe, it, expect } from 'vitest';
import {
  normalizeModel,
  impliedEffortForModel,
  joinMessages,
  stripAnsi,
  estTokens,
  estTokensForMessages,
  parseTime,
  aggregateUsage,
  isModelText,
  applyCors
} from '../../src/utils.js';

describe('model utils', () => {
  it('normalizes codex-5 to effective default', () => {
    const r = normalizeModel('codex-5', 'gpt-5');
    expect(r).toEqual({ requested: 'codex-5', effective: 'gpt-5' });
  });
  it('implies effort from codex-5-high', () => {
    expect(impliedEffortForModel('codex-5-high')).toBe('high');
    expect(impliedEffortForModel('codex-5-minimal')).toBe('minimal');
    expect(impliedEffortForModel('gpt-5')).toBe('');
  });
  it('passes through custom model name', () => {
    const r = normalizeModel('my-model', 'gpt-5');
    expect(r).toEqual({ requested: 'my-model', effective: 'my-model' });
  });
});

describe('prompt and tokens', () => {
  it('joins messages with role prefixes', () => {
    const s = joinMessages([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }]);
    expect(s).toContain('[user] Hi');
    expect(s).toContain('[assistant] Hello');
  });
  it('strips ansi/control sequences', () => {
    const out = stripAnsi('\u001b[31mRed\u001b[0m\rText\u0008');
    expect(out).toBe('RedText');
  });
  it('estimates tokens for strings and messages', () => {
    expect(estTokens('abcd')).toBe(1);
    expect(estTokens('abcdabcd')).toBe(2);
    const msgs = [{ content: 'hello' }, { content: ['a', 'b'] }];
    expect(estTokensForMessages(msgs)).toBeGreaterThan(0);
  });
});

describe('time and usage', () => {
  it('parses epoch and ISO, invalid to 0', () => {
    expect(parseTime('0')).toBe(0);
    expect(parseTime('1690000000000')).toBe(1690000000000);
    const iso = '2025-01-01T00:00:00Z';
    expect(parseTime(iso)).toBe(Date.parse(iso));
    expect(parseTime('not-a-date')).toBe(0);
  });
  it('aggregates totals and buckets by hour', () => {
    const t0 = Date.parse('2025-01-01T01:00:00Z');
    const t1 = Date.parse('2025-01-01T01:15:00Z');
    const t2 = Date.parse('2025-01-01T02:05:00Z');
    const events = [
      { ts: t0, prompt_tokens_est: 10, completion_tokens_est: 5, total_tokens_est: 15 },
      { ts: t1, prompt_tokens_est: 2, completion_tokens_est: 3, total_tokens_est: 5 },
      { ts: t2, prompt_tokens_est: 1, completion_tokens_est: 1, total_tokens_est: 2 }
    ];
    const agg = aggregateUsage(events, t0, t2 + 1, 'hour');
    expect(agg.total_requests).toBe(3);
    expect(agg.buckets.length).toBe(2);
    const sum = agg.prompt_tokens_est + agg.completion_tokens_est;
    expect(sum).toBe(10 + 5 + 2 + 3 + 1 + 1);
  });
});

describe('text filtering', () => {
  it('filters out patch/log lines but keeps normal text', () => {
    expect(isModelText('*** Begin Patch')).toBe(false);
    expect(isModelText('diff --git a b')).toBe(false);
    expect(isModelText('running: foo')).toBe(false);
    expect(isModelText('Hello model')).toBe(true);
  });
});

describe('CORS utility', () => {
  it('reflects origin and sets vary/creds when enabled and origin present', () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    applyCors({ headers: { origin: 'http://x' } }, res, true);
    expect(headers['Access-Control-Allow-Origin']).toBe('http://x');
    expect(headers['Vary']).toBe('Origin');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });
  it('sets wildcard origin when enabled and no origin present', () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    applyCors({ headers: {} }, res, true);
    expect(headers['Access-Control-Allow-Origin']).toBe('*');
  });
});

