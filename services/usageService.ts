import { apiGet } from './apiClient';

/**
 * What Cartesia has used this month. Cartesia's API shares spend only, never
 * the balance, and only to an admin key; `needsAdminKey` says that one is missing.
 */
export interface CartesiaUsage {
  configured: boolean;
  needsAdminKey?: boolean;
  creditsUsed?: number;
  /** ISO start of the period `creditsUsed` covers. */
  since?: string;
  error?: string;
}

/** The LLM gateway's budget, when the gateway is one that reports it. */
export interface GatewayUsage {
  configured: boolean;
  model?: string | null;
  /** 'unknown': the gateway answers but shares no budget. */
  kind?: 'litellm' | 'openrouter' | 'unknown';
  /** US dollars. */
  spent?: number | null;
  limit?: number | null;
  resetAt?: string | null;
  /** OpenRouter names its reset period ("monthly") instead of a date. */
  resetPeriod?: string | null;
}

/** Never throws: a service that cannot answer comes back as null and its card says so. */
export const getCartesiaUsage = (): Promise<CartesiaUsage | null> =>
  apiGet<CartesiaUsage>('/usage/cartesia').catch(() => null);

export const getGatewayUsage = (): Promise<GatewayUsage | null> =>
  apiGet<GatewayUsage>('/usage/gateway').catch(() => null);
