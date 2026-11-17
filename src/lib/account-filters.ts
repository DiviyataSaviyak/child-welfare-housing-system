/** ADM-12's status filter: "never signed in" is an active account with no sign-in yet. */
export const ACCOUNT_STATUSES = ["active", "disabled", "neverSignedIn"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** ADM-12: the columns the users screen sorts by. With none, it is in order of district, DS office and name. */
export const ACCOUNT_SORTS = ["name", "office", "lastSignIn"] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];

/** ADM-1: the users screen's page. */
export const ACCOUNTS_PER_PAGE = 50;
