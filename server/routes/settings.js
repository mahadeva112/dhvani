import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import {
  config,
  keySource,
  saveStoredKeys,
  serverSettings,
  STORED_FIELDS,
  CONFIG_FILE,
  translationSetup,
} from '../env.js';
import { getUser } from '../providers/elevenlabs/speech.js';
import { generateContent } from '../providers/gemini/client.js';
import { discoverGateway, listGatewayModels } from '../providers/llmGateway/client.js';
import { detectAll } from '../lib/detect.js';

export const settingsRouter = Router();

/**
 * Normalises the many shapes Node reports a loopback peer as: `127.0.0.1`,
 * `::1`, and the IPv4-mapped `::ffff:127.0.0.1`.
 */
const isLoopback = (req) => {
  const address = (req.socket?.remoteAddress || req.ip || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1' || address.startsWith('127.');
};

/**
 * Saving credentials is a local-machine affair only.
 *
 * DHVANI is built to be self-hosted by one person, but somebody will eventually
 * put it behind a reverse proxy. This makes sure that when they do, a stranger
 * cannot rewrite the operator's API keys.
 */
const requireLocalSetup = (req) => {
  if (!config.allowKeySetup) {
    throw new ApiError(
      'Saving API keys from the UI is disabled on this deployment. Set them with the ' +
        'ELEVENLABS_API_KEY and GEMINI_API_KEY environment variables instead.',
      { status: 403, code: 'key_setup_disabled' }
    );
  }

  if (!isLoopback(req)) {
    throw new ApiError(
      'API keys can only be changed from the machine running DHVANI. Set them with ' +
        'environment variables on the host instead.',
      { status: 403, code: 'remote_setup_forbidden' }
    );
  }
};

/**
 * GET /api/settings
 *
 * Reports where each key came from, never the key itself. `env` means it is
 * pinned by the environment and the UI must not offer to overwrite it.
 */
settingsRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const local = config.allowKeySetup && isLoopback(req);

    res.json({
      keys: keySource(),
      canSaveKeys: local,
      configFile: local ? CONFIG_FILE : null,
      version: config.version,
      // Where translation runs. The URL is shown so the setup screen can
      // confirm which gateway is active; the bearer key never leaves the server.
      translation: translationSetup(),
      /*
       * Endpoints and model names, sent in full because none of them is a
       * secret. The settings screen opens pre-filled with these, so what the
       * user edits is the configuration that is actually running.
       */
      server: serverSettings(),
    });
  })
);

/**
 * POST /api/settings/keys
 *
 * Validates each supplied key against its provider before saving, so a typo is
 * caught at setup time rather than on the user's first upload.
 */
