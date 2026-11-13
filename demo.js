const $ = id => document.getElementById(id);
const people = {creator: '曾組員', manager: '周主管', deputy: '陳副主管', member: '李組員'};
const members = Object.values(people);
const departments = ['品保部', '製造部', '工程部', '採購部', '倉儲部', '人資部'];
const department = settings => settings?.department || '品保部';
const storageKey = 'maiagent-approval-demo-v1';
const initial = () => {
  const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
  const settings = {label: '初始版本', department: '品保部', reply: 'Agent 模式'};
  const inspection = {
    ...settings, name: '進料檢驗助理', model: 'Claude 5.5 Opus', knowledge: '品保作業知識庫',
    purpose: '協助品保人員查詢進料抽樣、檢驗判定與隔離流程。',
    instructions: '依檢驗標準列出適用步驟。資料不足時，請使用者提供料號與批號。'
  };
  return {
    agents: [
      {id: 'QA-001', versions: [], history: [], active: null, open: false, draft: {
        ...settings, name: '品保作業助理', purpose: '協助查找品保作業與檢驗規範。',
        instructions: '以條列方式說明適用的標準作業步驟，並註明參考文件。',
        model: '預設模型', knowledge: '品保作業知識庫', updatedAt: hoursAgo(2)
      }},
      {id: 'QA-002', versions: [{
        ...inspection, number: 1, releaseNumber: 1, status: 'approved', reviewer: 'manager',
        submittedBy: people.creator, submittedAt: hoursAgo(72), decidedBy: people.manager,
        decidedAt: hoursAgo(48), publishedAt: hoursAgo(24)
      }], history: [
        {message: '送出 V1・周主管', actor: people.creator, at: hoursAgo(72)},
        {message: '核准 V1', actor: people.manager, at: hoursAgo(48)},
        {message: '開放給部門・V1', actor: people.creator, at: hoursAgo(24)}
      ], active: 1, open: true, draft: {
        ...inspection, releaseKind: '大版更新', updatedAt: hoursAgo(4),
        purpose: '新增供應商批次異常的通報與追蹤流程。'
      }},
      {id: 'QA-003', draft: null, history: [
        {message: '送出 V1・周主管', actor: people.creator, at: hoursAgo(1)}
      ], active: null, open: false, versions: [{
        ...settings, name: '部門新人指引', model: 'GPT-5.6 Luna（Microsoft Azure）',
        knowledge: '部門共用知識庫', purpose: '回答新人報到、必修訓練與常用表單的問題。',
        instructions: '依新人指引提供步驟與聯絡窗口，遇到例外時請轉問部門主管。',
        number: 1, releaseNumber: 1, status: 'pending', reviewer: 'manager',
        submittedBy: people.creator, submittedAt: hoursAgo(1)
      }]}
    ],
    notices: [{id: 1, to: 'manager', kind: 'review', agent: 'QA-003', name: '部門新人指引', version: 1, at: hoursAgo(1), read: false}],
    nextId: 4, schedule: {enabled: false, delegate: 'deputy'}
  };
};
let state;
try { state = JSON.parse(localStorage.getItem(storageKey)) || initial(); }
catch { state = initial(); }
// Older demos allowed a second deputy. Keep existing cases and notifications accessible.
const delegateRoles = ['deputy', 'member'];
if (state.schedule?.delegate === 'alternate') state.schedule.delegate = 'deputy';
if (typeof state.schedule?.enabled !== 'boolean') {
  const previous = state.schedule || {};
  const enabled = ['deputy', 'chief'].includes(previous.mode) &&
    (!previous.start || Date.now() >= Date.parse(previous.start)) &&
    (!previous.until || Date.now() < Date.parse(previous.until));
  state.schedule = {enabled, delegate: 'deputy'};
}
const legacyNames = {'林怡安':'曾組員', '周明哲':'周主管', '李佳穎':'李組員'};
for (const notice of state.notices) {
  if (['chief', 'alternate'].includes(notice.to)) notice.to = 'deputy';
}
for (const agent of state.agents) {
  for (const event of agent.history || []) event.actor = legacyNames[event.actor] || event.actor;
  for (const version of agent.versions) {
    for (const field of ['submittedBy', 'decidedBy']) {
      if (legacyNames[version[field]]) version[field] = legacyNames[version[field]];
    }
    if (['chief', 'alternate'].includes(version.reviewer)) version.reviewer = 'deputy';
  }
}
// Sample announcements are isolated per demo identity; reading never changes a task status.
if (!state.announcementSeeded) {
  for (const to of Object.keys(people)) {
    for (const [index, category, heading, description, tag] of [
      [1, 'system', '訊息處理延遲', '示範公告：訊息處理可能較平常慢，請勿重複送出。', ''],
      [2, 'system', 'Third-Party LLM 服務異常', '示範公告：部分模型暫時無法回應，請稍後再試。', '緊急'],
      [3, 'org', '助理發布審核規則', '助理須經直屬主管或代理人核准，再由建立者手動發布。', '重要']
    ]) state.notices.push({id:`announcement-${to}-${index}`, to, kind:'announcement', category, heading, description, tag, at:timestampSafe(), read:false});
  }
  state.announcementSeeded = true;
}
function timestampSafe() { return new Date().toISOString(); }
let role = 'creator';
let query = '';
let submitterQuery = '';
let listFilters = {status:'', department:''};
let reviewPage = null;
let chatPage = null;
let reviewing = false;
let market = false;
let marketTab = 'org';
let marketQuery = '';
let favoritesOnly = false;
const owns = agent => (agent?.owner || 'creator') === role;
let reviewHistory = false;
let noticeTab = 'review';
let onSubmit;
let feedbackTimer;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => (
  {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]
));
const timestamp = () => new Date().toISOString();
const dateLabel = value => value ? new Date(value).toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', hour12: false}) : '—';
const currentReviewer = () => {
  if (!state.managerOnLeave) return 'manager';
  return state.schedule.enabled && delegateRoles.includes(state.schedule.delegate) ? state.schedule.delegate : null;
};
const reviewerLabel = () => people[currentReviewer()] || '等待主管返工';
const approved = agent => agent.versions.filter(version => version.status === 'approved');
const releaseCandidate = agent => {
  const version = approved(agent).at(-1);
  return version && !version.publishedAt && version.number > (agent.active ?? 0) ? version : null;
};
const live = agent => agent.versions.find(version => version.number === agent.active);
const pending = agent => agent.versions.find(version => version.status === 'pending');
const latest = agent => agent.versions.at(-1);
const versionCopySource = agent => pending(agent) ||
  (latest(agent)?.status === 'withdrawn' ? latest(agent) : releaseCandidate(agent) || live(agent));
