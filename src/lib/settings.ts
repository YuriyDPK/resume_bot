import { hhConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const defaultResumeUrl = "https://hh.ru/resume/0f0a51ceff06ea07630039ed1f575a45573545?print=true";

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

async function seedExecutiveKeywords() {
  await prisma.searchKeyword.deleteMany();
  await prisma.searchKeyword.createMany({
    data: executiveDefaultKeywords.map((value) => ({ value, enabled: true }))
  });
}

export async function ensureSettings() {
  let setting = await prisma.setting.findUnique({ where: { id: 1 } });
  const isNew = !setting;

  if (!setting) {
    setting = await prisma.setting.create({
      data: {
        id: 1,
        city: hhConfig.defaultCity,
        minSalary: null,
        dailyLimit: 5,
        searchLimit: 50,
        searchAllRussia: false,
        remoteOnly: false,
        searchDelayMinSeconds: 1,
        searchDelayMaxSeconds: 3,
        applyDelayMinSeconds: 3,
        applyDelayMaxSeconds: 8,
        coverLetterTemplate:
          "Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой управленческий опыт может быть полезен вашей компании.",
        resumeText: executiveDefaultResumeText,
        resumeUrl: defaultResumeUrl,
        excludedWords: ""
      }
    });
  }

  let keywords = await prisma.searchKeyword.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" }
  });

  if (isNew && keywords.length === 0) {
    await seedExecutiveKeywords();
    keywords = await prisma.searchKeyword.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" }
    });
  }

  return { ...setting, keywords };
}
