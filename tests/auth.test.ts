import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticationConfigurationErrors,
  createOAuthFlow,
  googleAuthorizationUrl,
  oauthCookieName,
  oauthCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
  verifyOAuthFlow,
} from "../lib/server/auth";

function configure() {
  process.env.PUNTOS_BASE_URL = "https://puntos-docentes.unrc.edu.ar";
  process.env.PUNTOS_GOOGLE_CLIENT_ID = "cliente-prueba.apps.googleusercontent.com";
  process.env.PUNTOS_GOOGLE_CLIENT_SECRET = "secreto-cliente-prueba";
  process.env.PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT = "*";
  process.env.PUNTOS_AUTH_SECRET =
    "secreto-de-autenticacion-de-prueba-con-mas-de-sesenta-y-cuatro-caracteres-aleatorios";
  process.env.PUNTOS_COOKIE_SECURE = "true";
}

function clearConfiguration() {
  delete process.env.PUNTOS_BASE_URL;
  delete process.env.PUNTOS_GOOGLE_CLIENT_ID;
  delete process.env.PUNTOS_GOOGLE_CLIENT_SECRET;
  delete process.env.PUNTOS_GOOGLE_HOSTED_DOMAIN_HINT;
  delete process.env.PUNTOS_AUTH_SECRET;
  delete process.env.PUNTOS_COOKIE_SECURE;
}

test("rechaza una configuración institucional incompleta", () => {
  clearConfiguration();
  assert.ok(authenticationConfigurationErrors().length >= 4);
});

test("rechaza marcadores sin reemplazar y una URL pública con ruta", () => {
  configure();
  process.env.PUNTOS_BASE_URL = "https://puntos-docentes.unrc.edu.ar/aplicacion";
  process.env.PUNTOS_GOOGLE_CLIENT_SECRET = "REEMPLAZAR";
  assert.ok(authenticationConfigurationErrors().length >= 2);
  clearConfiguration();
});

test("crea un flujo Google firmado con state, nonce y PKCE", () => {
  configure();
  const now = Date.parse("2026-08-12T12:00:00.000Z");
  const flow = createOAuthFlow("login", "/admin/usuarios", now);
  const verified = verifyOAuthFlow(flow.cookieToken, flow.state, now + 1000);

  assert.equal(verified?.payload.returnTo, "/admin/usuarios");
  assert.equal(verified?.nonce, flow.nonce);
  assert.equal(verified?.codeVerifier, flow.codeVerifier);
  assert.equal(flow.codeVerifier.length, 43);
  assert.equal(flow.codeChallenge.length, 43);
  assert.equal(verifyOAuthFlow(`${flow.cookieToken}alterado`, flow.state, now + 1000), undefined);
  assert.equal(verifyOAuthFlow(flow.cookieToken, `${flow.state}alterado`, now + 1000), undefined);
  assert.equal(verifyOAuthFlow(flow.cookieToken, flow.state, now + 11 * 60 * 1000), undefined);
  clearConfiguration();
});

test("genera una autorización limitada al dominio institucional", () => {
  configure();
  const flow = createOAuthFlow();
  const url = new URL(googleAuthorizationUrl(flow));

  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("hd"), "*");
  assert.equal(url.searchParams.get("state"), flow.state);
  assert.equal(url.searchParams.get("nonce"), flow.nonce);
  assert.equal(url.searchParams.get("code_challenge"), flow.codeChallenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("scope") || "", /openid/);
  clearConfiguration();
});

test("usa cookies host-only seguras con atributos diferentes para sesión y OAuth", () => {
  configure();
  assert.equal(sessionCookieName(), "__Host-puntos_session");
  assert.equal(oauthCookieName(), "__Host-puntos_oauth");
  assert.equal(sessionCookieOptions().httpOnly, true);
  assert.equal(sessionCookieOptions().secure, true);
  assert.equal(sessionCookieOptions().sameSite, "strict");
  assert.equal(oauthCookieOptions().sameSite, "lax");
  clearConfiguration();
});
