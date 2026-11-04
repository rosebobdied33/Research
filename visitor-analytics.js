(function () {
  const config = window.VISITOR_ANALYTICS_CONFIG || {};
  const enabled = Boolean(config.url && config.publishableKey);
  let visitorId = null;
  let sessionId = null;
  let current = { campaign: "portfolio", page: "portfolio" };
  let heartbeatTimer = null;
  let refreshTimer = null;
  let started = false;

  function getId(key, storage = localStorage) {
    let value = storage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      storage.setItem(key, value);
    }
    return value;
  }

  function ensureIdentifiers() {
    if (!visitorId) visitorId = getId("researchVisitorId");
    if (!sessionId) sessionId = getId("researchVisitorSession", sessionStorage);
  }

  async function rpc(name, body, timeoutMs = 6000) {
    if (!enabled) throw new Error("visitor analytics is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`visitor analytics HTTP ${response.status}`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  function deviceType() {
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return "mobile";
    return "desktop";
  }

  async function record(eventType) {
    ensureIdentifiers();
    return rpc("record_visitor_activity", {
      p_visitor_id: visitorId,
      p_session_id: sessionId,
      p_campaign: current.campaign,
      p_page: current.page,
      p_device: deviceType(),
      p_event_type: eventType,
    });
  }

  async function refresh() {
    try {
      const data = await rpc("get_visitor_analytics", {});
      window.dispatchEvent(new CustomEvent("visitor-analytics-update", { detail: { status: "ready", ...data } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("visitor-analytics-update", { detail: { status: "unavailable" } }));
    }
  }

  function start() {
    if (started) return;
    started = true;
    if (!enabled) {
      window.dispatchEvent(new CustomEvent("visitor-analytics-update", { detail: { status: "unavailable" } }));
      return;
    }
    try {
      ensureIdentifiers();
    } catch (error) {
      window.dispatchEvent(new CustomEvent("visitor-analytics-update", { detail: { status: "unavailable" } }));
      return;
    }
    record("pageview").then(refresh).catch(refresh);
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === "visible") record("heartbeat").catch(() => {});
    }, 60000);
    refreshTimer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") record("heartbeat").then(refresh).catch(refresh);
    });
  }

  function trackPage(campaign, page) {
    const changed = current.campaign !== campaign || current.page !== page;
    current = { campaign: campaign || "portfolio", page: page || "portfolio" };
    if (!started) start();
    else if (changed && enabled) record("pageview").then(refresh).catch(() => {});
  }

  window.VisitorAnalytics = { start, trackPage, refresh, enabled };
})();
