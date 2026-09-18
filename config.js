// Supabase connection. The publishable key is meant for browsers and is safe to be public:
// every event row is locked to its owner by row-level security in the database.
export const SUPABASE_URL = 'https://hhpoypzgnlmkmundyvft.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_JGkDC1xH_Pe65R2u0-XhYQ_xUKXHzzA';

// The one account that can sign in. Not a real mailbox: the code is public, so a personal
// address doesn't belong here. The password itself lives only in Tal's password vault.
export const LOGIN_EMAIL = 'tal@my-calendar.local';
