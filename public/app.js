// Command Center front end. No build step, no dependencies.

const TASK_STATUS = [
  ['todo', 'To do'],
  ['doing', 'In progress'],
  ['review', 'Attorney review'],
  ['done', 'Done'],
];
const PRIORITY = [['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];
const MATTER_KIND = [
  ['deadline', 'Court deadline'],
  ['our_motion', 'Our motion'],
  ['their_motion', 'Their motion'],
  ['discovery', 'Discovery'],
  ['hearing', 'Hearing'],
  ['other', 'Other'],
];
const MATTER_STATUS = [
  ['not_started', 'Not started'],
  ['drafting', 'Drafting'],
  ['review', 'Attorney review'],
  ['filed', 'Filed'],
  ['awaiting', 'Awaiting ruling'],
  ['done', 'Closed'],
];
const VIEWS = [['overview', 'Overview'], ['tasks', 'Tasks'], ['deadlines', 'Deadlines & motions'], ['activity', 'Activity']];
const COLORS = ['#1f5fa8', '#b0562b', '#2c7a4b', '#7a4fa3', '#a8324e', '#3a7d86'];

const label = (list, key) => (list.find(([k]) => k === key) || [, key])[1];

const S = {
  data: null,
  view: VIEWS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  filter: 'all',
  showAllDone: false,
  dragging: false,
};

// ---------- tiny DOM helper ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'draggable') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (id) => document.getElementById(id);

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const toDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = (ymd) => Math.round((toDate(ymd) - toDate(today())) / 86400000);
function fmtDate(ymd, withYear) {
  const d = toDate(ymd);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function countdown(ymd) {
  const n = daysUntil(ymd);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n < 0 ? `${-n} days overdue` : `In ${n} days`;
}
function dueTone(ymd) {
  const n = daysUntil(ymd);
  return n < 0 ? 'red' : n <= 3 ? 'amber' : 'plain';
}
function parseStamp(s) {
  if (!s) return null;
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}
function ago(s) {
  const d = parseStamp(s);
  if (!d) return '';
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- people ----------
const user = (email) => S.data.users.find((u) => u.email === email);
const nameOf = (email) => (user(email) || {}).name || (email ? email.split('@')[0] : 'Unassigned');
function colorOf(email) {
  let n = 0;
  for (const c of email) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const idx = S.data.users.findIndex((u) => u.email === email);
  return COLORS[(idx >= 0 ? idx : n) % COLORS.length];
}
function avatar(email, cls = '') {
  if (!email) return h('span', { class: `avatar none ${cls}`, title: 'Unassigned' }, '?');
  const el = h('span', { class: `avatar ${cls}`, title: nameOf(email) }, nameOf(email).charAt(0).toUpperCase());
  el.style.background = colorOf(email);
  return el;
}

// ---------- api ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}
function setSync(text, isErr) {
  const el = $('sync');
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
}
async function api(method, path, body) {
  const res = await fetch('/api/' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    redirect: 'manual',
  });
  if (res.type === 'opaqueredirect' || res.status === 401) {
    // Sign-in expired: reload so the login screen appears.
    location.reload();
    throw new Error('Signing you back in…');
  }
  const data = await res.json().catch(() => ({ error: 'Unexpected response from the server.' }));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  S.data = data;
  setSync('Up to date');
  render();
  return data;
}
async function save(method, path, body) {
  try {
    await api(method, path, body);
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}
async function refresh() {
  if (S.dragging || document.hidden) return;
  try {
    await api('GET', 'state');
  } catch (e) {
    setSync('Offline. Retrying…', true);
  }
}

// ---------- derived ----------
const openTasks = () => S.data.tasks.filter((t) => t.status !== 'done');
const openMatters = () => S.data.matters.filter((m) => m.status !== 'done');
const matter = (id) => S.data.matters.find((m) => m.id === id);
function byDue(a, b) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date) || a.id - b.id;
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return a.id - b.id;
}
const PRI_RANK = { high: 0, normal: 1, low: 2 };
const taskOrder = (a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority] || byDue(a, b);
function doneSince(days) {
  const cut = Date.now() - days * 86400000;
  return S.data.tasks.filter((t) => t.status === 'done' && parseStamp(t.completed_at) >= cut);
}

// ---------- shared pieces ----------
function duePill(ymd, done) {
  if (!ymd) return null;
  if (done) return h('span', { class: 'pill plain' }, fmtDate(ymd));
  const n = daysUntil(ymd);
  const text = n >= -1 && n <= 1 ? countdown(ymd) : n < 0 ? countdown(ymd) : fmtDate(ymd);
  return h('span', { class: `pill ${dueTone(ymd)}`, title: fmtDate(ymd, true) }, text);
}
function miniTask(t) {
  return h('button', { class: 'mini', type: 'button', onclick: () => taskDialog(t) },
    h('span', { class: 't' }, t.title),
    t.blocked ? h('span', { class: 'pill amber' }, 'Blocked') : null,
    duePill(t.due_date));
}
function matterRow(m) {
  const linked = S.data.tasks.filter((t) => t.matter_id === m.id);
  const done = linked.filter((t) => t.status === 'done').length;
  const closed = m.status === 'done';
  const cal = m.due_date
    ? h('div', { class: 'cal' },
        h('div', { class: 'm' }, toDate(m.due_date).toLocaleDateString(undefined, { month: 'short' })),
        h('div', { class: 'd' }, toDate(m.due_date).getDate()))
    : h('div', { class: 'cal nodate' }, h('div', { class: 'd' }, 'TBD'));
  const statusTone = { not_started: 'plain', drafting: '', review: 'violet', filed: 'green', awaiting: 'amber', done: 'plain' }[m.status];
  return h('button', { class: `row ${closed ? 'closed' : ''}`, type: 'button', onclick: () => matterDialog(m) },
    cal,
    h('div', {},
      h('div', { class: 'title' }, m.title),
      h('div', { class: 'meta' },
        h('span', {}, label(MATTER_KIND, m.kind)),
        h('span', { class: `pill ${statusTone}` }, label(MATTER_STATUS, m.status)),
        linked.length ? h('span', {}, `${done} of ${linked.length} tasks done`) : null)),
    h('div', { class: 'right' },
      m.due_date && !closed ? h('span', { class: `pill ${dueTone(m.due_date)}` }, countdown(m.due_date)) : null,
      avatar(m.owner_email)));
}
function feedItem(a) {
  return h('div', { class: 'event' },
    avatar(a.actor_email),
    h('div', { class: 'what' }, h('strong', {}, nameOf(a.actor_email)), ' ', a.summary),
    h('div', { class: 'when', title: parseStamp(a.created_at).toLocaleString() }, ago(a.created_at)));
}

// ---------- views ----------
function go(view) {
  S.view = view;
  history.replaceState(null, '', '#' + view);
  render();
  window.scrollTo(0, 0);
}

function viewOverview() {
  const { tasks, users, me } = S.data;
  const open = openTasks();
  const doing = open.filter((t) => t.status === 'doing');
  const review = open.filter((t) => t.status === 'review');
  const week = doneSince(7);
  const doneAll = tasks.length - open.length;
  const pct = tasks.length ? Math.round((doneAll / tasks.length) * 100) : 0;
  const upcoming = openMatters().filter((m) => m.due_date).sort(byDue);
  const next = upcoming[0];

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stat = (k, v, s, onclick) =>
    h('button', { class: 'stat card', type: 'button', onclick }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('div', { class: 's' }, s));

  const nextTile = next
    ? h('button', { class: `stat card next ${daysUntil(next.due_date) <= 3 ? 'urgent' : ''}`, type: 'button', onclick: () => matterDialog(next) },
        h('div', { class: 'k' }, 'Next deadline'),
        h('div', { class: 'v' }, countdown(next.due_date)),
        h('div', { class: 's' }, `${fmtDate(next.due_date)} · ${next.title}`))
    : h('button', { class: 'stat card next', type: 'button', onclick: () => matterDialog() },
        h('div', { class: 'k' }, 'Next deadline'),
        h('div', { class: 'v' }, 'None yet'),
        h('div', { class: 's' }, 'Add your first deadline or motion'));

  const people = users.map((u) => {
    const mine = open.filter((t) => t.owner_email === u.email);
    const now = mine.filter((t) => t.status === 'doing').sort(taskOrder);
    const nextUp = mine.filter((t) => t.status === 'todo').sort(taskOrder);
    const inReview = mine.filter((t) => t.status === 'review');
    const doneWeek = week.filter((t) => t.owner_email === u.email).length;
    return h('div', { class: 'person card' },
      h('div', { class: 'person-head' },
        avatar(u.email, 'lg'),
        h('div', {},
          h('div', { class: 'name' }, u.name, u.email === me ? h('span', { class: 'faint small' }, '  (you)') : null),
          h('div', { class: 'small faint' }, u.last_seen ? `Active ${ago(u.last_seen)}` : '')),
        h('div', { class: 'counts' },
          inReview.length ? h('span', { class: 'pill violet' }, `${inReview.length} with attorney`) : null,
          h('span', { class: 'pill green' }, `${doneWeek} done this week`))),
      h('p', { class: 'label' }, 'Working on now'),
      now.length ? now.map(miniTask) : h('div', { class: 'small faint' }, 'Nothing in progress.'),
      nextUp.length
        ? [h('p', { class: 'label mt' }, `Up next (${nextUp.length})`), nextUp.slice(0, 3).map(miniTask)]
        : null);
  });
  const unassigned = open.filter((t) => !t.owner_email).sort(taskOrder);
  if (unassigned.length) {
    people.push(h('div', { class: 'person card' },
      h('div', { class: 'person-head' }, avatar(null, 'lg'),
        h('div', {}, h('div', { class: 'name' }, 'Unassigned'), h('div', { class: 'small faint' }, 'Up for grabs'))),
      unassigned.slice(0, 5).map(miniTask),
      unassigned.length > 5 ? h('div', { class: 'small faint mt' }, `and ${unassigned.length - 5} more`) : null));
  }

  const dueTasks = open.filter((t) => t.due_date && daysUntil(t.due_date) <= 7).sort(byDue);

  return h('div', {},
    h('div', { class: 'hello' },
      h('div', {},
        h('h1', {}, `${greet}, ${nameOf(me)}.`),
        h('p', { class: 'muted' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))),
      h('div', { class: 'hstack' },
        h('button', { class: 'btn', type: 'button', onclick: () => matterDialog() }, 'New deadline or motion'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => taskDialog() }, 'New task'))),
    h('div', { class: 'stats' },
      stat('Open tasks', open.length, `${open.filter((t) => t.blocked).length} blocked`, () => go('tasks')),
      stat('In progress', doing.length, doing.length === 1 ? '1 task underway' : `${doing.length} tasks underway`, () => go('tasks')),
      stat('Attorney review', review.length, 'Waiting on counsel', () => go('tasks')),
      stat('Done this week', week.length, `${doneAll} done in total`, () => go('tasks')),
      nextTile),
    h('div', { class: 'progress card' },
      h('strong', {}, `${pct}%`),
      (() => { const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i')); bar.firstChild.style.width = pct + '%'; return bar; })(),
      h('span', { class: 'muted small' }, `${doneAll} of ${tasks.length} tasks complete`)),
    h('div', { class: 'cols' },
      h('section', {},
        h('div', { class: 'section-head' }, h('h2', {}, "Who's on what")),
        h('div', { class: 'people' }, people)),
      h('div', { class: 'stack' },
        h('section', {},
          h('div', { class: 'section-head' }, h('h2', {}, 'Coming up'),
            h('button', { class: 'link', type: 'button', onclick: () => go('deadlines') }, 'All deadlines')),
          h('div', { class: 'rows card' },
            upcoming.length ? upcoming.slice(0, 5).map(matterRow) : h('div', { class: 'empty' }, 'No dated deadlines or motions yet.'))),
        dueTasks.length
          ? h('section', {},
              h('div', { class: 'section-head' }, h('h2', {}, 'Tasks due soon')),
              h('div', {}, dueTasks.slice(0, 6).map(miniTask)))
          : null,
        h('section', {},
          h('div', { class: 'section-head' }, h('h2', {}, 'Recent activity'),
            h('button', { class: 'link', type: 'button', onclick: () => go('activity') }, 'See all')),
          h('div', { class: 'feed card' },
            S.data.activity.length ? S.data.activity.slice(0, 7).map(feedItem) : h('div', { class: 'empty' }, 'Nothing yet.'))))));
}

function taskCard(t) {
  const m = t.matter_id ? matter(t.matter_id) : null;
  const done = t.status === 'done';
  const cls = ['task', 'card', t.blocked && !done ? 'blocked' : t.priority === 'high' && !done ? 'high' : '', done ? 'is-done' : ''].join(' ');
  return h('button', {
      class: cls, type: 'button', draggable: true,
      onclick: () => taskDialog(t),
      ondragstart: (e) => { S.dragging = true; e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragend: (e) => { S.dragging = false; e.currentTarget.classList.remove('dragging'); },
    },
    h('div', { class: 't' }, t.title),
    m ? h('div', { class: 'matter' }, '↳ ', m.title) : null,
    h('div', { class: 'foot' },
      t.blocked && !done ? h('span', { class: 'pill amber' }, 'Blocked') : null,
      t.priority === 'high' && !done ? h('span', { class: 'pill red' }, 'High') : null,
      duePill(t.due_date, done),
      t.notes ? h('span', { class: 'faint small', title: 'Has notes' }, '≡') : null,
      avatar(t.owner_email)));
}

function viewTasks() {
  const { users, me } = S.data;
  const match = (t) =>
    S.filter === 'all' ? true : S.filter === 'none' ? !t.owner_email : t.owner_email === S.filter;
  const chip = (key, text, email) =>
    h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.filter === key), onclick: () => { S.filter = key; render(); } },
      email ? avatar(email) : null, text);

  const cols = TASK_STATUS.map(([status, title]) => {
    let list = S.data.tasks.filter((t) => t.status === status && match(t));
    if (status === 'done') list.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    else list.sort(taskOrder);
    const total = list.length;
    const capped = status === 'done' && !S.showAllDone && total > 8;
    if (capped) list = list.slice(0, 8);

    const col = h('div', {
        class: 'col', 'data-status': status,
        ondragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); },
        ondragleave: (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); },
        ondrop: (e) => {
          e.preventDefault();
          col.classList.remove('over');
          S.dragging = false;
          const id = Number(e.dataTransfer.getData('text/plain'));
          const t = S.data.tasks.find((x) => x.id === id);
          if (!t || t.status === status) return;
          const patch = { status };
          // Picking up an unassigned task makes it yours.
          if (status === 'doing' && !t.owner_email) patch.owner_email = me;
          save('PATCH', `tasks/${id}`, patch);
        },
      },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), title, h('span', { class: 'n' }, total)),
      status === 'todo'
        ? h('input', {
            class: 'quick', type: 'text', maxlength: 200, placeholder: '+ Add a task and press Enter', 'aria-label': 'Quick add task',
            onkeydown: async (e) => {
              if (e.key !== 'Enter' || !e.target.value.trim()) return;
              const title = e.target.value.trim();
              e.target.value = '';
              const owner = S.filter !== 'all' && S.filter !== 'none' ? S.filter : null;
              await save('POST', 'tasks', { title, owner_email: owner });
              const again = document.querySelector('.quick');
              if (again) again.focus();
            },
          })
        : null,
      list.map(taskCard),
      !total && status !== 'todo' ? h('div', { class: 'empty' }, 'Drop tasks here') : null,
      capped ? h('button', { class: 'link', type: 'button', onclick: () => { S.showAllDone = true; render(); } }, `Show all ${total}`) : null);
    return col;
  });

  return h('div', {},
    h('div', { class: 'toolbar' },
      chip('all', 'Everyone'),
      users.map((u) => chip(u.email, u.email === me ? `${u.name} (you)` : u.name, u.email)),
      chip('none', 'Unassigned'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => taskDialog() }, 'New task')),
    h('div', { class: 'board' }, cols));
}

