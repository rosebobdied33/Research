const state = {
  campaign: "sunset-ride",
  page: "dashboard",
  campaigns: [],
  campaignData: {},
  dashboard: null,
  responses: [],
  insights: null,
  reports: [],
  refreshReports: [],
  onepagePdfs: [],
  loading: false,
  search: "",
  expanded: null,
};

const STATIC_MODE = Boolean(window.STATIC_DATA);

const pages = [
  ["dashboard", "总览"],
  ["answers", "原始答卷"],
  ["insights", "洞察分析"],
  ["reports", "每周报告"],
];

const defaultCampaigns = [
  { id: "sunset-ride", label: "3.落日飞车", title: "INS LAND新乐园落日飞车市场需求调研问卷", pendingLink: false },
  { id: "flash-cruise", label: "2.闪光邮轮", title: "INS LAND新乐园闪光邮轮市场需求调研问卷", pendingLink: false },
  { id: "game-world", label: "1.游戏世界", title: "INS LAND新乐园游戏世界市场需求调研问卷", pendingLink: false },
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
  state.campaign = data.activeCampaign || (state.campaigns.some((item) => item.id === state.campaign) ? state.campaign : (state.campaigns[0]?.id || "sunset-ride"));
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
  state.dashboard = data.dashboard || createEmptyCampaignPayload().dashboard;
  state.responses = sortResponsesNewestFirst(data.responses?.responses || []);
  state.insights = data.insights || createEmptyCampaignPayload().insights;
  state.reports = data.reports?.reports || [];
  state.refreshReports = data.reports?.refreshReports || [];
  state.onepagePdfs = data.reports?.onepagePdfs || [];
  state.expanded = null;
}

function nav() {
  const groups = orderedCampaigns().map((campaign) => {
    const isActiveCampaign = state.campaign === campaign.id;
    const children = pages.map(([id, label]) => `<div class="nav-child ${isActiveCampaign && state.page === id ? "active" : ""}" data-campaign="${campaign.id}" data-page="${id}">${label}</div>`).join("");
    return `<div class="nav-group">
      <button class="nav-campaign ${isActiveCampaign ? "active" : ""}" data-campaign="${campaign.id}" data-page="${state.page}">
        <span>${escapeHtml(campaign.label)}</span>
        <span class="nav-status">${campaign.pendingLink ? "待链接" : "已接入"}</span>
      </button>
      <div class="nav-children ${isActiveCampaign ? "open" : ""}">${children}</div>
    </div>`;
  }).join("");
  return `<aside><div class="brand"><div class="mark"></div><span>INS LAND 调研</span></div><nav>${groups}</nav></aside>`;
}

function shell(content) {
  const latest = state.dashboard?.latestSync;
  const updated = latest?.finished_at ? `最后同步：${latest.finished_at}` : "尚未同步";
  const modeText = STATIC_MODE ? "公开静态版" : "本地数据";
  const campaign = activeCampaign();
  const isPending = Boolean(campaign.pendingLink || activePayload().pendingLink);
  const actionDisabled = isPending || (!STATIC_MODE && state.campaign !== "game-world");
  const mobileNav = `<div class="mobile-nav">${
    orderedCampaigns().map((item) => `<button class="mobile-campaign-item ${state.campaign === item.id ? "active" : ""}" data-campaign="${item.id}" data-page="${state.page}">${escapeHtml(item.label)}</button>`).join("")
  }</div><div class="mobile-nav page-tabs">${
    pages.map(([id, label]) => `<button class="mobile-nav-item ${state.page === id ? "active" : ""}" data-campaign="${state.campaign}" data-page="${id}">${label}</button>`).join("")
  }</div>`;
  return `<div class="app">${nav()}<main>
    <div class="topbar">
      <div><div class="campaign-eyebrow">${escapeHtml(campaign.label)}</div><h1>${escapeHtml(campaign.title || campaign.label)}</h1><div class="sub">${updated} · ${modeText} · ${state.dashboard?.hasOpenAIKey ? "OpenAI 已配置" : "OpenAI 未配置"}</div></div>
      <div class="actions ${STATIC_MODE ? "static-actions" : ""}">
        <button id="analysisBtn" ${actionDisabled ? "disabled" : ""}>生成分析</button>
        <button id="reportBtn" ${actionDisabled ? "disabled" : ""}>生成周报</button>
        <button id="pdfBtn" ${actionDisabled ? "disabled" : ""}>生成图文PDF</button>
        <button class="primary" id="syncBtn" ${actionDisabled ? "disabled" : ""}>立即同步</button>
      </div>
    </div>
    ${mobileNav}
    ${isPending ? pendingBanner() : ""}
    ${content}
  </main></div>`;
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
  return `<section class="metrics">
    <div class="card pink"><div class="label">活动参与率</div><div class="value">${metrics.participationRate ?? 0}%</div><div class="muted">参与活动用户占比</div></div>
    <div class="card blue"><div class="label">样本总量</div><div class="value">${metrics.totalResponses ?? 0}</div><div class="muted">当前已同步答卷</div></div>
    <div class="card green score-card"><div class="label">平均评分</div><div class="score-circle"><div class="score-value">${metrics.averageRating ?? "-"}</div><div class="score-unit">/ 10</div></div><div class="muted">仅统计已填写评分的答卷 · ${ratingCount} 个有效评分</div></div>
  </section>`;
}