settingsRouter.post(
  '/settings/keys',
  asyncHandler(async (req, res) => {
    requireLocalSetup(req);

    const {
      elevenLabsApiKey,
      elevenLabsBaseUrl,
      elevenLabsSttModel,
      elevenLabsTtsModel,
      geminiApiKey,
      geminiBaseUrl,
      geminiTranslationModels,
      geminiTtsModel,
      llmGatewayUrl,
      llmGatewayKey,
      llmGatewayProtocol,
      llmGatewayModels,
      validate = true,
    } = req.body || {};

    /*
     * Which provider each half of the form touched.
     *
     * An endpoint or model change is as much a reason to re-run the check as a
     * new key: the pair only works together, and a good key against a mistyped
     * host is exactly the failure this screen exists to catch.
     */
    const elevenLabsTouched = [
      elevenLabsApiKey,
      elevenLabsBaseUrl,
      elevenLabsSttModel,
      elevenLabsTtsModel,
    ].some((value) => value !== undefined);

    const geminiTouched = [
      geminiApiKey,
      geminiBaseUrl,
      geminiTranslationModels,
      geminiTtsModel,
    ].some((value) => value !== undefined);

    const gatewayTouched =
      llmGatewayUrl !== undefined ||
      llmGatewayKey !== undefined ||
      llmGatewayProtocol !== undefined ||
      llmGatewayModels !== undefined;

    if (!elevenLabsTouched && !geminiTouched && !gatewayTouched) {
      throw new ApiError('No settings were supplied.', { status: 400, code: 'no_keys' });
    }

    const results = { elevenLabs: null, gemini: null, gateway: null };

    /*
     * A blank key field means "keep the stored one", so checks run against the
     * effective credential. Probing with a literal empty key would report a
     * perfectly good saved key as broken the moment an endpoint was edited.
     */
    const effectiveElevenLabsKey = (elevenLabsApiKey || '').trim() || config.elevenlabs.apiKey || '';
    const effectiveGeminiKey = (geminiApiKey || '').trim() || config.gemini.apiKey || '';

    const candidateGeminiModels = (
      Array.isArray(geminiTranslationModels)
        ? geminiTranslationModels
        : String(geminiTranslationModels || '').split(',')
    )
      .map((model) => String(model).trim())
      .filter(Boolean);

    if (validate && elevenLabsTouched && effectiveElevenLabsKey) {
      try {
        const user = await getUser({
          apiKey: effectiveElevenLabsKey,
          baseUrl: elevenLabsBaseUrl,
        });
        results.elevenLabs = {
          valid: true,
          tier: user?.subscription?.tier || 'unknown',
          charactersRemaining:
            typeof user?.subscription?.character_limit === 'number'
              ? user.subscription.character_limit - (user.subscription.character_count || 0)
              : null,
        };
      } catch (err) {
        results.elevenLabs = { valid: false, error: err?.message || 'Validation failed.' };
      }
    }

    if (validate && geminiTouched && effectiveGeminiKey) {
      try {
        // Checking against the models being saved means an unreachable model
        // name is caught here rather than on the first translation.
        const { modelUsed } = await generateContent({
          contents: { role: 'user', parts: [{ text: 'Reply with the single word OK.' }] },
          generationConfig: { maxOutputTokens: 16 },
          apiKey: effectiveGeminiKey,
          baseUrl: geminiBaseUrl,
          models: candidateGeminiModels.length > 0 ? candidateGeminiModels : undefined,
          retriesPerModel: 0,
        });
        results.gemini = { valid: true, model: modelUsed };
      } catch (err) {
        results.gemini = { valid: false, error: err?.message || 'Validation failed.' };
      }
    }

    /*
     * A gateway is only usable as a whole, so the URL, key, protocol and model
     * list are validated together with one round-trip before any of them is
     * written.
     */
    const gatewayModels = Array.isArray(llmGatewayModels)
      ? llmGatewayModels
      : String(llmGatewayModels || '')
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean);

    /*
     * Discovery resolves the base URL the user pasted (with or without /v1),
     * picks a model if they did not name one, and confirms the gateway answers.
     * What gets saved is the resolved form, so the app never has to re-guess.
     */
    let resolvedGateway = null;
    if (gatewayTouched && llmGatewayUrl) {
      results.gateway = await discoverGateway({
        url: llmGatewayUrl,
        // A blank key field means "keep using the stored one", so validation
        // must not probe with an empty credential and then refuse the save.
        apiKey: (llmGatewayKey || '').trim() || config.llmGateway.apiKey || '',
        protocol: llmGatewayProtocol,
        model: gatewayModels[0],
      });
      resolvedGateway = results.gateway;
    }

    // Save only the values that are usable, so a bad paste cannot replace a
    // working credential that is already stored.
    const toSave = {};
    if (results.elevenLabs?.valid !== false) {
      // The endpoint and models go with the key: they were checked together, so
      // a half-written ElevenLabs setup can never be left behind.
      if (elevenLabsApiKey !== undefined) toSave.elevenLabsApiKey = elevenLabsApiKey;
      if (elevenLabsBaseUrl !== undefined) toSave.elevenLabsBaseUrl = elevenLabsBaseUrl;
      if (elevenLabsSttModel !== undefined) toSave.elevenLabsSttModel = elevenLabsSttModel;
      if (elevenLabsTtsModel !== undefined) toSave.elevenLabsTtsModel = elevenLabsTtsModel;
    }

    if (results.gemini?.valid !== false) {
      if (geminiApiKey !== undefined) toSave.geminiApiKey = geminiApiKey;
      if (geminiBaseUrl !== undefined) toSave.geminiBaseUrl = geminiBaseUrl;
      if (geminiTtsModel !== undefined) toSave.geminiTtsModel = geminiTtsModel;
      if (geminiTranslationModels !== undefined) {
        /*
         * Lead with the model that actually answered. The list is tried in
         * order, so promoting the working one means the next translation does
         * not spend a failed round-trip on a model this key cannot reach.
         */
        const working = results.gemini?.model;
        toSave.geminiTranslationModels =
          working && candidateGeminiModels.includes(working)
            ? [working, ...candidateGeminiModels.filter((model) => model !== working)]
            : candidateGeminiModels;
      }
    }
    if (gatewayTouched && results.gateway?.valid !== false) {
      // Save the resolved values so a bare host is stored with its /v1 path and
      // an auto-picked model is remembered.
      if (llmGatewayUrl !== undefined) {
        toSave.llmGatewayUrl = resolvedGateway?.url || llmGatewayUrl;
      }
      if (llmGatewayKey !== undefined) toSave.llmGatewayKey = llmGatewayKey;
      if (llmGatewayProtocol !== undefined) toSave.llmGatewayProtocol = llmGatewayProtocol;
      if (llmGatewayModels !== undefined || resolvedGateway?.model) {
        /*
         * Save the model that actually answered. When the key was not entitled
         * to the one the user named, discovery falls back to a permitted model —
         * saving the original would store a configuration known to fail.
         */
        toSave.llmGatewayModels = resolvedGateway?.model
          ? [resolvedGateway.model]
          : gatewayModels.length > 0
            ? gatewayModels
            : [];
      }
    }

    let keys = keySource();
    if (Object.keys(toSave).length > 0) {
      keys = await saveStoredKeys(toSave);
      logger.success(`Saved API key settings to ${CONFIG_FILE}`);
    }

    res.json({
      keys,
      validation: results,
      saved: Object.keys(toSave).length > 0,
      translation: translationSetup(),
      // Echo the resolved endpoints so the form re-syncs to what was stored —
      // a bare host comes back with its /v1 path, a cleared field with its default.
      server: serverSettings(),
    });
  })
);