function viewDeadlines() {
  const all = S.data.matters;
  const open = all.filter((m) => m.status !== 'done');
  const groups = [
    ['Overdue', open.filter((m) => m.due_date && daysUntil(m.due_date) < 0).sort(byDue)],
    ['Upcoming', open.filter((m) => m.due_date && daysUntil(m.due_date) >= 0).sort(byDue)],
    ['No date yet', open.filter((m) => !m.due_date)],
    ['Closed', all.filter((m) => m.status === 'done').sort((a, b) => -byDue(a, b))],
  ].filter(([, list]) => list.length);

  return h('div', {},
    h('div', { class: 'toolbar' },
      h('div', { class: 'muted' }, 'Court deadlines, hearings, discovery, and every motion in play, ours and theirs.'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => matterDialog() }, 'New deadline or motion')),
    groups.length
      ? groups.map(([title, list]) => [
          h('p', { class: 'label group-label' }, `${title} (${list.length})`),
          h('div', { class: 'rows card' }, list.map(matterRow)),
        ])
      : h('div', { class: 'card empty' }, 'Nothing here yet. Add the first deadline or the first motion you plan to file.'));
}

function viewActivity() {
  return h('div', {},
    h('div', { class: 'section-head' }, h('h2', {}, 'Activity'), h('span', { class: 'faint small' }, 'Latest 60 changes')),
    h('div', { class: 'feed card' },
      S.data.activity.length ? S.data.activity.map(feedItem) : h('div', { class: 'empty' }, 'Nothing yet.')));
}

