import { hhConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const defaultResumeUrl = "https://hh.ru/resume/0f0a51ceff06ea07630039ed1f575a45573545?print=true";
const oldFrontendDefaults = new Set(["Frontend developer", "TypeScript", "Next.js"]);

export const executiveDefaultResumeText = "Руководитель / директор / заместитель директора / исполнительный руководитель. Управление командой, операционное управление, стратегическое планирование, развитие бизнеса, коммерческое управление, управление продажами, бюджетирование, P&L, KPI, оптимизация бизнес-процессов, переговоры, административное управление, запуск и развитие подразделений.";

export const executiveDefaultKeywords = [
  "Исполнительный директор",
  "Операционный директор",
  "Заместитель директора",
  "Руководитель подразделения",
  "Директор филиала",
  "Директор по развитию",
  "Коммерческий директор",
  "Управляющий директор",
  "Руководитель отдела",
  "Руководитель проекта"
];

function isOldFrontendProfile(value: string | null | undefined) {
  const text = (value ?? "").toLowerCase();
  return text.includes("typescript") && text.includes("react") && text.includes("next.js");
}

function shouldReplaceKeywords(values: string[]) {
  if (values.length === 0) return true;
  return values.every((value) => oldFrontendDefaults.has(value));
}

async function seedExecutiveKeywords() {
  await prisma.searchKeyword.deleteMany();
  await prisma.searchKeyword.createMany({
    data: executiveDefaultKeywords.map((value) => ({ value, enabled: true }))
  });
}

export async function ensureSettings() {
  let setting = await prisma.setting.findUnique({ where: { id: 1 } });

  if (!setting) {
    setting = await prisma.setting.create({
      data: {
        id: 1,
        city: hhConfig.defaultCity,
        minSalary: null,
        dailyLimit: 5,
        applyDelayMinSeconds: 3,
        applyDelayMaxSeconds: 8,
        coverLetterTemplate:
          "Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой управленческий опыт может быть полезен вашей компании.",
        resumeText: executiveDefaultResumeText,
        resumeUrl: defaultResumeUrl
      }
    });
  } else if (!setting.resumeUrl || !setting.resumeText.trim() || isOldFrontendProfile(setting.resumeText)) {
    setting = await prisma.setting.update({
      where: { id: 1 },
      data: {
        resumeUrl: setting.resumeUrl || defaultResumeUrl,
        applyDelayMinSeconds: setting.applyDelayMinSeconds ?? 3,
        applyDelayMaxSeconds: setting.applyDelayMaxSeconds ?? 8,
        resumeText: !setting.resumeText.trim() || isOldFrontendProfile(setting.resumeText) ? executiveDefaultResumeText : setting.resumeText,
        coverLetterTemplate: isOldFrontendProfile(setting.resumeText)
          ? "Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой управленческий опыт может быть полезен вашей компании."
          : setting.coverLetterTemplate
      }
    });
  }

  let keywords = await prisma.searchKeyword.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" }
  });

  if (shouldReplaceKeywords(keywords.map((keyword) => keyword.value))) {
    await seedExecutiveKeywords();
    keywords = await prisma.searchKeyword.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    });
  }

  return { ...setting, keywords };
}
