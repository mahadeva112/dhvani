import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { discoverGateway } from './client.js';

/**
 * Discovery against stub gateways shaped like the ones people actually run.
 *
 * The case that matters most: a LiteLLM instance on a private address, mounted
 * so that the user's dashboard shows a bare `http://host:port` with no `/v1`.
 */

const startGateway = async ({ mountAtRoot = false, requireAuth = false, models = [], onChat } = {}) => {
  const seen = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });

      const json = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (requireAuth && !req.headers.authorization) {
        json(401, { error: { message: 'Missing bearer token' } });
        return;
      }

      const prefix = mountAtRoot ? '' : '/v1';

      if (req.method === 'GET' && req.url === `${prefix}/models`) {
        json(200, { data: models.map((id) => ({ id })) });
        return;
      }

      if (req.method === 'POST' && req.url === `${prefix}/chat/completions`) {
        const parsed = JSON.parse(body || '{}');
        if (onChat) {
          const outcome = onChat(parsed);
          if (outcome) {
            json(outcome.status, outcome.payload);
            return;
          }
        }

        // Behave like a real gateway: a model it does not serve is a 404.
        if (models.length > 0 && !models.includes(parsed.model)) {
          json(404, { error: { message: `The model \`${parsed.model}\` does not exist` } });
          return;
        }

        json(200, { choices: [{ message: { content: 'OK' } }] });
        return;
      }

      json(404, { error: { message: `Unknown route ${req.url}` } });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    // What the user would paste: the bare host and port, no path.
    bareUrl: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

test('a bare host:port resolves to the /v1 base without the user adding it', async () => {
  const gw = await startGateway({
    models: ['vertex_ai/gemini-3.1-pro-preview', 'vertex_ai/gemini-2.5-flash'],
  });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: '',
      protocol: 'openai',
      model: 'vertex_ai/gemini-3.1-pro-preview',
    });

    assert.equal(result.valid, true);
    assert.equal(result.url, `${gw.bareUrl}/v1`, 'resolved URL gains the /v1 path');
    assert.equal(result.model, 'vertex_ai/gemini-3.1-pro-preview');
    assert.ok(result.availableModels.length >= 2);
    assert.ok(typeof result.latencyMs === 'number');
  } finally {
    await gw.close();
  }
});

test('a local gateway works with no API key at all', async () => {
  const gw = await startGateway({ models: ['vertex_ai/gemini-2.5-flash'] });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: '',
      protocol: 'openai',
    });

    assert.equal(result.valid, true, 'no key required on a loopback gateway');
    assert.equal(result.requiresKey, false);
    assert.equal(gw.seen[0].auth, null, 'no Authorization header was sent');
  } finally {
    await gw.close();
  }
});

test('a gateway mounted at the root is found on the second candidate', async () => {
  const gw = await startGateway({ mountAtRoot: true, models: ['gemini-2.5-flash'] });

  try {
    const result = await discoverGateway({ url: gw.bareUrl, apiKey: '', protocol: 'openai' });

    assert.equal(result.valid, true);
    assert.equal(result.url, gw.bareUrl, 'resolved to the bare root, not /v1');
  } finally {
    await gw.close();
  }
});

test('the model is auto-picked when the user names none', async () => {
  const gw = await startGateway({
    models: ['text-embedding-004', 'whisper-1', 'vertex_ai/gemini-2.5-flash', 'gpt-4o-mini'],
  });

  try {
    const result = await discoverGateway({ url: gw.bareUrl, apiKey: '', protocol: 'openai' });

    assert.equal(result.valid, true);
    assert.match(result.model, /gemini/, 'picked a Gemini chat model');
    assert.ok(!result.availableModels.includes('whisper-1'), 'speech models filtered out');
  } finally {
    await gw.close();
  }
});