// ---------- dialogs ----------
function field(text, control) {
  return h('label', { class: 'field' }, h('span', {}, text), control);
}
function select(name, options, value) {
  return h('select', { name }, options.map(([k, v]) => h('option', { value: k, selected: String(k) === String(value ?? '') }, v)));
}
function ownerSelect(value) {
  return select('owner_email', [['', 'Unassigned'], ...S.data.users.map((u) => [u.email, u.name])], value);
}
function openDialog(form) {
  const d = $('dialog');
  d.replaceChildren(form);
  if (!d.open) d.showModal();
}
function closeDialog() {
  $('dialog').close();
}
function sheet(title, fields, { onsave, ondelete, stamp }) {
  const err = h('div', { class: 'err', role: 'alert' });
  const form = h('form', {
      class: 'sheet', method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const body = Object.fromEntries(fd.entries());
        for (const box of form.querySelectorAll('input[type=checkbox]')) body[box.name] = box.checked;
        err.textContent = '';
        try {
          await onsave(body);
          closeDialog();
        } catch (ex) {
          err.textContent = ex.message;
        }
      },
    },
    h('h2', {}, title),
    fields,
    err,
    h('div', { class: 'actions' },
      ondelete ? h('button', { class: 'btn danger', type: 'button', onclick: ondelete }, 'Delete') : null,
      stamp ? h('span', { class: 'stamp' }, stamp) : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: closeDialog }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
  openDialog(form);
  const first = form.querySelector('input[name=title], input[name=name]');
  if (first && !first.value) first.focus();
}
function confirmDelete(what, path) {
  const form = h('form', { class: 'sheet', method: 'dialog', onsubmit: (e) => e.preventDefault() },
    h('h2', {}, 'Delete this?'),
    h('p', { class: 'muted' }, `“${what}” will be removed for both of you. This can't be undone.`),
    h('div', { class: 'actions' },
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: closeDialog }, 'Keep it'),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => { closeDialog(); await save('DELETE', path); } }, 'Delete')));
  openDialog(form);
}

