(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const config = window.KENSEI_CONFIG || {};
  let client = null, user = null, toastTimeout, storageWarning = false, authReady = false, authStarting = false, cloudError = false;
  const tools = window.KENSEI_TOOLS || {};
  const key = () => 'kensei-workshop:v1:' + (user?.id || 'guest');
  const emptyData = () => ({ items: [] });
  function read() { try { return JSON.parse(localStorage.getItem(key())) || emptyData(); } catch { return emptyData(); } }
  function write(data) {
    try { localStorage.setItem(key(), JSON.stringify(data)); return true; }
    catch { if (!storageWarning) { toast('Browser storage is unavailable or full. Export your work before leaving.'); storageWarning = true; } return false; }
  }
  function toast(message) { const node = $('.toast'); node.textContent = message; node.hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { node.hidden = true; }, 5500); }
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => crypto.randomUUID();
  const items = type => read().items.filter(x => x.type === type);
  function localSave(item) { const data = read(); data.items = data.items.filter(x => x.id !== item.id); data.items.push(item); return write(data); }
  async function saveItem(type, data, id = uid(), expected = null) {
    const item = { id, type, data, updated_at: new Date().toISOString() };
    if (user && client) {
      if (type === 'draft' && expected) {
        const { data: remote, error } = await client.from('workspace_items').select('updated_at').eq('id', id).maybeSingle();
        if (error) throw error;
        if (remote && remote.updated_at !== expected) { item.id = uid(); item.data.name += ' (conflict copy)'; toast('This draft changed on another device. Saved your work as a separate copy.'); }
      }
      const { data: saved, error } = await client.from('workspace_items').upsert({ ...item, user_id: user.id }).select('id,type,data,updated_at').single();
      if (error) throw error;
      localSave(saved); return saved;
    }
    if (!localSave(item)) throw new Error('Could not save in this browser.');
    return item;
  }
  async function removeItem(id) {
    if (user && client) { const { error } = await client.from('workspace_items').delete().eq('id', id); if (error) throw error; }
    const data = read(); data.items = data.items.filter(x => x.id !== id); write(data); updateFavorites(); renderWorkspace();
  }
  async function loadCloud() {
    if (!client || !user) return;
    const { data, error } = await client.from('workspace_items').select('id,type,data,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    const pending = read().items.filter(x => x.type === 'session' && x.data.pending && !data.some(r => r.id === x.id));
    write({ items: [...data, ...pending] }); updateFavorites(); renderWorkspace();
  }
  function updateFavorites() { const favorites = items('favorite'); $$('[data-favorite]').forEach(b => b.setAttribute('aria-pressed', String(favorites.some(x => x.data.slug === b.dataset.favorite)))); }
  function bindFavorites(root = document) {
    $$('[data-favorite]', root).forEach(b => b.addEventListener('click', async () => {
      const slug = b.dataset.favorite;
      const existing = items('favorite').find(x => x.data.slug === slug);
      try { if (existing) await removeItem(existing.id); else await saveItem('favorite', { slug }, 'favorite-' + slug); updateFavorites(); toast(existing ? 'Removed from favorites.' : (user ? 'Favorite synced.' : 'Saved to this device.')); }
      catch { toast('Could not save your favorite. Please try again.'); }
    }));
    updateFavorites();
  }
  $$('[data-personal]').forEach(a => { if (config.personalUrl) a.href = config.personalUrl; });
  $$('[data-car]').forEach(a => { if (config.carUrl) a.href = config.carUrl; });
  $('.menu-toggle')?.addEventListener('click', e => { const open = $('#navigation').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(open)); });
  const dialog = $('#auth-dialog');
  $('#google-login').disabled = true;
  function openAuth() {
    if (user) { location.href = '/workspace/'; return; }
    if (!config.supabaseUrl || !config.supabasePublishableKey) {
      $('#google-login').disabled = true;
      $('#auth-note').textContent = 'Cloud sign-in is not connected yet. This site needs its own Supabase and Google OAuth configuration. You can use all tools and save to this device now.';
    } else {
      $('#google-login').disabled = !authReady || authStarting;
      $('#auth-note').textContent = authReady ? 'Tools are always available without an account.' : 'Sign-in is connecting. If this takes a moment, close this window and try again.';
    }
    dialog.showModal();
  }
  $$('[data-sign-in]').forEach(b => b.addEventListener('click', openAuth));
  $('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  $('#google-login').addEventListener('click', async () => {
    if (!client || !authReady || authStarting) return;
    authStarting = true; $('#google-login').disabled = true;
    $('#auth-note').textContent = 'Opening Google sign-in…';
    try {
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/auth/callback/' } });
      if (error) throw error;
    } catch {
      $('#auth-note').textContent = 'Could not open Google sign-in. Please try again.';
      toast('Could not start Google sign-in. Please try again.');
    } finally { authStarting = false; $('#google-login').disabled = !authReady; }
  });
  async function initAuth() {
    if (!config.supabaseUrl || !config.supabasePublishableKey) {
      if ($('#callback-status')) $('#callback-status').textContent = 'Google sign-in has not been configured for this site yet.';
      return;
    }
    try {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      client = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: false } });
      const callback = location.pathname.startsWith('/auth/callback');
      if (callback) {
        const params = new URLSearchParams(location.search);
        // 回调 code 只由这里交换一次，避免 SDK 自动处理后再次交换。
        const code = params.get('code');
        history.replaceState(null, '', location.pathname);
        if (params.get('error')) throw new Error('Sign-in was cancelled or could not be completed.');
        if (code) { const { error } = await client.auth.exchangeCodeForSession(code); if (error) throw error; }
      }
      const { data, error } = await client.auth.getSession(); if (error) throw error;
      user = data.session?.user || null;
      authReady = true; $('#google-login').disabled = false;
      $('#auth-note').textContent = 'Tools are always available without an account.';
      if (user) {
        $('[data-auth-label]').textContent = 'Workspace';
        try { await loadCloud(); } catch { cloudError = true; renderWorkspace(); toast('Signed in, but cloud data could not be loaded. Please refresh to retry.'); }
        if (callback) location.replace('/workspace/');
      } else if (callback) $('#callback-status').textContent = 'No active session. Try signing in again.';
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || (!session && user)) {
          const oldKey = key();
          try { localStorage.removeItem(oldKey); sessionStorage.removeItem(oldKey + ':active-timer'); } catch {}
          user = null; location.replace('/workspace/');
        }
      });
    } catch (e) {
      authReady = !!client; $('#google-login').disabled = !authReady;
      $('#auth-note').textContent = authReady ? 'Sign-in could not be completed. Please try Google sign-in again.' : 'Sign-in is unavailable right now. Refresh the page to try again. Local tools still work.';
      toast('Sign-in connection unavailable. Local tools still work.');
      if ($('#callback-status')) $('#callback-status').textContent = 'Sign-in could not be completed. Please use Sign in to try again.';
    }
  }
  let filter = 'all';
  function filterTools() {
    const query = ($('#tool-search')?.value || '').trim().toLowerCase();
    let count = 0;
    $$('[data-tool-card]').forEach(card => { card.hidden = !(filter === 'all' || card.dataset.category === filter) || !card.dataset.search.includes(query); if (!card.hidden) count++; });
    if ($('#search-empty')) $('#search-empty').hidden = count > 0;
  }
  $$('[data-filter-group] .filter').forEach(b => b.addEventListener('click', () => {
    const group = b.closest('[data-filter-group]');
    $$('.filter', group).forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    if (group.dataset.filterGroup === 'tools') { filter = b.dataset.filter; filterTools(); }
    else $$('.project-card').forEach(c => { c.hidden = b.dataset.filter !== 'all' && c.dataset.category !== b.dataset.filter; });
  }));
  $('#tool-search')?.addEventListener('input', filterTools);

  function downloadText(text, name, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
  function initText() {
    const input = $('#text-input'); if (!input) return;
    let previous = null, draftId = null, savedAt = null, dirty = false;
    const setDirty = () => { dirty = true; $('#draft-state').textContent = 'Unsaved changes · your text is still on this page.'; };
    function stats() { const s = input.value, words = (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length; $('#stat-characters').textContent = [...s].length.toLocaleString(); $('#stat-words').textContent = words.toLocaleString(); $('#stat-lines').textContent = s.length ? s.split('\n').length : 0; $('#stat-reading').textContent = Math.ceil(words / 200) + ' min'; }
    input.addEventListener('input', () => { stats(); setDirty(); });
    $('#draft-name').addEventListener('input', setDirty);
    $$('[data-transform]').forEach(b => b.addEventListener('click', () => {
      previous = input.value;
      switch (b.dataset.transform) {
        case 'upper': input.value = input.value.toUpperCase(); break;
        case 'lower': input.value = input.value.toLowerCase(); break;
        case 'title': input.value = input.value.toLowerCase().replace(/(^|[^\p{L}\p{N}])\p{L}/gu, c => c.toUpperCase()); break;
        case 'clean': input.value = input.value.split('\n').map(l => l.replace(/[\t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim(); break;
      }
      $('#text-undo').disabled = false; stats(); setDirty();
    }));
    $('#text-undo').addEventListener('click', () => { if (previous !== null) { input.value = previous; previous = null; $('#text-undo').disabled = true; stats(); setDirty(); } });
    $('#text-clear').addEventListener('click', () => { previous = input.value; input.value = ''; $('#text-undo').disabled = false; stats(); setDirty(); });
    $('#text-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(input.value); toast('Copied to clipboard.'); } catch { input.focus(); input.select(); toast('Clipboard unavailable. Your text is selected; press Ctrl+C to copy.'); } });
    $('#text-download').addEventListener('click', () => downloadText(input.value, ($('#draft-name').value.trim() || 'kensei-draft').replace(/[<>:"/\\|?*]/g, '-') + '.txt'));
    $('#save-draft').addEventListener('click', async () => {
      const name = $('#draft-name').value.trim(); if (!name) { $('#draft-name').focus(); toast('Give your draft a name first.'); return; }
      if (!input.value.trim()) { toast('Add some text before saving.'); return; }
      const button = $('#save-draft'); button.disabled = true;
      try { const item = await saveItem('draft', { tool: 'text-toolkit', name, text: input.value }, draftId || uid(), savedAt); draftId = item.id; savedAt = item.updated_at; dirty = false; $('#draft-state').textContent = user ? 'Saved and synced to your workspace.' : 'Saved to your workspace on this device.'; toast('Draft saved.'); }
      catch { $('#draft-state').textContent = 'Save failed. Your text is still here; please retry.'; toast('Could not save. Your text has been kept on this page.'); }
      finally { button.disabled = false; }
    });
    const requestedDraft = new URLSearchParams(location.search).get('draft');
    const loadDraft = () => { if (dirty) return; const item = items('draft').find(x => x.id === requestedDraft && (x.data.tool || 'text-toolkit') === 'text-toolkit'); if (item) { draftId = item.id; savedAt = item.updated_at; input.value = item.data.text; $('#draft-name').value = item.data.name; $('#draft-state').textContent = 'Saved draft loaded. Changes need to be saved.'; stats(); } };
    loadDraft(); window.addEventListener('workspace-ready', loadDraft);
    window.addEventListener('beforeunload', e => { if (dirty && input.value) { e.preventDefault(); e.returnValue = ''; } });
    stats();
  }

  // 使用结束时间而非递减计数，避免后台标签页导致计时偏差。
  function initTimer() {
    if (!$('#timer-display')) return;
    let settings = { focus: 25, short: 5, long: 15 }, mode = 'focus', running = false, remaining = 25 * 60, end = 0, round = 0, completedId = null;
    const timerKey = () => key() + ':active-timer';
    const persist = () => { try { sessionStorage.setItem(timerKey(), JSON.stringify({ settings, mode, running, remaining, end, round, completedId })); } catch {} };
    function loadSettings() { const saved = items('settings').find(x => x.id === 'timer-settings'); if (saved) { settings = { ...settings, ...saved.data }; if (!running) remaining = settings[mode] * 60; } ['focus','short','long'].forEach(m => { $('#duration-' + m).value = settings[m]; }); render(); }
    loadSettings();
    try { const saved = JSON.parse(sessionStorage.getItem(timerKey())); if (saved) { ({ settings, mode, running, remaining, end, round, completedId } = saved); if (running) remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000)); ['focus','short','long'].forEach(m => { $('#duration-' + m).value = settings[m]; }); } } catch {}
    function render() {
      const display = `${String(Math.floor(remaining / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}`;
      $('#timer-display').textContent = display; $('#timer-display').setAttribute('aria-label', `${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`);
      $('#timer-start').textContent = running ? 'Pause' : (remaining < settings[mode] * 60 ? 'Resume' : mode === 'focus' ? 'Start focus' : 'Start break');
      $('#timer-label').textContent = mode === 'focus' ? 'TIME FOR YOUR NEXT IDEA' : 'A MOMENT TO RECHARGE';
      $('#timer-round').textContent = `Session ${(round % 4) + 1} of 4`;
      $$('[data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
      document.title = running ? `${display} · ${mode === 'focus' ? 'Focus' : 'Break'} — KenSei` : 'Focus Timer — KenSei';
    }
    async function finish() {
      running = false;
      if (mode === 'focus') {
        const duration = settings.focus, id = completedId || uid(); round++; completedId = null;
        try { await saveItem('session', { minutes: duration, completedAt: new Date().toISOString() }, id); $('#timer-summary').textContent = `${duration} minutes of focus, saved. Nicely done.`; }
        catch { toast('Session could not sync. Export or retry from your workspace.'); localSave({ id, type: 'session', data: { minutes: duration, completedAt: new Date().toISOString(), pending: true }, updated_at: new Date().toISOString() }); }
        mode = round % 4 === 0 ? 'long' : 'short'; toast('Focus complete. Time for a break.');
      } else { mode = 'focus'; toast('Break complete. Ready when you are.'); }
      remaining = settings[mode] * 60; persist(); render();
    }
    function tick() { if (!running) return; remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000)); render(); if (!remaining) finish(); }
    $('#timer-start').addEventListener('click', () => { if (running) { remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000)); running = false; } else { if (!remaining) remaining = settings[mode] * 60; end = Date.now() + remaining * 1000; completedId ||= uid(); running = true; } persist(); render(); });
    $('#timer-reset').addEventListener('click', () => { running = false; remaining = settings[mode] * 60; completedId = null; persist(); render(); });
    $$('[data-mode]').forEach(b => b.addEventListener('click', () => { running = false; mode = b.dataset.mode; remaining = settings[mode] * 60; completedId = null; persist(); render(); }));
    $('#timer-save-settings').addEventListener('click', async () => {
      const values = Object.fromEntries(['focus','short','long'].map(m => [m, +$('#duration-' + m).value]));
      if (Object.entries(values).some(([m,v]) => !Number.isInteger(v) || v < 1 || v > (m === 'focus' ? 120 : 60))) { toast('Use whole minutes: focus 1–120; breaks 1–60.'); return; }
      try { await saveItem('settings', values, 'timer-settings'); settings = values; running = false; remaining = settings[mode] * 60; completedId = null; persist(); render(); toast('Your rhythm is saved.'); } catch { toast('Settings could not be saved. Please retry.'); }
    });
    window.addEventListener('workspace-ready', () => { if (!running) loadSettings(); });
    window.addEventListener('beforeunload', persist); document.addEventListener('visibilitychange', tick);
    setInterval(tick, 300); render(); tick();
  }

  function renderWorkspace() {
    if (!$('#favorite-tools')) return;
    const banner = $('#workspace-account');
    if (user) banner.innerHTML = `<div><strong>Your connected workspace</strong><p>${escape(user.email)} · ${cloudError ? 'Cloud data could not be loaded. Refresh to retry.' : 'Cloud saves enabled'}</p></div><span class="small-tag">${cloudError ? 'Sync unavailable' : 'Connected'}</span>`;
    else banner.innerHTML = '<div><strong>On this device</strong><p>Your local saves stay on this device. Sign in with Google to sync new saves across devices.</p></div><button class="button secondary" id="workspace-login">Sign in with Google ↗</button>';
    $('#workspace-login')?.addEventListener('click', openAuth); $('#sign-out').hidden = !user;
    const drafts = items('draft'), presets = items('preset'), sessions = items('session').sort((a,b) => b.data.completedAt.localeCompare(a.data.completedAt));
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), week = today - 6 * 86400000;
    $('#today-focus').textContent = sessions.filter(x => Date.parse(x.data.completedAt) >= today).reduce((a,x) => a + x.data.minutes, 0) + ' min';
    $('#week-focus').textContent = sessions.filter(x => Date.parse(x.data.completedAt) >= week).reduce((a,x) => a + x.data.minutes, 0) + ' min';
    $('#draft-count').textContent = drafts.length;
    $('#favorite-tools').innerHTML = items('favorite').filter(x => tools[x.data.slug]).map(x => { const t = tools[x.data.slug]; return `<article class="tool-card"><div class="tool-card-top"><span class="small-tag">${t.category}</span><button class="text-link" data-delete="${escape(x.id)}">Remove</button></div><a href="/tools/${x.data.slug}/"><h3>${t.name} ↗</h3></a><p>${t.description}</p></article>`; }).join('') || '<p class="muted small">Star a tool to keep it close. <a class="text-link" href="/tools/">Explore tools →</a></p>';
    function row(item, detail, action) { return `<div class="saved-row"><div><strong>${escape(item.data.name || detail)}</strong><p>${escape(item.data.name ? detail : new Date(item.data.completedAt).toLocaleString())}${item.data.pending ? ' · Saved locally, sync pending' : ''}</p></div><div class="saved-actions">${action}<button data-delete="${escape(item.id)}">Delete</button></div></div>`; }
    $('#saved-drafts').innerHTML = drafts.map(x => row(x, `${tools[x.data.tool || 'text-toolkit']?.name || 'Text Toolkit'} · ${x.data.text.slice(0,90)}`, `<a class="text-link" href="/tools/${['text-toolkit','markdown-studio','image-to-text'].includes(x.data.tool) ? x.data.tool : 'text-toolkit'}/?draft=${encodeURIComponent(x.id)}">Open →</a>`)).join('') || '<p class="muted small">Your next good idea can start in Text Toolkit.</p>';
    $('#saved-presets').innerHTML = presets.map(x => row(x, x.data.tool === 'qr-studio' ? `QR appearance · ${x.data.size} px` : `${x.data.format.replace('image/','').toUpperCase()} · ${x.data.quality}% quality${x.data.width ? ' · '+x.data.width+' px wide' : ''}`, `<a class="text-link" href="/tools/${x.data.tool === 'qr-studio' ? 'qr-studio' : 'image-studio'}/?preset=${encodeURIComponent(x.id)}">Use →</a>`)).join('') || '<p class="muted small">Save a favorite image setup in Image Studio.</p>';
    $('#saved-sessions').innerHTML = sessions.slice(0,30).map(x => row(x, `${x.data.minutes} minutes of focus`, x.data.pending && user ? `<button data-retry-session="${escape(x.id)}">Retry sync</button>` : '')).join('') || '<p class="muted small">Complete a focus session to see it here.</p>';
    $$('[data-delete]').forEach(b => b.addEventListener('click', async () => { const item = read().items.find(x => x.id === b.dataset.delete); if (item?.type === 'draft' && !confirm('Delete this saved draft?')) return; try { await removeItem(b.dataset.delete); toast('Removed.'); } catch { toast('Could not delete. Please try again.'); } }));
    $$('[data-retry-session]').forEach(b => b.addEventListener('click', async () => { const x = read().items.find(x => x.id === b.dataset.retrySession); if (!x) return; try { await saveItem('session', { ...x.data, pending: false }, x.id); renderWorkspace(); toast('Session synced.'); } catch { toast('Still unable to sync. Please retry later.'); } }));
  }
  $('#sign-out')?.addEventListener('click', async () => {
    if (!client) return; const oldKey = key(); const { error } = await client.auth.signOut();
    if (error) { toast('Could not sign out. Please retry.'); return; }
    try { localStorage.removeItem(oldKey); sessionStorage.removeItem(oldKey + ':active-timer'); } catch {}
    user = null; location.replace('/workspace/');
  });
  $('#export-data')?.addEventListener('click', () => downloadText(JSON.stringify(read(), null, 2), 'kensei-workspace.json', 'application/json'));
  window.addEventListener('storage', e => { if (e.key === key()) { updateFavorites(); renderWorkspace(); } });
  window.KenseiWorkspace = { items, saveItem, toast, escape };
  bindFavorites(); renderWorkspace(); initText(); initTimer();
  const slug = document.querySelector('[data-tool]')?.dataset.tool;
  if (slug && !['text-toolkit', 'focus-timer'].includes(slug)) {
    import('/tool-scripts/' + slug + '.js').then(() => {
      document.querySelector('[data-tool]').dataset.ready = 'true';
    }).catch(() => {
      toast('Tool files could not load. Reload this page to retry.');
    });
  }
  initAuth().finally(() => window.dispatchEvent(new Event('workspace-ready')));
})();
