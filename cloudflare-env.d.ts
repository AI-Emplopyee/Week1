declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AICD_AUTH_MODE?: string;
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    AICD_OWNER_EMAIL?: string;
    MOONSHOT_API_KEY?: string;
    MOONSHOT_MODEL?: string;
  }
}