function taskDialog(t) {
  const isNew = !t;
  const me = S.data.me;
  t = t || { title: '', notes: '', status: 'todo', priority: 'normal', blocked: 0, owner_email: me, due_date: '', matter_id: '', link: '' };
  const matters = [['', 'None'], ...S.data.matters
    .filter((m) => m.status !== 'done' || m.id === t.matter_id).sort(byDue).map((m) => [m.id, m.title])];
  sheet(isNew ? 'New task' : 'Task', [
    field('Task', h('input', { name: 'title', type: 'text', value: t.title, required: true, maxlength: 200, placeholder: 'What needs to be done?' })),
    h('div', { class: 'grid2' },
      field('Owner', ownerSelect(t.owner_email)),
      field('Status', select('status', TASK_STATUS, t.status))),
    h('div', { class: 'grid2' },
      field('Due', h('input', { name: 'due_date', type: 'date', value: t.due_date || '' })),
      field('Priority', select('priority', PRIORITY, t.priority))),
    field('Part of', select('matter_id', matters, t.matter_id)),
    field('Notes', h('textarea', { name: 'notes', maxlength: 5000, placeholder: 'Details, where things stand, what is blocking it…' }, t.notes)),
    field('Link', h('input', { name: 'link', type: 'url', value: t.link, placeholder: 'https://… (a draft, a folder, a filing)' })),
    t.link ? h('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Open link ↗') : null,
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'blocked', checked: !!t.blocked }), 'Blocked, waiting on something'),
  ], {
    stamp: isNew ? null : `Added by ${nameOf(t.created_by)} ${ago(t.created_at)}`,
    onsave: (body) => api(isNew ? 'POST' : 'PATCH', isNew ? 'tasks' : `tasks/${t.id}`, body),
    ondelete: isNew ? null : () => confirmDelete(t.title, `tasks/${t.id}`),
  });
}

