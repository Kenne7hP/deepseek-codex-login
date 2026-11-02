'use strict';

// Run with the installed Harness Electron executable in ELECTRON_RUN_AS_NODE mode.
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { homedir } = require('node:os');

const runtime = path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai');
const load = name => require(path.join(runtime, name, 'lib', 'index.js'));
const { Context } = load('cordis');
const { LocalCredentialProvider } = load('dsh-credentials-local');
const { AuthorizationService } = load('dsh-authorization');
const { LlmRuntime } = load('dsh-llm');
const pi = load('dsh-llm-pi-ai');
const provider = 'openai-codex';
const key = pi.recordKeyFor(provider);
const home = process.env.DSH_HOME || path.join(homedir(), '.dsh');
const ctx = new Context();
const args = new Set(process.argv.slice(2));
let server;
let controller;
let expiry;

async function close() {
  clearTimeout(expiry);
  controller?.abort();
  server?.close();
  server?.closeAllConnections();
  await ctx.fiber.dispose();
}

function safeFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'AUTH_FAILED';
  const status = String(error?.message || '').match(/(?:status|failed\s*\()\s*(\d{3})/i)?.[1];
  return `Authentication failed: ${code}${status ? ` (HTTP ${status})` : ''}. No API-key fallback was attempted.`;
}

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Harness Codex subscription login</title>
<style>body{font:17px system-ui;max-width:720px;margin:60px auto;padding:0 24px;line-height:1.7;background:#f5f7fa;color:#182334}button,a{font:inherit}button{padding:10px 18px;cursor:pointer}section{background:white;padding:24px;border-radius:12px}#notice{white-space:pre-wrap}a{overflow-wrap:anywhere}input{box-sizing:border-box;width:100%;padding:10px}small{color:#536273}</style>
<section><h1>Harness · Codex subscription</h1><p>复用 Harness 内置登录流程。请在 OpenAI 官方网页亲自登录并授权。无需填写接口密钥。</p><p>此页仅在本机运行；凭据由 Harness 写入自身的本地凭据库。</p><button id="start">开始浏览器授权</button><p id="status">Ready</p><p id="notice"></p><p><a id="auth" hidden target="_blank" rel="noreferrer noopener">打开 OpenAI 官方登录页面</a></p><form id="prompt" hidden><label id="label" for="answer"></label><input id="answer" autocomplete="off" type="password"><button>提交到本机登录流程</button></form><small>授权后不要把验证码或回调地址发到聊天。窗口可在完成后关闭；本地辅助服务会自动退出。</small></section>
<script>
let promptId;const byId=id=>document.getElementById(id);
async function post(route,body){const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Local request failed: '+r.status);return r.json()}
byId('start').onclick=async()=>{byId('start').disabled=true;try{await post('/start',{})}catch(e){byId('status').textContent=e.message}};
byId('prompt').onsubmit=async e=>{e.preventDefault();await post('/answer',{id:promptId,value:byId('answer').value});byId('answer').value='';byId('prompt').hidden=true};
async function poll(){try{const r=await fetch('/state',{cache:'no-store'});if(!r.ok)throw Error('Local state unavailable');const s=await r.json();byId('status').textContent=s.status;byId('notice').textContent=s.message||'';byId('auth').hidden=!s.url;if(s.url)byId('auth').href=s.url;byId('start').disabled=s.status!=='Ready';byId('prompt').hidden=!s.prompt;if(s.prompt){promptId=s.prompt.id;byId('label').textContent=s.prompt.message}if(s.status==='Authorized')return}catch(e){byId('status').textContent='Local helper stopped. Check Harness login status.';return}setTimeout(poll,1000)}poll();
</script></html>`;

async function main() {
  if (args.size > 1 || [...args].some(a => !['--dry-run', '--status'].includes(a))) throw Error('Use no argument, --dry-run, or --status.');
  await ctx.plugin(LocalCredentialProvider, { dshHome: home, watch: false }).await();
  await ctx.plugin(AuthorizationService).await();
  await ctx.plugin(LlmRuntime).await();
  await ctx.plugin(pi, { providers: { [provider]: {} } }).await();
  const flow = ctx.authorization.describe(key);
  if (!flow?.methods.some(m => m.id === 'oauth')) throw Error('Installed Harness does not expose the Codex OAuth flow.');
  const status = await ctx.credentials.describeRecord(key);
  if (args.has('--dry-run') || args.has('--status')) {
    console.log(JSON.stringify({ provider, flowRegistered: true, oauthAvailable: true, credentialConfigured: status.configured, credentialKind: status.kind || null, credentialHome: home }));
    await close();
    return;
  }
  if (status.configured) {
    console.log('Codex credential already exists; refusing to replace it. Use --status.');
    await close();
    return;
  }
  const session = crypto.randomBytes(32).toString('hex');
  const state = { status: 'Ready', message: '' };
  let pending;
  let origin;
  async function start() {
    controller = new AbortController();
    state.status = 'Signing in';
    try {
      const result = await ctx.authorization.begin({ key, method: 'oauth', signal: controller.signal, interaction: {
        notify(notice) {
          state.message = notice.message || '';
          if (notice.url) {
            const url = new URL(notice.url);
            if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com') throw Error('Unexpected authorization host.');
            state.url = url.href;
          }
        },
        prompt(question) {
          if (question.kind === 'select') {
            if (!question.options.some(o => o.id === 'browser')) throw Error('Browser login is unavailable.');
            return Promise.resolve('browser');
          }
          return new Promise((resolve, reject) => {
            const id = crypto.randomBytes(12).toString('hex');
            const signal = question.signal || controller.signal;
            const onAbort = () => { if (pending?.id === id) { pending = undefined; delete state.prompt; } reject(Error('Login prompt ended.')); };
            signal.addEventListener('abort', onAbort, { once: true });
            pending = { id, resolve(value) { signal.removeEventListener('abort', onAbort); resolve(value); } };
            state.prompt = { id, message: question.message };
          });
        }
      }});
      const stored = await ctx.credentials.describeRecord(key);
      if (result.status !== 'authorized' || !stored.configured || stored.kind !== 'grant') throw Error('Subscription credential was not committed.');
      state.status = 'Authorized';
      state.message = '授权已保存到 Harness。请在新会话中选择 Codex 模型完成实际请求验证。';
      console.log('AUTHORIZED: Harness stored the Codex subscription grant. Inference is not yet verified.');
      clearTimeout(expiry);
      expiry = setTimeout(() => close(), 60_000);
    } catch (error) {
      state.status = 'Failed';
      state.message = safeFailure(error);
      console.log(state.message);
    } finally {
      delete state.url;
      delete state.prompt;
      pending = undefined;
    }
  }
  server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Host rejected' });
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('Set-Cookie', `harnessLogin=${session}; HttpOnly; SameSite=Strict; Path=/`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page);
    }
    if (!(req.headers.cookie || '').split(';').some(c => c.trim() === `harnessLogin=${session}`)) return send(403, { error: 'Local session required' });
    if (req.method === 'GET' && req.url === '/state') return send(200, state);
    if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Request rejected' });
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16_384) return send(413, { error: 'Request too large' }); }
      const input = JSON.parse(body);
      if (req.url === '/start' && state.status === 'Ready') { send(202, { started: true }); void start(); return; }
      if (req.url === '/answer' && pending && input.id === pending.id && typeof input.value === 'string') {
        const waiting = pending; pending = undefined; delete state.prompt; waiting.resolve(input.value); return send(200, { accepted: true });
      }
      return send(409, { error: 'No matching action' });
    } catch { return send(400, { error: 'Invalid local request' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`LOCAL_LOGIN_PAGE=${origin}/`);
  expiry = setTimeout(() => close(), 15 * 60_000);
}

process.once('SIGINT', () => close());
main().catch(async error => { console.error(safeFailure(error)); process.exitCode = 1; await close(); });
