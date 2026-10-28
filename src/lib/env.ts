import "dotenv/config";
import path from "node:path";

export const hhConfig = {
  storageStatePath: path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.HH_STORAGE_STATE_PATH ?? "./hh-auth.json"),
  defaultCity: process.env.HH_DEFAULT_CITY ?? ""
};