const title = agent => (live(agent) ?? agent.draft ?? latest(agent))?.name || agent.name || '未命名助理';
const submitter = version => version.submittedBy || people.creator;
const matchesSubmitter = version => submitter(version).toLowerCase().includes(submitterQuery.trim().toLowerCase());
const releaseNumber = version => version.releaseNumber ?? version.number;
const nextReleaseNumber = (agent, draft = agent.draft) => {
  const published = pending(agent) || releaseCandidate(agent) ||
    agent.versions.findLast(version => version.publishedAt) || live(agent);
  const [major, minor = 0] = published ? String(releaseNumber(published)).split('.').map(Number) : [0, 0];
  const isMinorUpdate = published && draft?.releaseKind === '小版更新' && department(draft) === department(published);
  const targetMajor = isMinorUpdate ? major : major + 1;
  const targetMinor = isMinorUpdate ? minor + 1 : 0;
  const usedMinorNumbers = agent.versions.map(version => String(releaseNumber(version)).split('.').map(Number))
    .filter(([versionMajor]) => versionMajor === targetMajor)
    .map(([, versionMinor = 0]) => versionMinor);
  const latestMinor = Math.max(-1, ...usedMinorNumbers);
  if (latestMinor >= targetMinor) return `${targetMajor}.${latestMinor + 1}`;
  return targetMinor ? `${targetMajor}.${targetMinor}` : targetMajor;
};
const versionName = version => `V${releaseNumber(version)}`;
const button = (label, action, attrs = '', style = '') =>
  `<button type="button" class="${style}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
const agentAttrs = (agent, version) => `data-id="${agent.id}"${version ? ` data-version="${version.number}"` : ''}`;
const badge = (label, style = '') => `<span class="badge ${style}">${esc(label)}</span>`;

function showInfo(title, content) {
  $('info-title').textContent = title;
  $('info-body').innerHTML = content;
  $('info-dialog').showModal();
}

function reasonButton(agent, version) {
  if (!version?.reason) return '';
  const unread = !version.reasonReadBy?.includes(role);
  return iconAction(unread ? '查看退回原因（未讀）' : '查看退回原因', 'note', 'return-reason',
    agentAttrs(agent, version), unread ? 'reason-note is-unread' : 'reason-note');
}

function showReturnReason(version) {
  showInfo('退回原因', `<p><strong>${esc(version.name)} · ${esc(versionName(version))}</strong></p><p class="muted">${esc(version.decidedBy || '審核人')} · ${esc(dateLabel(version.decidedAt))}</p><p class="reason-body">${esc(version.reason)}</p>`);
}

const noticesForRole = () => state.notices.filter(notice => notice.to === role);
const canReview = (agent, version) => Boolean(version && !agent.deleted &&
  version === pending(agent) && version.reviewer === role && currentReviewer() === role);
const canViewReview = (agent, version) => canReview(agent, version) ||
  Boolean(role === 'manager' && !agent.deleted && version && version === pending(agent));
const activeQueue = () => state.agents.filter(agent => canViewReview(agent, pending(agent)));

function persistState() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { /* The demo remains usable in memory when storage is unavailable. */ }
}

function save() {
  persistState();
  render();
}

function feedback(message, action = '', description = '') {
  const element = $('feedback');
  element.hidden = false;
  element.innerHTML = `<span class="toast-icon" aria-hidden="true">✓</span><div><strong>${esc(message)}</strong>${description ? `<p>${esc(description)}</p>` : ''}${action}</div>${button('×', 'dismiss-toast', 'aria-label="關閉通知"')}`;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { element.hidden = true; }, action ? 12000 : 4200);
}

function record(agent, message, actor = people[role]) {
  agent.history.push({message, actor, at: timestamp()});
}

function notify(to, kind, agent, version) {
  if (!to) return;
  state.notices.unshift({
    id: state.notices.length + 1, to, kind, agent: agent.id, name: title(agent),
    version: version.number, at: timestamp(), read: false
  });
}

function syncReviewers() {
  const reviewer = currentReviewer();
  const delayed = [];
  let changed = false;
  for (const agent of state.agents) {
    const version = pending(agent);
    if (agent.deleted || !version || version.reviewer === reviewer) continue;
    record(agent, `V${releaseNumber(version)} 審核交接：${version.reviewer ? people[version.reviewer] : '等候主管返工'} → ${reviewerLabel()}`, '系統');
    if (!version.reviewer && reviewer === 'manager') delayed.push({agent, version});
    else notify(reviewer, 'review', agent, version);
    version.reviewer = reviewer;
    changed = true;
  }
  if (delayed.length) {
    const {agent, version} = delayed[0];
    notify('manager', 'digest', agent, version);
    state.notices[0].count = delayed.length;
  }
  return changed;
}

function render({rowsOnly = false} = {}) {
  const creator = !reviewing;
  const member = false;
  const queue = activeQueue();
  const all = state.agents.filter(agent => !agent.deleted);
  const rows = creator ? all.filter(owns) : member ? all.filter(agent => agent.open && live(agent)) : queue;
  const visible = rows.filter(agent => creator
    ? (creatorBranches(agent).some(branch => matchesRow(branch.settings, branch.number, branch.status)) ||
      agent.versions.some(snapshot => snapshot.status === 'withdrawn' && matchesRow(snapshot, releaseNumber(snapshot), '已撤回')))
    : matchesRow(member ? live(agent) : pending(agent), releaseNumber(member ? live(agent) : pending(agent))) &&
      (member || matchesSubmitter(pending(agent))));
  const reviewNav = $('review-nav');
  reviewNav.hidden = !['manager', 'deputy'].includes(role) && currentReviewer() !== role;
  reviewNav.classList.toggle('current', reviewing);
  $('assistants').classList.toggle('current', !reviewing && !market);
  $('market-nav').classList.toggle('current', market);
  $('market-nav').setAttribute('aria-current', market ? 'page' : 'false');
  if (reviewing) {
    reviewNav.setAttribute('aria-current', 'page');
    $('assistants').removeAttribute('aria-current');
  } else {
    reviewNav.removeAttribute('aria-current');
    $('assistants').setAttribute('aria-current', 'page');
  }
  $('page-title').textContent = member ? '內部對話' : reviewing ? '助理審核' : 'AI 助理';
  $('top-page').textContent = member ? '內部對話' : reviewing ? '助理審核' : 'AI 助理';
  $('top-user').textContent = people[role];
  $('role-trigger').setAttribute('aria-label', `切換 Demo 身分，目前為${people[role]}`);
  $('role').querySelectorAll('[data-role]').forEach(option => {
    option.setAttribute('aria-pressed', String(option.dataset.role === role));
  });
  $('assistants').innerHTML = `<i aria-hidden="true">✧</i>${member ? '內部對話' : 'AI 助理'}`;
  $('page-actions').innerHTML = creator ? button('＋ 建立 AI 助理', 'new', '', 'primary') + iconAction('重新整理', 'refresh', 'refresh', 'title="重新整理"') :
    '';
  $('unread').textContent = noticesForRole().filter(notice => !notice.read).length || '';
  if (chatPage) return renderChat();
  if (market) { $('assistants').removeAttribute('aria-current'); return renderMarket(); }
  if (reviewPage) return renderReviewPage(reviewPage.agent, reviewPage.version);
  if (!creator && !member && !reviewing) {
    $('page-actions').innerHTML = '';
    $('content').innerHTML = '<p class="empty">目前沒有此身分建立的助理。</p>';
    return;
  }
  const filterSelect = (key, label, values) => `<select data-list-filter="${key}" aria-label="${label}" class="${listFilters[key] ? 'has-value' : ''}"><option value="">${label}</option>${[...new Set(values.filter(Boolean))].map(value => `<option value="${esc(value)}" ${listFilters[key] === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
  const branches = creator ? rows.flatMap(creatorBranches) : [];
  const submitterField = reviewing ? `<input id="submitter-search" type="search" list="review-submitters" aria-label="搜尋送審人" placeholder="輸入或選擇送審人" value="${esc(submitterQuery)}"><datalist id="review-submitters">${[...new Set([...members, ...state.agents.flatMap(agent => agent.versions.map(submitter))])].map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>` : '';
  const filters = `<div class="list-toolbar"><div class="filters reference-filters list-search"><label class="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="search" type="search" aria-label="搜尋名稱或版本" placeholder="搜尋名稱或版本（例如 V2）" value="${esc(query)}"></label>${creator ? filterSelect('status','全部狀態',['草稿', '待審核', '退回修改', '已撤回', '審核通過尚未發布', '已發布', '已下架', '未發布']) + filterSelect('department','全部使用部門',[...branches.map(b => department(b.settings)), listFilters.department]) : ''}${submitterField}${button('清除搜尋', 'reset-filter', query || submitterQuery || Object.values(listFilters).some(Boolean) ? '' : 'disabled')}</div><div class="actions toolbar-actions">${creator ? $('page-actions').innerHTML : iconAction('重新整理','refresh','refresh','title="重新整理"')}</div></div>`;
  $('page-actions').innerHTML = '';

  const columns = creator ? ['展開','助理名稱','目前發布版本','版本進度','使用部門','最後更新','操作'] :
    member ? ['名稱','用途','使用版本','操作'] : ['助理','版本','送審人','送審時間','操作'];
  const empty = creator ? '無此資料' : member ? '目前沒有開放給品保部的助理' : '目前沒有待你審核的案件';
  const publishPolicy = role === 'manager' && reviewing
    ? `<section class="publish-policy" aria-labelledby="publish-policy-title">
        <div><h2 id="publish-policy-title">品保部｜發布前須主管審核</h2>
        <p>公司規則・已生效。審核通過後，由建立者確認使用範圍並開放或發布。</p></div>
        ${button('設定代理', 'schedule')}
      </section>` : '';
  const reviewTabs = reviewing ? `<div class="actions review-tabs">${button('待審核', 'review-queue', `aria-pressed="${!reviewHistory}"`)}${role === 'manager' ? button('審核紀錄', 'review-history', `aria-pressed="${reviewHistory}"`) : ''}</div>` : '';
  if (reviewing && reviewHistory && role === 'manager') {
    const decisions = state.agents.flatMap(agent => agent.versions.filter(version =>
      version.decidedAt).map(version => ({agent, version})));
    decisions.sort((a, b) => b.version.decidedAt.localeCompare(a.version.decidedAt));
    $('content').innerHTML = publishPolicy + reviewTabs + `<div class="table"><table><thead><tr><th>名稱／版本</th><th>審核結果</th><th>審核人</th><th>審核時間</th><th>退回原因</th></tr></thead><tbody>${decisions.map(({agent, version}) => `<tr id="decision-${esc(agent.id)}-${version.number}" tabindex="-1"><td>${esc(version.name)} · ${esc(versionName(version))}</td><td>${version.status === 'approved' ? '已核准' : '退回修改'}</td><td>${esc(version.decidedBy)}</td><td>${esc(dateLabel(version.decidedAt))}</td><td>${version.reason ? button('查看', 'return-reason', agentAttrs(agent, version) + ' aria-label="查看退回原因"', 'text') : '—'}</td></tr>`).join('') || '<tr><td colspan="5">尚無審核紀錄</td></tr>'}</tbody></table></div>`;
    return;
  }
  const tableRows = visible.length ? visible.map(agent => renderRow(agent, creator, member)).join('') :
    `<tr><td class="empty" colspan="${columns.length}">${query || submitterQuery || Object.values(listFilters).some(Boolean) ? '找不到符合條件的助理，請調整或重置篩選。' : empty}</td></tr>`;
  if (rowsOnly) {
    $('content').querySelector('tbody').innerHTML = tableRows;
    $('content').querySelector('[data-action="reset-filter"]').disabled = !query && !submitterQuery.trim() && !Object.values(listFilters).some(Boolean);
    return;
  }
  const columnHeaders = columns.map(column => {
    if (column === '展開') return '<th scope="col" class="expand-column" aria-label="展開版本"></th>';
    return `<th scope="col"${column === '操作' ? ' class="pinned-actions"' : ''}>${column}</th>`;
  }).join('');
  $('content').innerHTML = publishPolicy + reviewTabs + filters + `<div class="table"><table><thead><tr>${columnHeaders}</tr></thead><tbody>${tableRows}</tbody></table></div>`;
}

const actionPaths = {
  copy: 'M8 3h12v16H8z M4 7v15h12',
  refresh: 'M20 7v-4m0 4h-4 M20 7a8 8 0 1 0 1 8',
  view: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z',
  edit: 'M12 5H4v15h15v-8 M10 14l1-4 8-8 3 3-8 8z',
  send: 'm22 2-7 20-4-9-9-4z M22 2 11 13',
  publish: 'M4 16v4h16v-4 M12 16V4m-4 4 4-4 4 4',
  undo: 'M8 4l-5 5 5 5 M3 9h11a5 5 0 0 1 0 10h-3',
  note: 'M5 3h14v12l-6 6H5z M13 21v-6h6 M8 8h8m-8 4h5',
  versions: 'M8 3h12v16H8z M4 7v15h12 M11 7h6m-6 4h6',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 14h10l1-14',
  chat: 'M3 19l1-4a9 9 0 1 1 4 5z M8 11h.1m4 0h.1m4 0h.1'
};

function iconAction(label, icon, action, attrs, emphasis = '') {
  return `<button type="button" class="row-icon ${emphasis}" aria-label="${label}" data-tip="${label}" data-action="${action}" ${attrs}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${actionPaths[icon]}"/></svg></button>`;
}

function matchesRow(settings, number, status) {
  const term = query.trim().toLowerCase();
  const searchable = `${settings?.name || ''} V${number} ${settings?.label || ''}`.toLowerCase();
  return searchable.includes(term) && (!status ||
    ((!listFilters.status || status === listFilters.status) &&
     (!listFilters.department || department(settings) === listFilters.department)));
}

const expandedAssistants = new Set();

function creatorBranches(agent) {
  const version = live(agent);
  const candidate = releaseCandidate(agent);
  const request = pending(agent);
  const draft = agent.draft;
  const branches = [
    version && {settings: version, number: releaseNumber(version), status: agent.open ? '已發布' : '已下架'},
    candidate && {settings: candidate, number: releaseNumber(candidate), status: '審核通過尚未發布'},
    request && {settings: request, number: releaseNumber(request), status: '待審核', reviewer: reviewerLabel()},
    draft && {settings: draft, number: nextReleaseNumber(agent), status: latest(agent)?.status === 'returned' ? '退回修改' : '草稿', editable: true}
  ].filter(Boolean);
  if (!branches.length) branches.push({settings: latest(agent) ?? {name: agent.name}, status: '未發布'});
  return branches;
}

function renderRow(agent, creator, member) {
  const version = live(agent);
  const attrs = agentAttrs(agent);
  if (member) {
    return `<tr><td><strong>${esc(version.name)}</strong></td><td>${esc(version.purpose)}</td><td>${esc(versionName(version))}</td><td class="pinned-actions">${iconAction('開始對話', 'chat', 'chat', attrs, 'next-step')}</td></tr>`;
  }
  const request = pending(agent);
  if (!creator) {
    return `<tr id="review-${esc(agent.id)}" tabindex="-1"><td>${esc(request.name)}</td><td>${esc(versionName(request))}</td><td>${esc(submitter(request))}</td><td>${esc(dateLabel(request.submittedAt))}</td><td class="pinned-actions">${iconAction('前往對話', 'chat', 'review-chat', agentAttrs(agent, request))}${iconAction(canReview(agent, request) ? '前往審核' : '查看案件', 'view', 'review', agentAttrs(agent, request), 'next-step')}</td></tr>`;
  }
  const candidate = releaseCandidate(agent);
  const branches = creatorBranches(agent);
  const draft = branches.find(branch => branch.editable);
  const showVersions = agent.versions.length + Number(Boolean(draft)) > 1;
  const current = branches.find(branch => version && branch.settings === version) ?? branches[0];
  const editSource = versionCopySource(agent);
  const currentAttrs = current.editable ? attrs : agentAttrs(agent, current.settings);
  const publishInMainRow = !showVersions || (!version && Boolean(request));
  const firstPublishSwitch = !showVersions && !version && candidate;
  const publishAction = candidate && !firstPublishSwitch
    ? iconAction(`發布 ${versionName(candidate)}`, 'publish', 'publish', agentAttrs(agent, candidate))
    : '';
  const status = showVersions
    ? (agent.open ? '已發布' : version ? '已下架' : candidate && publishInMainRow ? '審核通過尚未發布' : request ? '待審核' : '未發布')
    : current.status;
  const progressTone = ({
    '已發布': 'published', '待審核': 'wait', '退回修改': 'returned', '審核通過尚未發布': 'approved'
  })[status] ?? 'neutral';
  const singleSnapshot = !showVersions && !current.editable ? latest(agent) : null;
  const singleStatus = ({returned: '已退回', withdrawn: '已撤回', approved: '待發布'})[singleSnapshot?.status];
  const progress = firstPublishSwitch ? '待發布' : !version && candidate && publishInMainRow ? `${versionName(candidate)} 待發布`
    : !version && singleStatus ? `${versionName(singleSnapshot)} ${singleStatus}` : status;
  const updatedAt = branches.flatMap(({settings}) => [settings?.updatedAt, settings?.submittedAt, settings?.decidedAt, settings?.publishedAt]).filter(Boolean).sort().at(-1);
  const copies = showVersions ? [...agent.versions].reverse() : [];
  const standaloneDraft = draft && !showVersions;
  const expanded = expandedAssistants.has(agent.id);
  const draftId = `draft-${agent.id}`;
  const copyIds = [...(draft && showVersions ? [draftId] : []), ...copies.map(snapshot => `copy-${agent.id}-${snapshot.number}`)].join(' ');
  const draftRow = draft && showVersions ? `<tr id="${esc(draftId)}" class="assistant-copies" ${expanded ? '' : 'hidden'}>
    <td></td><td></td>
    <td>V${draft.number}</td><td class="copy-status">${esc(draft.status)}</td><td>${esc(department(draft.settings))}</td>
    <td><time>${esc(dateLabel(draft.settings.updatedAt))}</time></td>
    <td class="pinned-actions"><div class="row-tools">
      ${iconAction('編輯草稿', 'edit', 'submit', attrs)}
      ${iconAction(`刪除 V${draft.number} 草稿`, 'trash', 'delete-draft', attrs, 'danger')}
    </div></td>
  </tr>` : '';
  const history = copies.map(snapshot => `<tr id="copy-${esc(agent.id)}-${snapshot.number}" class="assistant-copies" tabindex="-1" data-copy-owner="${esc(agent.id)}" ${expanded ? '' : 'hidden'}>
    <td></td>
    <td></td>
    <td>${esc(versionName(snapshot))}</td>
    <td class="copy-status">${esc(({pending: '待審核', approved: snapshot === version ? (agent.open ? '目前發布' : '已下架') : snapshot === candidate ? '待發布' : '已核准', returned: '已退回', withdrawn: '已撤回'})[snapshot.status])} ${reasonButton(agent, snapshot)}</td>
    <td>${esc(department(snapshot))}</td>
    <td>${esc(dateLabel(snapshot.decidedAt || snapshot.submittedAt))}</td>
    <td class="pinned-actions"><div class="row-tools">
      ${snapshot === candidate && !publishInMainRow ? publishAction : ''}
      ${snapshot !== version && snapshot.status === 'approved' && snapshot.publishedAt
        ? iconAction(`切換至 ${versionName(snapshot)}`, 'publish', 'publish', agentAttrs(agent, snapshot)) : ''}
      ${iconAction('編輯', 'edit', 'snapshot', agentAttrs(agent, snapshot))}
      ${iconAction('已送審的版本無法刪除', 'trash', '', 'disabled', 'locked')}
    </div></td>
  </tr>`).join('');
  return `<tr class="assistant-group" id="assistant-${esc(agent.id)}" tabindex="-1">
    <td class="expand-column">${copyIds ? `<button type="button" data-action="expand-versions" ${attrs} aria-expanded="${expanded}" aria-controls="${esc(copyIds)}" aria-label="${esc(title(agent))}的其他副本">${expanded ? '▾' : '▸'}</button>` : ''}</td>
    <td><strong>${esc(title(agent))}</strong></td>
    <td>${version || firstPublishSwitch ? `<div class="release-state">${version ? button('V' + releaseNumber(version), 'snapshot', agentAttrs(agent, version), 'text') : '<span></span>'}<button type="button" class="switch" role="switch" aria-checked="${agent.open}" aria-label="${firstPublishSwitch ? '發布 ' + versionName(candidate) : esc(title(agent)) + ' 上下架'}" data-action="toggle" ${agentAttrs(agent, version)}></button></div>` : ''}</td>
    <td>${badge(progress, singleSnapshot?.status === 'returned' ? 'returned' : progressTone)}${reasonButton(agent, singleSnapshot)}</td>
    <td>${esc(department(version || current.settings))}</td>
    <td><time>${esc(dateLabel(updatedAt))}</time></td>
    <td class="pinned-actions"><div class="row-tools">
      ${publishInMainRow ? publishAction : ''}
      ${iconAction('前往對話', 'chat', 'try-version', currentAttrs)}
      ${iconAction('複製新助理', 'copy', 'duplicate-agent', currentAttrs)}
      ${iconAction('操作紀錄', 'versions', 'versions', attrs)}
      ${request && current.settings === request ? iconAction('編輯', 'edit', 'detail', currentAttrs) : ''}
      ${!editSource && !draft ? button('建立草稿', 'detail', attrs, 'primary') : ''}
      ${!current.editable && current.settings !== request ? iconAction('編輯', 'edit', 'snapshot', currentAttrs) : ''}
      ${standaloneDraft ? iconAction('編輯草稿', 'edit', 'submit', attrs) : ''}
      ${iconAction('刪除助理', 'trash', 'delete', attrs, 'danger')}
    </div></td>
  </tr>${draftRow}${history}`;
}

function modal(titleText, body, actions = '', handler) {
  $('dialog').classList.remove('setup-dialog', 'setup-expanded', 'submit-dialog');
  $('dialog').querySelector('[data-setup-expand]')?.remove();
  $('dialog-title').textContent = titleText;
  $('dialog-body').innerHTML = body;
  $('dialog-actions').innerHTML = actions || button('關閉', 'close');
  onSubmit = handler;
  if (!$('dialog').open) $('dialog').showModal();
  else $('close-dialog').focus();
}

function confirm(titleText, body, label, handler, danger = false, loading = '') {
  modal(titleText, body, button('取消', 'close') +
    `<button type="submit" data-loading="${esc(loading)}" class="${danger ? 'danger-fill' : 'primary'}">${esc(label)}</button>`, handler);
}

function complete(message) {
  $('dialog').close();
  save();
  feedback(message);
}

const setupGroups = [
  ['基本', [['basic','基本設定'], ['platform','對話平台啟用'], ['reply','回答模式設定']]],
  ['知識與資料', [['knowledge','知識庫設定'], ['tags','標籤過濾'], ['files','檔案工作區'], ['database','資料庫設定']]],
  ['能力擴充', [['tool','工具'], ['connector','MaiGPT 連接器'], ['skill','技能設定'], ['hook','Hook']]],
  ['介面與體驗', [['agentUI','Agent UI']]],
  ['管理與進階', [['permission','權限設定'], ['advanced','進階設定']]]
];
const setupFields = {
  knowledge: ['關聯知識庫', '品保作業知識庫'],
  files: ['檔案工作區', '品保文件工作區'],
  database: ['關聯資料庫', '品保資料庫'],
  tool: ['可用工具', 'SOP 查詢'],
  connector: ['連接器', '內部文件服務'],
  skill: ['技能', '品保文件摘要'],
  hook: ['事件 Hook', '對話結束通知'],
  agentUI: ['對話介面', '品保助理介面']
};
const setupExtras = ['reply', 'effort', 'instructions', 'tags', 'files', 'database', 'tool', 'connector', 'skill', 'hook', 'agentUI', 'advanced'];
function selectField(key, label, options, value) {
  return `<label>${label}<select name="${key}">${options.map(option =>
    `<option${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
}

function setupMarkup(draft, agent) {
  const choices = ['預設', '關閉', '低', '中', '高', '極高', '最高'];
  const sections = {
    basic: `${agent ? `<div class="setting-id"><span>系統 ID：${esc(agent.id)}</span>${iconAction('複製 ID', 'copy', 'copy-id', agentAttrs(agent))}</div>` : ''}<label>名稱 <span class="required">＊</span><input name="name" value="${esc(draft.name)}" required maxlength="60" placeholder="請輸入"></label>
      ${selectField('model', 'LLM 模型 <span class="required">＊</span>', [...new Set(['GPT-5.6 Luna（Microsoft Azure）', 'Claude 5.5 Opus', '多模態模型', draft.model].filter(Boolean))], draft.model)}
      <div class="banner"><strong>ⓘ　模型選擇建議</strong><p>模型選擇影響回覆速度與品質，預設模型適合大多數使用場景。</p></div>
      <fieldset class="effort"><legend>思考力度</legend><p class="muted">設定助理的預設思考力度。</p><div>${choices.map(choice => `<label><input type="radio" name="effort" value="${choice}" ${choice === (draft.effort ?? '預設') ? 'checked' : ''}><span>${choice === '預設' ? '預設（依模型設定）' : choice}</span></label>`).join('')}</div></fieldset>
      ${agent && (pending(agent) || releaseCandidate(agent) || live(agent)) ? selectField('releaseKind', '更新幅度', ['小版更新', '大版更新'], draft.releaseKind || '大版更新') + '<p class="muted">用途、使用範圍或操作能力有實質變更時，請選大版更新。版號會在確認送審時顯示。</p>' : ''}
      <label>用途與變更摘要 <textarea name="purpose" maxlength="500">${esc(draft.purpose)}</textarea></label>
      <label>角色指令 <textarea name="instructions" maxlength="2000">${esc(draft.instructions)}</textarea></label>`,
    platform: '<p class="banner">僅內部對話</p><p>建立者在審核通過後開啟，所選部門成員即可使用。</p>',
    reply: selectField('reply', '回答模式', ['Agent 模式', '一般回覆', '模板模式', '混合模式', '工作流模式'], draft.reply),
    tags: `<label>資料標籤<input name="tags" value="${esc(draft.tags)}" placeholder="以逗號分隔，例如：現行 SOP, 品保"></label>`,
    permission: `${selectField('department', '使用部門', departments, department(draft))}<p>由直屬主管審核。核准後，建立者確認部門成員並開啟。</p>`,
    advanced: `<label>回覆長度上限 <input type="number" name="advanced" min="512" step="1" value="${esc(draft.advanced)}" placeholder="使用模型預設"></label>`
  };
  for (const [key, [label, example]] of Object.entries(setupFields)) {
    sections[key] = selectField(key, label, [key === 'files' ? '不使用' : '未設定', example], draft[key]);
  }
  return `<div class="setup-layout"><aside class="setup-nav" aria-label="設定項目"><input type="search" id="setup-search" aria-label="搜尋設定" placeholder="搜尋設定">
    ${setupGroups.map(([group, entries]) => `<div class="setup-group"><small>${group}</small>
    ${entries.map(([key, label]) => `<button type="button" data-setup="${key}" aria-pressed="${key === 'basic'}"><span>${label}</span><small data-summary="${key}"></small></button>`).join('')}</div>`).join('')}
    <p id="setup-empty" hidden>沒有符合的設定</p></aside>
    <div class="setup-main">${setupGroups.flatMap(([, entries]) => entries).map(([key, label]) =>
      `<section id="setup-${key}" aria-label="${label}" ${key === 'basic' ? '' : 'hidden'}>${key === 'basic' ? '' : `<h3>${label}</h3>`}${sections[key]}</section>`).join('')}</div></div>`;
}

function bindSetup() {
  const body = $('dialog-body');
  const buttons = [...body.querySelectorAll('[data-setup]')];
  function activate(active) {
    buttons.forEach(button => {
      const selected = button === active;
      button.setAttribute('aria-pressed', String(selected));
      $('setup-' + button.dataset.setup).hidden = !selected;
    });
    body.querySelector('.setup-main').scrollTop = 0;
  }
  buttons.forEach(button => button.onclick = () => activate(button));
  $('setup-search').oninput = event => {
    const search = event.target.value.trim().toLowerCase();
    for (const button of buttons) button.hidden = !button.textContent.toLowerCase().includes(search);
    body.querySelectorAll('.setup-group').forEach(group => {
      group.hidden = !group.querySelector('button:not([hidden])');
    });
    $('setup-empty').hidden = buttons.some(button => !button.hidden);
  };
  function summaries() {
    for (const key of ['platform', 'reply', ...Object.keys(setupFields)]) {
      const summary = body.querySelector(`[data-summary="${key}"]`);
      summary.textContent = key === 'platform' ? '僅內部對話' : ($(`setup-${key}`).querySelector(`[name="${key}"]`)?.value ?? '');
      summary.classList.toggle('unset', summary.textContent === '未設定');
    }
  }
  body.querySelector('.setup-layout').addEventListener('change', summaries);
  body.querySelector('.setup-layout').addEventListener('invalid', event => {
    const section = event.target.closest('section');
    const button = buttons.find(item => 'setup-' + item.dataset.setup === section?.id);
    if (button) activate(button);
  }, true);
  summaries();
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.textContent = '⛶';
  expand.dataset.setupExpand = '';
  expand.setAttribute('aria-label', '放大設定視窗');
  expand.setAttribute('aria-pressed', 'false');
  expand.onclick = () => {
    const expanded = $('dialog').classList.toggle('setup-expanded');
    expand.setAttribute('aria-pressed', String(expanded));
    expand.setAttribute('aria-label', expanded ? '還原設定視窗' : '放大設定視窗');
  };
  $('close-dialog').before(expand);
}

function edit(agent) {
  if (agent && pending(agent) && !agent.draft) return readSettings(agent, pending(agent));
  const draft = agent?.draft ?? latest(agent ?? {versions: []}) ?? {name: agent?.name};
  confirm(agent ? '編輯 AI 助理' : '建立 AI 助理', setupMarkup(draft, agent), agent ? '儲存草稿' : '建立草稿', (form, submitter) => {
    const next = {...Object.fromEntries([...form].map(([key, value]) => [key, value.trim()])), updatedAt: timestamp()};
    if (!next.name) return showError('請填寫助理名稱。');
    if (agent && submitter?.value === 'review') return confirmDraftReview(agent, next);
    if (agent) {
      agent.draft = next;
      record(agent, '儲存草稿設定');
      return complete('草稿已儲存');
    }
    const created = {id: `QA-${String(state.nextId++).padStart(3, '0')}`, owner: role, draft: next, versions: [], history: [], active: null, open: false};
    state.agents.push(created);
    expandedAssistants.add(created.id);
    $('dialog').close();
    save();
    feedback('AI 助理建立成功', button('前往測試', 'try-version', agentAttrs(created), 'primary'), '草稿已儲存，可以先測試對話再送審。');
  });
  $('dialog').classList.add('setup-dialog');
  if (agent && latest(agent)?.status === 'returned') {
    const decision = latest(agent);
    $('dialog-body').insertAdjacentHTML('afterbegin', `<div class="banner return-context"><div class="return-meta">${esc(decision.decidedBy || '主管')} ／ ${esc(dateLabel(decision.decidedAt))}</div><div class="return-reason-text">${esc(decision.reason || '未填寫退回原因')}</div></div>`);
  }
  if (agent && !pending(agent)) {
    $('dialog-actions').querySelector('[type="submit"]').classList.remove('primary');
    $('dialog-actions').insertAdjacentHTML('beforeend', '<button type="submit" value="review" class="primary">送出審核</button>');
  }
  bindSetup();
}

function showError(message) {
  $('dialog-body').querySelector('.error')?.remove();
  const element = document.createElement('p');
  element.className = 'error';
  element.setAttribute('role', 'alert');
  element.textContent = message;
  $('dialog-body').prepend(element);
  element.scrollIntoView({block: 'nearest'});
}

function settingChanges(before, after) {
  if (!before) return '';
  const fields = {name: '名稱', model: 'LLM 模型', knowledge: '知識庫', reply: '回答模式',
    effort: '思考力度', instructions: '角色指令', purpose: '用途與變更摘要',
    tags: '資料標籤', advanced: '回覆長度上限',
    ...Object.fromEntries(Object.entries(setupFields).map(([key, [label]]) => [key, label]))};
  const changes = Object.entries(fields).filter(([key]) => (before[key] || '') !== (after[key] || ''));
  return `<details class="record"><summary>與 V${releaseNumber(before)} 的設定差異（${changes.length} 項）</summary>
    ${changes.map(([key, label]) => `<div class="record"><strong>${label}</strong><p>原設定：${esc(before[key] || '未設定')}</p><p>新設定：${esc(after[key] || '未設定')}</p></div>`).join('') || '<p>設定相同。</p>'}</details>`;
}

function confirmDraftReview(agent, draft) {
  const body = $('dialog-body');
  const actions = $('dialog-actions');
  const previousSubmit = onSubmit;
  const previousTitle = $('dialog-title').textContent;
  $('dialog').classList.add('submit-dialog');
  const number = agent.versions.length + 1;
  const targetRelease = nextReleaseNumber(agent, draft);
  const reviewer = currentReviewer();
  const settings = document.createElement('div');
  settings.className = 'review-settings-preserved';
  settings.hidden = true;
  settings.append(...body.childNodes);
  const previousActions = [...actions.childNodes];
  const summary = document.createElement('section');
  summary.className = 'submit-summary';
  summary.tabIndex = -1;
  summary.innerHTML = `<dl class="review-facts"><dt>助理</dt><dd>${esc(draft.name)}</dd><dt>版本</dt><dd>${esc(versionName({releaseNumber: targetRelease}))}</dd><dt>使用部門</dt><dd>${esc(department(draft))} · ${members.length} 位成員</dd><dt>審核安排</dt><dd>${esc(reviewerLabel())}</dd>
    </dl><p class="banner">送審後設定將鎖定；核准後仍需由你手動發布。${agent.open ? '目前發布版本仍可使用。' : ''}</p>`;
  body.append(settings, summary);
  const restore = () => {
    $('dialog').classList.remove('submit-dialog');
    body.replaceChildren(...settings.childNodes);
    actions.replaceChildren(...previousActions);
    $('dialog-title').textContent = previousTitle;
    onSubmit = previousSubmit;
    actions.querySelector('[value="review"]')?.focus();
  };
  $('dialog-title').textContent = '確認送審';
  actions.innerHTML = '<button type="button" id="back-to-settings">返回修改</button><button type="submit" class="primary" data-loading="送審中…">確認送審</button>';
  $('back-to-settings').onclick = restore;
  onSubmit = () => {
    if (!owns(agent) || agent.deleted || pending(agent) || agent.versions.length + 1 !== number || nextReleaseNumber(agent, draft) !== targetRelease) {
      return showError('草稿狀態已變更，請關閉後重新開啟設定。');
    }
    if (reviewer !== currentReviewer()) {
      restore();
      return confirmDraftReview(agent, draft);
    }
    const version = {...draft, number, releaseNumber: targetRelease, reviewBase: agent.active, status: 'pending', reviewer, submittedBy: people[role], submittedAt: timestamp()};
    agent.versions.push(version);
    agent.draft = null;
    agent.error = '';
    record(agent, `送出 ${versionName(version)}・${reviewerLabel()}`);
    if (reviewer) notify(reviewer, 'review', agent, version);
    complete('已送出審核，設定已鎖定');
  };
  summary.focus();
}

function review(agent, version) {
  if ($('dialog').open) $('dialog').close();
  market = false;
  reviewing = true;
  reviewPage = {agent, version};
  render();
  $('review-heading')?.focus();
}

function renderReviewPage(agent, version) {
  $('page-actions').innerHTML = button('返回審核待辦', 'review-queue');
  const closed = agent.deleted ? '助理已刪除，申請已撤回。' :
    version.status === 'withdrawn' ? '建立者已撤回這筆申請。' :
    version.status === 'approved' ? '審核已通過。' :
    version.status === 'returned' ? '申請已退回。' :
    !canViewReview(agent, version) ? '審核安排已變更。' : '';
  if (closed) {
    $('content').innerHTML = `<h2 id="review-heading" tabindex="-1">案件狀態</h2><p class="banner">${esc(closed)}</p>`;
    return;
  }

  const mayDecide = canReview(agent, version);
  if (mayDecide) $('page-actions').innerHTML = button('開啟試用對話', 'review-chat', agentAttrs(agent, version)) + $('page-actions').innerHTML;
  const reviewBase = version.reviewBase === undefined
    ? live(agent) : agent.versions.find(item => item.number === version.reviewBase);
  const facts = (entries) => `<dl class="review-facts">${entries.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${esc(value || '未設定')}</dd></div>`).join('')}</dl>`;
  const sections = {
    basic: [['名稱',version.name],['LLM 模型',version.model],['思考力度',version.effort || '預設'],['角色指令',version.instructions]],
    platform: [['對話平台','僅內部對話']],
    reply: [['回答模式',version.reply || 'Agent 模式']],
    tags: [['資料標籤',version.tags]],
    permission: [['使用部門',department(version)]],
    advanced: [['回覆長度上限',version.advanced || '使用模型預設']]
  };
  for (const [key, [label]] of Object.entries(setupFields)) sections[key] = [[label, version[key]]];
  $('content').innerHTML = `
    <div class="review-overview">
      ${mayDecide ? '' : `<p class="banner">僅供查看。審核安排：${esc(reviewerLabel())}</p>`}
      <h2 id="review-heading" tabindex="-1">${esc(version.name)} ${badge('待審核', 'wait')}</h2>
      ${facts([['送審版本',versionName(version)],['送審人',submitter(version)],['送審時間',dateLabel(version.submittedAt)],['開放範圍',department(version)],['審核人',reviewerLabel()],['目前發布版本',agent.open && live(agent) ? versionName(live(agent)) : '未開放']])}
      <h3>用途與變更摘要</h3><p class="review-copy">${esc(version.purpose || '未填寫')}</p>${settingChanges(reviewBase, version)}
    </div>
      <div class="review-layout">
      <section class="review-card submitted-settings"><h3>送審設定</h3>
        ${setupGroups.map(([group, entries], index) => `<details ${index < 2 ? 'open' : ''}><summary>${group}</summary>
          ${facts(entries.flatMap(([key]) => sections[key]))}</details>`).join('')}
      </section>
      <section class="review-card agent-review-history"><h3>此助理的審核紀錄</h3>
        ${agent.versions.filter(item => item.decidedAt && item.number < version.number).reverse().map(item => `<article class="review-history-entry"><strong>${esc(versionName(item))} · ${item.status === 'approved' ? '已核准' : '退回修改'}</strong><p class="muted">${esc(item.decidedBy)} ／ ${esc(dateLabel(item.decidedAt))}</p>${item.reason ? `<p class="review-copy">${esc(item.reason)}</p>` : ''}</article>`).join('') || '<p class="muted">首次送審，尚無審核紀錄。</p>'}
      </section>
      </div>
    ${mayDecide ? `<div class="review-footer review-decision-bar actions">${button('退回修改', 'return', agentAttrs(agent, version))}
    ${button('核准', 'approve', agentAttrs(agent, version), 'primary')}</div>` : ''}`;

}

function decide(agent, version, approve) {
  if (!canReview(agent, version)) return review(agent, version);
  confirm(approve ? '確認核准' : '退回修改',
    approve ? `<p>核准 ${esc(versionName(version))} 後，建立者會收到通知並確認開放範圍。</p>` :
      '<label>退回原因 <textarea name="reason" required maxlength="500"></textarea></label>',
    approve ? '確認核准' : '確認退回', form => {
    if (!canReview(agent, version)) return review(agent, version);
    const reason = form.get('reason')?.trim();
    if (!approve && !reason) return showError('請填寫退回原因。');
    version.status = approve ? 'approved' : 'returned';
    version.decidedBy = people[role];
    version.decidedAt = timestamp();
    if (!approve) {
      version.reason = reason;
      agent.draft ??= {...copySettings(version), releaseKind: version.releaseKind, updatedAt:timestamp()};
      expandedAssistants.add(agent.id);
    }
    record(agent, approve ? `核准 ${versionName(version)}` : `退回 ${versionName(version)}：${reason}`);
    notify(agent.owner || 'creator', approve ? 'approved' : 'returned', agent, version);
    complete(approve ? '已核准，已通知建立者' : '已退回，已通知建立者');
  }, false, approve ? '核准中…' : '退回中…');
}

function copySettings(version) {
  return Object.fromEntries(['name', 'label', 'purpose', 'model', 'knowledge', 'department', ...setupExtras]
    .filter(key => key in version).map(key => [key, version[key]]));
}

function readSettings(agent, version, back = '') {
  const locked = version.status === 'pending';
  const caption = locked ? `${versionName(version)} 已送審，設定已鎖定。` : `${versionName(version)}  設定已鎖定。`;
  const footer = locked && owns(agent) && !agent.deleted && pending(agent) === version
    ? (back || button('關閉', 'close')) + button('撤回審核', 'withdraw', agentAttrs(agent, version), 'danger-fill')
    : back;
  modal('編輯', `<p class="setup-status banner">${esc(caption)}</p>${setupMarkup(version, agent)}`, footer);
  $('dialog').classList.add('setup-dialog');
  $('dialog-body').querySelectorAll('.setup-main input, .setup-main textarea, .setup-main select').forEach(field => {
    field.disabled = true;
  });
  bindSetup();
}

function detail(agent, version) {
  if (version) return readSettings(agent, version);
  if (pending(agent)) return readSettings(agent, pending(agent));
  return edit(agent);
}

function versions(agent) {
  const events = [...agent.history].reverse().map(item => `<div class="record"><strong>${esc(item.message.replace(/^(送出 V\d+(?:\.\d+)?) · 第 \d+ 次送審(?=・|$)/, '$1'))}</strong>
    <p>${esc(item.actor)}・<time>${esc(dateLabel(item.at))}</time></p></div>`).join('');
  modal('操作紀錄', events || '<p class="empty">尚無操作紀錄</p>');
}

function withdraw(agent, version) {
  confirm('撤回送審', '<p>撤回後會保留這次送審的唯讀快照。需要修改時，可使用「複製新版本」。</p>', '確認撤回', () => {
    if (version !== pending(agent)) return showError('申請狀態已變更。');
    version.status = 'withdrawn';
    expandedAssistants.add(agent.id);
    record(agent, `撤回 ${versionName(version)}`);
    complete('申請已撤回');
  });
}

function publicationName(name) {
  return (name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
    .replace(/(?:\(副本\)|副本)+$/u, '');
}

function duplicatePublications(agent, version) {
  const name = publicationName(version.name);
  return state.agents.filter(other => {
    const published = live(other);
    return other !== agent && !other.deleted && other.open && published &&
      department(published) === department(version) && publicationName(published.name) === name;
  });
}

function publish(agent, version) {
  const isPublishedAlternative = () => version !== live(agent) && Boolean(version?.publishedAt);
  const canPublish = () => !agent.deleted && agent.versions.includes(version) && version?.status === 'approved' &&
    (isPublishedAlternative() || (!agent.open && version === live(agent)) ||
      version === releaseCandidate(agent));
  if (!canPublish()) return feedback('此版本的發佈狀態已變更，請從列表查看可用操作。');
  const before = live(agent);
  const action = isPublishedAlternative() ? '切換發布版本' : agent.open ? '發佈更新' : agent.active ? '重新開放' : '開放給部門';
  const duplicates = duplicatePublications(agent, version);
  const duplicateWarning = duplicates.length ? `<div class="confirm-warning"><strong>同部門已有同名助理上架</strong><ul>${duplicates.map(other => `<li>${esc(live(other).name)} · V${releaseNumber(live(other))}</li>`).join('')}</ul><label><input name="confirmDuplicate" type="checkbox" required> 我確認要同時開放這些助理</label></div>` : '';
  const wasOpen = agent.open;
  const targetVersion = versionName(version);
  const confirmLabel = isPublishedAlternative() ? `切換至 ${targetVersion}`
    : action === '重新開放' ? `重新開放 ${targetVersion}` : `發布 ${targetVersion}`;
  confirm(action, `<div class="publish-summary"><h3>${esc(version.name)}</h3>
    <dl class="publish-details">
      <dt>目前開放</dt><dd>${wasOpen ? esc(versionName(before)) : before ? `${esc(versionName(before))}（已下架）` : '尚未發布'}</dd>
      <dt>確認後開放</dt><dd><strong class="publish-target">${esc(targetVersion)}</strong></dd>
      <dt>影響範圍</dt><dd>${esc(department(version))} · ${members.length} 位成員</dd>
      <dt>審核結果</dt><dd>已核准${version.decidedBy ? ' · ' + esc(version.decidedBy) : ''}</dd>
      <dt>用途</dt><dd>${esc(version.purpose || '未填寫')}</dd>
    </dl>
  </div>
    ${duplicateWarning}
    <p class="muted">${wasOpen ? '確認後，部門成員會立即切換到指定版本。' : '確認後，部門成員可立即使用指定版本。'}</p>
    ${before && before !== version ? settingChanges(before, version) : ''}`, confirmLabel, form => {
    if (!canPublish()) return showError('版本狀態已變更，請關閉後重新操作。');
    if (before !== live(agent) || wasOpen !== agent.open) return publish(agent, version);
    const currentDuplicates = duplicatePublications(agent, version);
    if (currentDuplicates.some(other => !duplicates.includes(other))) return publish(agent, version);
    if (currentDuplicates.length && !form?.get('confirmDuplicate')) return showError('請確認是否同時開放同名助理。');
    version.updatedAt = timestamp();
    agent.active = version.number;
    agent.open = true;
    agent.error = '';
    version.publishedAt ??= timestamp();
    record(agent, `${action}・${versionName(version)}・${department(version)} ${members.length} 人`);
    complete(`${action}成功`);
  }, false, isPublishedAlternative() ? '切換中…' : '發布中…');
}

function toggle(agent) {
  if (!agent.open) return publish(agent, live(agent) ?? releaseCandidate(agent));
  confirm('下架助理', `<p><strong class="impact-emphasis">${esc(department(live(agent)))}</strong>的 <strong class="impact-emphasis">${members.length} 位成員</strong>將暫停使用「<strong class="impact-emphasis">${esc(title(agent))}</strong>」。待審新版仍可繼續審核。</p>`, '確認下架', () => {
    agent.open = false;
    live(agent).updatedAt = timestamp();
    record(agent, `下架 ${versionName(live(agent))}`);
    complete('助理已下架');
  });
}

function remove(agent) {
  confirm('刪除 AI 助理', `<p class="confirm-warning"><strong>即將刪除助理「<span class="impact-emphasis">${esc(title(agent))}</span>」，此操作無法復原。</strong></p><h3>影響範圍</h3><p>${agent.open ? `<strong class="impact-emphasis">${esc(department(live(agent)))}</strong>的 <strong class="impact-emphasis">${members.length} 位成員</strong>將無法再開啟此助理。` : '此助理將從列表移除。'}${pending(agent) ? '待審申請會一併撤回。' : ''}</p>`, '確認刪除', () => {
    const request = pending(agent);
    if (request) {
      request.status = 'withdrawn';
      record(agent, `因刪除助理而撤回 ${versionName(request)}`);
    }
    agent.open = false;
    agent.deleted = true;
    agent.draft = null;
    record(agent, '刪除助理');
    complete('助理已刪除');
  }, true);
}

function schedule() {
  const {enabled, delegate} = state.schedule;
  const picker = (name, options, selected) => `<details class="schedule-select"><summary>${esc(options.find(([key]) => key === selected)[1])}</summary>
    <div class="schedule-options">${options.map(([key, label]) =>
      `<label><input type="radio" name="${name}" value="${key}" ${key === selected ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div></details>`;
  confirm('設定代理', `<div class="schedule-field">代理審核
    ${picker('enabled', [['no', '不使用代理'], ['yes', '使用代理']], enabled ? 'yes' : 'no')}</div>
    <div class="schedule-field" id="delegate-picker" ${enabled ? '' : 'hidden'}>代理人
    ${picker('delegate', delegateRoles.map(key => [key, key === 'deputy' ? people[key] + '（下一位主管）' : people[key]]), delegateRoles.includes(delegate) ? delegate : 'deputy')}</div>
    <p class="muted">主管在班時由主管審核。主管請假時，待審與新送審案件會交由代理人處理。</p>`, '儲存設定', form => {
    const nextDelegate = form.get('delegate');
    if (!delegateRoles.includes(nextDelegate)) return showError('請選擇代理人。');
    state.schedule = {enabled: form.get('enabled') === 'yes', delegate: nextDelegate};
    syncReviewers();
    complete('已更新代理設定');
  });
  for (const menu of $('dialog-body').querySelectorAll('.schedule-select')) {
    menu.addEventListener('change', event => {
      const input = event.target;
      const summary = menu.querySelector('summary');
      summary.textContent = input.nextElementSibling.textContent;
      menu.open = false;
      summary.focus();
      if (input.name === 'enabled') $('delegate-picker').hidden = input.value !== 'yes';
    });
  }
}

function notifications() {
  const items = noticeTab === 'review' ? noticesForRole().filter(n => n.kind !== 'announcement').map(notice => {
    const agent = state.agents.find(item => item.id === notice.agent);
    const version = agent?.versions.find(item => item.number === notice.version);
    const headings = {
      review: '有一筆 AI 助理送審',
      digest: `有 ${notice.count} 筆助理待審核`,
      approved: '助理已通過審核',
      returned: '助理已退回修改'
    };
    const heading = headings[notice.kind];
    const action = notice.kind === 'digest' ? '查看待辦' : '查看列表';
    return `<article class="notice-row ${notice.read ? 'is-read' : 'is-unread'}"><span class="notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7m-7 4h5"/></svg></span><div><strong>${heading}</strong> ${badge('審核通知', 'neutral')}
    <p>${notice.kind === 'digest' ? '返工後的審核待辦' : esc(version ? notice.name + '・' + versionName(version) : notice.name)}</p>
    <time>${esc(dateLabel(notice.at))}</time>
    <div>${button(action, 'notice', `data-notice="${notice.id}"`, 'text')}</div></div></article>`;
  }).join('') : noticesForRole().filter(n => n.category === noticeTab).map(n => `<article class="notice-row ${n.read ? 'is-read' : 'is-unread'}"><span class="notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 9h5l11-5v16L9 15H4zM6 15v6h4l-1-6"/></svg></span><div><strong>${esc(n.heading)}</strong>${n.tag ? badge(n.tag, n.tag === '緊急' ? 'urgent' : 'wait') : ''}<p>${esc(n.description)}</p><time>${esc(dateLabel(n.at))}</time></div></article>`).join('');
  const panel = $('notification-popover');
  panel.innerHTML = `<div class="notice-heading"><h2 id="notification-title">通知中心</h2>${button('全部標記已讀', 'read-all', noticesForRole().some(n => !n.read) ? '' : 'disabled', 'text')}</div><div class="notice-tabs">${button(`系統公告（${noticesForRole().filter(n => n.category === 'system' && !n.read).length}）`, 'announcements', `aria-pressed="${noticeTab === 'system'}"`)}
    ${button(`組織公告（${noticesForRole().filter(n => n.category === 'org' && !n.read).length}）`, 'org-announcements', `aria-pressed="${noticeTab === 'org'}"`)}
    ${button(`審核通知（${noticesForRole().filter(n => n.kind !== 'announcement' && !n.read).length}）`, 'review-notices', `aria-pressed="${noticeTab === 'review'}"`, noticeTab === 'review' ? 'primary' : '')}</div>
    <div class="notice-list">${items ? items + '<p class="notice-end">沒有更多資料了</p>' : `<p class="empty">${noticeTab === 'review' ? '目前沒有審核通知' : '目前沒有公告'}</p>`}</div>`;
  panel.hidden = false;
  $('bell').setAttribute('aria-expanded', 'true');
  positionNotifications();
}

function positionNotifications() {
  const panel = $('notification-popover');
  if (panel.hidden) return;
  const bell = $('bell').getBoundingClientRect();
  const width = panel.offsetWidth;
  const anchor = bell.left + bell.width / 2;
  const left = Math.max(12, Math.min(anchor - width + 22, document.documentElement.clientWidth - width - 12));
  const top = bell.bottom + 12;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.setProperty('--notice-arrow', `${anchor - left}px`);
  panel.style.setProperty('--notice-list-height', `${Math.max(80, Math.min(410, window.innerHeight - top - 104))}px`);
}

function closeNotifications(restoreFocus = false) {
  $('notification-popover').hidden = true;
  $('bell').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('bell').focus();
}

function openNotice(id) {
  const notice = noticesForRole().find(item => item.id === Number(id));
  if (!notice) return;
  closeNotifications();
  notice.read = true;
  market = false;
  chatPage = null;
  reviewPage = null;
  query = '';
  submitterQuery = '';
  listFilters = {status: '', department: ''};

  const agent = state.agents.find(item => item.id === notice.agent);
  const version = agent?.versions.find(item => item.number === notice.version);
  reviewing = notice.kind === 'review' || notice.kind === 'digest';
  reviewHistory = reviewing && role === 'manager' && Boolean(version?.decidedAt);
  if (!reviewing && agent && version) expandedAssistants.add(agent.id);
  save();

  const target = reviewing
    ? reviewHistory ? `decision-${agent.id}-${version.number}` : `review-${agent?.id}`
    : `copy-${agent?.id}-${version?.number}`;
  const row = $(target) || (!reviewing && agent ? $(`assistant-${agent.id}`) : null);
  const destination = row || $('page-title');
  if (!row) destination.setAttribute('tabindex', '-1');
  destination.focus({preventScroll: true});
  destination.scrollIntoView({block: 'nearest'});
}

function tryVersion(agent, version) {
  if (!agent.deleted && (version || agent.draft)) openChat(agent, version);
}

function chat(agent) {
  if (!agent.open || agent.deleted || !live(agent)) return feedback('此助理目前未開放');
  openChat(agent, live(agent));
}

function openChat(agent, version) {
  $('feedback').hidden = true;
  const key = [role, agent.id, version?.number ?? 'draft'].join(':');
  state.conversations ??= {};
  const threads = state.conversations[key] ??= [];
  chatPage = {agent, version, threads, selected: threads[0]?.id, query: '', attachments: []};
  render();
}

const demoLibraries = {
  '品保作業知識庫': ['作業規範', '檢驗標準', '異常處理'],
  '部門共用知識庫': ['新人指引', '常用表單']
};

function conversationLibraries(settings) {
  const source = selectedThread() || chatPage;
  return (source.libraries ?? [source.library ?? settings.knowledge]).filter(name => Object.hasOwn(demoLibraries, name));
}
function conversationLibrary(settings) { return conversationLibraries(settings).join('、'); }
function libraryDocuments(libraries) {
  return libraries.flatMap(name => demoLibraries[name].flatMap(folder => [1,2].map(number => `${name}／${folder}／${folder}${number === 1 ? '作業手冊' : '檢核表'}.pdf`)));
}
function referencePicker(settings) {
  const libraries = conversationLibraries(settings);
  const docs = libraryDocuments(libraries);
  const selected = selectedThread()?.referenceDocuments ?? chatPage.referenceDocuments ?? docs;
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const docIcon = icon('M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6m-6 4h4');
  const caret = icon('m7 10 5 5 5-5');
  const count = selected.filter(id => docs.includes(id)).length;
  return `<details open class="reference-card"><summary class="reference-heading">${docIcon}<strong>參考文件</strong><span id="reference-badge">${count}</span>${caret}</summary>
    <div class="reference-controls">
      <details class="white-menu library-menu"><summary>篩選知識庫範圍${icon('M4 6h16M7 11h10m-7 5h4')}</summary><div class="menu-panel">${Object.keys(demoLibraries).map(name => `<label><input type="checkbox" name="reference-library" value="${esc(name)}" ${libraries.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('')}</div></details>
      <div class="reference-search-row"><label>${icon('M15.5 15.5 21 21 M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0') }<input id="reference-search" type="search" placeholder="搜尋文件名稱、FAQs 的問題或答案" aria-label="搜尋參考文件"></label>
      <details class="white-menu reference-tags"><summary aria-label="依資料夾篩選" title="依資料夾篩選">${icon('M3 4h9l9 9-8 8-10-10z M7 8h.1')}</summary><div class="menu-panel"><label>資料夾<select id="reference-folder"><option value="">全部資料夾</option>${[...new Set(libraries.flatMap(name => demoLibraries[name]))].map(folder => `<option value="${esc(folder)}">${esc(folder)}</option>`).join('')}</select></label></div></details>
      <button type="button" class="text reference-expand" data-action="references-expand" aria-label="展開或收合所有資料夾" title="展開或收合所有資料夾">${icon('m9 8 3-3 3 3m-6 8 3 3 3-3')}</button></div>
      <div class="reference-toolbar"><button type="button" data-action="references-all" class="text">${icon('m2 12 5 5L18 6m-8 11L22 6')} 全選</button><small id="reference-count">已選 ${count}/${docs.length}</small><button type="button" data-action="references-clear" class="text danger">清除</button></div>
    </div>
    <div class="reference-tree">${libraries.map(name => {
      const libraryDocs = docs.filter(id => id.startsWith(name+'／'));
      return `<div class="reference-group"><input type="checkbox" name="reference-group" aria-label="選取 ${esc(name)} 的所有文件" value="${esc(name)}" ${libraryDocs.every(id => selected.includes(id)) ? 'checked' : ''}>
      <details class="reference-library"><summary><strong>${esc(name)}</strong><small>${docIcon} 文件（${libraryDocs.length}）　ⓘ FAQ（0）</small></summary>${demoLibraries[name].map(folder => `<details><summary>${esc(folder)}</summary>${libraryDocs.filter(id => id.startsWith(name+'／'+folder+'／')).map(id => `<label class="reference-document" data-document="${esc(id)}"><input type="checkbox" name="reference-document" value="${esc(id)}" ${selected.includes(id) ? 'checked' : ''}>${esc(id.split('／').at(-1))}</label>`).join('')}</details>`).join('')}</details></div>`;
    }).join('') || '<p class="muted">請先連結一個或多個知識庫。</p>'}</div>
  </details>`;
}

function renderChat() {
  const {agent, version, threads} = chatPage;
  const settings = version || agent.draft;
  if (!settings || agent.deleted) {
    chatPage = null;
    return render();
  }
  $('page-title').textContent = settings.name;
  $('top-page').textContent = '助理對話';
  $('page-actions').innerHTML = button('返回上一頁', 'close-chat') + button('AI 助理設定', 'chat-settings', '', 'primary');
  $('content').innerHTML = `<section class="chat-workspace" aria-label="助理對話">
    <aside class="chat-sidebar"><div class="actions"><strong>新建問答</strong>${iconAction('新建問答','chat','new-thread')}</div>
      <input id="thread-search" type="search" aria-label="搜尋問答紀錄" placeholder="搜尋標題或對話內容" value="${esc(chatPage.query)}">
      <div id="thread-list"></div>
    </aside>
    <div class="chat-main">
      <div class="chat-context"><strong>${esc(version ? versionName(version) : '草稿試用')}</strong><small>模擬對話 · 附件僅記錄檔名</small></div>
      <div id="thread-messages" class="chat-messages" role="log" aria-label="對話訊息"></div>
      <form id="chat-compose" class="chat-compose"><textarea name="message" aria-label="訊息" placeholder="請輸入您想問的問題" maxlength="4000" rows="3"></textarea>
        <div id="chat-attachments" class="actions"></div>
        <div class="chat-compose-actions"><label class="chat-attach">＋ 附件<input id="chat-files" type="file" multiple aria-label="選擇附件"></label><button type="submit" class="primary">傳送</button></div>
      </form>
    </div>
    <aside class="chat-references">${referencePicker(settings)}</aside>
  </section>`;
  renderThreads();
  renderChatMessages();
  renderAttachments();
  $('thread-search').oninput = event => { chatPage.query = event.target.value; renderThreads(); };
  $('chat-files').onchange = async event => {
    const input = event.currentTarget;
    const names = Array.from(input.files, file => file.name);
    if (!names.length) return;
    const page = chatPage;
    const send = input.form.querySelector('button[type="submit"]');
    const label = input.parentElement;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.className = 'loading-indicator';
    status.textContent = '附件處理中…';
    label.after(status);
    input.disabled = true;
    send.disabled = true;
    try {
      await showDemoLoading();
      if (chatPage !== page || !input.isConnected) return;
      page.attachments.push(...names);
      renderAttachments();
    } finally {
      input.value = '';
      input.disabled = false;
      send.disabled = false;
      status.remove();
    }
  };
  const references = $('content').querySelector('.chat-references');
  const updateReferences = () => {
    const source = selectedThread() || chatPage;
    source.libraries = [...references.querySelectorAll('[name="reference-library"]:checked')].map(input => input.value);
    const docs = libraryDocuments(source.libraries);
    const before = source.referenceDocuments ?? docs;
    source.referenceDocuments = before.filter(id => docs.includes(id));
    persistState();
  };
  const refreshReferenceCount = () => {
    const docs = libraryDocuments(conversationLibraries(settings));
    const selected = (selectedThread() || chatPage).referenceDocuments ?? docs;
    $('reference-count').textContent = `已選 ${selected.length}/${docs.length}`;
    $('reference-badge').textContent = selected.length;
    references.querySelectorAll('[name="reference-group"]').forEach(input => {
      const group = docs.filter(id => id.startsWith(input.value + '／'));
      const count = group.filter(id => selected.includes(id)).length;
      input.checked = count === group.length;
      input.indeterminate = count > 0 && count < group.length;
    });
  };
  const filterReferences = () => {
    const term = $('reference-search').value.trim().toLowerCase();
    const folder = $('reference-folder').value;
    references.querySelectorAll('.reference-document').forEach(item => {
      item.hidden = !item.dataset.document.toLowerCase().includes(term) || Boolean(folder && item.dataset.document.split('／')[1] !== folder);
    });
    references.querySelectorAll('.reference-library details, .reference-library').forEach(item => {
      item.hidden = Boolean(term || folder) && !item.querySelector('.reference-document:not([hidden])');
      if ((term || folder) && !item.hidden) item.open = true;
      if (item.matches('.reference-library')) item.closest('.reference-group').hidden = item.hidden;
    });
  };
  refreshReferenceCount();
  references.onchange = event => {
    const source = selectedThread() || chatPage;
    if (event.target.name === 'reference-library') {
      const previous = libraryDocuments(conversationLibraries(settings));
      const selection = source.referenceDocuments ?? previous;
      updateReferences();
      const next = libraryDocuments(source.libraries);
      source.referenceDocuments = [...selection.filter(id => next.includes(id)), ...next.filter(id => !previous.includes(id))];
      persistState();
      references.innerHTML = referencePicker(settings);
      references.querySelector('.library-menu').open = true;
      [...references.querySelectorAll('[name="reference-library"]')].find(input => input.value === event.target.value)?.focus();
      refreshReferenceCount();
    } else if (event.target.name === 'reference-group') {
      const group = [...references.querySelectorAll('[name="reference-document"]')].filter(input => input.value.startsWith(event.target.value+'／'));
      group.forEach(input => { input.checked = event.target.checked; });
    } else if (event.target.id === 'reference-folder') return filterReferences();
    if (['reference-document','reference-group'].includes(event.target.name)) {
      source.referenceDocuments = [...references.querySelectorAll('[name="reference-document"]:checked')].map(input => input.value);
      persistState();
      refreshReferenceCount();
    }
  };
  references.oninput = event => { if (event.target.id === 'reference-search') filterReferences(); };
  references.onclick = event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'references-expand') {
      const groups = [...references.querySelectorAll('.reference-library, .reference-library details')].filter(item => !item.hidden);
      const open = groups.some(item => !item.open);
      groups.forEach(item => { item.open = open; });
    }
    if (!['references-all','references-clear'].includes(action)) return;
    const source = selectedThread() || chatPage;
    source.referenceDocuments = action === 'references-all' ? libraryDocuments(conversationLibraries(settings)) : [];
    references.querySelectorAll('[name="reference-document"]').forEach(input => { input.checked = action === 'references-all'; });
    persistState();
    refreshReferenceCount();
  };
  $('chat-compose').onsubmit = event => {
    event.preventDefault();
    const input = event.currentTarget.elements.message;
    const message = input.value.trim();
    if (!message && !chatPage.attachments.length) return input.focus();
    const libraries = conversationLibraries(settings);
    const thread = selectedThread() || newThread(message.slice(0, 30) || chatPage.attachments[0].slice(0, 30));
    const docs = libraryDocuments(libraries);
    const references = (thread.referenceDocuments ?? chatPage.referenceDocuments ?? docs).filter(id => docs.includes(id));
    thread.libraries = libraries;
    thread.referenceDocuments = references;
    thread.messages.push({message, library: libraries.join('、'), references, attachments: chatPage.attachments, reply: `這是「${settings.name}」的模擬回覆。`});
    chatPage.attachments = [];
    save();
    $('chat-compose').elements.message.focus();
  };
}

const selectedThread = () => chatPage?.threads.find(thread => thread.id === chatPage.selected);

function newThread(title = '新問答') {
  const thread = {id: Date.now().toString(36) + Math.random().toString(36).slice(2), title, messages: []};
  chatPage.threads.unshift(thread);
  chatPage.selected = thread.id;
  chatPage.query = '';
  return thread;
}

function renderThreads() {
  const term = chatPage.query.trim().toLowerCase();
  const threads = chatPage.threads.filter(thread => [thread.title, ...thread.messages.flatMap(item => [item.message, item.reply, ...item.attachments])].some(value => value.toLowerCase().includes(term)));
  $('thread-list').innerHTML = threads.map(thread => {
    const attrs = `data-thread="${thread.id}"`;
    return `<div class="chat-thread">${button(thread.title, 'select-thread', `${attrs} aria-pressed="${thread.id === chatPage.selected}"`)}<details class="white-menu thread-menu"><summary aria-label="對話操作">⋮</summary><div class="menu-panel">${button('✎　重新命名','rename-thread',attrs)}${button('刪除對話','delete-thread',attrs,'danger')}</div></details></div>`;
  }).join('') || '<p class="empty">沒有符合的問答紀錄</p>';
}

function renderChatMessages() {
  const messages = $('thread-messages');
  messages.innerHTML = selectedThread()?.messages.map(item => `<article><div class="chat-question">${esc(item.message)}${item.attachments.map(name => `<small>附件 · ${esc(name)}</small>`).join('')}</div><p class="chat-answer">${esc(item.reply)}${item.references?.length ? `<small>參考範圍 · ${esc([item.library, ...item.references].filter(Boolean).join('／'))}</small>` : ''}</p></article>`).join('') || '<p class="empty">輸入第一個問題，開始問答。</p>';
  messages.scrollTop = messages.scrollHeight;
}

function renderAttachments() {
  $('chat-attachments').innerHTML = chatPage.attachments.map((name, index) => button(name + ' ×', 'remove-chat-file', `data-index="${index}" aria-label="移除附件 ${esc(name)}"`)).join('');
}

function chatAction(action, data) {
  if (!chatPage) return;
  const {agent, version, threads} = chatPage;
  const thread = threads.find(item => item.id === data.thread);
  switch (action) {
    case 'close-chat': chatPage = null; return render();
    case 'chat-settings': return owns(agent) && !version ? edit(agent) : readSettings(agent, version || agent.draft);
    case 'new-thread':
      chatPage.libraries = undefined;
      chatPage.referenceDocuments = undefined;
      chatPage.library = undefined;
      chatPage.referenceFolders = undefined;
      newThread();
      chatPage.attachments = [];
      save();
      return $('chat-compose').elements.message.focus();
    case 'select-thread':
      if (!thread) return;
      chatPage.selected = thread.id;
      chatPage.attachments = [];
      return render();
    case 'remove-chat-file': chatPage.attachments.splice(Number(data.index), 1); return renderAttachments();
    case 'rename-thread':
      if (!thread) return;
      return confirm('重新命名對話', `<label>對話名稱<input name="title" required maxlength="80" value="${esc(thread.title)}"></label>`, '儲存名稱', form => {
        const name = form.get('title').trim();
        if (!name) return showError('請輸入對話名稱。');
        thread.title = name;
        complete('對話已重新命名');
      });
    case 'delete-thread':
      if (!thread) return;
      return confirm('刪除對話', `<p class="confirm-warning">即將刪除「${esc(thread.title)}」及其中的訊息，此操作無法復原。</p>`, '確認刪除', () => {
        threads.splice(threads.indexOf(thread), 1);
        if (chatPage.selected === thread.id) chatPage.selected = threads[0]?.id;
        complete('對話已刪除');
      }, true);
  }
}

function simulate() {
  modal('情境設定', `<p>主管狀態：<strong>${state.managerOnLeave ? '請假' : '在班'}</strong></p>
    <p>目前審核安排：${esc(reviewerLabel())}</p>
    ${button(state.managerOnLeave ? '模擬主管返工' : '模擬主管請假', 'toggle-manager-leave')}`,
    button('重設 Demo 資料', 'reset-demo', '', 'danger'));
}

function chooseCopy(agent, version) {
  if (!version && !agent.draft) return;
  const versionSource = versionCopySource(agent);
  const canCopyVersion = versionSource && !agent.draft;
  const versionHint = agent.draft
    ? '已有草稿，請先繼續編輯或刪除草稿。'
    : versionSource
      ? `以 ${versionName(versionSource)} 為基礎，在原助理下新增草稿。目前發布的版本不受影響。`
      : '目前沒有可用來建立新版本的來源。';
  modal('你想怎麼複製？', `<div class="copy-options">
    <button type="button" data-action="copy-assistant" ${agentAttrs(agent, version)}>
      <strong>建立獨立助理</strong>
      <span>適合另一個用途。沿用${version ? esc(versionName(version)) + ' 的設定' : '草稿設定'}，建立獨立的助理，版號從 V1 開始。</span>
    </button>
    <button type="button" data-action="copy-version" ${agentAttrs(agent, versionSource)} ${canCopyVersion ? '' : 'disabled'}>
      <strong>更新這個助理</strong>
      <span>${esc(versionHint)}</span>
    </button>
  </div>`, button('取消', 'close'));
}

function duplicateAgent(agent, version) {
  const source = version || agent.draft;
  if (!source) return;
  confirm('複製為新助理', `<p>將複製「${esc(source.name)}」${version ? ' V' + releaseNumber(version) : '的草稿'} 的設定，建立獨立助理。</p><p>新助理保留模型與資料關聯設定，審核紀錄及發布狀態不會沿用，需要重新送審。</p><label>新助理名稱<input name="copyName" required maxlength="60" value="${esc((source.name + '（副本）').slice(0,60))}"></label>`, '建立副本', form => {
    const name = form.get('copyName').trim();
    if (!name) return showError('請填寫新助理名稱。');
    if (agent.deleted) return showError('來源助理已刪除，請關閉後重新操作。');
    const copied = {id:`QA-${String(state.nextId++).padStart(3,'0')}`, owner: role, draft:{...copySettings(source), name, label:'初始版本', updatedAt:timestamp()}, versions:[], history:[], active:null, open:false};
    record(copied, `從 ${agent.id} ${version ? 'V' + releaseNumber(version) : '草稿'} 複製設定`);
    state.agents.push(copied);
    expandedAssistants.add(copied.id);
    query = ''; listFilters = {status:'',department:''};
    complete('已建立獨立草稿，請確認設定後送審');
  });
}

async function copyAgentId(agent) {
  try { await navigator.clipboard.writeText(agent.id); feedback('已複製助理 ID'); }
  catch { modal('複製助理 ID', `<p>瀏覽器未允許寫入剪貼簿，請選取下方 ID 手動複製。</p><label>助理 ID<input id="manual-copy-id" value="${esc(agent.id)}" readonly></label>`); $('manual-copy-id').select(); }
}

const creatorActions = {
  detail, edit, versions, delete: remove, toggle,
  'copy-id': copyAgentId,
  'duplicate-agent': chooseCopy,
  'copy-assistant': duplicateAgent,
  'knowledge-info': (agent, version) => { const source = version || agent.draft; modal('關聯知識庫', `<p><strong>${esc(source.knowledge)}</strong></p><p>此版本使用的知識庫關聯設定。Demo 未連接實際文件內容。</p>`); },
  'try-version': tryVersion,
  'copy-version': (agent, version) => {
    if (!version || version !== versionCopySource(agent) || agent.draft) return;
    confirm('複製新版本', `<p>將複製 ${esc(versionName(version))} 的設定到同一助理的新草稿。原版本與審核紀錄會保留。新草稿送審並通過後，建立者才能發佈。</p>`, '確認複製', () => {
      if (version !== versionCopySource(agent) || agent.draft) return showError('版本狀態已變更，請重新操作。');
      agent.draft = {...copySettings(version), label: '更新草稿', releaseKind: version.status === 'withdrawn' ? version.releaseKind : undefined, updatedAt:timestamp()};
      record(agent, `從 ${versionName(version)} 建立草稿`);
      expandedAssistants.add(agent.id);
      complete('已建立更新草稿');
      $(`draft-${agent.id}`)?.querySelector('[data-action=submit]')?.focus();
    });
  },
  'delete-draft': agent => {
    const draft = agent.draft;
    if (!draft || !agent.versions.length) return;
    const draftVersion = `V${nextReleaseNumber(agent)}`;
    confirm(`刪除 ${draftVersion} 草稿`, `<p>「${esc(title(agent))}」的 ${draftVersion} 草稿將被刪除。</p>`, '確認刪除草稿', () => {
      if (agent.draft !== draft || !agent.versions.length) return showError('草稿狀態已變更，請重新操作。');
      agent.name = title(agent);
      agent.draft = null;
      record(agent, '刪除草稿');
      complete('草稿已刪除');
    });
  },
  snapshot: (agent, version) => readSettings(agent, version),
  submit: agent => { if (agent.draft) edit(agent); },
  withdraw: (agent, version) => { if (version?.status === 'pending') withdraw(agent, version); },
  publish: (agent, version) => { if (version?.status === 'approved') publish(agent, version); }
};
const generalActions = {
  refresh: () => { syncReviewers(); save(); feedback('列表已重新整理'); },
  'read-all': () => { noticesForRole().forEach(n => n.read = true); save(); notifications(); feedback('通知已全部標記已讀'); },
  close: () => $('dialog').close(),
  'review-history': () => { if (reviewing && role === 'manager') { reviewPage = null; reviewHistory = true; render(); } },
  'review-queue': () => {
    reviewHistory = false;
    reviewPage = null;
    render();
    $('search')?.focus();
  },
  new: () => edit(),
  'reset-filter': () => { query = ''; submitterQuery = ''; listFilters = {status:'', department:''}; render(); $('search').focus(); },
  schedule: () => { if (role === 'manager') schedule(); },
  announcements: () => { noticeTab = 'system'; notifications(); },
  'org-announcements': () => { noticeTab = 'org'; notifications(); },
  'review-notices': () => { noticeTab = 'review'; notifications(); },
  'toggle-manager-leave': () => { state.managerOnLeave = !state.managerOnLeave; syncReviewers(); save(); simulate(); },
  'reset-demo': () => confirm('重設 Demo 資料', '<p>將清除本機示範進度與通知。</p>', '確認重設', () => {
    state = initial();
    chatPage = null;
    reviewPage = null;
    reviewing = false;
    reviewHistory = false;
    submitterQuery = '';
    listFilters = {status:'', department:''};
    role = 'creator';
    query = '';
    complete('已重設 Demo 資料');
  }, true)
};
document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const {action, id, version: number, notice} = control.dataset;
  const agent = state.agents.find(item => item.id === id);
  const version = agent?.versions.find(item => item.number === Number(number));
  if (action === 'market-favorite' && agent) { state.favorites ??= {}; const favorites = state.favorites[role] ??= []; const index = favorites.indexOf(agent.id); if (index < 0) favorites.push(agent.id); else favorites.splice(index, 1); save(); return; }
  if (action === 'expand-versions' && agent && owns(agent)) {
    const expanded = !expandedAssistants.has(id);
    if (expanded) expandedAssistants.add(id);
    else expandedAssistants.delete(id);
    for (const copy of control.getAttribute('aria-controls').split(' ')) {
      $(copy).hidden = !expanded;
    }
    control.setAttribute('aria-expanded', String(expanded));
    control.textContent = expanded ? '▾' : '▸';
    return;
  }
  if (action === 'return-reason' && version?.reason &&
    ((owns(agent) && !agent.deleted) || role === 'manager' ||
      (delegateRoles.includes(role) && reviewPage?.agent === agent &&
        canReview(agent, reviewPage.version) && version.number < reviewPage.version.number))) {
    showReturnReason(version);
    if (!control.classList.contains('reason-note')) return;
    version.reasonReadBy ??= [];
    if (!version.reasonReadBy.includes(role)) {
      version.reasonReadBy.push(role);
      persistState();
      control.classList.remove('is-unread');
      control.setAttribute('aria-label', '查看退回原因');
      control.dataset.tip = '查看退回原因';
    }
    return;
  }
  if (action === 'dismiss-toast') { $('feedback').hidden = true; return; }
  if (['close-chat', 'chat-settings', 'new-thread', 'select-thread', 'remove-chat-file', 'rename-thread', 'delete-thread'].includes(action)) return chatAction(action, control.dataset);
  if (Object.hasOwn(generalActions, action)) return generalActions[action]();
  if (action === 'notice') return openNotice(notice);
  if (!agent) return;
  if (owns(agent) && !agent.deleted && Object.hasOwn(creatorActions, action)) return creatorActions[action](agent, version);
  if (action === 'chat') return chat(agent);
  if (role === 'creator' || !version) return;
  if (action === 'review-chat' && canReview(agent, version)) tryVersion(agent, version);
  if (action === 'review' && canViewReview(agent, version)) review(agent, version);
  if (action === 'approve' || action === 'return') decide(agent, version, action === 'approve');
});
// Give the static demo time to display its loading feedback before applying the change.
const showDemoLoading = () => new Promise(resolve => setTimeout(resolve, 450));

$('dialog-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.hasAttribute('aria-busy')) return;
  const submitter = event.submitter || form.querySelector('button[type="submit"]');
  const handler = onSubmit;
  if (!handler) return;
  const data = new FormData(form);
  const loading = submitter?.dataset.loading;
  if (!loading) return handler(data, submitter);

  const label = submitter.textContent;
  form.setAttribute('aria-busy', 'true');
  submitter.disabled = true;
  submitter.classList.add('loading-indicator');
  submitter.textContent = loading;
  try {
    await showDemoLoading();
    if ($('dialog').open && handler === onSubmit && submitter.isConnected) {
      await handler(data, submitter);
    }
  } finally {
    form.removeAttribute('aria-busy');
    submitter.disabled = false;
    submitter.classList.remove('loading-indicator');
    submitter.textContent = label;
  }
});
$('close-dialog').onclick = () => $('dialog').close();
$('role').onclick = event => {
  const option = event.target.closest('button[data-role]');
  if (!option) return;
  $('role').open = false;
  $('role-trigger').focus();
  const nextRole = option.dataset.role;
  if (nextRole === role) return;
  closeNotifications();
  chatPage = null;
  reviewPage = null;
  listFilters = {status:'', department:''};
  role = nextRole;
  market = false;
  reviewing = role === 'manager' || role === 'deputy' || currentReviewer() === role;
  reviewHistory = false;
  submitterQuery = '';
  query = '';
  if ($('dialog').open) $('dialog').close();
  save();
};
$('content').addEventListener('change', event => {
  const key = event.target.dataset.listFilter;
  if (!key) return;
  listFilters[key] = event.target.value; render();
  $('content').querySelector(`[data-list-filter="${key}"]`)?.focus();
});
$('content').addEventListener('input', event => {
  if (event.target.id === 'submitter-search') {
    submitterQuery = event.target.value;
    render({rowsOnly: true});
    return;
  }
  if (event.target.id !== 'search') return;
  query = event.target.value;
  const {selectionStart, selectionEnd} = event.target;
  render();
  const search = $('search');
  search.focus();
  search.setSelectionRange(selectionStart, selectionEnd);
});
$('bell').onclick = () => {
  if (!$('notification-popover').hidden) return closeNotifications();
  noticeTab = 'review';
  notifications();
  $('notification-popover').querySelector('[aria-pressed="true"]')?.focus();
};
$('notification-popover').addEventListener('click', event => {
  const action = event.target.closest('.notice-tabs button')?.dataset.action;
  if (action) requestAnimationFrame(() => {
    $('notification-popover').querySelector(`[data-action="${action}"]`)?.focus();
  });
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#notification-popover, #bell')) closeNotifications();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('notification-popover').hidden) closeNotifications(true);
});
window.addEventListener('resize', positionNotifications);
window.addEventListener('scroll', positionNotifications);
$('simulate').onclick = simulate;
$('assistants').onclick = () => { market = false; chatPage = null; query = ''; reviewPage = null; reviewing = false; render(); };
$('review-nav').onclick = () => { market = false; chatPage = null; query = ''; reviewPage = null; reviewHistory = false; reviewing = true; render(); };
function collapseSidebar(collapsed) {
  document.body.classList.toggle('collapsed', collapsed);
  $('collapse').setAttribute('aria-expanded', String(!collapsed));
  $('expand').hidden = !collapsed;
  $(collapsed ? 'expand' : 'collapse').focus();
}
$('collapse').onclick = () => collapseSidebar(true);
$('expand').onclick = () => collapseSidebar(false);

if (syncReviewers()) save();
else render();

const actionHint = $('action-hint');
let hintAnchor;
function showActionHint(control) {
  hintAnchor = control;
  actionHint.textContent = control.dataset.tip;
  actionHint.hidden = false;
  const rect = control.getBoundingClientRect();
  const half = actionHint.offsetWidth / 2;
  actionHint.style.left = `${Math.max(half + 8, Math.min(innerWidth - half - 8, rect.left + rect.width / 2))}px`;
  actionHint.style.top = `${rect.bottom + 7}px`;
}
function hideActionHint() {
  actionHint.hidden = true;
  hintAnchor = null;
}
$('content').addEventListener('pointerover', event => {
  const control = event.target.closest('[data-tip]');
  if (control && control !== hintAnchor) showActionHint(control);
});
$('content').addEventListener('pointerout', event => {
  if (hintAnchor?.contains(event.target) && !hintAnchor.contains(event.relatedTarget)) hideActionHint();
});
$('content').addEventListener('focusin', event => {
  if (event.target.matches('[data-tip]')) showActionHint(event.target);
});
$('content').addEventListener('focusout', hideActionHint);
document.addEventListener('scroll', hideActionHint, true);
window.addEventListener('resize', hideActionHint);
document.addEventListener('click', hideActionHint);
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideActionHint(); });

// Dismiss shared dropdowns without affecting reference-folder expansion.
document.addEventListener('click', event => {
  document.querySelectorAll('.white-menu[open]').forEach(menu => {
    if (!menu.contains(event.target) || event.target.closest('.menu-panel button')) menu.open = false;
  });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('.white-menu[open]');
  if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
});

function renderMarket() {
  $('page-title').textContent = 'Agent 市集';
  $('top-page').textContent = 'Agent 市集';
  const available = state.agents.filter(agent => !agent.deleted && agent.open && live(agent) && department(live(agent)).includes('品保部'));
  const favorites = state.favorites?.[role] || [];
  const shown = available.filter(agent => (!favoritesOnly || favorites.includes(agent.id)) && [live(agent).name, live(agent).purpose].join(' ').toLowerCase().includes(marketQuery.toLowerCase()));
  $('page-actions').innerHTML = `<span class="muted">可使用 ${available.length} 個</span><button id="market-manage">Agent 管理</button><input id="market-search" type="search" placeholder="搜尋 Agent 名稱或描述" aria-label="搜尋 Agent 名稱或描述" value="${esc(marketQuery)}">`;
  $('content').innerHTML = `<div class="market-tabs" role="tablist"><button role="tab" data-market-tab="official" aria-selected="${marketTab === 'official'}">官方內建</button><button role="tab" data-market-tab="org" aria-selected="${marketTab === 'org'}">組織自建</button></div>${marketTab === 'org' ? `<div class="market-section-heading"><div><strong>組織助理 · ${available.length}</strong><span class="muted">由組織成員建立，已開放給你的部門使用。</span></div><button id="market-favorites" aria-pressed="${favoritesOnly}">${favoritesOnly ? '★' : '☆'} 檢視最愛</button></div><div class="market-grid">${shown.map(agent => { const v = live(agent); return `<article class="market-card"><div class="market-card-top"><span class="market-agent-symbol" aria-hidden="true">✧</span><button class="text" data-action="market-favorite" data-id="${agent.id}" aria-label="${favorites.includes(agent.id) ? '取消最愛' : '加入最愛'}" aria-pressed="${favorites.includes(agent.id)}">${favorites.includes(agent.id) ? '★' : '☆'}</button></div><h2>${esc(v.name)}</h2><p>${esc(v.purpose || '開啟對話，開始使用此助理。')}</p><div class="market-meta">${badge(v.model || '預設模型','neutral')} ${badge('V'+releaseNumber(v),'neutral')}</div><footer><small>建立者 · ${esc(people[agent.owner || 'creator'])}</small>${iconAction('前往對話','chat','chat',agentAttrs(agent))}</footer></article>`; }).join('') || '<div class="market-empty"><h2>目前沒有符合的助理</h2><p>助理發布並開放給你的部門後，會出現在這裡。</p></div>'}</div>` : '<div class="market-empty"><h2>尚未啟用官方 Agent</h2><p>切換「組織自建」使用部門已發布的助理。</p></div>'}`;
  $('market-manage').onclick = () => $('assistants').click();
  $('market-search').oninput = event => { marketQuery = event.target.value; const cursor = event.target.selectionStart; renderMarket(); $('market-search').focus(); $('market-search').setSelectionRange(cursor,cursor); };
  document.querySelectorAll('[data-market-tab]').forEach(button => button.onclick = () => { marketTab = button.dataset.marketTab; renderMarket(); });
  if ($('market-favorites')) $('market-favorites').onclick = () => { favoritesOnly = !favoritesOnly; renderMarket(); };
}
$('market-nav').onclick = () => { market = true; reviewing = false; chatPage = null; reviewPage = null; render(); };

