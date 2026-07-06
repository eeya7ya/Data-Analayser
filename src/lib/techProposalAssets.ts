/**
 * Client-safe Technical-Proposal asset shape + defaults.
 *
 * These live OUTSIDE `settings.ts` on purpose: `settings.ts` imports the
 * server-only DB layer (`./db` → the `postgres` driver, which pulls in Node
 * built-ins like `net`/`tls`/`fs`). A client component that imports a *value*
 * from `settings.ts` would drag that whole chain into the browser bundle and
 * fail the build with "Module not found: Can't resolve 'net'". Keeping the
 * constant + type here lets both the admin client component and `settings.ts`
 * share them without the client ever touching `db`.
 */
export interface TechProposalAssets {
  authorizedCert: string;
  teamCerts: string;
  pmCert: string;
  references: string;
}

export const DEFAULT_TECH_PROPOSAL_ASSETS: TechProposalAssets = {
  authorizedCert: "",
  teamCerts: "",
  pmCert: "",
  references: "",
};
