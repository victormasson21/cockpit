// NotificationSettings.tsx — Settings › Notifications: whether a pane that bells while cockpit is in
// the background also raises a desktop notification and bounces the Dock icon.
import { useSettings } from "../settings/store";

export function NotificationSettings() {
  const on = useSettings((s) => s.cockpit.preferences.notifyOnAttention ?? true);
  const setNotifyOnAttention = useSettings((s) => s.setNotifyOnAttention);
  return (
    <div className="appearance">
      <label className="appearance__toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setNotifyOnAttention(e.target.checked)}
        />
        <span className="appearance__label">Notify me when a pane needs attention</span>
      </label>
      <p className="appearance__hint">
        Sends a desktop notification and bounces the Dock icon when a Claude pane bells — the same
        signal as the “Check me out” badge. Only while cockpit is in the background.
      </p>
    </div>
  );
}