function ratingChart(dist = {}) {
  const max = Math.max(1, ...Object.values(dist).map(Number));
  const bars = Array.from({ length: 10 }, (_, index) => {
    const score = String(index + 1);
    const value = Number(dist[score] || 0);
    const height = Math.max(8, Math.round(value / max * 190));
    return `<div title="${score}分：${value}" class="bar" style="height:${height}px"></div>`;
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

function dashboardPage() {
  const metrics = state.dashboard?.metrics || {};
  const analysis = state.insights?.analysis || {};
  return shell(`${metricsCards(metrics)}
    <section class="grid">
      <div class="card"><div class="section-title"><span>评分分布</span><span class="tiny">1-10 分</span></div>${ratingChart(metrics.ratingDistribution)}</div>
      <div class="card"><div class="section-title"><span>AI 今日摘要</span><span class="tiny">OpenAI / 本地规则</span></div><div class="quote">${escapeHtml(analysis.summary || "同步数据后会显示分析摘要。")}</div></div>
    </section>
    ${guidancePanel(metrics)}
    ${djContestPanel(metrics)}
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
  const rows = state.responses.filter((item) => !query || JSON.stringify(item).toLowerCase().includes(query));
  return shell(`<section class="card">
    <div class="section-title"><span>原始答卷</span><span class="tiny">${rows.length} / ${state.responses.length} 条</span></div>
    <div class="toolbar"><input id="searchInput" placeholder="搜索开放题、导览、年龄、性别、评分" value="${escapeAttr(state.search)}"></div>
    ${answerTable(rows)}
  </section>`);
}

function answerTable(rows) {
  if (!rows.length) return `<div class="empty">当前周期暂无提交数据。问卷开始填写后，自动刷新会把新答卷同步到这里。</div>`;
  return `<div class="table-wrap"><table><thead><tr>
    <th>序号</th><th>提交时间</th><th>年龄</th><th>性别</th><th>参与</th><th>评分</th><th>导览清晰</th><th>本期活动</th><th>印象最深</th><th>建议/改进</th>
  </tr></thead><tbody>${rows.map((item) => {
    const a = item.answers || {};
    const key = `${item.sequence}-${item.submitted_at}`;
    const detail = state.expanded === key ? answerDetail(item) : "";
    return `<tr class="answer-row" data-expand="${escapeAttr(key)}"><td class="compact-cell">${item.sequence}</td><td class="compact-cell">${escapeHtml(item.submitted_at || "")}</td><td class="compact-cell">${escapeHtml(item.age || "")}</td><td class="compact-cell">${escapeHtml(item.gender || "")}</td><td class="compact-cell">${escapeHtml(item.participated || "")}</td><td class="compact-cell">${item.rating ?? ""}</td><td class="compact-cell">${escapeHtml(formatGuidanceClarity(a["导览清晰"]))}</td><td class="text-cell dj-cell">${escapeHtml(a["本期活动反馈"] || a["夏日DJ大赛"] || "")}</td><td class="text-cell">${escapeHtml(a["印象最深"] || "")}</td><td class="text-cell">${escapeHtml([a["建议"], a["改进"], a["想玩主题"]].filter(Boolean).join(" / "))}</td></tr>${detail}`;
  }).join("")}</tbody></table></div>`;
}

function answerDetail(item) {
  const a = item.answers || {};
  const fields = ["印象最深", "导览清晰", "导览不清晰", "本期活动名称", "本期活动反馈", "建议", "想玩主题", "INS印象", "改进"];
  return `<tr class="detail-row"><td colspan="10"><div class="answer-detail">
    <div class="detail-meta">
      <span class="detail-pill">提交日期：${escapeHtml(item.submitted_at || "")}</span>
      <span class="detail-pill">所用时间：${escapeHtml(item.duration || "")}</span>
      <span class="detail-pill">来源：${escapeHtml(item.source || "")}</span>
      <span class="detail-pill">来源详情：${escapeHtml(item.source_detail || "")}</span>
      <span class="detail-pill">地区：${escapeHtml(item.location || "")}</span>
    </div>
    <div class="detail-grid">${fields.map((field) => {
      const value = field === "导览清晰" ? formatGuidanceClarity(a[field]) : a[field];
      return `<div class="detail-item"><div class="detail-label">${escapeHtml(field)}</div><div class="detail-value">${escapeHtml(value || "未填写")}</div></div>`;
    }).join("")}</div>
  </div></td></tr>`;
}

function insightsPage() {
  const metrics = state.insights?.metrics || state.dashboard?.metrics || {};
  const analysis = state.insights?.analysis || {};
  return shell(`<section class="grid">
    <div class="card"><div class="section-title"><span>整体洞察</span><span class="tiny">分析摘要</span></div><div class="quote">${escapeHtml(analysis.summary || "暂无分析。")}</div></div>
    <div class="card"><div class="section-title"><span>建议优先级</span><span class="tiny">行动清单</span></div>${recommendations(analysis.recommendations)}</div>
  </section>
  <section class="keyword-grid">${keywordPanel("正向关键词", analysis.positive_keywords || metrics.positiveKeywords, "positive")}${keywordPanel("负向关键词", analysis.negative_keywords || metrics.negativeKeywords, "negative")}</section>
  ${selectedResponses(analysis.selected_responses || metrics.selectedResponses)}`);
}

function recommendations(items = []) {
  if (!items.length) return `<div class="empty">暂无建议。</div>`;
  return `<div class="keyword-list">${items.map((item) => `<div class="quote"><strong>${escapeHtml(item.priority || "medium")}</strong> ${escapeHtml(item.action || "")}<br><span class="tiny">${escapeHtml(item.evidence || "")}</span></div>`).join("")}</div>`;
}

function reportsPage() {
  const reports = state.reports || [];
  const refreshReports = state.refreshReports || [];
  const pdfs = state.onepagePdfs || [];
  const current = reports[0];
  const refreshList = refreshReports.length ? `<section class="card"><div class="section-title"><span>刷新前归档</span><span class="tiny">${refreshReports.length} 份留档</span></div>${refreshReports.map((item) => `<div class="quote"><strong>${escapeHtml(item.title)}</strong><br><span class="tiny">答卷数：${item.response_count} · ${escapeHtml(item.created_at || "")}</span><div class="report">${escapeHtml(item.report_markdown || "")}</div></div>`).join("")}</section>` : `<section class="card"><div class="section-title"><span>刷新前归档</span><span class="tiny">0 份留档</span></div><div class="empty">自动刷新前会先生成归档报告。</div></section>`;
  const pdfList = `<section class="card"><div class="section-title"><span>图文 onepage PDF</span><span class="tiny">16:9 · 最多 2 页</span></div>${pdfs.length ? pdfs.map((item) => `<div class="quote"><strong>${escapeHtml(item.filename)}</strong><br><a href="${escapeAttr(item.download_url)}" target="_blank">下载 PDF</a></div>`).join("") : `<div class="empty">点击顶部“生成图文PDF”，会生成一份 16:9 图文版周报。</div>`}</section>`;
  return shell(`<section class="card"><div class="section-title"><span>每周报告</span><span class="tiny">${reports.length} 份历史报告</span></div>${current ? `<div class="report">${escapeHtml(current.report_markdown)}</div>` : `<div class="empty">暂无周报，点击“生成周报”。</div>`}</section>${pdfList}${refreshList}`);
}

function render() {
  const content = state.page === "answers" ? answersPage()
    : state.page === "insights" ? insightsPage()
    : state.page === "reports" ? reportsPage()
    : dashboardPage();
  document.getElementById("app").innerHTML = content;
  bind();
}

function bind() {
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
  document.getElementById("pdfBtn")?.addEventListener("click", () => runPdfAction());
  document.getElementById("searchInput")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });
  document.querySelectorAll("[data-expand]").forEach((el) => el.addEventListener("click", () => {
    const key = el.dataset.expand;
    state.expanded = state.expanded === key ? null : key;
    render();
  }));
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

loadAll().catch((error) => {
  const fileHint = location.protocol === "file:" && !STATIC_MODE
    ? `<p>你现在打开的是开发版 <code>web/index.html</code>，它需要本地服务接口。</p>
       <p>直接查看请打开 <code>public_site/index.html</code>，或者访问 <code>http://127.0.0.1:8787/</code>。</p>`
    : "";
  document.getElementById("app").innerHTML = `<main><div class="card"><h1>加载失败</h1>${fileHint}<p>${escapeHtml(error.message)}</p></div></main>`;
});
