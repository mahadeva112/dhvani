import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { config, gatewayEnabled, resolveGateway } from '../env.js';
import { logger } from '../logger.js';
import { getCreditsUsed } from '../providers/cartesia/client.js';
import { cleanGatewayUrl } from '../providers/llmGateway/url.js';

/**
 * What each paid service has left, for the header's balance popover.
 *
 * Every answer is best effort: a service that cannot say returns a shape the
 * UI can describe ("not shared") rather than an error, so one slow or silent
 * provider never blanks the others.
 */
export const usageRouter = Router();

/** First moment of the current month in UTC, which is how Cartesia buckets usage. */
const monthStartUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

/**
 * GET /api/usage/cartesia
 *
 * Cartesia's API reports credits used, never the balance or the plan size, so
 * this is the month's spend so far. The UI says so instead of inventing a bar.
 * Usage sits behind an admin key; without one the answer says that is missing.
 */
usageRouter.get(
  '/usage/cartesia',
  asyncHandler(async (req, res) => {
    if (!config.cartesia.apiKey && !req.get('x-cartesia-key')) {
      res.json({ configured: false });
      return;
    }
    if (!config.cartesia.adminKey) {
      res.json({ configured: true, needsAdminKey: true });
      return;
    }
    const since = monthStartUtc();
    try {
      const creditsUsed = await getCreditsUsed({ adminKey: config.cartesia.adminKey, since });
      res.json({ configured: true, creditsUsed, since: since.toISOString() });
    } catch (err) {
      logger.warn(`Cartesia usage unavailable: ${err?.message || err}`);
      res.json({ configured: true, error: 'Cartesia did not return usage just now.' });
    }
  })
);

/** A GET that gives up quickly; a gateway without the endpoint should not hold the popover. */
const quickJson = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const type = response.headers.get('content-type') || '';
  return type.includes('json') ? response.json() : null;
};

const toNumber = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

/**
 * GET /api/usage/gateway
 *
 * Gateways do not share one budget API. Two common ones do expose it:
 *   OpenRouter — GET /api/v1/key  → { data: { usage, limit, limit_reset } }
 *   LiteLLM    — GET /key/info    → { info: { spend, max_budget, budget_reset_at } }
 * Anything else answers `kind: 'unknown'`, and the UI shows it as connected.
 */
usageRouter.get(
  '/usage/gateway',
  asyncHandler(async (_req, res) => {
    if (!gatewayEnabled()) {
      res.json({ configured: false });
      return;
    }
    const gateway = resolveGateway();
    const model = gateway.models?.[0] || null;
    const base = { configured: true, model };
    if (gateway.protocol !== 'openai') {
      res.json({ ...base, kind: 'unknown' });
      return;
    }

    const headers = gateway.apiKey ? { Authorization: `Bearer ${gateway.apiKey}` } : {};
    const root = cleanGatewayUrl(gateway.url).replace(/\/v\d+$/i, '');

    try {
      if (/(^|\.)openrouter\.ai$/i.test(new URL(root).hostname)) {
        const data = (await quickJson('https://openrouter.ai/api/v1/key', headers))?.data;
        if (data) {
          res.json({
            ...base,
            kind: 'openrouter',
            spent: toNumber(data.usage),
            limit: toNumber(data.limit),
            // OpenRouter names the period ("monthly") rather than a date.
            resetPeriod: data.limit_reset || null,
          });
          return;
        }
      } else {
        const info = (await quickJson(`${root}/key/info`, headers))?.info;
        if (info && 'spend' in info) {
          res.json({
            ...base,
            kind: 'litellm',
            spent: toNumber(info.spend),
            limit: toNumber(info.max_budget),
            resetAt: info.budget_reset_at || null,
          });
          return;
        }
      }
    } catch (err) {
      logger.warn(`Gateway budget unavailable: ${err?.message || err}`);
    }
    res.json({ ...base, kind: 'unknown' });
  })
);
