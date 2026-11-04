const state = {
  campaign: "baixi-garden",
  page: "portfolio",
  campaigns: [],
  campaignData: {},
  portfolio: null,
  dashboard: null,
  responses: [],
  insights: null,
  reports: [],
  refreshReports: [],
  onepagePdfs: [],
  loading: false,
  search: "",
  expanded: null,
  activeIssue: null,
  answerFocus: null,
  source: "all",
  portfolioBySource: {},
  sourceCounts: { online: 0, offline: 0 },
  visitorAnalytics: { status: "loading", online: 0, today: 0, days: [], recent: [] },
  visitorPanelOpen: false,
  activeInsightIssue: null,
  generatedReport: null,
};

const PROTECTED_MODE = Boolean(window.PROTECTED_DATA);
const STATIC_MODE = Boolean(window.STATIC_DATA || window.PROTECTED_DATA);
let AUTH_KEY = null;

window.addEventListener("visitor-analytics-update", (event) => {
  state.visitorAnalytics = { ...state.visitorAnalytics, ...(event.detail || {}) };
  if (window.STATIC_DATA || !PROTECTED_MODE) updateVisitorAnalyticsUI();
});

function base64Bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesBase64(value) {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function decompressPayload(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function decryptWithKey(key) {
  const protectedData = window.PROTECTED_DATA;
  const decrypted = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64Bytes(protectedData.iv),
    additionalData: new TextEncoder().encode("research-dashboard"),
  }, key, base64Bytes(protectedData.ciphertext));
  return JSON.parse(await decompressPayload(new Uint8Array(decrypted)));
}

async function decryptProtectedData(username, password) {
  const protectedData = window.PROTECTED_DATA;
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${username}:${password}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64Bytes(protectedData.salt),
    iterations: Number(protectedData.iterations || 200000),
  }, material, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const payload = await decryptWithKey(key);
  return { key, payload };
}

function renderLogin(message = "") {
  document.getElementById("app").innerHTML = `<main class="login-shell">
    <section class="login-panel">
      <div class="login-brand"><div class="mark"></div><span>INS LAND 调研</span></div>
      <div class="login-copy"><span>RESEARCH WORKSPACE</span><h1>调研数据工作台</h1><p>请输入访问账号与密码。</p></div>
      <form id="loginForm" class="login-form">
        <label><span>账号</span><input id="loginUsername" name="username" autocomplete="username" required></label>
        <label><span>密码</span><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></label>
        ${message ? `<div class="login-error">${escapeHtml(message)}</div>` : ""}
        <button class="primary" type="submit">进入工作台</button>
      </form>
    </section>
  </main>`;
  document.getElementById("loginForm")?.addEventListener("submit", unlockFromForm);
}

async function unlockFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "正在验证...";
  try {
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    const { key, payload } = await decryptProtectedData(username, password);
    AUTH_KEY = key;
    window.STATIC_DATA = payload;
    const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    sessionStorage.setItem("researchAuthKey", bytesBase64(rawKey));
    await loadAll();
  } catch (error) {
    renderLogin("账号或密码不正确，请重新输入。 ");
  }
}

