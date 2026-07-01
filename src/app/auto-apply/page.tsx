import { AutoApplyPanel } from "@/components/auto-apply-panel";
import { hhRunner } from "@/lib/hh/runner";

export const dynamic = "force-dynamic";

export default function AutoApplyPage() {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Manual launch only</p>
          <h1>Auto Apply</h1>
        </div>
      </header>
      <AutoApplyPanel initialState={hhRunner.getState()} />
    </div>
  );
}
