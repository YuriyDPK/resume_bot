"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BriefcaseBusiness, LayoutDashboard, MessageSquare, Rocket, Settings } from "lucide-react";
import { ResumeProfiles } from "@/components/resume-profiles";
import { HHBrowserWorkspace } from "@/components/hh-browser-workspace";

const navigation = [
  { href: "/", label: "Обзор", icon: LayoutDashboard },
  { href: "/vacancies", label: "Вакансии", icon: BriefcaseBusiness },
  { href: "/inbox", label: "Ответы", icon: MessageSquare },
  { href: "/auto-apply", label: "Автоотклики", icon: Rocket },
  { href: "/settings", label: "Настройки", icon: Settings }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="HH Job Apply Bot">
          <span className="brand-mark">
            <Bot size={22} />
          </span>
          <span>
            <strong>HH Apply</strong>
            <small>Ваш помощник в поиске</small>
          </span>
        </Link>

        <ResumeProfiles />
        <nav className="nav-list" aria-label="Основная навигация">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} className={active ? "nav-item active" : "nav-item"} href={item.href}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="main-shell">{children}</main>
      <HHBrowserWorkspace />
    </div>
  );
}
