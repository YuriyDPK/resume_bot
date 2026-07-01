UPDATE "Setting" SET
  "resumeText" = 'Руководитель / директор / заместитель директора / исполнительный руководитель. Управление командой, операционное управление, стратегическое планирование, развитие бизнеса, коммерческое управление, управление продажами, бюджетирование, P&L, KPI, оптимизация бизнес-процессов, переговоры, административное управление, запуск и развитие подразделений.',
  "coverLetterTemplate" = 'Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой управленческий опыт может быть полезен вашей компании.'
WHERE "resumeText" = '' OR lower("resumeText") LIKE '%typescript%react%next.js%';

DELETE FROM "SearchKeyword" WHERE "value" IN ('Frontend developer', 'TypeScript', 'Next.js');
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Исполнительный директор', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Операционный директор', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Заместитель директора', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Руководитель подразделения', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Директор филиала', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Директор по развитию', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Коммерческий директор', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Управляющий директор', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Руководитель отдела', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "SearchKeyword" ("value", "enabled", "createdAt", "updatedAt") VALUES ('Руководитель проекта', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
