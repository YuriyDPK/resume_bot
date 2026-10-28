import { InboxPanel } from "@/components/inbox-panel";
import { inboxData } from "@/lib/inbox-store";
import { hhRunner } from "@/lib/hh/runner";
export const dynamic = "force-dynamic";
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key,value);
  const data = await inboxData(params);
  return <div className="page-stack"><header className="page-header"><div><p className="eyebrow">Обратная связь работодателей</p><h1>Ответы и чаты</h1><p className="page-subtitle">Приглашения, отказы и переписка из вашего HH.</p></div></header><InboxPanel key={params.toString()+":"+data.profileId} data={data} initialState={hhRunner.getState()} /></div>;
}