function matterDialog(m) {
  const isNew = !m;
  m = m || { title: '', notes: '', kind: 'our_motion', status: 'not_started', owner_email: '', due_date: '', link: '' };
  const linked = isNew ? [] : S.data.tasks.filter((t) => t.matter_id === m.id).sort(taskOrder);
  sheet(isNew ? 'New deadline or motion' : 'Deadline or motion', [
    field('Title', h('input', { name: 'title', type: 'text', value: m.title, required: true, maxlength: 200, placeholder: 'e.g. Motion to compel, response due, hearing' })),
    h('div', { class: 'grid2' },
      field('Type', select('kind', MATTER_KIND, m.kind)),
      field('Status', select('status', MATTER_STATUS, m.status))),
    h('div', { class: 'grid2' },
      field('Date', h('input', { name: 'due_date', type: 'date', value: m.due_date || '' })),
      field('Lead', ownerSelect(m.owner_email))),
    field('Notes', h('textarea', { name: 'notes', maxlength: 5000, placeholder: 'Strategy, what the attorney said, what is still needed…' }, m.notes)),
    field('Link', h('input', { name: 'link', type: 'url', value: m.link, placeholder: 'https://…' })),
    m.link ? h('a', { href: m.link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Open link ↗') : null,
    linked.length ? h('div', {}, h('p', { class: 'label' }, `Tasks (${linked.filter((t) => t.status === 'done').length} of ${linked.length} done)`), linked.map(miniTask)) : null,
    isNew ? null : h('button', { class: 'link', type: 'button', onclick: () => { closeDialog(); taskDialogFor(m.id); } }, '+ Add a task for this'),
  ], {
    stamp: isNew ? null : `Added by ${nameOf(m.created_by)} ${ago(m.created_at)}`,
    onsave: (body) => api(isNew ? 'POST' : 'PATCH', isNew ? 'matters' : `matters/${m.id}`, body),
    ondelete: isNew ? null : () => confirmDelete(m.title, `matters/${m.id}`),
  });
}
function taskDialogFor(matterId) {
  taskDialog();
  const sel = document.querySelector('#dialog select[name=matter_id]');
  if (sel) sel.value = String(matterId);
}

function nameDialog() {
  const me = user(S.data.me);
  sheet('Your display name', [
    field('Name', h('input', { name: 'name', type: 'text', value: me ? me.name : '', required: true, maxlength: 40 })),
    h('p', { class: 'small faint' }, `Signed in as ${S.data.me}`),
  ], { onsave: (body) => api('PATCH', 'me', body) });
}

// ---------- render ----------
function render() {
  if (!S.data) return;
  const counts = { tasks: openTasks().length, deadlines: openMatters().length };
  $('tabs').replaceChildren(...VIEWS.map(([key, text]) =>
    h('button', { class: 'tab', type: 'button', 'aria-current': S.view === key ? 'page' : null, onclick: () => go(key) },
      text, counts[key] ? h('span', { class: 'n' }, counts[key]) : null)));
  $('me').replaceChildren(avatar(S.data.me), nameOf(S.data.me));

  // Keep a half-typed quick-add from being wiped by a background refresh.
  const quick = document.querySelector('.quick');
  const typed = quick ? quick.value : '';
  const hadFocus = quick && document.activeElement === quick;

  const view = { overview: viewOverview, tasks: viewTasks, deadlines: viewDeadlines, activity: viewActivity }[S.view]();
  $('app').replaceChildren(view);

  const again = document.querySelector('.quick');
  if (again && typed) again.value = typed;
  if (again && hadFocus) again.focus();
}

$('me').addEventListener('click', nameDialog);
$('dialog').addEventListener('click', (e) => { if (e.target === $('dialog')) closeDialog(); });
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS.some(([k]) => k === v) && v !== S.view) { S.view = v; render(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!$('dialog').open) refresh(); }, 15000);

api('GET', 'state').catch((e) => {
  $('app').replaceChildren(h('p', { class: 'loading' }, `Could not load: ${e.message}`));
});
