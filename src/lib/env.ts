import "dotenv/config";
import path from "node:path";

function boolFromEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const delayMinSeconds = intFromEnv(process.env.HH_ACTION_DELAY_MIN_SECONDS, 60);
const delayMaxSeconds = intFromEnv(process.env.HH_ACTION_DELAY_MAX_SECONDS, 180);

export const hhConfig = {
  storageStatePath: path.resolve(process.cwd(), process.env.HH_STORAGE_STATE_PATH ?? "./hh-auth.json"),
  headless: boolFromEnv(process.env.HH_HEADLESS, false),
  defaultCity: process.env.HH_DEFAULT_CITY ?? "Москва",
  actionDelayMinMs: Math.min(delayMinSeconds, delayMaxSeconds) * 1000,
  actionDelayMaxMs: Math.max(delayMinSeconds, delayMaxSeconds) * 1000
};

export function randomActionDelayMs() {
  const span = hhConfig.actionDelayMaxMs - hhConfig.actionDelayMinMs;
  return hhConfig.actionDelayMinMs + Math.floor(Math.random() * (span + 1));
}