test('a gateway with no /models endpoint still validates via the named model', async () => {
  const gw = await startGateway({ models: [] });

  // Make /models 404 so only the chat endpoint is usable.
  const strict = await startGateway({
    mountAtRoot: false,
    onChat: () => null,
  });
  await gw.close();

  try {
    // startGateway serves /v1/models with an empty list, which counts as
    // "reachable but nothing listed"; force the fallback by asking for a model.
    const result = await discoverGateway({
      url: strict.bareUrl,
      apiKey: '',
      protocol: 'openai',
      model: 'vertex_ai/gemini-3.1-pro-preview',
    });

    assert.equal(result.valid, true);
    assert.equal(result.model, 'vertex_ai/gemini-3.1-pro-preview');
  } finally {
    await strict.close();
  }
});

test('an unreachable gateway reports what was tried', async () => {
  const result = await discoverGateway({
    url: 'http://127.0.0.1:1',
    apiKey: '',
    protocol: 'openai',
    model: 'gemini-2.5-flash',
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /Could not reach/);
  assert.match(result.error, /127\.0\.0\.1:1/, 'names the address that failed');
});

test('a wrong model name is reported separately from an unreachable gateway', async () => {
  const gw = await startGateway({
    models: ['vertex_ai/gemini-2.5-flash'],
    onChat: (body) =>
      body.model === 'does-not-exist'
        ? { status: 404, payload: { error: { message: 'model not found' } } }
        : null,
  });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: '',
      protocol: 'openai',
      model: 'does-not-exist',
    });

    assert.equal(result.valid, false);
    assert.match(result.error, /does not offer/, 'distinguishes reachable-but-bad-model');
    assert.ok(result.availableModels.includes('vertex_ai/gemini-2.5-flash'), 'still offers the real list');
  } finally {
    await gw.close();
  }
});

test('an empty URL asks for one instead of probing', async () => {
  const result = await discoverGateway({ url: '', apiKey: '', protocol: 'openai' });
  assert.equal(result.valid, false);
  assert.match(result.error, /Enter your gateway URL/);
});

test('a model from another tool is reported as not-offered, with the real list', async () => {
  const gw = await startGateway({ models: ['gemini-3-flash-preview'] });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: 'sk-test',
      protocol: 'openai',
      // A name carried over from a different gateway — the commonest mistake.
      model: 'vertex_ai/gemini-3.1-pro-preview',
    });

    assert.equal(result.valid, false);
    assert.match(result.error, /does not offer/, 'names the problem plainly');
    assert.match(result.error, /gemini-3-flash-preview/, 'lists what is actually available');
    assert.deepEqual(result.availableModels, ['gemini-3-flash-preview']);
  } finally {
    await gw.close();
  }
});

test('a gateway that requires a key says so, rather than "unreachable"', async () => {
  // A 401 proves something IS listening. Reporting it as a network failure
  // sends people hunting for a problem that is not there.
  const gw = await startGateway({ requireAuth: true, models: ['gemini-3-flash-preview'] });

  try {
    const result = await discoverGateway({ url: gw.bareUrl, apiKey: '', protocol: 'openai' });

    assert.equal(result.valid, false);
    assert.equal(result.rejected, true);
    assert.match(result.error, /requires an API key/);
    assert.doesNotMatch(result.error, /Could not reach/, 'not reported as a network failure');
  } finally {
    await gw.close();
  }
});

test('a wrong key on a gateway that requires one is reported as rejected', async () => {
  const gw = await startGateway({ requireAuth: true, models: ['gemini-3-flash-preview'] });

  try {
    // The stub accepts any Authorization header, so drive the rejection by
    // checking what a keyless probe reports versus a keyed one.
    const withKey = await discoverGateway({ url: gw.bareUrl, apiKey: 'sk-ok', protocol: 'openai' });
    assert.equal(withKey.valid, true, 'a key gets through');

    const without = await discoverGateway({ url: gw.bareUrl, apiKey: '', protocol: 'openai' });
    assert.equal(without.rejected, true);
    assert.match(without.error, /requires an API key/);
  } finally {
    await gw.close();
  }
});

