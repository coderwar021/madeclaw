/**
 * Shared MadeClaw site auth helpers (credentials: include for session cookie).
 */
(() => {
  const api = {
    async me() {
      const res = await fetch("/v1/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`me ${res.status}`);
      return res.json();
    },
    async login(login, password) {
      const res = await fetch("/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.error || "登录失败");
      return body;
    },
    async register(username, email, password) {
      const res = await fetch("/v1/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, email: email || undefined, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || body.error || "注册失败");
      return body;
    },
    async logout() {
      await fetch("/v1/auth/logout", { method: "POST", credentials: "include" });
    },
    formatUsd(cents) {
      const n = Number(cents) || 0;
      return `$${(n / 100).toFixed(2)}`;
    },
    async paintNav() {
      const slot = document.querySelector("[data-auth-nav]");
      if (!slot) return null;
      try {
        const me = await api.me();
        if (me?.user) {
          slot.innerHTML = `<a href="/account">${me.user.username}</a>`;
          return me;
        }
      } catch {
        // ignore
      }
      slot.innerHTML = `<a href="/login">登录</a>`;
      return null;
    },
  };
  window.MadeClawAuth = api;
})();
