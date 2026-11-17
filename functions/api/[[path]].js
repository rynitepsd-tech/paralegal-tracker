const TASK_STATUS = ['todo', 'doing', 'review', 'done'];
const PRIORITY = ['low', 'normal', 'high'];
const MATTER_KIND = ['deadline', 'our_motion', 'their_motion', 'discovery', 'hearing', 'other'];
const MATTER_STATUS = ['not_started', 'drafting', 'review', 'filed', 'awaiting', 'done'];

const TASK_STATUS_LABEL = { todo: 'To do', doing: 'In progress', review: 'Attorney review', done: 'Done' };
const MATTER_STATUS_LABEL = {
  not_started: 'Not started', drafting: 'Drafting', review: 'Attorney review',
  filed: 'Filed', awaiting: 'Awaiting ruling', done: 'Closed',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

class Bad extends Error {}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function pick(v, list, field) {
  if (!list.includes(v)) throw new Bad(`Invalid ${field}`);
  return v;
}
function date(v) {
  if (v === null || v === '' || v === undefined) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Bad('Invalid date');
  return v;
}
function link(v) {
  const s = str(v, 2000);
  if (s && !/^https?:\/\//i.test(s)) throw new Bad('Links must start with http:// or https://');
  return s;
}
async function owner(db, v) {
  if (v === null || v === '' || v === undefined) return null;
  const row = await db.prepare('SELECT email FROM users WHERE email = ?').bind(String(v).toLowerCase()).first();
  if (!row) throw new Bad('Unknown owner');
  return row.email;
}
async function matterId(db, v) {
  if (v === null || v === '' || v === undefined) return null;
  const row = await db.prepare('SELECT id FROM matters WHERE id = ?').bind(Number(v)).first();
  if (!row) throw new Bad('Unknown deadline or motion');
  return row.id;
}

function defaultName(email) {
  const base = email.split('@')[0].split(/[._+-]/)[0] || 'Me';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function log(db, email, summary) {
  await db.prepare('INSERT INTO activity (actor_email, summary) VALUES (?, ?)').bind(email, summary.slice(0, 300)).run();
}

async function state(db, email) {
  const [users, tasks, matters, activity] = await db.batch([
    db.prepare('SELECT email, name, last_seen FROM users ORDER BY created_at'),
    db.prepare('SELECT * FROM tasks ORDER BY id DESC'),
    db.prepare('SELECT * FROM matters ORDER BY id DESC'),
    db.prepare('SELECT id, actor_email, summary, created_at FROM activity ORDER BY id DESC LIMIT 60'),
  ]);
  return {
    me: email,
    users: users.results,
    tasks: tasks.results,
    matters: matters.results,
    activity: activity.results,
  };
}

async function buildTask(db, body, current) {
  const t = { ...current };
  if ('title' in body) t.title = str(body.title, 200);
  if (!t.title) throw new Bad('A title is required');
  if ('notes' in body) t.notes = str(body.notes, 5000);
  if ('status' in body) t.status = pick(body.status, TASK_STATUS, 'status');
  if ('priority' in body) t.priority = pick(body.priority, PRIORITY, 'priority');
  if ('blocked' in body) t.blocked = body.blocked ? 1 : 0;
  if ('owner_email' in body) t.owner_email = await owner(db, body.owner_email);
  if ('due_date' in body) t.due_date = date(body.due_date);
  if ('matter_id' in body) t.matter_id = await matterId(db, body.matter_id);
  if ('link' in body) t.link = link(body.link);
  return t;
}

async function buildMatter(db, body, current) {
  const m = { ...current };
  if ('title' in body) m.title = str(body.title, 200);
  if (!m.title) throw new Bad('A title is required');
  if ('notes' in body) m.notes = str(body.notes, 5000);
  if ('kind' in body) m.kind = pick(body.kind, MATTER_KIND, 'type');
  if ('status' in body) m.status = pick(body.status, MATTER_STATUS, 'status');
  if ('owner_email' in body) m.owner_email = await owner(db, body.owner_email);
  if ('due_date' in body) m.due_date = date(body.due_date);
  if ('link' in body) m.link = link(body.link);
  return m;
}

export async function onRequest(context) {
  const { request, env, params, data } = context;
  const db = env.DB;
  const email = data.email;
  const path = (params.path || []).join('/');
  const method = request.method;

  if (!db) return json({ error: 'Database is not connected (missing DB binding).' }, 503);

  try {
    if (method !== 'GET') {
      // Same-origin only: block cross-site form posts.
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== new URL(request.url).host) throw new Bad('Bad origin');
      if (!(request.headers.get('content-type') || '').includes('application/json')) throw new Bad('JSON required');
    }

    await db
      .prepare(
        `INSERT INTO users (email, name, last_seen) VALUES (?, ?, datetime('now'))
         ON CONFLICT(email) DO UPDATE SET last_seen = datetime('now')`
      )
      .bind(email, defaultName(email))
      .run();

    if (method === 'GET' && path === 'state') return json(await state(db, email));

    const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
    if (typeof body !== 'object' || body === null) throw new Bad('Invalid body');

    if (method === 'PATCH' && path === 'me') {
      const name = str(body.name, 40);
      if (!name) throw new Bad('A name is required');
      await db.prepare('UPDATE users SET name = ? WHERE email = ?').bind(name, email).run();
      return json(await state(db, email));
    }

    const [collection, idRaw] = path.split('/');
    const id = idRaw ? Number(idRaw) : null;
    if (idRaw && !Number.isInteger(id)) throw new Bad('Invalid id');

    if (collection === 'tasks') {
      if (method === 'POST' && !id) {
        const t = await buildTask(db, body, {
          title: '', notes: '', status: 'todo', priority: 'normal', blocked: 0,
          owner_email: null, due_date: null, matter_id: null, link: '',
        });
        await db
          .prepare(
            `INSERT INTO tasks (title, notes, status, priority, blocked, owner_email, due_date, matter_id, link, created_by, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(t.title, t.notes, t.status, t.priority, t.blocked, t.owner_email, t.due_date, t.matter_id, t.link, email,
            t.status === 'done' ? new Date().toISOString() : null)
          .run();
        await log(db, email, `added task “${t.title}”`);
        return json(await state(db, email));
      }
      if (id) {
        const cur = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
        if (!cur) return json({ error: 'That task no longer exists.' }, 404);
        if (method === 'DELETE') {
          await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
          await log(db, email, `deleted task “${cur.title}”`);
          return json(await state(db, email));
        }
        if (method === 'PATCH') {
          const t = await buildTask(db, body, cur);
          const completed =
            t.status === 'done' ? cur.completed_at || new Date().toISOString() : null;
          await db
            .prepare(
              `UPDATE tasks SET title=?, notes=?, status=?, priority=?, blocked=?, owner_email=?, due_date=?, matter_id=?, link=?,
               completed_at=?, updated_at=datetime('now') WHERE id=?`
            )
            .bind(t.title, t.notes, t.status, t.priority, t.blocked, t.owner_email, t.due_date, t.matter_id, t.link, completed, id)
            .run();
          let what = `updated task “${t.title}”`;
          if (t.status !== cur.status) what = `moved “${t.title}” to ${TASK_STATUS_LABEL[t.status]}`;
          else if (t.blocked !== cur.blocked) what = `${t.blocked ? 'flagged' : 'unblocked'} “${t.title}”${t.blocked ? ' as blocked' : ''}`;
          else if (t.owner_email !== cur.owner_email) what = `reassigned “${t.title}”`;
          await log(db, email, what);
          return json(await state(db, email));
        }
      }
    }

    if (collection === 'matters') {
      if (method === 'POST' && !id) {
        const m = await buildMatter(db, body, {
          title: '', notes: '', kind: 'deadline', status: 'not_started', owner_email: null, due_date: null, link: '',
        });
        await db
          .prepare(
            `INSERT INTO matters (title, notes, kind, status, owner_email, due_date, link, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(m.title, m.notes, m.kind, m.status, m.owner_email, m.due_date, m.link, email)
          .run();
        await log(db, email, `added “${m.title}” to deadlines`);
        return json(await state(db, email));
      }
      if (id) {
        const cur = await db.prepare('SELECT * FROM matters WHERE id = ?').bind(id).first();
        if (!cur) return json({ error: 'That item no longer exists.' }, 404);
        if (method === 'DELETE') {
          await db.batch([
            db.prepare('UPDATE tasks SET matter_id = NULL WHERE matter_id = ?').bind(id),
            db.prepare('DELETE FROM matters WHERE id = ?').bind(id),
          ]);
          await log(db, email, `deleted “${cur.title}” from deadlines`);
          return json(await state(db, email));
        }
        if (method === 'PATCH') {
          const m = await buildMatter(db, body, cur);
          await db
            .prepare(
              `UPDATE matters SET title=?, notes=?, kind=?, status=?, owner_email=?, due_date=?, link=?, updated_at=datetime('now') WHERE id=?`
            )
            .bind(m.title, m.notes, m.kind, m.status, m.owner_email, m.due_date, m.link, id)
            .run();
          let what = `updated “${m.title}”`;
          if (m.status !== cur.status) what = `marked “${m.title}” ${MATTER_STATUS_LABEL[m.status]}`;
          else if (m.due_date !== cur.due_date) what = `changed the date on “${m.title}”`;
          await log(db, email, what);
          return json(await state(db, email));
        }
      }
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof Bad) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: 'Something went wrong saving that.' }, 500);
  }
}
