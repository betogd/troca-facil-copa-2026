// app.js — Troca Fácil (Copa 2026). Frontend estático conectado ao Supabase.
// Escopo atual: T2 (client) · T3 (auth magic link) · T4 (perfis) · T5 (coleção no banco).
// Visual e catálogo reaproveitados de legacy-local.html.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { NAME, KIND, TEAMOF, KLABEL, GROUPS } from './catalog.js';

const TOTAL = 980;
const $ = s => document.querySelector(s);
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function toast(m) {
  const t = $('#toast'); t.textContent = m; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function screen(name) { document.body.dataset.screen = name; }

// ---------- guarda de configuração ----------
const URL_ = window.SUPABASE_URL, KEY_ = window.SUPABASE_ANON_KEY;
const configured = !!URL_ && !!KEY_ && !/SEU-PROJETO/.test(URL_) && !/COLE_A_ANON_KEY/.test(KEY_);

if (!configured) {
  screen('setup');
} else {
  boot(createClient(URL_, KEY_));
}

function boot(sb) {
  // ---------- estado ----------
  let profiles = [];
  let activeId = null;
  let counts = {};                 // sticker_id -> count (perfil ativo)
  let filter = 'all', query = '';
  let currentTab = 'album';
  const timers = new Map();        // sticker_id -> timeout (debounce de persistência)
  const dirty = new Map();         // sticker_id -> { pid, count } pendente de gravação

  // ---------- auth (T3) ----------
  let ownerId = null;
  let currentUid;                  // undefined até o 1º evento (distinto de null = deslogado)
  sb.auth.getSession().then(({ data }) => applySession(data.session));
  sb.auth.onAuthStateChange((_evt, session) => applySession(session));

  function applySession(session) {
    const uid = session?.user?.id ?? null;
    if (uid === currentUid) return;   // ignora repetições (getSession + INITIAL_SESSION, token refresh…)
    currentUid = uid;
    if (session) {
      ownerId = session.user.id;
      $('#userEmail').textContent = session.user.email || '';
      screen('app');
      loadProfiles();
    } else {
      ownerId = null; profiles = []; activeId = null; counts = {};
      if (inboxChannel) { sb.removeChannel(inboxChannel); inboxChannel = null; }
      closeChat();
      unread = 0; updateBadge();
      screen('login');
    }
  }

  const LOGIN_LABEL = 'Enviar link de acesso';
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'), msg = $('#loginMsg');
    if (btn.disabled) return;                       // já enviando ou em cooldown
    const email = $('#email').value.trim();
    if (!email) return;
    btn.disabled = true; btn.textContent = 'Enviando…';
    msg.className = 'banner'; msg.textContent = '';
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.href }
    });
    if (error) {                                    // deixa tentar de novo (ex.: corrigir e-mail)
      msg.className = 'banner err'; msg.textContent = 'Não deu pra enviar: ' + error.message;
      btn.textContent = LOGIN_LABEL; btn.disabled = false;
      return;
    }
    msg.className = 'banner ok';
    msg.textContent = 'Link enviado! Abra o e-mail (' + email + ') e clique pra entrar.';
    // cooldown de 60s pra evitar reenvios acidentais (poupa a cota de e-mail)
    let s = 60;
    btn.textContent = 'Reenviar em ' + s + 's';
    const timer = setInterval(() => {
      s -= 1;
      if (s <= 0) { clearInterval(timer); btn.textContent = LOGIN_LABEL; btn.disabled = false; }
      else btn.textContent = 'Reenviar em ' + s + 's';
    }, 1000);
  });

  $('#googleBtn').addEventListener('click', async () => {
    const msg = $('#loginMsg');
    msg.className = 'banner'; msg.textContent = '';
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) { msg.className = 'banner err'; msg.textContent = 'Não deu pra abrir o Google: ' + error.message; }
  });

  $('#logout').addEventListener('click', () => sb.auth.signOut());

  // ---------- perfis (T4) ----------
  async function loadProfiles() {
    // Filtra por owner_id: o RLS permite ler o diretório (profiles_read), então sem isto
    // viriam perfis de todo mundo, não só os meus.
    const { data, error } = await sb.from('profiles')
      .select('*').eq('owner_id', ownerId).order('created_at', { ascending: true });
    if (error) { toast('Erro ao carregar perfis'); return; }
    profiles = data || [];
    if (!profiles.length) { await createProfile(true); return; }
    if (!activeId || !profiles.some(p => p.id === activeId)) activeId = profiles[0].id;
    renderProfiles();
    loadCollection();
  }

  function renderProfiles() {
    const sel = $('#prof'); sel.innerHTML = '';
    for (const p of profiles) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.display_name + (p.city ? ' · ' + p.city : '');
      if (p.id === activeId) o.selected = true;
      sel.appendChild(o);
    }
  }

  $('#prof').addEventListener('change', (e) => { activeId = e.target.value; loadCollection(); });

  function askCity() {
    const city = (prompt('Cidade (pra achar trocas por perto). Pode deixar em branco:', '') || '').trim();
    let uf = '';
    if (city) uf = (prompt('Estado (UF), ex.: PR:', '') || '').trim().toUpperCase().slice(0, 2);
    return { city, uf };
  }

  async function createProfile(first) {
    const name = (prompt(first ? 'Bora criar o primeiro colecionador. Nome:' : 'Nome do novo colecionador:') || '').trim();
    if (!name) { if (first) { renderProfiles(); loadCollection(); } return; }
    const { city, uf } = askCity();
    const { data, error } = await sb.from('profiles').insert({
      owner_id: ownerId,              // exigido por NOT NULL + RLS (owner_id = auth.uid())
      display_name: name,
      city: city || null,
      uf: uf || null,
      city_norm: city ? norm(city) : null
    }).select().single();
    if (error) { toast('Erro ao criar perfil'); return; }
    profiles.push(data); activeId = data.id;
    renderProfiles(); loadCollection();
    toast('Perfil "' + data.display_name + '" criado');
  }
  $('#newProf').addEventListener('click', () => createProfile(false));

  async function renameProfile() {
    const p = profiles.find(x => x.id === activeId); if (!p) return;
    const name = (prompt('Nome do colecionador:', p.display_name) || '').trim();
    if (!name) return;
    const city = (prompt('Cidade:', p.city || '') || '').trim();
    const uf = city ? (prompt('Estado (UF):', p.uf || '') || '').trim().toUpperCase().slice(0, 2) : '';
    const patch = { display_name: name, city: city || null, uf: uf || null, city_norm: city ? norm(city) : null };
    const { data, error } = await sb.from('profiles').update(patch).eq('id', p.id).select().single();
    if (error) { toast('Erro ao salvar'); return; }
    Object.assign(p, data); renderProfiles();
    toast('Perfil atualizado');
  }
  $('#renProf').addEventListener('click', renameProfile);

  // ---------- coleção (T5) ----------
  async function loadCollection() {
    counts = {};
    renderStats(); renderList();
    subscribeInbox();
    if (currentTab === 'inbox') { unread = 0; updateBadge(); loadInbox(); } else seedBadge();
    if (!activeId) return;
    const { data, error } = await sb.from('collection_items')
      .select('sticker_id,count').eq('profile_id', activeId);
    if (error) { toast('Erro ao carregar coleção'); return; }
    const next = {};
    for (const r of (data || [])) next[r.sticker_id] = r.count;
    counts = next;
    renderStats(); renderList();
  }

  // Grava com debounce: count>=1 => upsert; count==0 => delete. Update otimista já ocorreu na UI.
  function persist(id) {
    dirty.set(id, { pid: activeId, count: counts[id] || 0 });
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => flush(id), 400));
  }
  async function flush(id) {
    timers.delete(id);
    const d = dirty.get(id); if (!d) return;
    dirty.delete(id);
    if (d.count <= 0) {
      const { error } = await sb.from('collection_items').delete()
        .eq('profile_id', d.pid).eq('sticker_id', id);
      if (error) toast('Falha ao salvar ' + id);
    } else {
      const { error } = await sb.from('collection_items').upsert(
        { profile_id: d.pid, sticker_id: id, count: d.count, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id,sticker_id' }
      );
      if (error) toast('Falha ao salvar ' + id);
    }
  }
  // Não perde a última marcação se fechar a aba no meio do debounce.
  window.addEventListener('beforeunload', () => { for (const id of [...timers.keys()]) flush(id); });

  function bump(id, d) {
    if (!activeId) { toast('Crie um colecionador primeiro (+ Novo)'); return; }
    let n = (counts[id] || 0) + d; if (n < 0) n = 0;
    if (n === 0) delete counts[id]; else counts[id] = n;
    updateSlot(id); renderStats(); updateTeamProg(id);
    if ((filter === 'falta' && n > 0) || (filter === 'repe' && n < 2)) renderList();
    persist(id);
  }

  // ---------- KPIs ----------
  function stat() {
    let have = 0, repe = 0;
    for (const id in counts) { const n = counts[id]; if (n >= 1) have++; if (n >= 2) repe += n - 1; }
    return { have, falta: TOTAL - have, repe, pct: Math.round(have / TOTAL * 100) };
  }
  function renderStats() {
    const s = stat();
    $('#kHave').textContent = s.have; $('#kFalta').textContent = s.falta; $('#kRepe').textContent = s.repe;
    $('#ring').style.setProperty('--p', s.pct);
    $('#ringtxt').innerHTML = s.pct + '%<small>colado</small>';
  }

  // ---------- filtros / busca ----------
  function setFilter(f) {
    filter = f;
    $('#fAll').setAttribute('aria-pressed', f === 'all');
    $('#fFalta').setAttribute('aria-pressed', f === 'falta');
    $('#fRepe').setAttribute('aria-pressed', f === 'repe');
    renderList();
  }
  $('#fAll').onclick = () => setFilter('all');
  $('#fFalta').onclick = () => setFilter('falta');
  $('#fRepe').onclick = () => setFilter('repe');
  $('#q').addEventListener('input', (e) => { query = norm(e.target.value); renderList(); });

  function visible(id) {
    const n = counts[id] || 0;
    if (filter === 'falta' && n > 0) return false;
    if (filter === 'repe' && n < 2) return false;
    if (query) {
      const hay = norm(id + ' ' + NAME[id] + ' ' + TEAMOF[id]);
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  // ---------- render do álbum (reaproveitado do legacy) ----------
  function slotHTML(id) {
    const n = counts[id] || 0, k = KIND[id];
    const cls = ['slot', 'k-' + k]; if (n >= 2) cls.push('repe'); else if (n === 1) cls.push('have');
    const num = id === '00' ? '00' : id.replace(/^[A-Z]+/, '');
    return '<button class="' + cls.join(' ') + '" data-id="' + id + '" aria-label="' + id + ' ' + NAME[id] + '">'
      + '<span class="kindtag">' + (KLABEL[k] || '') + '</span>'
      + '<span class="tick">✓</span><span class="dup">×' + n + '</span>'
      + '<span class="n">' + num + '</span>'
      + '<span class="nm">' + NAME[id] + '</span></button>';
  }

  function renderList() {
    const host = $('#list'); let html = ''; let any = false;
    for (const g of GROUPS) {
      const vis = g.ids.filter(visible); if (!vis.length) continue; any = true;
      let have = 0; g.ids.forEach(id => { if ((counts[id] || 0) >= 1) have++; });
      const done = have === g.ids.length;
      const open = (filter !== 'all' || query) ? 'open' : '';
      html += '<details class="team" ' + open + '>'
        + '<summary>'
        + '<span class="flagcode">' + (g.code === 'FWC' ? '★' : g.code) + '</span>'
        + '<span class="tname">' + g.name + '</span>'
        + '<span class="tprog' + (done ? ' done' : '') + '">' + have + '/' + g.ids.length + '</span>'
        + '<span class="chev">▶</span>'
        + '</summary>'
        + '<div class="grid">' + vis.map(slotHTML).join('') + '</div>'
        + '</details>';
    }
    host.innerHTML = any ? html : '<div class="empty">Nada por aqui com esse filtro. 🔍</div>';
  }

  function updateSlot(id) {
    const b = $('.slot[data-id="' + CSS.escape(id) + '"]'); if (!b) return;
    const n = counts[id] || 0;
    b.classList.toggle('have', n === 1); b.classList.toggle('repe', n >= 2);
    b.querySelector('.dup').textContent = '×' + n;
  }
  function updateTeamProg(id) {
    const g = GROUPS.find(g => g.ids.includes(id)); if (!g) return;
    const det = [...document.querySelectorAll('.team')]
      .find(d => d.querySelector('.flagcode')?.textContent === (g.code === 'FWC' ? '★' : g.code));
    if (!det) return;
    let have = 0; g.ids.forEach(x => { if ((counts[x] || 0) >= 1) have++; });
    const el = det.querySelector('.tprog');
    el.textContent = have + '/' + g.ids.length;
    el.classList.toggle('done', have === g.ids.length);
  }

  // tap = +1 ; segurar = -1 (idêntico ao legacy)
  let holdTimer = null, held = false;
  $('#list').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.slot'); if (!b) return; held = false;
    holdTimer = setTimeout(() => { held = true; bump(b.dataset.id, -1); navigator.vibrate && navigator.vibrate(15); }, 420);
  });
  const cancelHold = () => clearTimeout(holdTimer);
  $('#list').addEventListener('pointerup', cancelHold);
  $('#list').addEventListener('pointerleave', cancelHold, true);
  $('#list').addEventListener('pointercancel', cancelHold);
  $('#list').addEventListener('click', (e) => {
    const b = e.target.closest('.slot'); if (!b) return;
    if (held) { held = false; return; }
    bump(b.dataset.id, +1);
  });

  // ---------- T6: procurar trocas ----------
  function activeProfile() { return profiles.find(p => p.id === activeId) || null; }

  function prefillTrade() {
    const p = activeProfile();
    $('#tCity').value = p?.city || '';
    $('#tUf').value = p?.uf || '';
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function plural(n) { return n === 1 ? '1 figurinha' : n + ' figurinhas'; }

  function chipsHTML(ids, total, cls) {
    if (!ids || !ids.length) return '<div class="cnt">—</div>';
    let html = ids.map(id => '<span class="chip ' + cls + '" title="' + escapeHtml(NAME[id]) + '">' + id + '</span>').join('');
    if (total > ids.length) html += '<span class="chip ' + cls + ' more">+' + (total - ids.length) + '</span>';
    return '<div class="chips">' + html + '</div>';
  }

  function renderMatches(rows) {
    const host = $('#tResults');
    if (!rows.length) {
      host.innerHTML = '<div class="empty">Ninguém por aqui ainda com troca que valha. Tente “estado inteiro” ou volte depois. 🙂</div>';
      return;
    }
    host.innerHTML = rows.map(r => {
      const local = [r.city, r.uf].filter(Boolean).join(' · ') || '—';
      return '<div class="card">'
        + '<div class="matchhead">'
        + '<div><h3>' + escapeHtml(r.display_name) + '</h3><p class="d">' + escapeHtml(local) + '</p></div>'
        + '<button class="btn green" data-to="' + r.profile_id + '">Solicitar troca</button>'
        + '</div>'
        + '<div class="result">'
        + '<div class="col give"><h4>Você dá</h4><div class="cnt">' + plural(r.give_count) + '</div>' + chipsHTML(r.sample_give, r.give_count, 'b') + '</div>'
        + '<div class="col get"><h4>Você recebe</h4><div class="cnt">' + plural(r.get_count) + '</div>' + chipsHTML(r.sample_get, r.get_count, 'g') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  async function searchTrades() {
    const banner = $('#tBanner'), host = $('#tResults');
    banner.className = 'banner'; banner.textContent = '';
    if (!activeId) { banner.className = 'banner warn'; banner.textContent = 'Escolha ou crie um colecionador primeiro.'; host.innerHTML = ''; return; }
    const byState = $('#tState').checked;
    const city = $('#tCity').value.trim();
    const uf = $('#tUf').value.trim().toUpperCase().slice(0, 2);
    const params = { p_profile: activeId, p_only_mutual: $('#tMutual').checked, p_limit: 50 };
    if (byState) {
      if (!uf) { banner.className = 'banner warn'; banner.textContent = 'Pra buscar pelo estado, preencha a UF.'; return; }
      params.p_city_norm = null; params.p_uf = uf;
    } else {
      if (!city) { banner.className = 'banner warn'; banner.textContent = 'Preencha a cidade (ou marque “estado inteiro”).'; return; }
      params.p_city_norm = norm(city); params.p_uf = uf || null;
    }
    host.innerHTML = '<div class="empty">Procurando…</div>';
    const { data, error } = await sb.rpc('find_trade_matches', params);
    if (error) { banner.className = 'banner err'; banner.textContent = 'Erro na busca: ' + error.message; host.innerHTML = ''; return; }
    const rows = data || [];
    if (rows.length) { banner.className = 'banner ok'; banner.textContent = rows.length + (rows.length === 1 ? ' pessoa encontrada.' : ' pessoas encontradas.'); }
    renderMatches(rows);
  }

  $('#tSearch').addEventListener('click', searchTrades);
  $('#tResults').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-to]'); if (!b || b.disabled) return;
    const name = b.closest('.card')?.querySelector('h3')?.textContent || 'colecionador';
    openComposer(b.dataset.to, name);
  });

  // ---------- T7: solicitar troca ----------
  const dlg = $('#composer');
  let composeTo = null;                          // { id, name }
  let composePreview = { offered: [], requested: [] };

  async function openComposer(toId, toName) {
    composeTo = { id: toId, name: toName };
    $('#cTitle').textContent = 'Trocar com ' + toName;
    $('#cLists').innerHTML = '<div class="empty">Montando a troca…</div>';
    $('#cBanner').className = 'banner'; $('#cBanner').textContent = '';
    $('#cMsg').value = ''; $('#cSend').disabled = true;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    const { data, error } = await sb.rpc('trade_preview', { p_from: activeId, p_to: toId });
    if (composeTo?.id !== toId) return;          // fechou/trocou no meio
    if (error) { $('#cLists').innerHTML = ''; $('#cBanner').className = 'banner err'; $('#cBanner').textContent = 'Erro ao montar a troca: ' + error.message; return; }
    const row = (data && data[0]) || { offered: [], requested: [] };
    composePreview = { offered: row.offered || [], requested: row.requested || [] };
    renderComposer(toName);
  }

  function renderComposer(toName) {
    const { offered, requested } = composePreview;
    $('#cLists').innerHTML =
      '<div class="col give"><h4>Você dá</h4><div class="cnt">' + plural(offered.length) + '</div>' + chipsHTML(offered, offered.length, 'b') + '</div>'
      + '<div class="col get"><h4>Você recebe</h4><div class="cnt">' + plural(requested.length) + '</div>' + chipsHTML(requested, requested.length, 'g') + '</div>';
    $('#cMsg').value = defaultMessage(toName, offered, requested);
    $('#cSend').disabled = (offered.length === 0 && requested.length === 0);
  }

  function defaultMessage(toName, offered, requested) {
    const give = offered.length ? offered.join(', ') : '(nada agora)';
    const get = requested.length ? requested.join(', ') : '(nada agora)';
    return 'Oi, ' + toName + '! Bora trocar figurinha da Copa 2026? 📗⚽\n'
      + 'Tenho pra você: ' + give + '.\n'
      + 'Queria de você: ' + get + '.';
  }

  function closeComposer() { if (dlg.open) dlg.close(); composeTo = null; }
  $('#cClose').addEventListener('click', closeComposer);
  dlg.addEventListener('cancel', () => { composeTo = null; });                 // ESC
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeComposer(); }); // backdrop

  $('#cWpp').addEventListener('click', () => {
    window.open('https://wa.me/?text=' + encodeURIComponent($('#cMsg').value), '_blank');
  });

  $('#cSend').addEventListener('click', async () => {
    if (!activeId || !composeTo) return;
    const to = composeTo;
    $('#cSend').disabled = true;
    $('#cBanner').className = 'banner'; $('#cBanner').textContent = '';
    const { error } = await sb.from('trade_requests').insert({
      from_profile: activeId,
      to_profile: to.id,
      message: $('#cMsg').value.trim() || null,
      offered: composePreview.offered,
      requested: composePreview.requested
    });
    if (error) { $('#cSend').disabled = false; $('#cBanner').className = 'banner err'; $('#cBanner').textContent = 'Não deu pra enviar: ' + error.message; return; }
    const cardBtn = $('#tResults button[data-to="' + CSS.escape(to.id) + '"]');
    if (cardBtn) { cardBtn.textContent = 'Solicitado ✓'; cardBtn.disabled = true; cardBtn.classList.remove('green'); cardBtn.classList.add('ghost'); }
    closeComposer();
    toast('Solicitação enviada pra ' + to.name + '! 🎉');
  });

  // ---------- T8: caixa de entrada + realtime ----------
  let unread = 0;
  let inboxChannel = null;

  function updateBadge() {
    const b = $('#msgBadge');
    if (unread > 0) { b.textContent = unread > 9 ? '9+' : String(unread); b.classList.remove('hide'); }
    else b.classList.add('hide');
  }

  async function seedBadge() {
    if (!activeId) { unread = 0; updateBadge(); return; }
    const { count, error } = await sb.from('trade_requests')
      .select('id', { count: 'exact', head: true })
      .eq('to_profile', activeId).eq('status', 'pending');
    if (!error) { unread = count || 0; updateBadge(); }
  }

  const STATUS_LABEL = { pending: 'Pendente', accepted: 'Aceita', declined: 'Recusada', cancelled: 'Cancelada' };
  function fmtDate(s) { try { return new Date(s).toLocaleDateString('pt-BR'); } catch (e) { return ''; } }

  function namedChips(ids, cls) {
    if (!ids || !ids.length) return '<div class="cnt">—</div>';
    return '<div class="chips">' + ids.map(id =>
      '<span class="chip ' + cls + '">' + escapeHtml(id + (NAME[id] ? ' ' + NAME[id] : '')) + '</span>'
    ).join('') + '</div>';
  }

  function requestCard(r, kind) {
    // kind 'recv' = sou destinatário; 'sent' = sou remetente.
    const who = (kind === 'recv' ? r.sender : r.recipient) || {};
    const local = [who.city, who.uf].filter(Boolean).join(' · ');
    const offered = r.offered || [], requested = r.requested || [];
    const giveIds = kind === 'recv' ? requested : offered;   // o que EU dou (azul)
    const getIds = kind === 'recv' ? offered : requested;    // o que EU recebo (verde)
    let actions = '';
    if (kind === 'recv' && r.status === 'pending') {
      actions = '<div class="btnrow"><button class="btn green" data-act="accept" data-id="' + r.id + '">Aceitar</button>'
        + '<button class="btn ghost" data-act="decline" data-id="' + r.id + '">Recusar</button></div>';
    } else if (r.status === 'accepted') {
      actions = '<div class="btnrow"><button class="btn blue" data-chat="' + r.id + '" data-other="' + escapeHtml(who.display_name || 'colecionador') + '">💬 Combinar encontro</button></div>';
    }
    return '<div class="card">'
      + '<div class="reqhead">'
      + '<div><h4>' + escapeHtml(who.display_name || 'colecionador') + '</h4>'
      + '<p class="d">' + escapeHtml(local || '—') + ' · ' + fmtDate(r.created_at) + '</p></div>'
      + '<span class="status ' + r.status + '">' + (STATUS_LABEL[r.status] || r.status) + '</span>'
      + '</div>'
      + (r.message ? '<div class="reqmsg">' + escapeHtml(r.message) + '</div>' : '')
      + '<div class="result">'
      + '<div class="col give"><h4>Você dá</h4><div class="cnt">' + plural(giveIds.length) + '</div>' + namedChips(giveIds, 'b') + '</div>'
      + '<div class="col get"><h4>Você recebe</h4><div class="cnt">' + plural(getIds.length) + '</div>' + namedChips(getIds, 'g') + '</div>'
      + '</div>'
      + actions
      + '</div>';
  }

  async function loadInbox() {
    const recvHost = $('#inboxRecv'), sentHost = $('#inboxSent');
    if (!activeId) { recvHost.innerHTML = sentHost.innerHTML = '<div class="empty">Escolha um colecionador.</div>'; return; }
    recvHost.innerHTML = sentHost.innerHTML = '<div class="empty">Carregando…</div>';
    const cols = '*, sender:from_profile(display_name,city,uf), recipient:to_profile(display_name,city,uf)';
    const [recv, sent] = await Promise.all([
      sb.from('trade_requests').select(cols).eq('to_profile', activeId).order('created_at', { ascending: false }),
      sb.from('trade_requests').select(cols).eq('from_profile', activeId).order('created_at', { ascending: false })
    ]);
    recvHost.innerHTML = recv.error ? '<div class="empty">Erro ao carregar recebidas.</div>'
      : (recv.data.length ? recv.data.map(r => requestCard(r, 'recv')).join('') : '<div class="empty">Nenhuma solicitação recebida ainda.</div>');
    sentHost.innerHTML = sent.error ? '<div class="empty">Erro ao carregar enviadas.</div>'
      : (sent.data.length ? sent.data.map(r => requestCard(r, 'sent')).join('') : '<div class="empty">Você ainda não enviou solicitações.</div>');
  }

  async function setStatus(id, status) {
    const { error } = await sb.from('trade_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Erro: ' + error.message); }
    else { toast(status === 'accepted' ? 'Troca aceita! 🎉' : 'Solicitação recusada'); }
    loadInbox();
  }

  $('#viewInbox').addEventListener('click', (e) => {
    const act = e.target.closest('button[data-act]');
    if (act) { act.disabled = true; setStatus(act.dataset.id, act.dataset.act === 'accept' ? 'accepted' : 'declined'); return; }
    const chat = e.target.closest('button[data-chat]');
    if (chat) openChat(chat.dataset.chat, chat.dataset.other || 'colecionador');
  });

  function subscribeInbox() {
    if (inboxChannel) { sb.removeChannel(inboxChannel); inboxChannel = null; }
    if (!activeId) return;
    inboxChannel = sb.channel('inbox-' + activeId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trade_requests', filter: 'to_profile=eq.' + activeId }, () => {
        if (currentTab === 'inbox') loadInbox(); else { unread++; updateBadge(); }
        toast('Nova solicitação de troca! 📩');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trade_requests', filter: 'from_profile=eq.' + activeId }, () => {
        if (currentTab === 'inbox') loadInbox();
      })
      // Mensagens de chat: o RLS já entrega só as das minhas trocas. Avisa quando é do outro lado.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trade_messages' }, (payload) => {
        const m = payload.new;
        if (!m || m.sender_profile === activeId) return;                         // minhas, ignora
        if (chatDlg.open && chatReq && chatReq.id === m.request_id) return;       // já estou vendo essa conversa
        unread++; updateBadge();
        toast('Nova mensagem no chat! 💬');
      })
      .subscribe();
  }

  // ---------- Chat da troca (combinar encontro) ----------
  const chatDlg = $('#chat');
  let chatReq = null;            // { id, other }
  let chatChannel = null;

  async function openChat(requestId, otherName) {
    chatReq = { id: requestId, other: otherName };
    $('#chTitle').textContent = 'Combinar com ' + otherName;
    $('#chThread').innerHTML = '<div class="empty">Carregando…</div>';
    $('#chInput').value = '';
    if (chatDlg.showModal) chatDlg.showModal(); else chatDlg.setAttribute('open', '');
    await loadChat();
    subscribeChat();
    $('#chInput').focus();
  }

  async function loadChat() {
    if (!chatReq) return;
    const reqId = chatReq.id;
    const { data, error } = await sb.from('trade_messages')
      .select('*').eq('request_id', reqId).order('created_at', { ascending: true });
    if (chatReq?.id !== reqId) return;          // fechou/trocou no meio
    if (error) { $('#chThread').innerHTML = '<div class="empty">Erro ao carregar as mensagens.</div>'; return; }
    renderThread(data || []);
  }

  function fmtTime(s) { try { return new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  function renderThread(msgs) {
    const host = $('#chThread');
    if (!msgs.length) { host.innerHTML = '<div class="empty">Combinem o encontro por aqui. 👋</div>'; return; }
    host.innerHTML = msgs.map(m => {
      const mine = m.sender_profile === activeId;
      return '<div class="msg ' + (mine ? 'mine' : 'theirs') + '">' + escapeHtml(m.body)
        + '<span class="meta">' + fmtTime(m.created_at) + '</span></div>';
    }).join('');
    host.scrollTop = host.scrollHeight;
  }

  $('#chForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = $('#chInput').value.trim();
    if (!body || !chatReq || !activeId) return;
    $('#chInput').value = '';
    const { error } = await sb.from('trade_messages').insert({ request_id: chatReq.id, sender_profile: activeId, body });
    if (error) { $('#chInput').value = body; toast('Não deu pra enviar: ' + error.message); return; }
    loadChat();
  });

  function subscribeChat() {
    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
    if (!chatReq) return;
    chatChannel = sb.channel('chat-' + chatReq.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trade_messages', filter: 'request_id=eq.' + chatReq.id }, () => loadChat())
      .subscribe();
  }

  function closeChat() {
    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
    if (chatDlg.open) chatDlg.close();
    chatReq = null;
  }
  $('#chClose').addEventListener('click', closeChat);
  chatDlg.addEventListener('cancel', () => { if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; } chatReq = null; });
  chatDlg.addEventListener('click', (e) => { if (e.target === chatDlg) closeChat(); });

  // ---------- abas ----------
  function tab(which) {
    currentTab = which;
    $('#tabAlbum').setAttribute('aria-selected', which === 'album');
    $('#tabTrade').setAttribute('aria-selected', which === 'trade');
    $('#tabMsgs').setAttribute('aria-selected', which === 'inbox');
    $('#viewAlbum').classList.toggle('hide', which !== 'album');
    $('#viewTrade').classList.toggle('hide', which !== 'trade');
    $('#viewInbox').classList.toggle('hide', which !== 'inbox');
    if (which === 'trade') { prefillTrade(); if ($('#tCity').value || $('#tUf').value) searchTrades(); }
    if (which === 'inbox') { unread = 0; updateBadge(); loadInbox(); }
  }
  $('#tabAlbum').onclick = () => tab('album');
  $('#tabTrade').onclick = () => tab('trade');
  $('#tabMsgs').onclick = () => tab('inbox');
}
