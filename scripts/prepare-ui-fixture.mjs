import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const directory = path.resolve("test-results/workspace-ui");
fs.mkdirSync(directory, { recursive: true });
const databasePath = path.join(directory, "fixture.db");
fs.rmSync(databasePath, { force: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: "file:" + databasePath }, stdio: "pipe" });
const db = new Database(databasePath);
const now = Date.now();
db.prepare('INSERT INTO Setting (id,searchAllRussia,city,minSalary,resumeText,resumeUrl,coverLetterTemplate,dailyLimit,searchLimit,activeSearchBatchId,createdAt,updatedAt) VALUES (1,0,?,?,?,?,?,100,50,?,?,?)')
  .run("Казань", 80000, "SMOKE_WORKSPACE_FIXTURE", "https://hh.ru/resume/fixture-own", "Тестовое письмо", "fixture", now, now);
for (const value of ["Бухгалтер", "Водитель"]) db.prepare('INSERT INTO SearchKeyword (value,enabled,createdAt,updatedAt) VALUES (?,1,?,?)').run(value, now, now);
const statuses = ["failed", "pending", "found", "applied", "skipped"];
const jobs = ["Бухгалтер по расчётам", "Водитель категории B", "Медицинская сестра"];
for (let id = 1; id <= 40; id += 1) {
  db.prepare('INSERT INTO Vacancy (id,title,company,salary,city,url,description,matchScore,status,searchBatchId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, jobs[id % 3] + " №" + id, "Компания " + (id % 2 + 1), id % 3 ? "от 90 000 ₽" : null, id % 2 ? "Казань" : "Москва", "https://hh.ru/vacancy/" + (100000 + id), "Описание работы и требований", 100 - id, statuses[id % 5], "fixture", now - id * 60000, now);
  if (statuses[id % 5] === "applied") db.prepare('INSERT INTO Application (vacancyId,status,appliedAt,createdAt,updatedAt) VALUES (?,\'applied\',?,?,?)').run(id, now - id * 1000, now, now);
}
for (const [index, [level, message]] of [["info", "SMOKE_INFO"], ["warn", "SMOKE_WARN"], ["error", "SMOKE_ERROR_A"], ["error", "SMOKE_ERROR_B"]].entries()) db.prepare('INSERT INTO Log (level,message,meta,createdAt) VALUES (?,?,?,?)').run(level, message, "{}", now - index * 1000);
for (const [index, outcome] of ["positive", "negative", "neutral"].entries()) {
  const text = ["Приглашаем вас на собеседование", "К сожалению, мы не готовы предложить работу", "Спасибо за отклик! Мы изучаем резюме"][index];
  db.prepare('INSERT INTO Conversation (accountId,externalId,vacancyUrl,vacancyTitle,company,resumeId,outcome,statusLabel,unread,lastMessage,messagesJson,hhUrl,lastMessageAt,syncedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run("fixture-owner", "fixture:" + index, "https://hh.ru/vacancy/" + (100001 + index), ["Врач", "Водитель", "Бухгалтер"][index], "Тестовая компания " + index, index === 0 ? "fixture-own" : index === 1 ? "fixture-secondary" : null, outcome, ["Приглашение", "Отказ", "Просмотрен"][index], index === 0 ? 1 : 0, text, JSON.stringify([{id:"fixture-message-"+index,text,author:"employer",at:new Date(now-index*60000).toISOString()}]), "https://hh.ru/applicant/negotiations", now-index*60000, now);
}
db.prepare('INSERT INTO Conversation (accountId,externalId,vacancyTitle,company,lastMessage,hhUrl,syncedAt) VALUES (?,?,?,?,?,?,?)').run("other-account","foreign","Чужая вакансия","Чужая компания","Чужое сообщение","https://hh.ru/applicant/negotiations",now);
db.close();
fs.writeFileSync(path.join(directory, "hh-auth.json"), JSON.stringify({ cookies: [], origins: [] }));
fs.writeFileSync(path.join(directory, "hh-auth.account.json"), JSON.stringify({ status: "connected", accountId: "fixture-owner", name: "Иван Тестовый", profileUrl: "https://hh.ru/applicant/profile/me", checkedAt: new Date().toISOString() }));
console.log("Prepared isolated UI fixture in test-results/workspace-ui. No application data was changed.");
