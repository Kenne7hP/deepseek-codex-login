# DeepSeek Harness Codex Login Helper

A small Windows helper that exposes the Codex subscription sign-in flow already bundled with DeepSeek Harness. It uses the installed runtime and credential service; it does not patch Harness, copy Codex tokens, install dependencies, or proxy model requests.

Unofficial community utility, not affiliated with DeepSeek or OpenAI. Tested with DeepSeek Harness **0.2.1-rc.5** on Windows. It depends on internal interfaces, so compatibility with other builds is not guaranteed.

## Requirements

- DeepSeek Harness installed at `%LOCALAPPDATA%\Programs\DeepSeek Harness`.
- PowerShell and a browser. A separate Node.js installation is not required.
- An OpenAI account eligible for Codex subscription access. This helper does not grant access or bypass subscription limits.

## Usage

Download this repository and open PowerShell in its folder. Check compatibility first:

```powershell
.\scripts\2026-11-02-codex-login-launcher.ps1 -Mode DryRun
```

Expected fields include `flowRegistered: true` and `oauthAvailable: true`. This command makes no authentication requests and does not write or refresh credentials. If it fails, stop; do not substitute an API key.

Start the helper:

```powershell
.\scripts\2026-11-02-codex-login-launcher.ps1 -Mode Login
```

1. Open the printed `LOCAL_LOGIN_PAGE` address in your browser. The port is assigned at launch.
2. Click **开始浏览器授权** and then **打开 OpenAI 官方登录页面**.
3. Complete sign-in and authorization yourself on `auth.openai.com`.
4. Wait for **Authorized** on the local helper page.
5. In Harness, open model settings, add the built-in provider **`openai-codex`** under third-party providers, and save without entering an API key. If it already exists, keep it.
6. Select a model from that provider in a new conversation and verify a short, non-sensitive request.

The built-in provider may be labeled **OpenAI Codex (legacy)** or identified by **`openai-codex`**. The tested build's model-settings page does not expose a generic subscription-login button; that is the gap this helper fills.

Check stored authorization later:

```powershell
.\scripts\2026-11-02-codex-login-launcher.ps1 -Mode Status
```

`credentialConfigured: true` with `credentialKind: "grant"` confirms a stored subscription grant. Only a successful model request verifies actual model access. The helper refuses to replace an existing credential.

## 中文说明

此工具补足 Harness 内置 Codex 订阅认证流程的登录入口。先运行 `DryRun` 检查兼容性，再运行 `Login` 打开输出的本机地址，点击授权按钮并在 OpenAI 官方页面亲自完成登录。显示 `Authorized` 后，在 Harness 中添加或选用 `openai-codex`，用无敏感信息的短问题验证。

无需填写接口密钥，也不会读取 Codex 的登录文件。如果浏览器无法自动回到本机，辅助页可能提供手动输入回调地址的栏位；仅填入你自己的本机辅助页，不要把地址或验证码发到聊天、问题单或日志中。

## Credential handling

- Calls the installed Harness `authorization.begin` with `recordKeyFor('openai-codex')` and method `oauth` (Open Authorization).
- Uses the bundled pi-ai flow for login, callback validation and token exchange. Credentials are stored through Harness's existing locked, atomic writer in `%USERPROFILE%\.dsh\.credentials.yaml`, or under `DSH_HOME` when set.
- Preserves other credential records and provider settings. Never accesses Codex `auth.json`. There is no API-key fallback.
- Serves the temporary page on `127.0.0.1` only, with same-site session cookies, exact Origin checks for mutations and no-store response headers. Authorization links and prompt answers are kept in memory, not written to project files.
- Stops after 15 minutes, or 60 seconds after successful authorization. Raw authentication error bodies are not logged because they may contain secrets.

Do not upload credential files, authorization codes, callback URLs, or output containing local personal paths. If the helper reports `Failed`, do not share secrets while troubleshooting. If PowerShell blocks the script, review your local policy; this project does not change execution policy or other system protections.

## Verification and limitations

The tested build passed real-runtime flow discovery, dry-run credential-file invariance, local HTTP access checks, stored-grant verification, and a user's successful model request in Harness. Continued conversation, tool use, persistence after restarting Harness, and later automatic token refresh were not independently verified.

Run `DryRun` again after updating Harness. Restart the helper for a new attempt after failure or timeout. Missing runtime packages or changed interfaces require a compatibility update; installing this project does not update Harness itself. No third-party runtime code or credentials are distributed here.
