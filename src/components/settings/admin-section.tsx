"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, UserPlus, UserX, Loader2, Check } from "lucide-react";

interface UserRow {
  id: number;
  email: string;
  username: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  lastLogin: string | null;
  _count: { watchlists: number; apiKeys: number };
}

interface Props {
  currentUserId: number;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export function AdminSection({ currentUserId, onError, onSuccess }: Props) {
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [regSaving, setRegSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [settingsRes, usersRes] = await Promise.all([
        fetch("/api/admin/settings"),
        fetch("/api/admin/users"),
      ]);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setRegOpen(data.registrationOpen);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleRegistration = async () => {
    setRegSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationOpen: !regOpen }),
      });
      if (res.ok) {
        const data = await res.json();
        setRegOpen(data.registrationOpen);
        onSuccess(data.registrationOpen ? "Registrierung geöffnet" : "Registrierung geschlossen");
      } else {
        onError("Fehler beim Umstellen");
      }
    } catch { onError("Netzwerkfehler"); }
    finally { setRegSaving(false); }
  };

  const updateUser = async (id: number, patch: { isAdmin?: boolean; isActive?: boolean }) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, ...data.user } : u));
        onSuccess("Aktualisiert");
      } else {
        onError(data.error || "Fehler");
      }
    } catch { onError("Netzwerkfehler"); }
  };

  const deleteUser = async (id: number, username: string) => {
    if (!confirm(`User "${username}" und ALLE zugehörigen Daten (Watchlist, API-Keys) unwiderruflich löschen?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.id !== id));
        onSuccess(`User "${username}" gelöscht`);
      } else {
        onError(data.error || "Löschen fehlgeschlagen");
      }
    } catch { onError("Netzwerkfehler"); }
  };

  if (loading) return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Admin-Daten laden…</div>
    </section>
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100">
          <Shield className="h-5 w-5 text-purple-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">Benutzer-Verwaltung (Admin)</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Neue Nutzer anlegen lassen (Registrierung öffnen), Bestandsnutzer sperren oder Admin-Rechte vergeben.
          </p>
        </div>
      </div>

      {/* Registration Toggle */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div>
          <div className="text-sm font-medium text-gray-900">
            {regOpen ? "Registrierung ist OFFEN" : "Registrierung ist GESCHLOSSEN"}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {regOpen
              ? "Neue User können sich unter /register selbst anmelden. Wenn alle da sind, wieder schließen."
              : "Kein Fremder kann sich anmelden. Zum Einladen: hier öffnen, User macht /register, dann wieder schließen."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!regOpen}
          disabled={regSaving}
          onClick={toggleRegistration}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 ${
            regOpen ? "bg-purple-600" : "bg-gray-300"
          }`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${regOpen ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* User list */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">{users.length} Nutzer</h3>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Nutzer</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Lots / Keys</th>
                <th className="px-3 py-2 font-medium">Zuletzt aktiv</th>
                <th className="px-3 py-2 font-medium text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {users.map((u) => {
                const isMe = u.id === currentUserId;
                return (
                  <tr key={u.id} className={isMe ? "bg-blue-50/40" : ""}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{u.username}{isMe && <span className="ml-1 text-[10px] text-blue-600">(du)</span>}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {u.isAdmin && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">Admin</span>}
                        {u.isActive ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">aktiv</span>
                        ) : (
                          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">gesperrt</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">
                      {u._count.watchlists.toLocaleString("de-DE")} / {u._count.apiKeys}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {!isMe && (
                          <>
                            <button
                              onClick={() => updateUser(u.id, { isAdmin: !u.isAdmin })}
                              title={u.isAdmin ? "Admin-Recht entziehen" : "Zum Admin machen"}
                              className="rounded p-1 text-gray-400 hover:bg-purple-50 hover:text-purple-600"
                            >
                              <Shield size={14} />
                            </button>
                            <button
                              onClick={() => updateUser(u.id, { isActive: !u.isActive })}
                              title={u.isActive ? "Sperren" : "Entsperren"}
                              className="rounded p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600"
                            >
                              {u.isActive ? <UserX size={14} /> : <Check size={14} />}
                            </button>
                            <button
                              onClick={() => deleteUser(u.id, u.username)}
                              title="Endgültig löschen"
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <UserPlus size={14} style={{ transform: "rotate(45deg)" }} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-gray-400">
          Deinen eigenen Account kannst du hier nicht ändern (Sicherheit gegen Aussperren). Um dich selbst umzukonfigurieren, muss ein anderer Admin ran.
        </p>
      </div>
    </section>
  );
}
