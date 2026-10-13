import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Start local development with npm run local, or configure the standalone database in aicd.standalone.json."
    );
  }

  return drizzle(env.DB, { schema });
}
