import assert from "node:assert/strict";
import test from "node:test";
import {
  publishPdfBlob,
  reservePdfWindow,
  type PdfBrowser,
  type PdfEnvironment,
  type PdfPopup,
} from "../lib/client/pdf-window";

function popupFixture() {
  let navigatedTo = "";
  const popup: PdfPopup = {
    closed: false,
    opener: "original",
    document: {
      title: "",
      body: {
        style: { margin: "", padding: "", fontFamily: "", color: "" },
        textContent: null,
      },
    },
    location: { replace: (url) => { navigatedTo = url; } },
  };
  return { popup, navigatedTo: () => navigatedTo };
}

test("reserva la pestaña antes de generar el PDF y prepara un estado transitorio", () => {
  const fixture = popupFixture();
  const calls: string[] = [];
  const browser: PdfBrowser = {
    open: (url, target) => {
      calls.push(`${url}|${target}`);
      return fixture.popup;
    },
    setTimeout: () => 1,
  };

  const result = reservePdfWindow(browser);

  assert.equal(result, fixture.popup);
  assert.deepEqual(calls, ["about:blank|_blank"]);
  assert.equal(fixture.popup.opener, null);
  assert.equal(fixture.popup.document.title, "Generando informe PDF…");
  assert.equal(fixture.popup.document.body.textContent, "Generando informe PDF…");
});

test("publica en la pestaña reservada sin mostrar alertas", () => {
  const fixture = popupFixture();
  let downloadClicks = 0;
  let releaseDelay = 0;
  const environment: PdfEnvironment = {
    browser: {
      open: () => fixture.popup,
      setTimeout: (_callback, delay) => { releaseDelay = delay; return 1; },
    },
    document: {
      createElement: () => ({
        href: "",
        download: "",
        style: { display: "" },
        click: () => { downloadClicks += 1; },
        remove: () => undefined,
      }),
      body: { appendChild: () => undefined },
    },
    url: {
      createObjectURL: () => "blob:informe",
      revokeObjectURL: () => undefined,
    },
  };

  const result = publishPdfBlob(new Blob(["pdf"]), fixture.popup, "informe.pdf", environment);

  assert.equal(result, "tab");
  assert.equal(fixture.navigatedTo(), "blob:informe");
  assert.equal(downloadClicks, 0);
  assert.equal(releaseDelay, 120_000);
});

test("descarga el PDF silenciosamente si el navegador bloquea la pestaña", () => {
  let appended = false;
  let clicked = false;
  let removed = false;
  const link = {
    href: "",
    download: "",
    style: { display: "" },
    click: () => { clicked = true; },
    remove: () => { removed = true; },
  };
  const environment: PdfEnvironment = {
    browser: { open: () => null, setTimeout: () => 1 },
    document: {
      createElement: () => link,
      body: { appendChild: () => { appended = true; } },
    },
    url: {
      createObjectURL: () => "blob:descarga",
      revokeObjectURL: () => undefined,
    },
  };

  const result = publishPdfBlob(new Blob(["pdf"]), null, "Informe_UNRC.pdf", environment);

  assert.equal(result, "download");
  assert.equal(link.href, "blob:descarga");
  assert.equal(link.download, "Informe_UNRC.pdf");
  assert.equal(link.style.display, "none");
  assert.ok(appended && clicked && removed);
});
