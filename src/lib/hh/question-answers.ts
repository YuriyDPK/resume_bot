import type { Page } from "playwright";

const selector = 'textarea[name^="task_"]:visible, input[name^="task_"]:visible, select[name^="task_"]:visible';
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Fill only unambiguous, explicitly configured answers. Never submit the form. */
export async function fillQuestionAnswers(page: Page, configured: string) {
  const answers = new Map<string, string[]>();
  for (const line of configured.split("\n")) {
    const separator = line.indexOf("|");
    if (separator < 0) continue;
    const question = normalize(line.slice(0, separator));
    const answer = line.slice(separator + 1).trim();
    if (question && answer) answers.set(question, [...(answers.get(question) ?? []), answer]);
  }
  if (!answers.size) return false;
  if (await page.locator('[data-qa="hidden-resume-warning"]:visible').count()) return false;
  // Unknown controls within a questionnaire need human review as well.
  const unsupported = page.locator('[data-qa="vacancy-response-questionnaire"] :is(input, textarea, select):visible:not([name^="task_"])');
  if (await unsupported.count()) return false;
  const controls = page.locator(selector);
  const count = await controls.count();
  if (!count) return false;
  const groups = new Map<string, { index: number; type: string; question: string; option: string; disabled: boolean }[]>();
  for (let index = 0; index < count; index++) {
    const info = await controls.nth(index).evaluate((element) => {
      const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const fieldset = control.closest("fieldset");
      const legend = fieldset?.querySelector("legend")?.textContent ?? "";
      const label = [...(control.labels ?? [])].map((item) => {
        const clone = item.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("input, select, textarea").forEach((node) => node.remove());
        return clone.textContent ?? "";
      }).join(" ");
      const labelled = (control.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
      return { name: control.name, type: control.tagName === "INPUT" ? (control as HTMLInputElement).type : control.tagName.toLowerCase(),
        question: (legend || labelled.trim() || control.getAttribute("aria-label") || label).trim(), option: label.trim(), disabled: control.disabled };
    });
    const group = groups.get(info.name) ?? [];
    group.push({ index, ...info });
    groups.set(info.name, group);
  }
  const actions: (() => Promise<void>)[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.some((item) => item.disabled || normalize(item.question) !== normalize(first.question))) return false;
    const matches = answers.get(normalize(first.question));
    if (!matches || matches.length !== 1) return false;
    const answer = matches[0];
    if (first.type === "radio") {
      const options = group.filter((item) => normalize(item.option) === normalize(answer));
      if (options.length !== 1) return false;
      actions.push(async () => { await controls.nth(options[0].index).check(); });
    } else if (group.length !== 1) return false;
    else if (["text", "number", "email", "tel", "url", "textarea"].includes(first.type)) {
      actions.push(async () => { await controls.nth(first.index).fill(answer); });
    } else if (first.type === "select") {
      const options = await controls.nth(first.index).locator("option").all();
      const matched = [];
      for (const option of options) if (normalize(await option.innerText()) === normalize(answer) && !await option.isDisabled()) matched.push(option);
      if (matched.length !== 1) return false;
      const value = await matched[0].getAttribute("value");
      if (value === null || !value) return false;
      actions.push(async () => { await controls.nth(first.index).selectOption(value); });
    } else return false;
  }
  for (const action of actions) await action();
  return true;
}