/** DELETE /api/settings/keys — forgets the saved keys on this machine. */
settingsRouter.delete(
  '/settings/keys',
  asyncHandler(async (req, res) => {
    requireLocalSetup(req);
    /*
     * null is the explicit "forget this" signal. Clearing every field the
     * settings screen owns hands the app back to the environment and its
     * built-in defaults, which is what "start over" has to mean now that saved
     * values take precedence.
     */
    const keys = await saveStoredKeys(
      Object.fromEntries(STORED_FIELDS.map((field) => [field, null]))
    );
    logger.info('Cleared saved API keys, endpoints and gateway settings.');
    res.json({ keys, cleared: true, translation: translationSetup(), server: serverSettings() });
  })
);

/**
 * POST /api/settings/detect
 *
 * Checks every credential at once and reports each in the same vocabulary:
 * working, key rejected, wrong URL, model missing, rate limited, provider down,
 * unverified. Values in the body are checked without being saved, so the panel
 * can report on what is being typed.
 */
settingsRouter.post(
  '/settings/detect',
  asyncHandler(async (req, res) => {
    requireLocalSetup(req);
    res.json(await detectAll(req.body || {}));
  })
);

/** GET /api/settings/detect — the same check against what is saved. */
settingsRouter.get(
  '/settings/detect',
  asyncHandler(async (req, res) => {
    requireLocalSetup(req);
    res.json(await detectAll());
  })
);

/**
 * POST /api/settings/gateway/test
 *
 * Round-trips one tiny prompt against a candidate gateway without saving it,
 * so a URL or model name can be checked before it becomes the active config.
 */
settingsRouter.post(
  '/settings/gateway/test',
  asyncHandler(async (req, res) => {
    requireLocalSetup(req);

    const { url, apiKey, protocol, model } = req.body || {};
    if (!url) {
      throw new ApiError('A gateway URL is required to test the connection.', {
        status: 400,
        code: 'missing_gateway_url',
      });
    }

    /*
     * A blank key field means "use what is stored", not "no key".
     *
     * The settings form cannot show a saved secret, so its key box is empty
     * when reopened. Probing with a literal empty key made a perfectly good
     * saved gateway report as broken.
     */
    const effectiveKey = (apiKey || '').trim() || config.llmGateway.apiKey || '';

    const result = await discoverGateway({ url, apiKey: effectiveKey, protocol, model });
    res.json({
      availableModels: [],
      ...result,
      // Tells the UI the check used the stored credential, not a typed one.
      usedStoredKey: !((apiKey || '').trim()) && Boolean(effectiveKey),
    });
  })
);
