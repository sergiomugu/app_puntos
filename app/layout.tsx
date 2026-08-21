import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Control de Puntos Docentes UNRC",
  description: "Sistema centralizado de control de puntos docentes",
  icons: {
    icon: [{ url: "/icono-unrc-pd.png", type: "image/png" }],
    apple: [{ url: "/icono-unrc-pd.png", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Leer el encabezado fuerza renderizado dinámico y permite que Next aplique
  // el nonce generado por proxy.ts a sus scripts internos.
  await headers();
  return <html lang="es"><body className={geist.variable}>{children}</body></html>;
}