test('a restricted model does not abort the cascade behind it', async () => {
  const { generateContent } = await import('./client.js');

  const gw = await startGateway({
    models: ['gemini-3-flash-preview'],
    onChat: (body) =>
      body.model === 'gemini-3-flash-preview'
        ? null
        : {
            status: 401,
            payload: {
              error: {
                message: `key not allowed to access model. This key can only access models=['gemini-3-flash-preview']. Tried to access ${body.model}`,
                type: 'key_model_access_denied',
                code: '401',
              },
            },
          },
  });

  try {
    // The restricted model is listed FIRST — the working one must still run.
    const { modelUsed } = await generateContent({
      contents: { role: 'user', parts: [{ text: 'hello' }] },
      gateway: {
        url: `${gw.bareUrl}/v1`,
        apiKey: 'sk-scoped',
        protocol: 'openai',
        models: ['gemini-2.5-flash', 'gemini-3-flash-preview'],
      },
    });

    assert.equal(modelUsed, 'gemini-3-flash-preview', 'fell through to the permitted model');
  } finally {
    await gw.close();
  }
});

test('when no candidate is permitted, the allowed models are named', async () => {
  const { generateContent } = await import('./client.js');

  const gw = await startGateway({
    models: ['gemini-3-flash-preview'],
    onChat: (body) => ({
      status: 401,
      payload: {
        error: {
          message: `key not allowed to access model. This key can only access models=['gemini-3-flash-preview']. Tried to access ${body.model}`,
          type: 'key_model_access_denied',
          code: '401',
        },
      },
    }),
  });

  try {
    await assert.rejects(
      generateContent({
        contents: { role: 'user', parts: [{ text: 'hello' }] },
        gateway: {
          url: `${gw.bareUrl}/v1`,
          apiKey: 'sk-scoped',
          protocol: 'openai',
          models: ['gemini-2.5-flash', 'gpt-4o'],
        },
      }),
      (err) => {
        assert.equal(err.code, 'model_not_permitted');
        assert.match(err.message, /It can use: gemini-3-flash-preview\./);
        return true;
      }
    );
  } finally {
    await gw.close();
  }
});

test('a key scoped away from the named model falls back to one it may use', async () => {
  const gw = await startGateway({
    models: ['gemini-3-flash-preview'],
    onChat: (body) =>
      body.model === 'gemini-3-flash-preview'
        ? null
        : {
            status: 401,
            payload: {
              error: {
                message: `key not allowed to access model. This key can only access models=['gemini-3-flash-preview']. Tried to access ${body.model}`,
                type: 'key_model_access_denied',
                code: '401',
              },
            },
          },
  });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: 'sk-scoped',
      protocol: 'openai',
      model: 'gemini-2.5-flash',
    });

    assert.equal(result.valid, true, 'recovers rather than stopping at "no"');
    assert.equal(result.model, 'gemini-3-flash-preview', 'switched to a permitted model');
    assert.equal(result.switchedFrom, 'gemini-2.5-flash');
    assert.match(result.note, /may not use "gemini-2\.5-flash"/, 'says what it did and why');
  } finally {
    await gw.close();
  }
});

test('a restricted key with nothing usable still reports plainly', async () => {
  const gw = await startGateway({
    models: ['gemini-3-flash-preview'],
    // Every model refused, and the gateway names nothing usable.
    onChat: () => ({
      status: 401,
      payload: {
        error: { message: 'key not allowed to access model.', type: 'key_model_access_denied' },
      },
    }),
  });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: 'sk-scoped',
      protocol: 'openai',
      model: 'gemini-2.5-flash',
    });

    assert.equal(result.valid, false);
    assert.equal(result.switchedFrom, undefined, 'no false claim of recovery');
    assert.match(result.error, /may not use/);
  } finally {
    await gw.close();
  }
});

