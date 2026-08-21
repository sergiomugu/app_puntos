export type PdfPopup = {
  closed: boolean;
  opener: unknown;
  document: {
    title: string;
    body: {
      style: {
        margin: string;
        padding: string;
        fontFamily: string;
        color: string;
      };
      textContent: string | null;
    };
  };
  location: { replace(url: string): void };
};

type PdfLink = {
  href: string;
  download: string;
  style: { display: string };
  click(): void;
  remove(): void;
};

export type PdfBrowser = {
  open(url: string, target: string): PdfPopup | null;
  setTimeout(callback: () => void, delay: number): number;
};

export type PdfEnvironment = {
  browser: PdfBrowser;
  document: {
    createElement(tag: "a"): PdfLink;
    body: { appendChild(link: PdfLink): void };
  };
  url: {
    createObjectURL(blob: Blob): string;
    revokeObjectURL(url: string): void;
  };
};

function browserEnvironment(): PdfEnvironment {
  return {
    browser: window as unknown as PdfBrowser,
    document: document as unknown as PdfEnvironment["document"],
    url: URL,
  };
}

export function reservePdfWindow(
  browser: PdfBrowser = window as unknown as PdfBrowser,
): PdfPopup | null {
  const pdfWindow = browser.open("about:blank", "_blank");
  if (!pdfWindow) return null;

  pdfWindow.opener = null;
  pdfWindow.document.title = "Generando informe PDF…";
  pdfWindow.document.body.style.margin = "0";
  pdfWindow.document.body.style.padding = "32px";
  pdfWindow.document.body.style.fontFamily = "Arial, sans-serif";
  pdfWindow.document.body.style.color = "#12345a";
  pdfWindow.document.body.textContent = "Generando informe PDF…";
  return pdfWindow;
}

export function publishPdfBlob(
  blob: Blob,
  pdfWindow: PdfPopup | null,
  fileName: string,
  environment: PdfEnvironment = browserEnvironment(),
): "tab" | "download" {
  const pdfUrl = environment.url.createObjectURL(blob);
  let delivery: "tab" | "download";

  if (pdfWindow && !pdfWindow.closed) {
    pdfWindow.location.replace(pdfUrl);
    delivery = "tab";
  } else {
    const download = environment.document.createElement("a");
    download.href = pdfUrl;
    download.download = fileName;
    download.style.display = "none";
    environment.document.body.appendChild(download);
    download.click();
    download.remove();
    delivery = "download";
  }

  environment.browser.setTimeout(
    () => environment.url.revokeObjectURL(pdfUrl),
    120_000,
  );
  return delivery;
}
