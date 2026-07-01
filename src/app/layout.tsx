import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "HH Job Apply Bot",
  description: "MVP для поиска вакансий HH, match score и ручного запуска откликов"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
