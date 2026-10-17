import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = { title: "Mercado Livre → ClickUp", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="pt-BR"><body><main>{children}</main></body></html>; }
