import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import {
  LayoutDashboard, ListTodo, Users, Plus, LogOut, Copy, CalendarDays, Circle, Clock3,
  CheckCircle2, Trash2, Menu, X, Pencil, UserCheck, Crown, RefreshCw,
} from 'lucide-react';
import './style.css';

/* ------------------------------------------------------------------
 * 环境变量 / 数据库连接
 * 注意：国内网络下 fonts.googleapis.com、*.vercel.app 会被拦截，
 * 所以项目里不再引用任何境外字体或 CDN 资源，详见「国内访问部署指南.md」。
 * ------------------------------------------------------------------ */
const ENV_URL = import.meta.env.VITE_SUPABASE_URL;
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = ENV_URL && ENV_KEY && !ENV_URL.includes('YOUR_PROJECT')
  ? createClient(ENV_URL, ENV_KEY)
  : null;

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: '高优先级', medium: '中优先级', low: '低优先级' };
const STATUS_LABEL = { todo: '待处理', doing: '进行中', done: '已完成' };

function todayStr(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
const dateText = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '未设置');
const stampText = ts => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/* 需求3：截止日期 > 优先级；需求4：已完成的自动沉到最底下 */
function sortTasks(list) {
  return [...(list || [])].sort((a, b) => {
    const aDone = a.status === 'done' ? 1 : 0;
    const bDone = b.status === 'done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    const pa = PRIORITY_RANK[a.priority] ?? 1;
    const pb = PRIORITY_RANK[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    if (aDone === 1) return new Date(b.completed_at || b.created_at || 0) - new Date(a.completed_at || a.created_at || 0);
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

/* 需求2：一项任务可以有多个负责人（兼容旧字段 assignee_id） */
function assigneeIdsOf(t) {
  if (Array.isArray(t?.assignee_ids) && t.assignee_ids.length) return t.assignee_ids;
  if (t?.assignee_id) return [t.assignee_id];
  return [];
}

function alertDb(error) {
  const m = error?.message || String(error);
  if (/does not exist|schema cache|Could not find the function|column .* does not exist/i.test(m)) {
    alert('数据库还没升级到新版。\n\n请在 Supabase → SQL Editor 中打开并运行 supabase.sql（已有数据请运行 supabase-upgrade-v2.sql），然后再试。\n\n原始错误：' + m);
  } else {
    alert(m);
  }
}

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [people, setPeople] = useState({});
  const [tab, setTab] = useState('overview');
  const [view, setView] = useState('projects');
  const [myTasks, setMyTasks] = useState([]);
  const [myLoading, setMyLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [netIssue, setNetIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [invite, setInvite] = useState('');
  const [taskModal, setTaskModal] = useState(null);
  const [taskFilter, setTaskFilter] = useState('all');
  const [mobileMenu, setMobileMenu] = useState(false);

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(''), 2200);
  }

  /* 登录态：加超时保护，国内网络连不上 Supabase 时不会一直白屏 */
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    const timer = setTimeout(() => {
      if (!alive) return;
      alive = false;
      setLoading(false);
      setNetIssue('连接数据库超时。请检查网络，或稍后点击「重试」。');
    }, 15000);
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!alive) return;
        clearTimeout(timer);
        setSession(data.session || null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        clearTimeout(timer);
        setLoading(false);
        setNetIssue('无法连接数据库，请检查网络后点击「重试」。');
      });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; clearTimeout(timer); subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (session) bootstrap();
    else { setProjects([]); setSelected(null); setProfile(null); setMyTasks([]); setPeople({}); setView('projects'); }
  }, [session?.user?.id]);

  async function bootstrap() {
    setLoading(true);
    const { data: p, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) console.error('profile:', error);
    setProfile(p || null);
    const ps = await loadProjects();
    await loadPeople(ps);
    await loadMyTasks(ps);
    setLoading(false);
  }

  async function loadProjects() {
    const { data, error } = await supabase.from('project_members').select('project_id, role, projects(id,name,description,invite_code,created_at)');
    if (error) {
      console.error('loadProjects:', error);
      flash('项目加载失败：' + error.message);
      return [];
    }
    const ps = (data || []).map(x => ({ ...x.projects, role: x.role }))
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    setProjects(ps);
    setSelected(prev => (prev ? ps.find(p => p.id === prev.id) || null : null));
    return ps;
  }

  /* 一次性把所有项目成员的昵称缓存下来，任务行才能显示「张三、李四」 */
  async function loadPeople(projectList) {
    const ids = (projectList || projects).map(p => p.id);
    if (!ids.length) { setPeople({}); return; }
    const { data: m } = await supabase.from('project_members').select('project_id,user_id').in('project_id', ids);
    const userIds = [...new Set((m || []).map(x => x.user_id))];
    if (!userIds.length) return;
    const { data: p } = await supabase.from('profiles').select('id,display_name,email').in('id', userIds);
    setPeople(prev => {
      const next = { ...prev };
      (p || []).forEach(x => { next[x.id] = x; });
      return next;
    });
  }

  async function openProject(p, nextTab = 'overview') {
    setView('projects');
    setSelected(p);
    setTab(nextTab);
    setTaskFilter('all');
    setMobileMenu(false);
    await loadProjectData(p.id);
  }

  async function loadProjectData(id) {
    const [{ data: t, error: taskError }, { data: m, error: memberError }] = await Promise.all([
      supabase.from('tasks').select('*').eq('project_id', id),
      supabase.from('project_members').select('user_id,role').eq('project_id', id),
    ]);
    if (taskError) { console.error('loadProjectData tasks:', taskError); flash('任务加载失败：' + taskError.message); }
    if (memberError) { console.error('loadProjectData members:', memberError); flash('成员加载失败：' + memberError.message); }
    const ids = (m || []).map(x => x.user_id);
    let profiles = [];
    if (ids.length) {
      const { data: p, error: profileError } = await supabase.from('profiles').select('id,display_name,email').in('id', ids);
      if (profileError) { console.error('loadProjectData profiles:', profileError); flash('成员资料加载失败：' + profileError.message); }
      profiles = p || [];
    }
    const byId = new Map(profiles.map(p => [p.id, p]));
    setPeople(prev => {
      const next = { ...prev };
      profiles.forEach(p => { next[p.id] = p; });
      return next;
    });
    setTasks(t || []);
    setMembers((m || []).map(x => ({ ...byId.get(x.user_id), id: x.user_id, role: x.role })));
  }

  /* 需求7：我的任务（所有项目里分配给我的） */
  async function loadMyTasks(projectList) {
    if (!session) return;
    const ids = (projectList || projects).map(p => p.id);
    if (!ids.length) { setMyTasks([]); return; }
    setMyLoading(true);
    const { data, error } = await supabase.from('tasks').select('*').in('project_id', ids);
    setMyLoading(false);
    if (error) { console.error('loadMyTasks:', error); flash('我的任务加载失败：' + error.message); return; }
    const uid = session.user.id;
    setMyTasks((data || []).filter(t => assigneeIdsOf(t).includes(uid)));
  }

  useEffect(() => {
    if (!selected || !supabase) return;
    const channel = supabase.channel('project-' + selected.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${selected.id}` }, () => loadProjectData(selected.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${selected.id}` }, () => { loadProjectData(selected.id); loadProjects(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selected?.id]);

  /* 我的任务页面也保持实时同步（RLS 会自动过滤掉别人的任务） */
  useEffect(() => {
    if (!session || !supabase) return;
    const channel = supabase.channel('tasks-feed-' + session.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadMyTasks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id, projects.length]);

  async function authSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setNetIssue('');
    let result;
    if (authMode === 'signup') {
      result = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
    }
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      if (/failed to fetch|network/i.test(result.error.message)) setNetIssue('网络连不上数据库，国内网络可参考「国内访问部署指南」。');
    } else if (authMode === 'signup' && !result.data.session) {
      setMessage('注册成功。请检查邮箱并完成验证，然后登录。');
    }
  }

  async function createProject(e) {
    e.preventDefault();
    const { data, error } = await supabase.rpc('create_project', { p_name: projectName, p_description: projectDesc });
    if (error) { alertDb(error); return; }
    setShowCreate(false);
    setProjectName('');
    setProjectDesc('');
    const ps = await loadProjects();
    const p = ps.find(x => x.id === data);
    if (p) openProject(p);
  }

  async function joinProject(e) {
    e.preventDefault();
    const { data, error } = await supabase.rpc('join_project', { p_invite_code: invite.trim().toUpperCase() });
    if (error) { alertDb(error); return; }
    setInvite('');
    const ps = await loadProjects();
    const p = ps.find(x => x.id === data);
    if (p) openProject(p);
  }

  /* 需求1：新建 / 编辑任务共用同一个表单 */
  async function submitTask(form) {
    const assignees = form.assignees || [];
    const patch = {
      title: form.title.trim(),
      assignee_ids: assignees,
      assignee_id: assignees[0] || null,
      due_date: form.due || null,
      priority: form.priority,
    };
    if (taskModal?.mode === 'edit') {
      return updateTask(taskModal.task.id, patch);
    }
    const { error } = await supabase.from('tasks').insert({
      ...patch,
      project_id: selected.id,
      created_by: session.user.id,
    });
    if (error) { alertDb(error); return false; }
    await refreshTasks();
    flash('任务已创建');
    return true;
  }

  async function updateTask(id, patch) {
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (error) { alertDb(error); return false; }
    await refreshTasks();
    return true;
  }

  async function refreshTasks() {
    if (selected) await loadProjectData(selected.id);
    await loadMyTasks();
    await loadProjects();
  }

  async function deleteTask(id) {
    if (!confirm('确定删除这项任务吗？')) return;
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { alertDb(error); return; }
    await refreshTasks();
    flash('任务已删除');
  }

  /* 需求1：点铅笔进入编辑；如果是在「我的任务」里编辑，先跳到对应项目 */
  async function editTask(task) {
    if (selected?.id === task.project_id) { setTaskModal({ mode: 'edit', task }); return; }
    const p = projects.find(x => x.id === task.project_id);
    if (!p) { flash('找不到这项任务所属的项目'); return; }
    await openProject(p, 'tasks');
    setTaskModal({ mode: 'edit', task });
  }

  /* 需求6：组长身份（role=owner），组长可以把组长转给其他成员 */
  async function setLeader(userId) {
    const { error } = await supabase.rpc('set_project_leader', { p_project_id: selected.id, p_user_id: userId });
    if (error) { alertDb(error); return; }
    await loadProjectData(selected.id);
    await loadProjects();
    flash('已更新组长');
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(selected.invite_code);
      flash('邀请码已复制');
    } catch {
      flash('复制失败，请手动选择邀请码复制');
    }
  }

  async function signOut() { await supabase.auth.signOut(); }

  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);
  const sortedMyTasks = useMemo(() => sortTasks(myTasks), [myTasks]);
  const today = todayStr();
  const uid = session?.user?.id;
  const done = tasks.filter(t => t.status === 'done').length;
  const doing = tasks.filter(t => t.status === 'doing').length;
  const todo = tasks.length - done - doing;
  const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  const dueTodayCount = tasks.filter(t => t.due_date === today && t.status !== 'done').length;
  const myOpen = sortedMyTasks.filter(t => t.status !== 'done').length;
  const myDueToday = sortedMyTasks.filter(t => t.due_date === today && t.status !== 'done').length;

  const filteredTasks = sortedTasks.filter(t => {
    if (taskFilter === 'mine') return assigneeIdsOf(t).includes(uid);
    if (taskFilter === 'all') return true;
    return t.status === taskFilter;
  });
  const filterOptions = [
    { key: 'all', label: '全部', count: sortedTasks.length },
    { key: 'mine', label: '我的', count: sortedTasks.filter(t => assigneeIdsOf(t).includes(uid)).length },
    { key: 'todo', label: '待处理', count: todo },
    { key: 'doing', label: '进行中', count: doing },
    { key: 'done', label: '已完成', count: done },
  ];

  if (!supabase) {
    return (
      <div className="setup">
        <div className="setup-card">
          <div className="brand-mark">G</div>
          <h1>GroupMate</h1>
          <p>多人小组作业协作平台</p>
          <h3>完成云端配置后即可启用</h3>
          <ol>
            <li>创建 Supabase 项目。</li>
            <li>在 SQL Editor 中运行项目根目录的 <code>supabase.sql</code>。</li>
            <li>复制 Project URL 和 Publishable key，填入 <code>.env</code>。</li>
            <li>部署到 Vercel，并添加相同的环境变量。</li>
          </ol>
          <p className="muted">当前尚未连接数据库，因此不会显示虚假的在线协作状态。</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="center">
        <div className="loader" />
        <p>正在加载…</p>
        {netIssue && (
          <div className="net-hint">
            <b>{netIssue}</b>
            <button className="secondary small-btn" onClick={() => window.location.reload()}>重试</button>
          </div>
        )}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand-mark">G</div>
          <h1>GroupMate</h1>
          <p className="muted">让每一次小组合作都有序推进</p>
          <div className="auth-tabs">
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>登录</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>注册</button>
          </div>
          <form onSubmit={authSubmit}>
            {authMode === 'signup' && (
              <label>你的昵称<input required value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="例如：陈同学" /></label>
            )}
            <label>邮箱<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
            <label>密码<input type="password" minLength="6" required value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" /></label>
            <button className="primary full" disabled={busy}>{busy ? '请稍候…' : authMode === 'login' ? '登录' : '创建账号'}</button>
          </form>
          {message && <p className="notice">{message}</p>}
          {netIssue && <p className="notice">{netIssue} 如果页面一直转圈，请参考仓库里的「国内访问部署指南.md」。</p>}
          <p className="tiny">注册后，每个账号只会看到自己加入的项目。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className={mobileMenu ? 'sidebar show' : 'sidebar'}>
        <div className="side-top">
          <div className="brand"><div className="brand-mark small">G</div><b>GroupMate</b></div>
          <button className="icon-btn mobile-close" onClick={() => setMobileMenu(false)}><X size={18} /></button>
        </div>
        <div className="side-label">工作空间</div>
        <button
          className={view === 'mytasks' ? 'nav active' : 'nav'}
          onClick={() => { setView('mytasks'); setSelected(null); setMobileMenu(false); loadProjects().then(ps => loadMyTasks(ps)); }}
        >
          <UserCheck size={17} /> 我的任务
          {myOpen > 0 && <span className="nav-badge">{myOpen}</span>}
        </button>
        <button
          className={view === 'projects' && !selected ? 'nav active' : 'nav'}
          onClick={() => { setView('projects'); setSelected(null); setMobileMenu(false); }}
        >
          <LayoutDashboard size={17} /> 我的项目
        </button>
        <div className="project-label">
          <span>我的项目</span>
          <button className="tiny-icon" onClick={() => setShowCreate(true)}><Plus size={16} /></button>
        </div>
        <div className="project-list">
          {projects.map(p => (
            <button key={p.id} className={selected?.id === p.id ? 'project-link selected' : 'project-link'} onClick={() => openProject(p)}>
              <span className="dot" />{p.name}
            </button>
          ))}
        </div>
        <div className="side-bottom">
          <div className="avatar">{(profile?.display_name || session.user.email || 'U').slice(0, 1).toUpperCase()}</div>
          <div className="user-meta">
            <b>{profile?.display_name || '用户'}</b>
            <span>{session.user.email}</span>
          </div>
          <button className="icon-btn" title="退出登录" onClick={signOut}><LogOut size={17} /></button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn mobile-open" onClick={() => setMobileMenu(true)}><Menu size={19} /></button>
          <div className="crumb">
            {view === 'mytasks'
              ? <b>我的任务</b>
              : selected ? <>我的项目 <span>/</span> <b>{selected.name}</b></> : <b>我的项目</b>}
          </div>
          <div className="top-right"><span className="live-dot" /> 云端同步</div>
        </header>

        {/* ---------------- 我的任务（需求7） ---------------- */}
        {view === 'mytasks' && (
          <section className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">MY TASKS</p>
                <h1>我的任务</h1>
                <p className="muted">所有项目里分配给我的任务，按截止日期和优先级自动排序。</p>
              </div>
              <button className="secondary" disabled={myLoading} onClick={() => loadMyTasks()}>
                <RefreshCw size={15} /> {myLoading ? '刷新中…' : '刷新'}
              </button>
            </div>
            <div className="stats">
              <div className="stat"><span>我的任务</span><b>{sortedMyTasks.length}</b><small>未完成 {myOpen} 项</small></div>
              <div className="stat"><span>待处理</span><b>{sortedMyTasks.filter(t => t.status === 'todo').length}</b><small>尚未开始</small></div>
              <div className="stat"><span>进行中</span><b>{sortedMyTasks.filter(t => t.status === 'doing').length}</b><small>正在推进</small></div>
              <div className="stat"><span>今天截止</span><b className={myDueToday ? 'red' : ''}>{myDueToday}</b><small>需要优先处理</small></div>
            </div>
            {sortedMyTasks.length ? (
              <div className="panel">
                <div className="panel-head">
                  <div><h3>任务清单</h3><p className="muted">截止日期越近越靠前，已完成的自动排在最下面</p></div>
                </div>
                {sortedMyTasks.map(t => (
                  <TaskRow
                    key={t.id}
                    t={t}
                    people={people}
                    projectName={(projects.find(p => p.id === t.project_id) || {}).name}
                    onStatus={(id, patch) => updateTask(id, patch)}
                    onEdit={editTask}
                    onDelete={deleteTask}
                  />
                ))}
              </div>
            ) : (
              <div className="empty compact">
                <div className="empty-icon"><UserCheck size={24} /></div>
                <h3>暂时没有分配给你的任务</h3>
                <p>去项目里把任务的负责人设置成自己，这里就会出现。</p>
              </div>
            )}
          </section>
        )}

        {/* ---------------- 项目首页 ---------------- */}
        {view === 'projects' && !selected && (
          <section className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">WORKSPACE</p>
                <h1>我的项目</h1>
                <p className="muted">你参与的所有小组项目都在这里。</p>
              </div>
              <button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> 创建项目</button>
            </div>
            <div className="join-box">
              <div>
                <b>加入已有项目</b>
                <p className="muted">输入项目管理员分享给你的邀请码。</p>
              </div>
              <form onSubmit={joinProject}>
                <input value={invite} onChange={e => setInvite(e.target.value)} placeholder="输入邀请码" required />
                <button className="secondary">加入项目</button>
              </form>
            </div>
            {projects.length ? (
              <div className="project-grid">
                {projects.map(p => (
                  <button className="project-card" key={p.id} onClick={() => openProject(p)}>
                    <div className="card-icon"><LayoutDashboard size={19} /></div>
                    <div className="card-title">{p.name}</div>
                    <p>{p.description || '暂无项目描述'}</p>
                    <div className="card-foot">
                      <span>{p.role === 'owner' ? '组长' : '组员'}</span>
                      <span>进入项目 →</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon"><Users size={24} /></div>
                <h3>还没有加入任何项目</h3>
                <p>创建一个新项目，或使用邀请码加入已有项目。</p>
                <button className="primary" onClick={() => setShowCreate(true)}><Plus size={16} /> 创建第一个项目</button>
              </div>
            )}
          </section>
        )}

        {/* ---------------- 项目内部 ---------------- */}
        {view === 'projects' && selected && (
          <section className="content">
            <div className="project-heading">
              <div>
                <p className="eyebrow">PROJECT</p>
                <h1>{selected.name}</h1>
                <p className="muted">{selected.description || '把任务、进度和成员集中管理。'}</p>
              </div>
              <div className="heading-actions">
                <button className="secondary" onClick={copyInvite}><Copy size={15} /> 复制邀请码</button>
                <button className="primary" onClick={() => setTaskModal({ mode: 'create' })}><Plus size={16} /> 新建任务</button>
              </div>
            </div>

            <div className="tabs">
              <button className={tab === 'overview' ? 'tab active' : 'tab'} onClick={() => setTab('overview')}><LayoutDashboard size={15} /> 项目概览</button>
              <button className={tab === 'tasks' ? 'tab active' : 'tab'} onClick={() => setTab('tasks')}><ListTodo size={15} /> 任务管理</button>
              <button className={tab === 'members' ? 'tab active' : 'tab'} onClick={() => setTab('members')}><Users size={15} /> 成员（{members.length}）</button>
            </div>

            {tab === 'overview' && (
              <>
                <div className="stats">
                  <div className="stat"><span>全部任务</span><b>{tasks.length}</b><small>当前项目任务总数</small></div>
                  <div className="stat"><span>待处理</span><b>{todo}</b><small>尚未开始</small></div>
                  <div className="stat"><span>进行中</span><b>{doing}</b><small>正在推进</small></div>
                  <div className="stat"><span>已完成</span><b>{done}</b><small>完成率 {pct}%</small></div>
                </div>
                {dueTodayCount > 0 && (
                  <div className="due-banner"><CalendarDays size={14} /> 今天有 {dueTodayCount} 项任务截止，记得同步进度。</div>
                )}
                <div className="panel">
                  <div className="panel-head">
                    <div><h3>任务进度</h3><p className="muted">项目整体完成情况</p></div>
                    <b>{pct}%</b>
                  </div>
                  <div className="progress"><span style={{ width: pct + '%' }} /></div>
                  <div className="legend">
                    <span><i className="l-todo" />待处理 {todo}</span>
                    <span><i className="l-doing" />进行中 {doing}</span>
                    <span><i className="l-done" />已完成 {done}</span>
                  </div>
                </div>
                <div className="two-col">
                  <div className="panel">
                    <div className="panel-head">
                      <h3>最近任务</h3>
                      <button className="text-btn" onClick={() => setTab('tasks')}>查看全部</button>
                    </div>
                    {sortedTasks.slice(0, 5).length
                      ? sortedTasks.slice(0, 5).map(t => (
                        <TaskRow key={t.id} t={t} people={people}
                          onStatus={(id, patch) => updateTask(id, patch)}
                          onEdit={editTask}
                          onDelete={deleteTask} />
                      ))
                      : <p className="muted">还没有任务，点击右上角新建任务。</p>}
                  </div>
                  <div className="panel">
                    <div className="panel-head"><h3>项目成员</h3><span className="muted">{members.length} 人</span></div>
                    <MemberList members={members} />
                  </div>
                </div>
              </>
            )}

            {tab === 'tasks' && (
              <div className="panel">
                <div className="panel-head">
                  <div><h3>全部任务</h3><p className="muted">所有项目成员共享此任务列表 · 截止日期越近越靠前</p></div>
                  <button className="primary small-btn" onClick={() => setTaskModal({ mode: 'create' })}><Plus size={15} /> 新建任务</button>
                </div>
                <div className="row-filters">
                  {filterOptions.map(f => (
                    <button key={f.key} className={taskFilter === f.key ? 'filter-chip active' : 'filter-chip'} onClick={() => setTaskFilter(f.key)}>
                      {f.label} {f.count}
                    </button>
                  ))}
                </div>
                {filteredTasks.length ? filteredTasks.map(t => (
                  <TaskRow key={t.id} t={t} people={people}
                    onStatus={(id, patch) => updateTask(id, patch)}
                    onEdit={editTask}
                    onDelete={deleteTask} />
                )) : (
                  <div className="empty compact">
                    <p>{tasks.length ? '这个筛选下没有任务' : '当前项目暂无任务'}</p>
                    <button className="secondary" onClick={() => setTaskModal({ mode: 'create' })}>创建第一项任务</button>
                  </div>
                )}
              </div>
            )}

            {tab === 'members' && (
              <div className="panel">
                <div className="panel-head">
                  <div><h3>项目成员</h3><p className="muted">通过邀请码邀请其他成员加入</p></div>
                  <button className="secondary" onClick={copyInvite}><Copy size={15} /> 复制邀请码</button>
                </div>
                <div className="invite-strip">
                  <span>项目邀请码</span>
                  <code>{selected.invite_code}</code>
                  <button className="text-btn" onClick={copyInvite}>复制</button>
                </div>
                <MemberList
                  members={members}
                  detailed
                  canManage={selected.role === 'owner'}
                  onSetLeader={setLeader}
                />
                <p className="form-hint">组长可以把「组长」身份转给其他成员（同一时间只有一位组长）。</p>
              </div>
            )}
          </section>
        )}
      </main>

      {showCreate && (
        <Modal title="创建新项目" close={() => setShowCreate(false)}>
          <form onSubmit={createProject}>
            <label>项目名称<input required value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="例如：市场营销课程小组作业" /></label>
            <label>项目描述<textarea value={projectDesc} onChange={e => setProjectDesc(e.target.value)} placeholder="简单描述项目目标（选填）" /></label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setShowCreate(false)}>取消</button>
              <button className="primary">创建项目</button>
            </div>
          </form>
        </Modal>
      )}

      {taskModal && (selected || taskModal.task) && (
        <TaskModal
          mode={taskModal.mode}
          initial={taskModal.task}
          members={members}
          onClose={() => setTaskModal(null)}
          onSubmit={submitTask}
        />
      )}

      {message && <div className="toast">{message}</div>}
    </div>
  );
}

/* 需求1/2/5/8：任务行 —— 多负责人、今天到期标红、开始/完成时间戳 */
function TaskRow({ t, people, projectName, onStatus, onEdit, onDelete }) {
  const today = todayStr();
  const ids = assigneeIdsOf(t);
  const done = t.status === 'done';
  const isToday = t.due_date === today;
  const overdue = !!t.due_date && t.due_date < today && !done;
  const nameOf = id => (people?.[id]?.display_name) || (people?.[id]?.email) || '成员';
  return (
    <div className={'task-row' + (isToday && !done ? ' is-today' : '') + (overdue ? ' is-overdue' : '')}>
      <div className="task-main">
        <span className={'task-status ' + t.status}>
          {done ? <CheckCircle2 size={17} /> : t.status === 'doing' ? <Clock3 size={17} /> : <Circle size={17} />}
        </span>
        <div className="task-body">
          <div className="task-title-line">
            <b className={(done ? 'finished ' : '') + (isToday && !done ? 'today-text' : '')}>{t.title}</b>
            {projectName && <span className="tag project">{projectName}</span>}
            {isToday && !done && <span className="tag today">今天截止</span>}
            {overdue && <span className="tag overdue">已逾期</span>}
          </div>
          <div className="task-meta">
            <span className="assignees">
              {ids.length
                ? ids.map(id => (
                  <span className="chip" key={id}>
                    <i className="mini-avatar">{nameOf(id).slice(0, 1).toUpperCase()}</i>
                    {nameOf(id)}
                  </span>
                ))
                : <span className="chip muted-chip">未分配</span>}
            </span>
            <span className={'due-date' + (isToday && !done ? ' red' : '')}>
              <CalendarDays size={12} /> {dateText(t.due_date)}
            </span>
            <span className={'priority ' + t.priority}>{PRIORITY_LABEL[t.priority] || '中优先级'}</span>
          </div>
          {(t.started_at || t.completed_at) && (
            <div className="task-times">
              {t.started_at && <span>开始 {stampText(t.started_at)}</span>}
              {t.completed_at && <span>完成 {stampText(t.completed_at)}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="task-actions">
        <select aria-label="任务状态" value={t.status} onChange={e => onStatus(t.id, { status: e.target.value })}>
          <option value="todo">待处理</option>
          <option value="doing">进行中</option>
          <option value="done">已完成</option>
        </select>
        <button className="icon-btn edit" title="编辑任务" onClick={() => onEdit(t)}><Pencil size={15} /></button>
        <button className="icon-btn delete" title="删除任务" onClick={() => onDelete(t.id)}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

/* 需求1/2：新建与编辑共用的任务表单，负责人可选一位或多位 */
function TaskModal({ mode, initial, members, onClose, onSubmit }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [assignees, setAssignees] = useState(initial ? assigneeIdsOf(initial) : []);
  const [due, setDue] = useState(initial?.due_date || '');
  const [priority, setPriority] = useState(initial?.priority || 'medium');
  const [saving, setSaving] = useState(false);
  const toggle = id => setAssignees(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]));
  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const ok = await onSubmit({ title, assignees, due, priority });
    setSaving(false);
    if (ok) onClose();
  }
  return (
    <Modal title={mode === 'edit' ? '编辑任务' : '新建任务'} close={onClose}>
      <form onSubmit={submit}>
        <label>任务名称
          <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：完成行业分析" />
        </label>
        <div className="field">
          <span className="field-label">负责人（可单选或多选，也可先不分配）</span>
          <div className="check-list">
            {members.length ? members.map(m => (
              <label className="check-item" key={m.id}>
                <input type="checkbox" checked={assignees.includes(m.id)} onChange={() => toggle(m.id)} />
                <span>{m.display_name || m.email || '未设置昵称'}</span>
                {m.role === 'owner' && <i className="mini-tag">组长</i>}
              </label>
            )) : <p className="form-hint">项目还没有其他成员</p>}
          </div>
          <span className="form-hint">已选 {assignees.length} 人</span>
        </div>
        <label>截止日期
          <input type="date" value={due} onChange={e => setDue(e.target.value)} />
        </label>
        <label>优先级
          <select value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>
        {mode === 'edit' && initial?.started_at && (
          <p className="form-hint">该任务开始于 {stampText(initial.started_at)}{initial.completed_at ? `，完成于 ${stampText(initial.completed_at)}` : ''}</p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>取消</button>
          <button className="primary" disabled={saving}>{saving ? '保存中…' : mode === 'edit' ? '保存修改' : '创建任务'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* 需求6：成员列表标注组长 / 组员 */
function MemberList({ members, detailed = false, canManage = false, onSetLeader }) {
  return (
    <div className="member-list">
      {members.map(m => {
        const isLeader = m.role === 'owner';
        return (
          <div className="member-row" key={m.id}>
            <div className="avatar">{(m.display_name || m.email || 'U').slice(0, 1).toUpperCase()}</div>
            <div className="member-info">
              <b>{m.display_name || '未设置昵称'}</b>
              {detailed && <span>{m.email}</span>}
            </div>
            <span className={'role ' + (isLeader ? 'leader' : 'member')}>
              {isLeader ? <><Crown size={11} /> 组长</> : '组员'}
            </span>
            {canManage && !isLeader && onSetLeader && (
              <button className="leader-btn" onClick={() => onSetLeader(m.id)}>设为组长</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Modal({ title, close, children }) {
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={close}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
