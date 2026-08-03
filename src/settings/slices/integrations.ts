// integrations.ts — persisted config for the Slack and PR Reviews tiles. Secrets never live here: the
// Slack user token + client secret are in the macOS Keychain, and only the client id / watched ids /
// curated PR items reach cockpit.json. Every writer preserves its sibling integration's fields.
import { mergePrItems } from "../../tiles/pr/merge";
import type { PrReviewItem } from "../types";
import type { SettingsSlice } from "../storeState";

export interface IntegrationsSlice {
  setSlackClientId: (clientId: string) => void;
  setSlackWatched: (ids: string[]) => void;
  setPrChannel: (id: string | null) => void;
  applyPrFetch: (items: PrReviewItem[], newestTs?: string) => void;
  removePrItem: (id: string) => void;
}

export const createIntegrationsSlice: SettingsSlice<IntegrationsSlice> = (_set, get) => ({
  setSlackClientId: (clientId) =>
    get().setCockpit((c) => ({ ...c, integrations: { ...c.integrations, slack: { ...c.integrations?.slack, watchedChannelIds: c.integrations?.slack?.watchedChannelIds ?? [], clientId } } })),
  setSlackWatched: (ids) =>
    get().setCockpit((c) => ({ ...c, integrations: { ...c.integrations, slack: { ...c.integrations?.slack, clientId: c.integrations?.slack?.clientId, watchedChannelIds: ids } } })),
  // Switching channels drops the cursor (it belongs to a channel) but keeps the curated items.
  setPrChannel: (id) =>
    get().setCockpit((c) => ({
      ...c,
      integrations: { ...c.integrations, prReviews: { channelId: id ?? undefined, items: c.integrations?.prReviews?.items ?? [] } },
    })),
  applyPrFetch: (items, newestTs) =>
    get().setCockpit((c) => {
      const pr = c.integrations?.prReviews ?? { items: [] };
      return {
        ...c,
        integrations: {
          ...c.integrations,
          prReviews: { ...pr, items: mergePrItems(pr.items, items), lastSeenTs: newestTs ?? pr.lastSeenTs },
        },
      };
    }),
  removePrItem: (id) =>
    get().setCockpit((c) => {
      const pr = c.integrations?.prReviews;
      if (!pr) return c;
      return { ...c, integrations: { ...c.integrations, prReviews: { ...pr, items: pr.items.filter((i) => i.id !== id) } } };
    }),
});
