import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateContent, testGateway, listGatewayModels } from './client.js';

/**
 * Exercises the gateway client against a stub server that speaks both wire
 * formats, so the request shape and auth header are verified without needing a
 * real gateway.
 */

/** Starts a stub gateway and returns its base URL plus the requests it saw. */
const startStub = async (handler) => {
  const seen = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const entry = {
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      };
      seen.push(entry);
      handler(entry, res);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

test('OpenAI-compatible: sends a Bearer token and reads the message content', async () => {
  const stub = await startStub((req, res) =>
    json(res, 200, { choices: [{ message: { content: '{"translations":[]}' } }] })
  );

  try {
    const { response, modelUsed } = await generateContent({
      contents: { role: 'user', parts: [{ text: 'translate this' }] },
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
      gateway: { url: stub.url, apiKey: 'sk-test-key', protocol: 'openai', models: ['gemini-2.5-flash'] },
    });

    assert.equal(response.text, '{"translations":[]}');
    assert.equal(modelUsed, 'gemini-2.5-flash');

    const call = stub.seen[0];
    assert.equal(call.path, '/v1/chat/completions');
    assert.equal(call.headers.authorization, 'Bearer sk-test-key');
    assert.equal(call.body.model, 'gemini-2.5-flash');
    assert.equal(call.body.messages[0].content, 'translate this');
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
    assert.equal(call.body.temperature, 0.3);
  } finally {
    await stub.close();
  }
});

test('OpenAI-compatible: retries without JSON mode when the gateway rejects it', async () => {
  let call = 0;
  const stub = await startStub((req, res) => {
    call += 1;
    if (call === 1) {
      json(res, 400, { error: { message: 'response_format is not supported' } });
      return;
    }
    json(res, 200, { choices: [{ message: { content: 'plain text reply' } }] });
  });

  try {
    const { response } = await generateContent({
      contents: { role: 'user', parts: [{ text: 'hello' }] },
      generationConfig: { responseMimeType: 'application/json' },
      gateway: { url: stub.url, apiKey: 'sk-test', protocol: 'openai', models: ['m1'] },
    });

    assert.equal(response.text, 'plain text reply');
    assert.equal(stub.seen.length, 2);
    assert.ok(stub.seen[0].body.response_format, 'first attempt asks for JSON mode');
    assert.equal(stub.seen[1].body.response_format, undefined, 'retry drops it');
  } finally {
    await stub.close();
  }
});

test('Gemini REST: uses x-goog-api-key and the generateContent path', async () => {
  const stub = await startStub((req, res) =>
    json(res, 200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] })
  );

  try {
    const { response } = await generateContent({
      contents: { role: 'user', parts: [{ text: 'hi' }] },
      gateway: { url: stub.url, apiKey: 'proxy-key', protocol: 'gemini', models: ['gemini-2.5-flash'] },
    });

    assert.equal(response.text, 'ok');

    const call = stub.seen[0];
    assert.equal(call.path, '/v1/models/gemini-2.5-flash:generateContent');
    assert.equal(call.headers['x-goog-api-key'], 'proxy-key');
    assert.equal(call.headers.authorization, undefined, 'no Bearer header on this protocol');
    assert.equal(call.body.contents[0].parts[0].text, 'hi');
  } finally {
    await stub.close();
  }
});

test('falls through to the next model when one is unavailable', async () => {
  const stub = await startStub((req, res) => {
    if (req.body.model === 'missing-model') {
      json(res, 404, { error: { message: 'model not found' } });
      return;
    }
    json(res, 200, { choices: [{ message: { content: 'second model answered' } }] });
  });

  try {
    const { response, modelUsed } = await generateContent({
      contents: { role: 'user', parts: [{ text: 'x' }] },
      gateway: {
        url: stub.url,
        apiKey: 'sk-test',
        protocol: 'openai',
        models: ['missing-model', 'working-model'],
      },
    });

    assert.equal(modelUsed, 'working-model');
    assert.equal(response.text, 'second model answered');
  } finally {
    await stub.close();
  }
});