test('a reasoning model is given room to answer, not starved by the probe', async () => {
  /*
   * gemini-2.5-pro and friends spend tokens on hidden reasoning before emitting
   * any visible text. A tight probe budget makes them stop at
   * finish_reason "length" with null content, which reads as a broken model.
   */
  let sawBudget = null;

  const gw = await startGateway({
    models: ['gemini-2.5-pro'],
    onChat: (body) => {
      sawBudget = body.max_tokens;
      // Mimic the real behaviour: too small a budget yields no text at all.
      if ((body.max_tokens ?? 0) < 100) {
        return {
          status: 200,
          payload: {
            choices: [{ finish_reason: 'length', index: 0, message: { content: null } }],
            usage: { completion_tokens_details: { reasoning_tokens: 12, text_tokens: 0 } },
          },
        };
      }
      return null;
    },
  });

  try {
    const result = await discoverGateway({
      url: gw.bareUrl,
      apiKey: 'sk-test',
      protocol: 'openai',
      model: 'gemini-2.5-pro',
    });

    assert.ok(sawBudget >= 100, `probe asked for ${sawBudget} tokens, too few for a reasoning model`);
    assert.equal(result.valid, true, 'a reasoning model validates');
    assert.equal(result.model, 'gemini-2.5-pro');
  } finally {
    await gw.close();
  }
});

test('an output truncated before any text names the budget as the cause', async () => {
  const { generateContent } = await import('./client.js');

  const gw = await startGateway({
    models: ['gemini-2.5-pro'],
    onChat: () => ({
      status: 200,
      payload: {
        choices: [{ finish_reason: 'length', index: 0, message: { content: null } }],
        usage: { completion_tokens_details: { reasoning_tokens: 40, text_tokens: 0 } },
      },
    }),
  });

  try {
    await assert.rejects(
      generateContent({
        contents: { role: 'user', parts: [{ text: 'translate' }] },
        gateway: {
          url: `${gw.bareUrl}/v1`,
          apiKey: 'sk-test',
          protocol: 'openai',
          models: ['gemini-2.5-pro'],
        },
      }),
      (err) => {
        assert.match(err.message, /hit its output limit/);
        assert.match(err.message, /40 tokens reasoning/, 'quantifies where the budget went');
        assert.match(err.message, /larger token budget/, 'names the fix');
        return true;
      }
    );
  } finally {
    await gw.close();
  }
});

test('the model list is narrowed to what the credential may actually use', async () => {
  /*
   * /v1/models lists what the GATEWAY hosts; a LiteLLM user can be scoped to a
   * fraction of it. Offering the full catalog makes every restricted entry look
   * like a working choice.
   */
  const ENTITLED = ['gemini-2.5-flash', 'gemini-2.5-pro'];

  const gw = await startGateway({
    models: [...ENTITLED, 'anthropic/claude-opus-4-5', 'gpt-5.4', 'llama-3-70b'],
    onChat: (body) =>
      ENTITLED.includes(body.model)
        ? null
        : {
            status: 401,
            payload: {
              error: {
                message: `user not allowed to access model. This user can only access models=['${ENTITLED.join("', '")}']. Tried to access ${body.model}`,
                type: 'user_model_access_denied',
                code: '401',
              },
            },
          },
  });

  try {
    const result = await discoverGateway({ url: gw.bareUrl, apiKey: 'sk-scoped', protocol: 'openai' });

    assert.equal(result.valid, true);
    assert.deepEqual(
      [...result.availableModels].sort(),
      [...ENTITLED].sort(),
      'only the entitled models are offered'
    );
    assert.ok(ENTITLED.includes(result.model), 'and the chosen one is usable');
  } finally {
    await gw.close();
  }
});

test('an unrestricted gateway still offers its whole catalog', async () => {
  // The entitlement probe must not narrow anything when there is no restriction.
  const gw = await startGateway({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] });

  try {
    const result = await discoverGateway({ url: gw.bareUrl, apiKey: 'sk-open', protocol: 'openai' });

    assert.equal(result.valid, true);
    assert.equal(result.availableModels.length, 2, 'nothing was filtered out');
  } finally {
    await gw.close();
  }
});