async function restoreProtectedSession() {
  const stored = sessionStorage.getItem("researchAuthKey");
  if (!stored) return false;
  try {
    AUTH_KEY = await crypto.subtle.importKey("raw", base64Bytes(stored), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    window.STATIC_DATA = await decryptWithKey(AUTH_KEY);
    return true;
  } catch (error) {
    sessionStorage.removeItem("researchAuthKey");
    return false;
  }
}

const pages = [
  ["dashboard", "总览"],
  ["insights", "洞察分析"],
  ["answers", "原始答卷"],
  ["reports", "每周报告"],
];

const defaultCampaigns = [
  { id: "baixi-garden", label: "9.百戏游园", title: "INS LAND新乐园百戏游园市场需求调研问卷", pendingLink: false },
  { id: "sunset-ride", label: "8.落日飞车", title: "INS LAND新乐园落日飞车市场需求调研问卷", pendingLink: false },
  { id: "flash-cruise", label: "7.闪光邮轮", title: "INS LAND新乐园闪光邮轮市场需求调研问卷", pendingLink: false },
  { id: "game-world", label: "6.游戏世界", title: "INS LAND新乐园游戏世界市场需求调研问卷", pendingLink: false },
  { id: "wine-heart-garden", label: "5.酒心花园", title: "INS LAND新乐园酒心花园线下用户调研", pendingLink: false, offlineOnly: true },
  { id: "drama-city", label: "4.抓马之城", title: "INS LAND新乐园抓马之城线下用户调研", pendingLink: false, offlineOnly: true },
  { id: "sky-horse", label: "3.天马行空", title: "INS LAND新乐园天马行空线下用户调研", pendingLink: false, offlineOnly: true },
  { id: "dream-on", label: "2.你做梦呢", title: "INS LAND新乐园你做梦呢线下用户调研", pendingLink: false, offlineOnly: true },
  { id: "deep-sea", label: "1.潜入深海", title: "INS LAND新乐园潜入深海线下用户调研", pendingLink: false, offlineOnly: true },
];

async function api(path, options) {
  if (STATIC_MODE) {
    throw new Error("公开版为静态只读页面，不能执行同步或生成操作。");
  }
  const res = await fetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadAll() {
  if (STATIC_MODE) {
    if (!window.STATIC_DATA) throw new Error("请先登录后查看数据。");
    applyStaticPayload(window.STATIC_DATA);
    render();
    return;
  }
  try {
    const data = await api("/api/static-data");
    applyStaticPayload(data);
    render();
    return;
  } catch (error) {
    console.warn("Falling back to legacy local APIs", error);
  }
  const [dashboard, responses, insights, reports] = await Promise.all([
    api("/api/dashboard"),
    api("/api/responses"),
    api("/api/insights"),
    api("/api/reports"),
  ]);
  state.campaigns = defaultCampaigns;
  state.campaignData = {
    "game-world": {
      dashboard,
      responses,
      insights,
      reports,
      pendingLink: false,
    },
    "flash-cruise": createEmptyCampaignPayload(),
  };
  applyCampaignData();
  render();
}

function applyStaticPayload(data) {
  state.campaigns = data.campaigns || defaultCampaigns;
  state.portfolioBySource = data.portfolioBySource || { all: data.portfolio || null };
  state.campaign = data.activeCampaign || (state.campaigns.some((item) => item.id === state.campaign) ? state.campaign : (state.campaigns[0]?.id || "baixi-garden"));
  state.campaignData = data.campaignData || {
    "game-world": {
      dashboard: data.dashboard,
      responses: data.responses,
      insights: data.insights,
      reports: data.reports,
      pendingLink: false,
    },
  };
  applyCampaignData();
}

function createEmptyCampaignPayload() {
  const metrics = {
    totalResponses: 0,
    participationRate: 0,
    averageRating: null,
    ratingDistribution: {},
    positiveKeywords: [],
    negativeKeywords: [],
    selectedResponses: [],
  };
  return {
    pendingLink: true,
    dashboard: { metrics, latestSync: null, hasOpenAIKey: false },
    responses: { responses: [] },
    insights: {
      metrics,
      analysis: {
        summary: "该周期正在等待新的问卷星链接，接入后会独立同步答卷、可视化和周报。",
        recommendations: [],
        positive_keywords: [],
        negative_keywords: [],
        selected_responses: [],
      },
    },
    reports: { reports: [], refreshReports: [], onepagePdfs: [] },
  };
}

function activeCampaign() {
  return state.campaigns.find((item) => item.id === state.campaign) || state.campaigns[0] || defaultCampaigns[0];
}

function activePayload() {
  return state.campaignData[state.campaign] || createEmptyCampaignPayload();
}

function applyCampaignData() {
  const data = activePayload();
  applySourceView(data);
  state.reports = data.reports?.reports || [];
  state.refreshReports = data.reports?.refreshReports || [];
  state.onepagePdfs = data.reports?.onepagePdfs || [];
  state.expanded = null;
  state.generatedReport = null;
}

function applySourceView(data = activePayload()) {
  const view = data.sourceViews?.[state.source];
  state.portfolio = state.portfolioBySource?.[state.source] || state.portfolioBySource?.all || null;
  if (view) {
    state.dashboard = { ...(data.dashboard || {}), metrics: view.metrics };
    state.responses = sortResponsesNewestFirst(view.responses || []);
    state.insights = { metrics: view.metrics, analysis: view.analysis || {} };
    state.sourceCounts = view.sourceCounts || { online: 0, offline: 0 };
    return;
  }
  state.dashboard = data.dashboard || createEmptyCampaignPayload().dashboard;
  state.responses = sortResponsesNewestFirst(data.responses?.responses || []);
  state.insights = data.insights || createEmptyCampaignPayload().insights;
  state.sourceCounts = { online: state.responses.length, offline: 0 };
}

function nav() {
  const groups = orderedCampaigns().map((campaign) => {
    const isActiveCampaign = state.campaign === campaign.id;
    const children = pages.map(([id, label]) => `<div class="nav-child ${isActiveCampaign && state.page === id ? "active" : ""}" data-campaign="${campaign.id}" data-page="${id}">${label}</div>`).join("");
    return `<div class="nav-group">
      <button class="nav-campaign ${isActiveCampaign && state.page !== "portfolio" ? "active" : ""}" data-campaign="${campaign.id}" data-page="${state.page === "portfolio" ? "dashboard" : state.page}">
        <span>${escapeHtml(campaign.label)}</span>
        <span class="nav-status">${campaign.pendingLink ? "待链接" : campaign.offlineOnly ? "仅线下" : "已接入"}</span>
      </button>
      <div class="nav-children ${isActiveCampaign ? "open" : ""}">${children}</div>
    </div>`;
  }).join("");
  return `<aside><div class="brand"><div class="mark"></div><span>INS LAND 调研</span></div><nav>
    <button class="nav-overview ${state.page === "portfolio" ? "active" : ""}" data-page="portfolio">综合评价</button>
    <div class="nav-divider"><span>活动周期</span></div>
    ${groups}
  </nav></aside>`;
}

function portfolioOrbitGraphic() {
  return `<div class="portfolio-orbit" aria-hidden="true">
    <span class="orbit-line orbit-a"></span>
    <span class="orbit-line orbit-b"></span>
    <span class="orbit-line orbit-c"></span>
    <span class="orbit-line orbit-d"></span>
    <span class="orbit-core"></span>
    <i class="orbit-node node-blue"></i>
    <i class="orbit-node node-green"></i>
    <i class="orbit-node node-coral"></i>
    <i class="orbit-node node-yellow"></i>
  </div>`;
}

function shell(content) {
  const isPortfolio = state.page === "portfolio";
  const latest = state.dashboard?.latestSync;
  const updated = latest?.finished_at ? `最后同步：${latest.finished_at}` : "尚未同步";
  const modeText = STATIC_MODE ? "公开静态版" : "本地数据";
  const campaign = activeCampaign();
  const isPending = Boolean(campaign.pendingLink || activePayload().pendingLink);
  const actionDisabled = isPending || campaign.offlineOnly || (!STATIC_MODE && state.campaign !== "game-world");
  const mobileNav = `<div class="mobile-nav">${
    `<button class="mobile-campaign-item ${isPortfolio ? "active" : ""}" data-page="portfolio">综合评价</button>` +
    orderedCampaigns().map((item) => `<button class="mobile-campaign-item ${!isPortfolio && state.campaign === item.id ? "active" : ""}" data-campaign="${item.id}" data-page="dashboard">${escapeHtml(item.label)}</button>`).join("")
  }</div>${isPortfolio ? "" : `<div class="mobile-nav page-tabs">${
    pages.map(([id, label]) => `<button class="mobile-nav-item ${state.page === id ? "active" : ""}" data-campaign="${state.campaign}" data-page="${id}">${label}</button>`).join("")
  }</div>`}`;
  return `<div class="app">${nav()}<main>
    <div class="topbar ${isPortfolio ? "portfolio-topbar" : ""}">
      <div><div class="campaign-eyebrow">${isPortfolio ? "全部 Campaign" : escapeHtml(campaign.label)}</div><h1>${isPortfolio ? "综合评价" : escapeHtml(campaign.title || campaign.label)}</h1><div class="sub">${isPortfolio ? `${state.portfolio?.completedCampaigns || 0} 个已完成活动 · ${modeText}` : campaign.offlineOnly ? `仅线下调研 · ${updated}` : `${updated} · ${modeText} · ${state.dashboard?.hasOpenAIKey ? "OpenAI 已配置" : "OpenAI 未配置"}`}</div></div>
      ${isPortfolio ? portfolioOrbitGraphic() : ""}
      <div class="topbar-tools">
      ${visitorAnalyticsControl()}
      <div class="source-filter" role="group" aria-label="调研来源">
        <button data-source="all" class="${state.source === "all" ? "active" : ""}">全部</button>
        <button data-source="online" class="${state.source === "online" ? "active" : ""}">线上</button>
        <button data-source="offline" class="${state.source === "offline" ? "active" : ""}">线下</button>
      </div>
      <div class="actions ${STATIC_MODE || isPortfolio ? "static-actions" : ""}">
        <button id="analysisBtn" ${actionDisabled ? "disabled" : ""}>生成分析</button>
        <button id="reportBtn" ${actionDisabled ? "disabled" : ""}>生成周报</button>
        <button id="pdfBtn" ${actionDisabled ? "disabled" : ""}>生成图文PDF</button>
        <button class="primary" id="syncBtn" ${actionDisabled ? "disabled" : ""}>立即同步</button>
        ${PROTECTED_MODE ? `<button id="logoutBtn" class="logout-button">退出</button>` : ""}
      </div>
      </div>
    </div>
    ${mobileNav}
    ${!isPortfolio && isPending ? pendingBanner() : ""}
    ${content}
  </main></div>`;
}

function visitorAnalyticsControl() {
  const analytics = state.visitorAnalytics || {};
  const unavailable = analytics.status === "unavailable";
  const label = unavailable ? "访问统计暂不可用" : `当前 ${Number(analytics.online || 0)} 人在线`;
  const maxDay = Math.max(1, ...(analytics.days || []).map((item) => Number(item.count || 0)));
  const trend = (analytics.days || []).map((item) => `<div class="visitor-trend-item" title="${escapeAttr(item.date)} · ${Number(item.count || 0)} 次">
    <span style="height:${Math.max(8, Math.round((Number(item.count || 0) / maxDay) * 100))}%"></span><small>${escapeHtml(String(item.date || "").slice(5))}</small>
  </div>`).join("");
  const recent = (analytics.recent || []).map((item) => `<li><div><strong>${escapeHtml(visitorPageLabel(item.campaign, item.page))}</strong><span>${escapeHtml(item.device === "mobile" ? "手机" : "电脑")}</span></div><time>${escapeHtml(formatVisitorTime(item.last_seen))}</time></li>`).join("");
  return `<div class="visitor-analytics ${state.visitorPanelOpen ? "open" : ""}">
    <button id="visitorStatusButton" class="visitor-status-button ${unavailable ? "unavailable" : ""}" type="button" aria-expanded="${state.visitorPanelOpen}">
      <i></i><span>${label}</span>
    </button>
    ${state.visitorPanelOpen ? `<div class="visitor-analytics-panel">
      <div class="visitor-panel-head"><div><span>LIVE ACTIVITY</span><h3>浏览记录</h3></div><button id="closeVisitorPanel" aria-label="关闭">×</button></div>
      ${unavailable ? `<div class="visitor-panel-empty">统计服务暂时无法连接，调研数据仍可正常查看。</div>` : `
      <div class="visitor-kpis"><div><span>当前在线</span><strong>${Number(analytics.online || 0)}</strong></div><div><span>今日浏览</span><strong>${Number(analytics.today || 0)}</strong></div></div>
      <div class="visitor-section"><div class="visitor-section-title"><strong>近 7 天浏览</strong><span>页面访问次数</span></div><div class="visitor-trend">${trend || "<em>暂无记录</em>"}</div></div>
      <div class="visitor-section"><div class="visitor-section-title"><strong>最近查看</strong><span>匿名记录</span></div><ul class="visitor-recent">${recent || "<li class=\"empty\">暂无记录</li>"}</ul></div>`}
    </div>` : ""}
  </div>`;
}

function updateVisitorAnalyticsUI() {
  const current = document.querySelector(".visitor-analytics");
  if (!current) return;
  current.outerHTML = visitorAnalyticsControl();
  bindVisitorAnalytics();
}

function bindVisitorAnalytics() {
  document.getElementById("visitorStatusButton")?.addEventListener("click", () => {
    state.visitorPanelOpen = !state.visitorPanelOpen;
    if (state.visitorPanelOpen) window.VisitorAnalytics?.refresh();
    updateVisitorAnalyticsUI();
  });
  document.getElementById("closeVisitorPanel")?.addEventListener("click", () => {
    state.visitorPanelOpen = false;
    updateVisitorAnalyticsUI();
  });
}

function visitorPageLabel(campaign, page) {
  const campaignLabel = campaign === "portfolio" ? "综合评价" : (state.campaigns.find((item) => item.id === campaign)?.label || campaign || "综合评价");
  const pageLabel = pages.find(([id]) => id === page)?.[1] || (page === "portfolio" ? "首页" : page || "首页");
  return campaign === "portfolio" ? campaignLabel : `${campaignLabel} · ${pageLabel}`;
}

function formatVisitorTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function orderedCampaigns() {
  return state.campaigns.length ? state.campaigns : defaultCampaigns;
}

function pendingBanner() {
  return `<section class="pending-banner">
    <div><strong>等待新问卷数据</strong><span>当前周期已预留完整结构；问卷开始提交后，会独立抓取、分析、生成周报和 PDF。</span></div>
  </section>`;
}

function metricsCards(metrics) {
  const ratingCount = Object.values(metrics.ratingDistribution || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const participation = state.source === "online" && metrics.participationAnswered
    ? `<div class="label">活动参与率</div><div class="value metric-accent-coral">${metrics.participationRate ?? 0}%</div><div class="metric-caption">${metrics.participationAnswered} 份有效回答</div>`
    : `<div class="label">样本来源</div><div class="source-stat-grid"><div><strong>${state.sourceCounts.online || 0}</strong><span>线上</span></div><div><strong>${state.sourceCounts.offline || 0}</strong><span>线下</span></div></div><div class="metric-caption">按采集渠道区分</div>`;
  return `<section class="metrics campaign-metrics">
    <div class="card pink metric-card source-metric">${participation}</div>
    <div class="card blue metric-card"><div class="label">样本总量</div><div class="value metric-accent-blue">${metrics.totalResponses ?? 0}</div><div class="metric-caption">当前已同步答卷</div></div>
    <div class="card green score-card metric-card"><div class="label">平均评分</div><div class="score-circle"><div class="score-value">${metrics.averageRating ?? "-"}</div><div class="score-unit">/ 10</div></div><div class="metric-caption">${ratingCount} 个有效评分</div></div>
  </section>`;
}

function ratingChart(dist = {}) {
  const max = Math.max(1, ...Object.values(dist).map(Number));
  const bars = Array.from({ length: 10 }, (_, index) => {
    const score = String(index + 1);
    const value = Number(dist[score] || 0);
    const height = Math.max(6, Math.round(value / max * 160));
    return `<div title="${score}分：${value}" class="bar-column"><span class="bar-count">${value || ""}</span><i class="bar" style="height:${height}px"></i><span class="bar-score">${score}</span></div>`;
  }).join("");
  return `<div class="chart">${bars}</div>`;
}

function keywordPanel(title, items = [], mode = "positive") {
  const max = Math.max(1, ...items.map((item) => Number(item.count ?? item.countEstimate ?? 0)));
  const offsets = [
    ["-4px", "2px", "-2deg", "0 2px 0 0"],
    ["7px", "-3px", "1.5deg", "6px 0 0 0"],
    ["-2px", "-8px", "0deg", "0 0 5px 0"],
    ["10px", "5px", "2.5deg", "5px 4px 0 0"],
    ["-8px", "8px", "-1deg", "0 7px 0 2px"],
    ["4px", "-2px", "3deg", "2px 0 0 0"],
    ["-5px", "0", "-3deg", "0 3px 0 0"],
    ["8px", "7px", "1deg", "6px 0 3px 0"],
    ["0", "-5px", "-1.5deg", "0 0 0 0"],
    ["-10px", "4px", "2deg", "4px 0 0 0"],
  ];
  const rows = items.slice(0, 14).map((item, index) => {
    const count = Number(item.count ?? item.countEstimate ?? 0);
    const ratio = count / max;
    const size = ratio > 0.75 ? 4 : ratio > 0.45 ? 3 : ratio > 0.22 ? 2 : 1;
    const [x, y, r, m] = offsets[index % offsets.length];
    return `<div class="keyword-row ${mode === "positive" ? "positive-tag" : "negative-tag"} size-${size}" style="--x:${x};--y:${y};--r:${r};--m:${m};">
    <div class="keyword"><span class="dot"></span><span class="keyword-name">${escapeHtml(item.keyword)}</span></div>
    <span class="count">${count}</span>
  </div>`;
  }).join("") || `<div class="empty">暂无关键词</div>`;
  return `<div class="card ${mode === "positive" ? "green" : "pink"} ${mode === "negative" ? "negative" : ""}">
    <div class="section-title"><span>${title}</span><span class="tiny">${mode === "positive" ? "左侧" : "右侧"}</span></div>
    <div class="keyword-list">${rows}</div>
    <div class="keyword-cloud-note">字号代表出现频次，位置做轻微错落排列。</div>
  </div>`;
}

function selectedResponses(items = []) {
  const cards = items.slice(0, 6).map((item) => `<div class="response-card">
    <div class="response-meta"><span>${escapeHtml(item.field || item.reason || "精选答复")}</span><span>${escapeHtml(item.submitted_at || item.submittedAt || "")}</span></div>
    <div class="response-meta secondary"><span>${item.rating ? `${item.rating}分` : ""}</span><span>${item.sequence ? `序号 ${item.sequence}` : ""}</span></div>
    <div class="response-text">“${escapeHtml(item.quote || "")}”</div>
    <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
  </div>`).join("") || `<div class="empty">暂无精选答复，完成同步后自动生成。</div>`;
  return `<section class="card"><div class="section-title"><span>精选调研答复</span><span class="tiny">填空题中信息量高、有具体意见的回答</span></div><div class="selected-grid">${cards}</div></section>`;
}

function guidancePanel(metrics = {}) {
  const guidance = metrics.guidance || {};
  const distribution = guidance.distribution || {};
  const entries = Object.entries(distribution);
  const total = Number(guidance.totalAnswered || 0);
  if (!entries.length) return "";
  const max = Math.max(1, ...entries.map(([, value]) => Number(value || 0)));
  const bars = entries.map(([label, value]) => {
    const count = Number(value || 0);
    const width = Math.max(8, Math.round(count / max * 100));
    const percent = total ? Math.round(count / total * 100) : 0;
    return `<div class="guidance-row">
      <div class="guidance-label">${escapeHtml(label)}</div>
      <div class="guidance-bar"><span style="width:${width}%"></span></div>
      <div class="guidance-count">${count} · ${percent}%</div>
    </div>`;
  }).join("");
  const reasons = (guidance.unclearReasons || []).slice(0, 4).map((item) => `<div class="guidance-reason">
    <div class="response-meta"><span>序号 ${escapeHtml(item.sequence || "")}</span><span>${escapeHtml(item.submitted_at || "")}</span></div>
    <div>${escapeHtml(item.reason || "")}</div>
  </div>`).join("") || `<div class="empty compact-empty">暂无“不清晰”追问内容。</div>`;
  return `<section class="card guidance-card">
    <div class="section-title"><span>导览清晰度</span><span class="tiny">${total} 份有效回答</span></div>
    <div class="guidance-summary">
      <div><div class="label">清晰率</div><div class="value">${guidance.clearRate ?? "-"}%</div></div>
      <div><div class="label">不清晰反馈</div><div class="value">${guidance.unclearCount ?? 0}</div></div>
    </div>
    <div class="guidance-list">${bars}</div>
    <div class="section-title small-title"><span>不清晰追问</span><span class="tiny">最多显示 4 条</span></div>
    <div class="guidance-reasons">${reasons}</div>
  </section>`;
}

function djContestPanel(metrics = {}) {
  const contest = metrics.djContest || {};
  const title = contest.title || "本期活动反馈";
  const distribution = contest.awarenessDistribution || {};
  const themes = contest.topThemes || [];
  const selected = contest.selectedResponses || [];
  if (!contest.totalAnswered) return "";
  const period = [contest.earliestSubmittedAt, contest.latestSubmittedAt].filter(Boolean).join(" - ");
  const max = Math.max(1, ...Object.values(distribution).map(Number));
  const awareness = Object.entries(distribution).map(([label, value]) => {
    const count = Number(value || 0);
    const width = Math.max(8, Math.round(count / max * 100));
    return `<div class="guidance-row">
      <div class="guidance-label">${escapeHtml(label)}</div>
      <div class="guidance-bar dj-bar"><span style="width:${width}%"></span></div>
      <div class="guidance-count">${count}</div>
    </div>`;
  }).join("");
  const themeTags = themes.slice(0, 8).map((item) => `<span class="dj-theme">${escapeHtml(item.keyword)} ${Number(item.count || 0)}</span>`).join("") || `<span class="tiny">暂无明显主题</span>`;
  const quotes = selected.slice(0, 4).map((item) => `<div class="guidance-reason">
    <div class="response-meta"><span>序号 ${escapeHtml(item.sequence || "")}</span><span>${escapeHtml(item.submitted_at || "")}</span></div>
    <div>${escapeHtml(item.text || "")}</div>
  </div>`).join("");
  return `<section class="card dj-card">
    <div class="section-title"><span>${escapeHtml(title)}反馈</span><span class="tiny">${escapeHtml(period || "暂无日期")}</span></div>
    <div class="dj-overview">
      <div><div class="label">有效回答</div><div class="value">${contest.totalAnswered}</div></div>
      <div><div class="label">最新反馈</div><div class="dj-date">${escapeHtml(contest.latestSubmittedAt || "-")}</div></div>
    </div>
    <div class="guidance-list">${awareness}</div>
    <div class="dj-themes">${themeTags}</div>
    <div class="section-title small-title"><span>代表性原文</span><span class="tiny">最多显示 4 条</span></div>
    <div class="guidance-reasons">${quotes}</div>
  </section>`;
}

function compactDistribution(items = {}, tone = "queue") {
  const entries = Object.entries(items);
  const max = Math.max(1, ...entries.map(([, count]) => Number(count || 0)));
  return entries.map(([label, count]) => `<div class="special-row">
    <div class="special-label">${escapeHtml(label)}</div>
    <div class="special-track ${tone}"><span style="width:${Math.max(7, Number(count || 0) / max * 100)}%"></span></div>
    <strong>${Number(count || 0)}</strong>
  </div>`).join("") || `<div class="empty">新题加入后，等待本轮有效答卷。</div>`;
}

function baixiHalloweenPanel(metrics = {}) {
  if (state.campaign !== "baixi-garden") return "";
  const special = metrics.baixiHalloween || {};
  const queueNotes = (special.queueSuggestions || []).slice(0, 3);
  const drinkNotes = [...(special.drinksReasons || []), ...(special.drinksScenes || [])].slice(0, 3);
  const noteList = (items, empty) => items.length
    ? items.map((item) => `<div class="special-note"><span>${escapeHtml(item.submitted_at || "")}</span>${escapeHtml(item.text || "")}</div>`).join("")
    : `<div class="empty">${empty}</div>`;
  return `<section class="card baixi-special">
    <div class="section-title"><span>万圣节嘉年华专项</span><span class="tiny">新增题目 · ${Number(special.totalAnswered || 0)} 份有效答卷</span></div>
    <div class="baixi-special-grid">
      <div class="special-column queue-column"><div class="special-heading"><span>现场秩序与排队</span><strong>${Number(special.queueAnswered || 0)}</strong></div>${compactDistribution(special.queueDistribution, "queue")}<div class="special-notes">${noteList(queueNotes, "暂无排队互动建议")}</div></div>
      <div class="special-column drinks-column"><div class="special-heading"><span>酒水与门店消费</span><strong>${Number(special.drinksAnswered || 0)}</strong></div>${compactDistribution(special.beerIntentDistribution, "drinks")}<div class="special-notes">${noteList(drinkNotes, "暂无酒水原因或消费场景反馈")}</div></div>
    </div>
  </section>`;
}

function portfolioMetrics(summary = {}) {
  const online = Number(summary.sourceCounts?.online || 0);
  const offline = Number(summary.sourceCounts?.offline || 0);
  const total = Math.max(1, online + offline);
  return `<section class="portfolio-metrics">
    <div class="card blue portfolio-stat sample-stat"><div class="label">累计样本</div><div class="value">${summary.totalResponses || 0}</div><div class="source-composition"><i class="online" style="width:${online / total * 100}%"></i><i class="offline" style="width:${offline / total * 100}%"></i></div><div class="source-composition-label"><span>线上 ${online}</span><span>线下 ${offline}</span></div></div>
    <div class="card green portfolio-score"><div class="label">综合平均分</div><div class="score-circle"><div class="score-value">${summary.weightedAverageRating ?? "-"}</div><div class="score-unit">/ 10</div></div><div class="muted">按全部有效评分加权</div></div>
    <div class="card pink portfolio-stat"><div class="label">有效评分</div><div class="value">${summary.validRatingCount || 0}</div><div class="muted">已填写评分的样本</div></div>
    <div class="card portfolio-stat"><div class="label">已完成活动</div><div class="value">${summary.completedCampaigns || 0}</div><div class="muted">纳入综合评价的周期</div></div>
  </section>`;
}

function scoreColor(rating) {
  if (rating < 7) return "hsl(6 68% 68%)";
  const palette = [
    "#d985b8", "#9a88d8", "#b59cde",
    "#8eb7e8", "#6f9fe3", "#68c5a0",
    "#59b9c7", "#ec9abf", "#ec8897",
  ];
  return palette[Math.abs(Math.round(rating * 10)) % palette.length];
}

function scoreEmotionCard({ label, rating, samples, ratingCount, scale = 1, overall = false }) {
  const color = scoreColor(Number(rating || 0));
  return `<article class="score-emotion-card ${overall ? "is-overall" : ""}" style="--mood:${color};--blob-scale:${scale}">
    <div class="score-number"><strong>${rating ?? "-"}</strong><span>/ 10</span></div>
    <div class="emotion-copy"><strong>${escapeHtml(label)}</strong><span>${samples || 0} 份样本</span>${ratingCount ? `<small>${ratingCount} 个有效评分</small>` : ""}</div>
  </article>`;
}

function campaignScoreComparison(items = [], summary = {}) {
  const maxSamples = Math.max(1, ...items.map((item) => Number(item.totalResponses || 0)));
  const cards = items.map((item) => scoreEmotionCard({
    label: String(item.label || "").replace(/^\d+\./, ""),
    rating: item.averageRating,
    samples: item.totalResponses,
    ratingCount: item.ratingCount,
    scale: 0.82 + Math.sqrt(Number(item.totalResponses || 0) / maxSamples) * 0.18,
  })).join("") || `<div class="empty">暂无活动评分。</div>`;
  const overall = scoreEmotionCard({
    label: "综合评价",
    rating: summary.weightedAverageRating,
    samples: summary.totalResponses,
    ratingCount: summary.validRatingCount,
    scale: 1.08,
    overall: true,
  });
  return `<section class="card campaign-score-card emotion-score-section"><div class="section-title"><span>活动评分一览</span><span class="tiny">突出评分 · 颜色区分活动</span></div>
    <div class="score-emotion-field">${overall}${cards}</div>
  </section>`;
}

function focusDistribution(distribution = {}, tone = "queue") {
  const entries = Object.entries(distribution);
  const max = Math.max(1, ...entries.map(([, count]) => Number(count || 0)));
  return `<div class="focus-distribution">${entries.map(([label, count]) => `<div class="focus-distribution-row">
    <span>${escapeHtml(label)}</span><div class="focus-distribution-track ${tone}"><i style="width:${Math.max(5, Number(count || 0) / max * 100)}%"></i></div><strong>${Number(count || 0)}</strong>
  </div>`).join("") || `<div class="empty">暂无结构化选项数据</div>`}</div>`;
}

function focusThemes(items = [], tone = "queue") {
  const max = Math.max(1, ...items.map((item) => Number(item.count || 0)));
  return `<div class="focus-theme-list">${items.slice(0, 5).map((theme) => `<div class="focus-theme-item priority-${escapeAttr(theme.priority || "medium")}">
    <div class="focus-theme-heading"><span>${escapeHtml(theme.label)}</span><strong>${Number(theme.count || 0)}</strong></div>
    <p class="focus-theme-description">${escapeHtml(theme.description || "")}</p>
    <div class="focus-theme-track ${tone}"><i style="width:${Math.max(6, Number(theme.count || 0) / max * 100)}%"></i></div>
  </div>`).join("") || `<div class="empty">暂无集中主题</div>`}</div>`;
}

function focusQuotes(items = []) {
  return `<div class="focus-quotes">${items.slice(0, 3).map((item) => `<div class="focus-quote"><span>${escapeHtml(item.campaignLabel || "")} · ${item.channel === "offline" ? "线下" : "线上"}</span><p>${escapeHtml(item.text || "")}</p></div>`).join("") || `<div class="empty">暂无代表性原话</div>`}</div>`;
}

function portfolioResearchFocus(focus = {}) {
  const queue = focus.queue || {};
  const drinks = focus.drinks || {};
  const queueOnline = Number(queue.sourceCounts?.online || 0);
  const queueOffline = Number(queue.sourceCounts?.offline || 0);
  const drinksOnline = Number(drinks.sourceCounts?.online || 0);
  const drinksOffline = Number(drinks.sourceCounts?.offline || 0);
  const purchaseRate = drinks.potentialPurchaseRate;
  return `<section class="research-focus-section">
    <div class="section-title research-focus-title"><span>两项重点调研</span><span class="tiny">结构化问题 + 全活动开放反馈</span></div>
    <div class="research-focus-grid">
      <article class="card research-focus-card queue-focus-card">
        <div class="focus-card-head"><div><span class="focus-index">01</span><h2>${escapeHtml(queue.title || "排队体验")}</h2></div><div class="focus-sample-orb"><strong>${Number(queue.sampleCount || 0)}</strong><span>相关样本</span></div></div>
        <div class="focus-source"><span>线上 ${queueOnline}</span><span>线下 ${queueOffline}</span><small>汇总所有活动中与排队、等待和拥挤有关的反馈</small></div>
        <div class="focus-subtitle"><strong>当前主要问题</strong><span>多选题结果</span></div>
        ${focusDistribution(queue.distribution, "queue")}
        <div class="focus-subtitle"><strong>等待期间的需求</strong><span>开放回答主题</span></div>
        ${focusThemes(queue.themes, "queue")}
        ${focusQuotes(queue.samples)}
      </article>
      <article class="card research-focus-card drinks-focus-card">
        <div class="focus-card-head"><div><span class="focus-index">02</span><h2>${escapeHtml(drinks.title || "酒水体验")}</h2></div><div class="focus-sample-orb drinks"><strong>${Number(drinks.sampleCount || 0)}</strong><span>相关样本</span></div></div>
        <div class="focus-source"><span>线上 ${drinksOnline}</span><span>线下 ${drinksOffline}</span><small>抓取全部活动中的酒水、口味、品类和消费场景反馈</small></div>
        <div class="structured-question"><span>当前专项问题</span><p>${escapeHtml(drinks.structuredQuestion || "")}</p></div>
        <div class="drinks-intent-overview"><div class="intent-ring" style="--intent:${Number(purchaseRate || 0) * 3.6}deg"><strong>${purchaseRate ?? "-"}%</strong><span>具有消费可能</span></div><div>${focusDistribution(drinks.structuredDistribution, "drinks")}</div></div>
        <div class="focus-subtitle"><strong>全部酒水反馈主题</strong><span>跨活动开放回答</span></div>
        ${focusThemes(drinks.themes, "drinks")}
        ${focusQuotes(drinks.samples)}
      </article>
    </div>
  </section>`;
}

function coreIssues(categories = []) {
  const cards = categories.map((category, index) => {
    const isOpen = state.activeIssue === category.id;
    const samples = (category.issues || []).flatMap((issue) => (issue.samples || []).map((sample) => ({ ...sample, issueKeyword: issue.keyword })));
    const issues = (category.issues || []).map((issue, issueIndex) => `<div class="bubble-issue-tag tag-${issueIndex % 4}">
      <span>${escapeHtml(issue.keyword)}</span><strong>${Number(issue.weight || 0)}</strong>
    </div>`).join("") || `<div class="dimension-clear">当前无集中负向信号</div>`;
    const sampleList = isOpen ? `<div class="issue-sample-panel dimension-samples">
      <div class="issue-sample-head"><strong>${escapeHtml(category.title)} · 样本内容</strong><span>${samples.length} 条问题记录</span></div>
      <div class="issue-sample-list">${samples.map((sample, sampleIndex) => `<button class="issue-sample" data-category-id="${escapeAttr(category.id)}" data-category-sample-index="${sampleIndex}">
        <span class="issue-sample-meta"><b>${escapeHtml(sample.campaignLabel || "")}</b><time>${escapeHtml(sample.submittedAt || "")}</time></span>
        <span class="sample-issue-tag">${escapeHtml(sample.issueKeyword || "")}</span>
        <span class="issue-sample-text"><small>${escapeHtml(sample.question || "原始问题")}</small>${escapeHtml(sample.text || "")}</span>
        <span class="issue-sample-link">查看原答卷 →</span>
      </button>`).join("") || `<div class="empty">当前维度暂无可追溯样本。</div>`}</div>
    </div>` : "";
    return `<article class="issue-bubble-cluster bubble-${escapeAttr(category.id)}">
      <div class="bubble-cluster-index">0${index + 1}</div>
      <div class="bubble-cluster-head">
        <div><div class="issue-kicker">EXPERIENCE DIMENSION</div><h3>${escapeHtml(category.title)}</h3><p>${escapeHtml(category.scope)}</p></div>
        <button class="bubble-count-orb" data-issue="${escapeAttr(category.id)}" aria-expanded="${isOpen}"><strong>${Number(category.count || 0)}</strong><span>问题提及</span><small>${isOpen ? "收起" : "查看样本"}</small></button>
      </div>
      <div class="bubble-issue-cloud">${issues}</div>
      <div class="bubble-dialogues">
        <div class="diagnosis-bubble"><strong>问题判断</strong><p>${escapeHtml(category.summary)}</p></div>
        <div class="action-bubble"><strong>优化方向</strong><p>${escapeHtml(category.action)}</p></div>
      </div>
      <div class="issue-sources">${(category.sources || []).map((source) => `<span>${escapeHtml(source)}</span>`).join("")}</div>
      ${sampleList}
    </article>`;
  }).join("") || `<div class="empty">暂无足够问题信号，后续活动数据更新后自动补充。</div>`;
  return `<section class="card portfolio-issues bubble-wall-section"><div class="section-title"><span>核心问题智能总结</span><span class="tiny">四大体验维度 · 问题—证据—行动</span></div><div class="issue-bubble-wall ordered-bubble-stack">${cards}</div></section>`;
}

function keywordRanking(items = [], mode = "positive") {
  const max = Math.max(1, ...items.map((item) => Number(item.count || 0)));
  return `<div class="keyword-ranking">${items.slice(0, 8).map((item, index) => `<div class="rank-row">
    <span class="rank-number">${index + 1}</span><span class="rank-name">${escapeHtml(item.keyword)}</span>
    <span class="rank-track ${mode}"><i style="width:${Math.max(5, Number(item.count || 0) / max * 100)}%"></i></span><strong>${Number(item.count || 0)}</strong>
  </div>`).join("") || `<div class="empty">暂无关键词</div>`}</div>`;
}

function portfolioKeywords(summary = {}) {
  return `<section class="portfolio-keywords">
    <div class="card green"><div class="section-title"><span>正向关键词频率</span><span class="tiny">跨活动累计</span></div>${keywordRanking(summary.positiveKeywords, "positive")}<div class="portfolio-cloud">${(summary.positiveKeywords || []).slice(0, 12).map((item, index) => `<span class="cloud-word positive word-${index % 4}">${escapeHtml(item.keyword)}<small>${item.count}</small></span>`).join("")}</div></div>
    <div class="card pink"><div class="section-title"><span>负向关键词频率</span><span class="tiny">跨活动累计</span></div>${keywordRanking(summary.negativeKeywords, "negative")}<div class="portfolio-cloud">${(summary.negativeKeywords || []).slice(0, 12).map((item, index) => `<span class="cloud-word negative word-${index % 4}">${escapeHtml(item.keyword)}<small>${item.count}</small></span>`).join("")}</div></div>
  </section>`;
}

function portfolioPage() {
  const summary = state.portfolio || {};
  return shell(`${portfolioMetrics(summary)}
    ${campaignScoreComparison(summary.campaignScores, summary)}
    ${portfolioResearchFocus(summary.researchFocus)}
    ${coreIssues(summary.issueCategories)}
    ${portfolioKeywords(summary)}`);
}

function dashboardPage() {
  const metrics = state.dashboard?.metrics || {};
  const analysis = state.insights?.analysis || {};
  return shell(`${metricsCards(metrics)}
    <section class="grid">
      <div class="card"><div class="section-title"><span>评分分布</span><span class="tiny">1-10 分</span></div>${ratingChart(metrics.ratingDistribution)}</div>
      <div class="card dashboard-summary-card"><div class="section-title"><span>AI 今日摘要</span><span class="tiny">OpenAI / 本地规则</span></div><div class="quote dashboard-summary-text">${escapeHtml(analysis.summary || "同步数据后会显示分析摘要。")}</div></div>
    </section>
    ${guidancePanel(metrics)}
    ${djContestPanel(metrics)}
    ${baixiHalloweenPanel(metrics)}
    <section class="keyword-grid">${keywordPanel("正向关键词", metrics.positiveKeywords, "positive")}${keywordPanel("负向关键词", metrics.negativeKeywords, "negative")}</section>
    ${selectedResponses(metrics.selectedResponses)}
    ${rawPreview()}`);
}

function rawPreview() {
  const rows = state.responses.slice(0, 6);
  return `<section class="card"><div class="section-title"><span>原始答卷预览</span><span class="tiny">完整内容见“原始答卷”</span></div>${answerTable(rows)}</section>`;
}

function answersPage() {
  const query = state.search.trim().toLowerCase();
  const rows = state.responses.filter((item) => {
    if (state.answerFocus) {
      if (state.answerFocus.recordKey) return String(item.record_key || "") === String(state.answerFocus.recordKey);
      return String(item.sequence) === String(state.answerFocus.sequence)
        && String(item.submitted_at || "") === String(state.answerFocus.submittedAt || "");
    }
    return !query || JSON.stringify(item).toLowerCase().includes(query);
  });
  return shell(`<section class="card">
    <div class="section-title"><span>原始答卷</span><span class="tiny">${rows.length} / ${state.responses.length} 条</span></div>
    ${state.answerFocus ? `<div class="answer-focus"><span>已从综合评价定位到答卷 #${escapeHtml(state.answerFocus.sequence)}</span><button id="clearAnswerFocus">查看全部答卷</button></div>` : ""}
    <div class="toolbar"><input id="searchInput" placeholder="搜索开放题、导览、年龄、性别、评分" value="${escapeAttr(state.search)}"></div>
    ${answerTable(rows)}
  </section>`);
}

function answerTable(rows) {
  if (!rows.length) return `<div class="empty">当前周期暂无提交数据。问卷开始填写后，自动刷新会把新答卷同步到这里。</div>`;
  return `<div class="table-wrap"><table><thead><tr>
    <th>序号</th><th>来源 / 时间</th><th>用户信息</th><th>评分</th><th>关键回答摘要</th><th>完整答卷</th>
  </tr></thead><tbody>${rows.map((item) => {
    const a = item.answers || {};
    const key = item.record_key || `${item.sequence}-${item.submitted_at}`;
    const isOffline = item.channel === "offline";
    const displayDate = isOffline ? [item.period_label, item.date_label].filter(Boolean).join(" · ") : (item.submitted_at || "");
    const detail = state.expanded === key ? answerDetail(item) : "";
    const suggestions = [...new Set([a["建议"], a["改进"], a["想玩主题"]].filter(Boolean))].join(" / ");
    const highlights = [a["印象最深"], a["本期活动反馈"], a["夏日DJ大赛"], suggestions].filter(Boolean).slice(0, 2).join(" / ");
    return `<tr class="answer-row ${state.expanded === key ? "is-expanded" : ""}" data-expand="${escapeAttr(key)}"><td class="compact-cell">${item.sequence}</td><td class="compact-cell"><span class="source-badge ${isOffline ? "offline" : "online"}">${isOffline ? "线下" : "线上"}</span><span class="source-date">${escapeHtml(displayDate)}</span></td><td class="compact-cell"><strong>${escapeHtml(item.gender || "未填")}</strong><span class="source-date">${escapeHtml(item.age || "年龄未填")}${item.participated ? ` · ${escapeHtml(item.participated)}` : ""}</span></td><td class="rating-cell">${item.rating ?? "-"}<small>/10</small></td><td class="text-cell answer-summary">${escapeHtml(highlights || "点击查看完整问题与回答")}</td><td class="expand-cell">${state.expanded === key ? "收起" : "查看全部问题 →"}</td></tr>${detail}`;
  }).join("")}</tbody></table></div>`;
}

function answerDetail(item) {
  const a = item.answers || {};
  const metadataFields = ["序号", "提交答卷时间", "所用时间", "来源", "来源详情", "来自IP", "总分"];
  const rawEntries = Object.entries(item.raw_answers || item.raw || {}).filter(([question, value]) => {
    const label = String(question || "").trim();
    return label && String(value ?? "").trim() && !metadataFields.some((field) => label === field || label.startsWith(`${field}:`));
  });
  const fallbackFields = ["印象最深", "导览清晰", "导览不清晰", "本期活动名称", "本期活动反馈", "建议", "想玩主题", "INS印象", "改进"]
    .filter((field) => String(a[field] ?? "").trim())
    .map((field) => [field, a[field], true]);
  const entries = rawEntries.length ? rawEntries.map(([question, value]) => [question, value, false]) : fallbackFields;
  return `<tr class="detail-row"><td colspan="6"><div class="answer-detail">
    <div class="detail-meta">
      <span class="detail-pill">${item.channel === "offline" ? "调研周期" : "提交日期"}：${escapeHtml(item.channel === "offline" ? [item.period_label, item.date_label].filter(Boolean).join(" · ") : (item.submitted_at || ""))}</span>
      <span class="detail-pill">所用时间：${escapeHtml(item.duration || "")}</span>
      <span class="detail-pill">来源：${escapeHtml(item.source || "")}</span>
      <span class="detail-pill">来源详情：${escapeHtml(item.source_detail || "")}</span>
      <span class="detail-pill">地区：${escapeHtml(item.location || "")}</span>
    </div>
    <div class="answer-question-head"><strong>完整问题与回答</strong><span>${entries.length} 个已回答问题${rawEntries.length ? " · 保留原始题目" : " · 标准化字段"}</span></div>
    <div class="detail-grid question-detail-grid">${entries.map(([question, rawValue, normalized]) => {
      const value = question === "导览清晰" ? formatGuidanceClarity(rawValue) : rawValue;
      return `<div class="detail-item question-answer-item"><div class="detail-label">${normalized ? '<span class="normalized-badge">标准化</span>' : ""}${escapeHtml(question)}</div><div class="detail-value">${escapeHtml(value || "未填写")}</div></div>`;
    }).join("")}</div>
  </div></td></tr>`;
}

function insightIssueCategory(keyword) {
  if (/酒|饮品|啤酒/.test(keyword)) return { id: "drinks", label: "消费体验", tone: "yellow" };
  if (/指引|提示|导览|不知道|看不懂/.test(keyword)) return { id: "guidance", label: "信息触达", tone: "blue" };
  if (/排队|等待|拥挤|入口|动线|空间|NPC/.test(keyword)) return { id: "onsite", label: "现场运营", tone: "green" };
  return { id: "activity", label: "活动体验", tone: "coral" };
}

function insightAction(keyword) {
  if (/排队|等待|拥挤/.test(keyword)) return "优化高峰分流，并补充等待提示与轻互动";
  if (/指引|提示|导览|不知道|看不懂/.test(keyword)) return "统一入口、楼层与玩法说明";
  if (/酒|饮品|啤酒/.test(keyword)) return "按消费场景调整品类与推荐方式";
  if (/NPC/.test(keyword)) return "核对问题时段并补足互动覆盖";
  if (/奖品|奖励/.test(keyword)) return "提升奖励辨识度与即时获得感";
  return "定位发生环节，在下一轮活动验证优化";
}

function buildInsightWorkspace(metrics = {}) {
  const total = Math.max(1, Number(metrics.totalResponses || state.responses.length || 1));
  const source = metrics.negativeKeywords || [];
  const maxCount = Math.max(1, ...source.map((item) => Number(item.count || 0)));
  const issues = source.slice(0, 9).map((item, index) => {
    const count = Number(item.count || 0);
    const category = insightIssueCategory(item.keyword || "");
    const relative = count / maxCount;
    const priority = index === 0 && count >= 2 ? "P0" : index < 4 ? "P1" : "观察";
    return {
      id: `issue-${index}`,
      keyword: item.keyword || "待核查问题",
      count,
      share: Math.round(count / total * 1000) / 10,
      category,
      priority,
      impact: [82, 58, 42, 80, 18, 40, 62, 84, 27][index],
      severity: [78, 62, 75, 48, 24, 38, 20, 28, 46][index],
      quotes: (item.quotes || []).slice(0, 2),
      action: insightAction(item.keyword || ""),
    };
  });
  const opportunities = (metrics.positiveKeywords || []).slice(0, 7).map((item) => ({ label: item.keyword, count: item.count }));
  return { issues, opportunities };
}

function insightMap(issues, activeId) {
  if (!issues.length) return `<div class="empty">当前没有形成集中问题信号。</div>`;
  const maxCount = Math.max(1, ...issues.map((item) => item.count));
  return `<div class="insight-message-board">
    ${issues.map((item, index) => {
      const strength = Math.max(0, Math.min(1, item.count / maxCount));
      const side = index % 4 === 1 || index % 4 === 2 ? "from-right" : "from-left";
      return `<div class="insight-message ${side}"><button class="insight-message-bubble tone-${item.category.tone} ${item.id === activeId ? "active" : ""}" data-insight-issue="${item.id}" style="--signal:${strength}">
        <span class="message-meta">${escapeHtml(item.category.label)} · ${item.priority}</span>
        <strong>${escapeHtml(item.keyword)}</strong>
        <small><b>${item.count}</b> 次提及 · ${item.share}% 样本</small>
      </button></div>`;
    }).join("")}
  </div>`;
}

function insightDiagnosis(issue) {
  if (!issue) return `<div class="insight-diagnosis empty">选择问题气泡查看诊断。</div>`;
  return `<section class="insight-diagnosis tone-${issue.category.tone}">
    <div class="diagnosis-head"><div><span>${escapeHtml(issue.category.label)} · ${issue.priority}</span><h2>${escapeHtml(issue.keyword)}</h2></div><strong>${issue.count}<small>次提及</small></strong></div>
    <div class="diagnosis-signal"><span>影响样本</span><b>${issue.share}%</b><i style="width:${Math.max(5, issue.share)}%"></i></div>
    <div class="diagnosis-block"><span>核心判断</span><p>${escapeHtml(`${issue.keyword}已形成明确体验信号，需要定位发生时段与环节。`)}</p></div>
    <div class="diagnosis-quotes">${issue.quotes.map((quote) => `<blockquote>${escapeHtml(quote)}</blockquote>`).join("") || `<blockquote>暂无可展示原话，建议进入原始答卷核查。</blockquote>`}</div>
    <div class="diagnosis-action"><span>建议动作</span><strong>${escapeHtml(issue.action)}</strong></div>
    <button class="insight-evidence-link" data-insight-evidence="${escapeAttr(issue.keyword)}">查看相关原始答卷 →</button>
  </section>`;
}

function insightActionLanes(issues) {
  const lanes = [
    ["P0", "立即处理"], ["P1", "本期优化"], ["观察", "继续验证"],
  ];
  return `<section class="insight-action-lanes">${lanes.map(([key, label]) => {
    const items = issues.filter((item) => item.priority === key);
    return `<div class="action-lane lane-${key === "P0" ? "now" : key === "P1" ? "next" : "watch"}"><div class="lane-head"><span>${key}</span><strong>${label}</strong><small>${items.length}</small></div>${items.map((item) => `<button data-insight-issue="${item.id}"><span>${escapeHtml(item.keyword)}</span><small>${escapeHtml(item.action)}</small><b>${item.count}</b></button>`).join("") || `<div class="lane-empty">暂无事项</div>`}</div>`;
  }).join("")}</section>`;
}

function insightsPage() {
  const metrics = state.insights?.metrics || state.dashboard?.metrics || {};
  const workspace = buildInsightWorkspace(metrics);
  const active = workspace.issues.find((item) => item.id === state.activeInsightIssue) || workspace.issues[0];
  if (active && !state.activeInsightIssue) state.activeInsightIssue = active.id;
  const p0 = workspace.issues.filter((item) => item.priority === "P0").length;
  const p1 = workspace.issues.filter((item) => item.priority === "P1").length;
  const watch = workspace.issues.filter((item) => item.priority === "观察").length;
  const headline = active ? `${active.keyword}是当前最优先核查的体验问题。` : "当前未发现集中负向信号。";
  return shell(`<section class="insight-workbench">
    <div class="insight-status-strip"><div><span>P0 立即处理<strong>${p0}</strong></span><span>P1 本期优化<strong>${p1}</strong></span><span>观察<strong>${watch}</strong></span><span>机会<strong>${workspace.opportunities.length}</strong></span></div><p>${escapeHtml(headline)}</p></div>
    <div class="insight-main-grid"><section class="card insight-map-card"><div class="section-title"><span>问题信号对话流</span><span class="tiny">气泡宽度表示提及强度</span></div>${insightMap(workspace.issues, active?.id)}</section>${insightDiagnosis(active)}</div>
    ${insightActionLanes(workspace.issues)}
    <section class="insight-opportunities"><div><strong>待验证机会</strong><span>需求信号，不等于当前问题</span></div><div>${workspace.opportunities.map((item) => `<span style="--weight:${Math.min(1, Number(item.count || 0) / Math.max(1, workspace.opportunities[0]?.count || 1))}">${escapeHtml(item.label)}<small>${item.count}</small></span>`).join("") || `<em>暂无机会信号</em>`}</div></section>
  </section>`);
}

function buildClientWeeklyReport() {
  const metrics = state.dashboard?.metrics || {};
  const campaign = activeCampaign();
  const positive = (metrics.positiveKeywords || []).slice(0, 5).map((item) => `${item.keyword}（${item.count}）`).join("、") || "暂无集中正向主题";
  const negative = (metrics.negativeKeywords || []).slice(0, 5).map((item) => `${item.keyword}（${item.count}）`).join("、") || "暂无集中问题";
  const selected = (metrics.selectedResponses || []).slice(0, 3).map((item, index) => `${index + 1}. ${item.quote || item.text || ""}`).filter((item) => !item.endsWith(". ")).join("\n") || "暂无精选答复";
  const generatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
  const report = `# ${campaign.label} 调研周报

生成时间：${generatedAt}

## 核心数据
- 当前样本：${metrics.totalResponses || 0} 份
- 平均评分：${metrics.averageRating ?? "暂无"} / 10
- 线上样本：${state.sourceCounts.online || 0} 份
- 线下样本：${state.sourceCounts.offline || 0} 份

## 体验亮点
${positive}

## 核心问题
${negative}

## 精选用户原话
${selected}

## 本周建议
1. 优先核查最高频负向问题对应的时段、区域和执行环节。
2. 保留高频正向体验，并在下一轮传播与现场执行中强化。
3. 下一次刷新时对比问题提及次数与平均评分变化。`;
  return {
    title: `${campaign.label} 当前周报`,
    report_markdown: report,
    generated_at: generatedAt,
    filename: `${campaign.id}-weekly-report.md`,
  };
}

function reportsPage() {
  const reports = state.reports || [];
  const refreshReports = state.refreshReports || [];
  const pdfs = state.onepagePdfs || [];
  const current = state.generatedReport || reports[0];
  const reportActions = `<div class="report-page-actions"><button class="primary" id="generateReportPageBtn">${STATIC_MODE ? "生成当前周报" : "生成最新周报"}</button><button id="downloadGeneratedReportBtn" ${current ? "" : "disabled"}>下载文本报告</button><span>${STATIC_MODE ? "根据当前已同步数据即时生成" : "生成后会保存到历史报告"}</span></div>`;
  const refreshList = refreshReports.length ? `<section class="card"><div class="section-title"><span>刷新前归档</span><span class="tiny">${refreshReports.length} 份留档</span></div>${refreshReports.map((item) => `<div class="quote"><strong>${escapeHtml(item.title)}</strong><br><span class="tiny">答卷数：${item.response_count} · ${escapeHtml(item.created_at || "")}</span><div class="report">${escapeHtml(item.report_markdown || "")}</div></div>`).join("")}</section>` : `<section class="card"><div class="section-title"><span>刷新前归档</span><span class="tiny">0 份留档</span></div><div class="empty">自动刷新前会先生成归档报告。</div></section>`;
  const pdfList = `<section class="card"><div class="section-title"><span>图文 onepage PDF</span><span class="tiny">16:9 · 最多 2 页</span></div>${pdfs.length ? pdfs.map((item, index) => `<div class="quote"><strong>${escapeHtml(item.filename)}</strong><br>${item.encrypted ? `<button class="pdf-download" data-pdf-index="${index}">解密并下载 PDF</button>` : `<a href="${escapeAttr(item.download_url)}" target="_blank">下载 PDF</a>`}</div>`).join("") : `<div class="empty">点击顶部“生成图文PDF”，会生成一份 16:9 图文版周报。</div>`}</section>`;
  return shell(`${reportActions}<section class="card"><div class="section-title"><span>每周报告</span><span class="tiny">${reports.length} 份历史报告${state.generatedReport ? " · 当前临时生成" : ""}</span></div>${current ? `<div class="report">${escapeHtml(current.report_markdown)}</div>` : `<div class="empty">暂无周报，点击“生成当前周报”。</div>`}</section>${pdfList}${refreshList}`);
}

function render({ preserveMainScroll = false } = {}) {
  const previousMainScroll = preserveMainScroll
    ? (document.querySelector("main")?.scrollTop || 0)
    : 0;
  const content = state.page === "portfolio" ? portfolioPage()
    : state.page === "answers" ? answersPage()
    : state.page === "insights" ? insightsPage()
    : state.page === "reports" ? reportsPage()
    : dashboardPage();
  document.getElementById("app").innerHTML = content;
  bind();
  window.VisitorAnalytics?.trackPage(state.page === "portfolio" ? "portfolio" : state.campaign, state.page);
  if (preserveMainScroll) {
    const main = document.querySelector("main");
    if (main) main.scrollTop = previousMainScroll;
  }
}

function bind() {
  bindVisitorAnalytics();
  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("researchAuthKey");
    AUTH_KEY = null;
    window.STATIC_DATA = null;
    renderLogin();
  });
  document.querySelectorAll("[data-pdf-index]").forEach((el) => el.addEventListener("click", () => {
    const item = state.onepagePdfs[Number(el.dataset.pdfIndex)];
    if (item) downloadEncryptedPdf(item, el);
  }));
  document.querySelectorAll("[data-source]").forEach((el) => el.addEventListener("click", () => {
    state.source = el.dataset.source;
    state.answerFocus = null;
    applyCampaignData();
    render();
  }));
  document.querySelectorAll("[data-page]").forEach((el) => el.addEventListener("click", () => {
    if (el.dataset.campaign && state.campaign !== el.dataset.campaign) {
      state.campaign = el.dataset.campaign;
      applyCampaignData();
    }
    state.page = el.dataset.page;
    render();
  }));
  document.getElementById("syncBtn")?.addEventListener("click", () => runAction("/api/sync", "同步"));
  document.getElementById("analysisBtn")?.addEventListener("click", () => runAction("/api/analysis", "分析"));
  document.getElementById("reportBtn")?.addEventListener("click", () => runAction("/api/reports/weekly", "周报"));
  document.getElementById("generateReportPageBtn")?.addEventListener("click", () => {
    if (!STATIC_MODE) {
      runAction("/api/reports/weekly", "周报");
      return;
    }
    state.generatedReport = buildClientWeeklyReport();
    render({ preserveMainScroll: true });
  });
  document.getElementById("downloadGeneratedReportBtn")?.addEventListener("click", () => {
    const report = state.generatedReport || state.reports?.[0];
    if (report) downloadTextReport(report);
  });
  document.getElementById("pdfBtn")?.addEventListener("click", () => runPdfAction());
  document.getElementById("searchInput")?.addEventListener("input", (event) => {
    state.answerFocus = null;
    state.search = event.target.value;
    render();
  });
  document.getElementById("clearAnswerFocus")?.addEventListener("click", () => {
    state.answerFocus = null;
    state.expanded = null;
    render();
  });
  document.querySelectorAll("[data-issue]").forEach((el) => el.addEventListener("click", () => {
    state.activeIssue = state.activeIssue === el.dataset.issue ? null : el.dataset.issue;
    render({ preserveMainScroll: true });
  }));
  document.querySelectorAll("[data-insight-issue]").forEach((el) => el.addEventListener("click", () => {
    state.activeInsightIssue = el.dataset.insightIssue;
    render({ preserveMainScroll: true });
  }));
  document.querySelectorAll("[data-insight-evidence]").forEach((el) => el.addEventListener("click", () => {
    state.page = "answers";
    state.search = el.dataset.insightEvidence || "";
    state.answerFocus = null;
    state.expanded = null;
    render();
  }));
  document.querySelectorAll("[data-category-sample-index]").forEach((el) => el.addEventListener("click", () => {
    const category = (state.portfolio?.issueCategories || []).find((item) => item.id === el.dataset.categoryId);
    const samples = (category?.issues || []).flatMap((issue) => issue.samples || []);
    const sample = samples[Number(el.dataset.categorySampleIndex)];
    if (!sample) return;
    state.campaign = sample.campaignId;
    applyCampaignData();
    state.page = "answers";
    state.search = "";
    state.answerFocus = { recordKey: sample.recordKey || "", sequence: sample.sequence, submittedAt: sample.submittedAt };
    state.expanded = sample.recordKey || `${sample.sequence}-${sample.submittedAt}`;
    render();
  }));
  document.querySelectorAll("[data-expand]").forEach((el) => el.addEventListener("click", () => {
    const key = el.dataset.expand;
    state.expanded = state.expanded === key ? null : key;
    render({ preserveMainScroll: true });
  }));
}

function downloadTextReport(report) {
  const blob = new Blob([report.report_markdown || ""], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = report.filename || "weekly-report.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadEncryptedPdf(item, button) {
  if (!AUTH_KEY) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "正在解密...";
  try {
    const response = await fetch(item.download_url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const encrypted = new Uint8Array(await response.arrayBuffer());
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: encrypted.slice(0, 12),
      additionalData: new TextEncoder().encode(item.filename),
    }, AUTH_KEY, encrypted.slice(12));
    const url = URL.createObjectURL(new Blob([decrypted], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = item.filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(`PDF 下载失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function runPdfAction() {
  try {
    await api("/api/reports/onepage", { method: "POST" });
    await loadAll();
    state.page = "reports";
    render();
  } catch (error) {
    alert(`图文PDF生成失败：${error.message}`);
  }
}

async function runAction(path, label) {
  state.loading = true;
  render();
  try {
    await api(path, { method: "POST" });
    await loadAll();
  } catch (error) {
    alert(`${label}失败：${error.message}`);
  } finally {
    state.loading = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatGuidanceClarity(value) {
  const text = String(value || "").trim();
  if (text === "是") return "清晰";
  if (text === "否") return "不清晰";
  return text;
}

function parseSubmittedAt(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const normalized = text
    .replace(/[年月]/g, "/")
    .replace(/日/g, "")
    .replace(/-/g, "/")
    .replace(/\s+/g, " ");
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!match) return 0;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
}

function sortResponsesNewestFirst(responses) {
  return [...responses].sort((a, b) => {
    const timeDiff = parseSubmittedAt(b.submitted_at) - parseSubmittedAt(a.submitted_at);
    if (timeDiff) return timeDiff;
    return Number(b.sequence || 0) - Number(a.sequence || 0);
  });
}

async function boot() {
  if (PROTECTED_MODE) {
    if (await restoreProtectedSession()) {
      await loadAll();
    } else {
      renderLogin();
    }
    return;
  }
  await loadAll();
}

boot().catch((error) => {
  const fileHint = location.protocol === "file:" && !STATIC_MODE
    ? `<p>你现在打开的是开发版 <code>web/index.html</code>，它需要本地服务接口。</p>
       <p>直接查看请打开 <code>public_site/index.html</code>，或者访问 <code>http://127.0.0.1:8787/</code>。</p>`
    : "";
  document.getElementById("app").innerHTML = `<main><div class="card"><h1>加载失败</h1>${fileHint}<p>${escapeHtml(error.message)}</p></div></main>`;
});
