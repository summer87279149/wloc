const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const scripts = Object.fromEntries(['wloc', 'wloc-settings', 'wloc-route'].map(name =>
  [name, fs.readFileSync(path.join(root, 'dist/control-center-1.1.1', name + '.js'), 'utf8')]));
function run(name, url, store = new Map(), response) {
  const results = [];
  const context = {
    $request: { url, method: 'GET', headers: {} },
    $environment: { 'surge-version': '5' },
    $argument: 'accuracy=25&mode=diagnostic&logLevel=info&worker=https%3A%2F%2Fwloc.app',
    $persistentStore: {
      read: key => store.get(key) ?? null,
      write: (value, key) => { value === null ? store.delete(key) : store.set(key, value); return true; }
    },
    $done: value => results.push(value),
    Uint8Array, ArrayBuffer, atob, console
  };
  if (response) context.$response = response;
  vm.runInNewContext(scripts[name], context, { timeout: 1000 });
  assert.equal(results.length, 1, 'exactly one $done call');
  return results[0];
}
function bridge(name, endpoint, store) {
  const result = run(name, 'https://gs-loc.apple.com/' + endpoint, store);
  assert.ok(result.response, 'http-request returns a synthetic response');
  return { status: result.response.status, ...JSON.parse(result.response.body) };
}
const settings = (endpoint, store) => bridge('wloc-settings', 'wloc-settings/' + endpoint, store);
const route = (endpoint, store) => bridge('wloc-route', 'wloc-route/' + endpoint, store);
function varint(value) {
  let n = BigInt(value); if (n < 0n) n += 1n << 64n;
  const bytes = [];
  while (n >= 128n) { bytes.push(Number(n & 127n) | 128); n >>= 7n; }
  return [...bytes, Number(n)];
}
const number = (tag, value) => [...varint(tag * 8), ...varint(value)];
const bytes = (tag, body) => [...varint(tag * 8 + 2), ...varint(body.length), ...body];
function fixture(lat, lon, accuracy) {
  const location = [...number(1, Math.round(lat * 1e8)), ...number(2, Math.round(lon * 1e8)), ...number(3, accuracy)];
  const wifi = [...bytes(1, [...Buffer.from('aa:bb:cc:dd:ee:ff')]), ...bytes(2, location)];
  const payload = bytes(2, wifi);
  return new Uint8Array([...Array(8).fill(0), payload.length >> 8, payload.length & 255, ...payload]);
}
const patch = (body, store) => run('wloc', 'https://gs-loc.apple.com/clls/wloc', store,
  { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body });

test('module declares three Surge scripts with binary mode, unlimited size and no default coordinates', () => {
  const module = fs.readFileSync(path.join(root, 'modules/wloc-control-center.sgmodule'), 'utf8');
  const lines = module.split('\n').filter(line => line.includes(' = type='));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line, /max-size=-1/);
    assert.doesNotMatch(line, /requires-body=[01]|latitude=|longitude=/);
    const pattern = line.match(/pattern=([^,]+)/)[1];
    const regex = new RegExp(pattern);
    const endpoint = line.includes('Status Bridge') ? 'wloc-settings/ping' : line.includes('Route Control') ? 'wloc-route/status' : 'clls/wloc';
    for (const domain of ['gs-loc.apple.com', 'gs-loc-cn.apple.com']) assert.ok(regex.test('https://' + domain + '/' + endpoint));
    assert.ok(!regex.test('https://example.com/' + endpoint));
    const script = line.match(/script-path=([^,]+)/)[1].split('/').at(-1);
    assert.ok(fs.existsSync(path.join(root, 'dist/control-center-1.1.1', script)));
  }
  assert.match(lines[1], /engine=webview/);
  assert.match(lines[2], /requires-body=true, binary-body-mode=true/);
});
test('settings and route pings identify Surge and the correct bridge', () => {
  assert.equal(settings('ping').tool, 'Surge');
  assert.equal(settings('ping').signature, 'wloc-control-center-device-bridge');
  assert.equal(route('ping').signature, 'wloc-control-center-route-bridge');
});
test('coordinates persist, status/export/diag read them, clear restores passthrough', () => {
  const store = new Map();
  assert.equal(settings('status', store).mode, 'passthrough');
  assert.equal(settings('save?lat=25.03&lon=121.56&accuracy=25', store).mode, 'active');
  assert.equal(settings('status', store).current.latitude, 25.03);
  for (const endpoint of ['export', 'diag']) assert.equal(settings(endpoint, store).settings.lon, 121.56);
  assert.equal(settings('clear', store).mode, 'passthrough');
});
test('invalid coordinates leave an existing coordinate untouched', () => {
  const store = new Map();
  settings('save?lat=25&lon=121', store);
  const before = store.get('wloc_settings');
  assert.equal(settings('save?lat=999&lon=121', store).status, 422);
  assert.equal(store.get('wloc_settings'), before);
});
test('route saves, starts, pauses, resumes, stops and clears', () => {
  const store = new Map();
  const payload = Buffer.from(JSON.stringify({ id: 'test', pts: [[25,121,0],[25.01,121.01,60]] })).toString('base64url');
  const saved = route('save?payload=' + payload, store);
  assert.equal(saved.ok, true, saved.error);
  for (const [action, state] of [['start','running'],['pause','paused'],['resume','running'],['stop','idle']]) {
    assert.equal(route(action, store).route.state, state);
    assert.equal(route('status', store).route.state, state);
  }
  assert.equal(route('clear', store).route, null);
});
test('no saved coordinate and cleared coordinate preserve binary body without a response wrapper', () => {
  const body = fixture(1, 2, 50);
  const store = new Map();
  assert.deepEqual(patch(body, store).body, body);
  settings('save?lat=25&lon=121', store);
  settings('clear', store);
  const result = patch(body, store);
  assert.equal(result.response, undefined);
  assert.deepEqual(result.body, body);
});
test('binary WLOC response contains new coordinates and direct Surge fields', () => {
  const store = new Map();
  settings('save?lat=-25&lon=121&accuracy=25', store);
  const result = patch(fixture(1, 2, 50), store);
  assert.equal(result.response, undefined);
  assert.deepEqual(Object.keys(result).sort(), ['body', 'headers', 'status']);
  assert.ok(result.body instanceof Uint8Array);
  assert.deepEqual(result.body, fixture(-25, 121, 25));
  assert.equal(result.headers['Content-Length'], String(result.body.length));
  assert.equal(JSON.parse(store.get('wloc_diag')).patchCount, 1);
});
test('malformed binary response passes through and records diagnostic error', () => {
  const store = new Map();
  settings('save?lat=25&lon=121', store);
  const body = new Uint8Array([255]);
  assert.deepEqual(patch(body, store).body, body);
  assert.match(JSON.parse(store.get('wloc_diag')).lastError, /no patchable/);
});
