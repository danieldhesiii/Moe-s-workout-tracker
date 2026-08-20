/* Supabase connection for cloud sync.
   Publishable key — safe to expose in client code; row-level security
   guards the data. Table is namespaced (moe_) and isolated from the
   Hockey Training project's own tables. */
window.MOE_CONFIG = {
  url: "https://ighgxihauvmkclnlyqhv.supabase.co",
  key: "sb_publishable_Bdaxh14XeNYH4NnoxkvtZA_CM3z5xRm",
  table: "moe_app_state",
  rowId: "moe",
};
