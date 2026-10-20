"use client";

import { Save, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { shortHex } from "@/lib/format";

export function AccountPanel({
  showHistory = true,
}: { showHistory?: boolean } = {}) {
  const { profile, trades, busy, updateUsername } = useApp();
  const [username, setUsername] = useState(profile?.username ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setUsername(profile?.username ?? ""), [profile?.username]);
  if (!profile) return null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateUsername(username);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={`panel ticks mb-8 grid gap-6 p-5 sm:p-6 ${showHistory ? "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : ""}`}
    >
      <div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center border border-line-strong bg-bg">
            <UserRound className="size-5 text-lime" aria-hidden />
          </span>
          <div>
            <h2 className="wide text-sm">User account</h2>
            <p className="num mt-1 text-xs text-faint">
              {shortHex(profile.wallets[0]?.address ?? "")}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-line py-4 text-sm">
          <div>
            <dt className="text-faint">Login count</dt>
            <dd className="num mt-1">{profile.loginCount}</dd>
          </div>
          <div>
            <dt className="text-faint">Last login</dt>
            <dd className="num mt-1 text-xs">
              {profile.lastLoginAt
                ? new Date(profile.lastLoginAt).toLocaleString()
                : "Current session"}
            </dd>
          </div>
        </dl>
        <form onSubmit={(event) => void save(event)} className="mt-5">
          <label htmlFor="username" className="label">
            Username
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              placeholder="Choose a username"
              className="h-11 min-w-0 flex-1 border border-line bg-bg px-3 outline-none focus:border-lime"
            />
            <Button
              type="submit"
              disabled={busy || saving || username.length < 3}
            >
              <Save className="size-4" aria-hidden /> Save
            </Button>
          </div>
          <p className="mt-2 text-xs text-faint">
            Three to 32 letters, numbers, or underscores.
          </p>
        </form>
      </div>
      {showHistory && (
        <div>
          <h2 className="wide text-sm">Recent trade history</h2>
          <div className="mt-4 min-w-0 max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Scrollable trade history" tabIndex={0} data-lenis-prevent>
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-y border-line font-mono text-[11px] uppercase text-faint">
                <tr>
                  <th className="py-2 font-normal">Action</th>
                  <th className="py-2 font-normal">Venue</th>
                  <th className="py-2 font-normal">Status</th>
                  <th className="py-2 text-right font-normal">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-line">
                    <td className="py-3">{trade.action}</td>
                    <td className="py-3 text-muted">{trade.venue}</td>
                    <td className="py-3 font-mono text-xs uppercase text-lime">
                      {trade.status}
                    </td>
                    <td className="num py-3 text-right text-xs text-faint">
                      {trade.transactionHash
                        ? shortHex(trade.transactionHash, 6)
                        : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trades.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">
                No stored trade history for this user yet.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
