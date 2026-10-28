import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getHHAccount } from "@/lib/hh/account";
import { activeProfileId } from "@/lib/profiles";
import { resumeIdFromUrl } from "@/lib/hh/ownership";
import { integer, periodStart, periodValue, textVariants } from "@/lib/list-filters";
import { replyOutcome, type HHConversation, type ChatMessage } from "@/lib/hh/inbox-scraper";

export async function saveConversation(accountId: string, row: HHConversation) {
  const outcome = replyOutcome(row.statusLabel, row.messages.filter((message) => message.author === "employer").at(-1)?.text);
  const data = { vacancyUrl: row.vacancyUrl, vacancyTitle: row.vacancyTitle, company: row.company, resumeId: row.resumeId, statusLabel: row.statusLabel, unread: row.unread, hhUrl: row.hhUrl, outcome, syncedAt: new Date(),
    ...(row.messages.length ? { messagesJson: JSON.stringify(row.messages), lastMessage: row.lastMessage, lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt) : null } : {}) };
  await prisma.conversation.upsert({ where: { accountId_externalId: { accountId, externalId: row.externalId } }, create: { accountId, externalId: row.externalId, ...data }, update: { ...data, ...(!row.messages.length && outcome === "neutral" ? { outcome: undefined } : {}) } });
}

export async function inboxData(params: URLSearchParams) {
  const profileId = await activeProfileId();
  const account = await getHHAccount();
  const filters = { q: (params.get("q") ?? "").trim().slice(0, 150), outcome: ["positive", "negative", "neutral"].includes(params.get("outcome") ?? "") ? params.get("outcome")! : "all",
    unread: ["unread", "read"].includes(params.get("unread") ?? "") ? params.get("unread")! : "all", scope: params.get("scope") === "profile" ? "profile" : "account", sort: params.get("sort") === "oldest" ? "oldest" : "newest", period: periodValue(params.get("period")), page: integer(params.get("page"), 1, 1, 100000) };
  const accountId = account.status === "connected" ? account.accountId : undefined;
  const base: Prisma.ConversationWhereInput = { accountId: accountId ?? "__no_connected_account__" };
  if (filters.scope === "profile") {
    const setting = await prisma.setting.findUnique({ where: { id: profileId }, select: { resumeUrl: true } });
    const applications = await prisma.vacancy.findMany({ where: { profileId, applications: { some: { status: "applied", appliedAt: { not: null } } } }, select: { url: true } });
    base.OR = [{ resumeId: resumeIdFromUrl(setting?.resumeUrl) ?? "__unknown_resume__" }, { resumeId: null, vacancyUrl: { in: applications.map((row) => row.url) } }];
  }
  const where: Prisma.ConversationWhereInput = { AND: [base, ...(filters.outcome === "all" ? [] : [{ outcome: filters.outcome }]), ...(filters.unread === "all" ? [] : [{ unread: filters.unread === "unread" }]),
    ...(filters.q ? [{ OR: textVariants(filters.q).flatMap((contains) => [{ vacancyTitle: { contains } }, { company: { contains } }, { lastMessage: { contains } }]) }] : []), ...(periodStart(filters.period) ? [{ syncedAt: { gte: periodStart(filters.period)! } }] : [])] };
  const [total, all, positive, negative, unread] = await Promise.all([prisma.conversation.count({ where }), prisma.conversation.count({ where: base }), prisma.conversation.count({ where: { AND: [base, { outcome: "positive" }] } }), prisma.conversation.count({ where: { AND: [base, { outcome: "negative" }] } }), prisma.conversation.count({ where: { AND: [base, { unread: true }] } })]);
  const pages = Math.max(1, Math.ceil(total / 20)); filters.page = Math.min(filters.page, pages);
  const rows = await prisma.conversation.findMany({ where, orderBy: [{ lastMessageAt: filters.sort === "newest" ? "desc" : "asc" }, { syncedAt: filters.sort === "newest" ? "desc" : "asc" }, { id: "desc" }], skip: (filters.page - 1) * 20, take: 20 });
  return { profileId, accountConnected: account.status === "connected", filters, total, pages, stats: { all, positive, negative, unread }, conversations: rows.map((row) => {
    let messages: ChatMessage[] = []; try { const value: unknown = JSON.parse(row.messagesJson); if (Array.isArray(value)) messages = value.filter((item) => item && typeof item.text === "string"); } catch { /* Preserve the conversation even if an older message snapshot is invalid. */ }
    return { ...row, messagesJson: undefined, messages, lastMessageAt: row.lastMessageAt?.toISOString() ?? null, syncedAt: row.syncedAt.toISOString() };
  }) };
}
export type InboxData = Awaited<ReturnType<typeof inboxData>>;
