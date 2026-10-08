import fs from 'node:fs';

export type ImportEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  prodHost: string | null;
  geminiApiKey: string | null;
  geminiModel: string | null;
};

export class ImportEnvError extends Error {}

function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Reads the service-role key and target project from .env.import — never
 *  from .env.local. This script's credentials are deliberately separate from
 *  the app's, and this file must never be committed. */
export function loadImportEnv(envPath: string): ImportEnv {
  if (!fs.existsSync(envPath)) {
    throw new ImportEnvError(
      `${envPath} does not exist. Copy .env.import.example (repo root) to ${envPath} and fill in ` +
      `SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the project this import should run against.`
    );
  }
  const vars = parseEnvText(fs.readFileSync(envPath, 'utf8'));
  const supabaseUrl = vars.SUPABASE_URL;
  const serviceRoleKey = vars.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new ImportEnvError(`SUPABASE_URL is missing or blank in ${envPath}.`);
  if (!serviceRoleKey) throw new ImportEnvError(`SUPABASE_SERVICE_ROLE_KEY is missing or blank in ${envPath}.`);
  try {
    new URL(supabaseUrl);
  } catch {
    throw new ImportEnvError(`SUPABASE_URL in ${envPath} is not a valid URL: ${supabaseUrl}`);
  }
  const prodHost = vars.PROD_SUPABASE_HOST ? vars.PROD_SUPABASE_HOST.trim().toLowerCase() : null;
  const geminiApiKey = vars.GEMINI_API_KEY || null;
  const geminiModel = vars.GEMINI_MODEL || null;
  return { supabaseUrl, serviceRoleKey, prodHost, geminiApiKey, geminiModel };
}

/** Pure, so it is unit-testable without a real .env.import file on disk.
 *  Refuses by default: an unconfigured PROD_SUPABASE_HOST means safety can't
 *  be confirmed, so --allow-prod is required either way. */
export function assertNotProd(env: Pick<ImportEnv, 'supabaseUrl' | 'prodHost'>, allowProd: boolean): void {
  if (allowProd) return;
  const host = new URL(env.supabaseUrl).host.toLowerCase();
  if (!env.prodHost) {
    throw new ImportEnvError(
      'PROD_SUPABASE_HOST is not set in .env.import, so this script cannot confirm SUPABASE_URL is ' +
      'not your production project. Set PROD_SUPABASE_HOST in .env.import, or re-run with --allow-prod ' +
      'if you are certain this is safe.'
    );
  }
  if (host === env.prodHost) {
    throw new ImportEnvError(
      `SUPABASE_URL (${host}) matches PROD_SUPABASE_HOST. Refusing to run against production without --allow-prod.`
    );
  }
}