test('a rejected bearer key fails immediately instead of trying every model', async () => {
  const stub = await startStub((req, res) =>
    json(res, 401, { error: { message: 'invalid bearer token' } })
  );

  try {
    await assert.rejects(
      generateContent({
        contents: { role: 'user', parts: [{ text: 'x' }] },
        gateway: {
          url: stub.url,
          apiKey: 'sk-wrong',
          protocol: 'openai',
          models: ['a', 'b', 'c'],
        },
      }),
      /rejected this API key/
    );

    assert.equal(stub.seen.length, 1, 'stopped after the first rejection');
  } finally {
    await stub.close();
  }
});

test('audio is refused on an OpenAI-compatible gateway with an actionable message', async () => {
  await assert.rejects(
    generateContent({
      contents: {
        role: 'user',
        parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/mpeg' } }, { text: 'describe' }],
      },
      gateway: { url: 'http://127.0.0.1:1/v1', apiKey: 'sk-x', protocol: 'openai', models: ['m'] },
    }),
    /cannot carry.*GEMINI_API_KEY|GEMINI_API_KEY/s
  );
});

test('a missing URL is reported rather than attempted', async () => {
  await assert.rejects(
    generateContent({
      contents: { role: 'user', parts: [{ text: 'x' }] },
      gateway: { url: '', apiKey: 'sk-x', protocol: 'openai', models: ['m'] },
    }),
    /No LLM gateway URL is configured/
  );
});

test('a local gateway is attempted without a bearer token', async () => {
  const stub = await startStub((req, res) =>
    json(res, 200, { choices: [{ message: { content: 'no auth needed' } }] })
  );

  try {
    const { response } = await generateContent({
      contents: { role: 'user', parts: [{ text: 'x' }] },
      gateway: { url: stub.url, apiKey: '', protocol: 'openai', models: ['m'] },
    });

    assert.equal(response.text, 'no auth needed');
    assert.equal(stub.seen[0].headers.authorization, undefined, 'no Authorization header sent');
  } finally {
    await stub.close();
  }
});

test('a REMOTE gateway without a bearer token is refused before any request', async () => {
  await assert.rejects(
    generateContent({
      contents: { role: 'user', parts: [{ text: 'x' }] },
      gateway: {
        url: 'https://gateway.example.com/v1',
        apiKey: '',
        protocol: 'openai',
        models: ['m'],
      },
    }),
    /not on a local or private network/
  );
});

test('testGateway reports success with the model that answered', async () => {
  const stub = await startStub((req, res) =>
    json(res, 200, { choices: [{ message: { content: 'OK' } }] })
  );

  try {
    const result = await testGateway({
      url: stub.url,
      apiKey: 'sk-test',
      protocol: 'openai',
      model: 'gemini-2.5-flash',
    });

    assert.equal(result.valid, true);
    assert.equal(result.model, 'gemini-2.5-flash');
    assert.ok(typeof result.latencyMs === 'number');
  } finally {
    await stub.close();
  }
});

test('testGateway reports failure as data rather than throwing', async () => {
  const result = await testGateway({
    url: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-test',
    protocol: 'openai',
    model: 'm',
  });

  assert.equal(result.valid, false);
  assert.ok(result.error && result.error.length > 0);
});

test('listGatewayModels reads the OpenAI model list', async () => {
  const stub = await startStub((req, res) =>
    json(res, 200, { data: [{ id: 'gemini-2.5-flash' }, { id: 'gemini-2.0-flash' }] })
  );

  try {
    const models = await listGatewayModels({
      url: stub.url,
      apiKey: 'sk-test',
      protocol: 'openai',
    });

    assert.deepEqual(models, ['gemini-2.5-flash', 'gemini-2.0-flash']);
    assert.equal(stub.seen[0].path, '/v1/models');
  } finally {
    await stub.close();
  }
});
