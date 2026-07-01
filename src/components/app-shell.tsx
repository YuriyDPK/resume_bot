"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BriefcaseBusiness, LayoutDashboard, Rocket, Settings } from "lucide-react";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vacancies", label: "Vacancies", icon: BriefcaseBusiness },
  { href: "/auto-apply", label: "Auto Apply", icon: Rocket },
  { href: "/settings", label: "Settings", icon: Settings }
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
            <small>Job bot MVP</small>
          </span>
        </Link>

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
    </div>
  );
}
