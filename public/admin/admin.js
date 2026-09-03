(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
  const money = (n) => `¥${Number(n || 0).toFixed(2)}`;
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-');
  const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '-');

  const ORDER_STATUS = {
    pending: { label: '待支付', cls: 'amber' },
    paid: { label: '已支付', cls: 'blue' },
    shipped: { label: '已发货', cls: 'blue' },
    completed: { label: '已完成', cls: 'green' },
    cancelled: { label: '已取消', cls: 'gray' }
  };

  const INSPECTION_STATUS = {
    submitted: { label: '待审核', cls: 'amber' },
    verified: { label: '已通过', cls: 'green' },
    rejected: { label: '已驳回', cls: 'red' }
  };

  const VIEW_META = {
    dashboard: ['仪表盘', '运营数据总览'],
    records: ['查对记录', '开封查对照片与审核'],
    users: ['用户管理', '小程序用户与状态'],
    personnel: ['人员管理', '查对人员科室与岗位'],
    medicines: ['药品管理', '药品信息与库存'],
    products: ['物品管理', '商品与物资维护'],
    orders: ['订单管理', '订单流转与状态'],
    banners: ['轮播图', '首页展示内容'],
    settings: ['系统设置', '小程序配置与账号'],
    admins: ['权限管理', '管理员账号与操作权限']
  };

  const VIEW_PERM = {
    dashboard: '',
    records: 'records:view',
    users: 'users:manage',
    personnel: 'personnel:manage',
    medicines: 'medicines:manage',
    products: 'products:manage',
    orders: 'orders:manage',
    banners: 'banners:manage',
    settings: 'settings:manage',
    admins: 'admins:manage'
  };

  const PERMISSION_GROUPS = [
    ['records:view', '查对记录查看'],
    ['records:review', '查对记录审核'],
    ['users:manage', '用户管理'],
    ['personnel:manage', '人员管理'],
    ['medicines:manage', '药品管理'],
    ['products:manage', '物品管理'],
    ['orders:manage', '订单管理'],
    ['banners:manage', '轮播图管理'],
    ['settings:manage', '系统设置'],
    ['admins:manage', '权限管理']
  ];

  const MEDICINE_STATUS = {
    normal: { label: '正常', cls: 'green' },
    expiring: { label: '临期', cls: 'amber' },
    expired: { label: '过期', cls: 'red' }
  };

  const state = {
    admin: null,
    view: 'dashboard',
    filters: {
      records: { status: '', q: '', start: '', end: '', page: 1, pageSize: 10 },
      users: { q: '', page: 1, pageSize: 10 },
      personnel: { q: '', department: '', status: '', page: 1, pageSize: 10 },
      medicines: { q: '', status: '', page: 1, pageSize: 10 },
      products: { q: '', category: '', status: '', page: 1, pageSize: 10 },
      orders: { status: '', q: '', page: 1, pageSize: 10 },
      banners: { page: 1, pageSize: 20 },
      admins: { page: 1, pageSize: 20 }
    }
  };

  function canPerm(perm) {
    const admin = state.admin;
    if (!admin) return false;
    if (admin.role === 'super') return true;
    return !perm || (admin.permissions || []).includes(perm);
  }

  function applyNavPermissions() {
    $$('.nav-item').forEach((el) => {
      el.classList.toggle('hidden', !canPerm(el.dataset.perm));
    });
  }

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    opts.headers = { ...(options.headers || {}) };
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      showLogin();
      throw new Error('登录已过期');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  }

  function toast(message, type = '') {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function openLightbox(src) {
    const box = $('#lightbox');
    $('#lightbox-img').src = src;
    box.classList.remove('hidden');
  }

  function closeLightbox() {
    $('#lightbox').classList.add('hidden');
    $('#lightbox-img').src = '';
  }

  function openModal(html, { size = '', onMount } = {}) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal ${size}">${html}</div>
      </div>`;
    const backdrop = $('.modal-backdrop', root);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) closeModal();
    });
    if (onMount) onMount($('.modal', root));
    icons();
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
  }

  function confirmModal(title, text, actionLabel = '确认') {
    return new Promise((resolve) => {
      openModal(`
        <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
        <div class="modal-body"><p style="margin:0">${esc(text)}</p></div>
        <div class="modal-foot">
          <button class="btn ghost" data-close>取消</button>
          <button class="btn danger" data-confirm>${esc(actionLabel)}</button>
        </div>`);
      const modalEl = $('.modal');
      modalEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) {
          closeModal();
          resolve(false);
        } else if (e.target.closest('[data-confirm]')) {
          closeModal();
          resolve(true);
        }
      });
    });
  }

  function badge(status, map) {
    const meta = map[status] || { label: status, cls: 'gray' };
    return `<span class="badge ${meta.cls}">${esc(meta.label)}</span>`;
  }

  function photoThumbs(row) {
    const shots = [
      ['check_photo', '查对'],
      ['cargo_photo', '摆放'],
      ['lock_photo', '锁号']
    ];
    return `<div class="thumb-group">${shots.map(([key, label]) => row[key]
      ? `<img class="thumb" src="${esc(row[key])}" alt="${label}" title="${label}照片" data-photo="${esc(row[key])}">`
      : `<span class="thumb" style="display:grid;place-items:center;color:#9ca3af" title="缺 ${label}">—</span>`
    ).join('')}</div>`;
  }

  function pager({ page, total, pageSize, view, action }) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `
      <div class="pagination">
        <span>共 ${total} 条</span>
        <button class="btn ghost sm" data-page="${page - 1}" data-action="${action}" ${page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i>上一页</button>
        <span>${page} / ${pages}</span>
        <button class="btn ghost sm" data-page="${page + 1}" data-action="${action}" ${page >= pages ? 'disabled' : ''}>下一页<i data-lucide="chevron-right"></i></button>
      </div>`;
  }

  function bindPager(root, action) {
    $$('[data-page]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const page = Number(btn.dataset.page);
        const filter = state.filters[state.view];
        if (page >= 1 && filter && filter.pageSize) {
          filter.page = page;
          loadView(state.view);
        } else if (action) {
          state.filters[state.view].page = page;
          loadView(state.view);
        }
      });
    });
  }

  function loading() {
    return `<div class="card panel"><div class="panel-body empty">数据加载中...</div></div>`;
  }

  function errorBox(message) {
    return `<div class="card panel"><div class="panel-body empty" style="color:#b91c1c">${esc(message)}</div></div>`;
  }

  async function loadView(view) {
    if (!canPerm(VIEW_PERM[view])) {
      toast('没有该模块的访问权限', 'error');
      if (view !== 'dashboard') return loadView('dashboard');
    }
    state.view = view;
    const [title, subtitle] = VIEW_META[view];
    $('#view-title').textContent = title;
    $('#view-subtitle').textContent = subtitle;
    $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    $('#content').innerHTML = loading();
    try {
      const html = await renderers[view]();
      $('#content').innerHTML = html;
      icons();
      bindViewEvents(view);
    } catch (err) {
      $('#content').innerHTML = errorBox(err.message);
    }
  }

  function bindViewEvents(view) {
    const content = $('#content');
    $$('[data-photo]', content).forEach((el) => el.addEventListener('click', () => openLightbox(el.dataset.photo)));

    if (view === 'records') {
      const filter = state.filters.records;
      $$('.status-tab', content).forEach((btn) => btn.addEventListener('click', () => {
        filter.status = btn.dataset.status;
        filter.page = 1;
        loadView('records');
      }));
      $('#records-search').addEventListener('click', () => {
        filter.q = $('#records-q').value.trim();
        filter.start = $('#records-start').value;
        filter.end = $('#records-end').value;
        filter.page = 1;
        loadView('records');
      });
      $('#records-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#records-search').click();
      });
      $$('[data-open-record]', content).forEach((el) => el.addEventListener('click', () => openRecordDetail(Number(el.dataset.openRecord))));
      bindPager(content);
    }

    if (view === 'users') {
      $('#users-search').addEventListener('click', () => {
        state.filters.users.q = $('#users-q').value.trim();
        state.filters.users.page = 1;
        loadView('users');
      });
      $('#users-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#users-search').click();
      });
      $$('[data-toggle-user]', content).forEach((el) => el.addEventListener('change', async () => {
        try {
          await api(`/api/admin/users/${el.dataset.toggleUser}`, {
            method: 'PATCH',
            body: { status: el.checked ? 1 : 0 }
          });
          toast(el.checked ? '已启用' : '已禁用');
        } catch (err) {
          toast(err.message, 'error');
          loadView('users');
        }
      }));
      $$('[data-edit-user]', content).forEach((el) => el.addEventListener('click', () => editUser(Number(el.dataset.editUser))));
      bindPager(content);
    }

    if (view === 'personnel') {
      const f = state.filters.personnel;
      $('#personnel-search').addEventListener('click', () => {
        f.q = $('#personnel-q').value.trim();
        f.department = $('#personnel-department').value;
        f.status = $('#personnel-status').value;
        f.page = 1;
        loadView('personnel');
      });
      $('#personnel-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#personnel-search').click();
      });
      $('#add-personnel').addEventListener('click', () => editPersonnel(null));
      $$('[data-edit-personnel]', content).forEach((el) => el.addEventListener('click', () => editPersonnel(Number(el.dataset.editPersonnel))));
      $$('[data-delete-personnel]', content).forEach((el) => el.addEventListener('click', async () => {
        if (await confirmModal('删除人员', '确定删除该人员吗？', '删除')) {
          try {
            await api(`/api/admin/personnel/${el.dataset.deletePersonnel}`, { method: 'DELETE' });
            toast('已删除', 'success');
            loadView('personnel');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }));
      bindPager(content);
    }

    if (view === 'medicines') {
      const f = state.filters.medicines;
      $('#medicines-search').addEventListener('click', () => {
        f.q = $('#medicines-q').value.trim();
        f.status = $('#medicines-status').value;
        f.page = 1;
        loadView('medicines');
      });
      $('#medicines-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#medicines-search').click();
      });
      $('#add-medicine').addEventListener('click', () => editMedicine(null));
      $$('[data-edit-medicine]', content).forEach((el) => el.addEventListener('click', () => editMedicine(Number(el.dataset.editMedicine))));
      $$('[data-delete-medicine]', content).forEach((el) => el.addEventListener('click', async () => {
        if (await confirmModal('删除药品', '确定删除该药品吗？', '删除')) {
          try {
            await api(`/api/admin/medicines/${el.dataset.deleteMedicine}`, { method: 'DELETE' });
            toast('已删除', 'success');
            loadView('medicines');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }));
      bindPager(content);
    }

    if (view === 'products') {
      $('#products-search').addEventListener('click', () => {
        const f = state.filters.products;
        f.q = $('#products-q').value.trim();
        f.category = $('#products-category').value;
        f.status = $('#products-status').value;
        f.page = 1;
        loadView('products');
      });
      $('#products-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#products-search').click();
      });
      $('#add-product').addEventListener('click', () => editProduct(null));
      $$('[data-edit-product]', content).forEach((el) => el.addEventListener('click', () => editProduct(Number(el.dataset.editProduct))));
      $$('[data-delete-product]', content).forEach((el) => el.addEventListener('click', async () => {
        if (await confirmModal('删除物品', '删除后不可恢复，确定删除该物品吗？', '删除')) {
          try {
            await api(`/api/admin/products/${el.dataset.deleteProduct}`, { method: 'DELETE' });
            toast('已删除', 'success');
            loadView('products');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }));
      bindPager(content);
    }

    if (view === 'orders') {
      const filter = state.filters.orders;
      $$('.status-tab', content).forEach((btn) => btn.addEventListener('click', () => {
        filter.status = btn.dataset.status;
        filter.page = 1;
        loadView('orders');
      }));
      $('#orders-search').addEventListener('click', () => {
        filter.q = $('#orders-q').value.trim();
        filter.page = 1;
        loadView('orders');
      });
      $('#orders-q').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('#orders-search').click();
      });
      $$('[data-open-order]', content).forEach((el) => el.addEventListener('click', () => openOrderDetail(Number(el.dataset.openOrder))));
      bindPager(content);
    }

    if (view === 'banners') {
      $('#add-banner').addEventListener('click', () => editBanner(null));
      $$('[data-edit-banner]', content).forEach((el) => el.addEventListener('click', () => editBanner(Number(el.dataset.editBanner))));
      $$('[data-delete-banner]', content).forEach((el) => el.addEventListener('click', async () => {
        if (await confirmModal('删除轮播图', '确定删除该轮播图吗？', '删除')) {
          try {
            await api(`/api/admin/banners/${el.dataset.deleteBanner}`, { method: 'DELETE' });
            toast('已删除', 'success');
            loadView('banners');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }));
    }

    if (view === 'settings') {
      $('#settings-save').addEventListener('click', saveSettings);
      $('#change-password').addEventListener('click', changePasswordModal);
    }

    if (view === 'admins') {
      $('#add-admin').addEventListener('click', () => editAdmin(null));
      $$('[data-edit-admin]', content).forEach((el) => el.addEventListener('click', () => editAdmin(Number(el.dataset.editAdmin))));
      $$('[data-delete-admin]', content).forEach((el) => el.addEventListener('click', async () => {
        if (await confirmModal('删除管理员', '确定删除该管理员账号吗？', '删除')) {
          try {
            await api(`/api/admin/admins/${el.dataset.deleteAdmin}`, { method: 'DELETE' });
            toast('已删除', 'success');
            loadView('admins');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }));
      $$('[data-toggle-admin]', content).forEach((el) => el.addEventListener('change', async () => {
        try {
          await api(`/api/admin/admins/${el.dataset.toggleAdmin}`, {
            method: 'PUT',
            body: { status: el.checked ? 1 : 0 }
          });
          toast(el.checked ? '已启用' : '已停用');
        } catch (err) {
          toast(err.message, 'error');
          loadView('admins');
        }
      }));
    }
  }

  const renderers = {
    async dashboard() {
      const data = await api('/api/admin/dashboard');
      const t = data.totals;
      const maxTrend = Math.max(1, ...data.trend.map((d) => Math.max(d.orders, d.inspections)));
      return `
        <section class="stat-grid">
          ${statCard('users', '用户总数', t.users, `${t.users_today} 今日新增`, 'teal')}
          ${statCard('id-card', '人员总数', t.personnel, '在职查对人员', 'rose')}
          ${statCard('pill', '药品总数', t.medicines, `${t.medicines_attention} 临期/过期`, 'green')}
          ${statCard('package', '物品总数', t.products, `${t.on_sale} 在售`, 'blue')}
          ${statCard('receipt', '订单总数', t.orders, `${t.orders_today} 今日订单`, 'amber')}
          ${statCard('banknote', '累计销售额', money(t.revenue), '已支付订单', 'green')}
          ${statCard('clipboard-list', '查对记录', t.inspections, `${t.inspections_pending} 待审核`, 'violet')}
        </section>

        <section class="card panel">
          <div class="panel-head"><h2>近 7 天趋势</h2><span style="color:#6b7280;font-size:12px">订单与查对记录</span></div>
          <div class="panel-body">
            <div class="trend">
              <div class="trend-y">
                <span></span><span></span><span></span><span></span><span></span><span></span>
              </div>
              <div class="trend-bars">
                ${data.trend.map((d) => `
                  <div class="trend-col">
                    <div class="trend-bar-wrap">
                      <div class="trend-bar orders" style="height:${Math.round((d.orders / maxTrend) * 100)}%"></div>
                      <div class="trend-bar records" style="height:${Math.round((d.inspections / maxTrend) * 100)}%"></div>
                    </div>
                    <b>${d.orders + d.inspections}</b>
                    <small>${esc(d.date)}</small>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </section>

        <section class="card panel">
          <div class="panel-head"><h2>最新查对记录</h2><button class="btn ghost sm" data-view-nav="records">查看全部</button></div>
          <div class="panel-body" style="padding:6px 16px">
            ${data.recent_inspections.map((r) => `
              <div class="record-row">
                <img class="record-thumb" src="${esc(r.check_photo)}" alt="查对照片" data-photo="${esc(r.check_photo)}">
                <div class="record-info">
                  <strong>${esc(r.record_no)} · ${esc(r.vehicle_no || '未填车牌')} · 锁号 ${esc(r.lock_no)}</strong>
                  <span>${esc(r.nickname)} · ${fmtDateTime(r.created_at)}</span>
                </div>
                ${badge(r.status, INSPECTION_STATUS)}
              </div>`).join('') || '<div class="empty">暂无查对记录</div>'}
          </div>
        </section>

        <section class="card panel">
          <div class="panel-head"><h2>热销物品</h2><button class="btn ghost sm" data-view-nav="products">查看全部</button></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>物品</th><th>销量</th><th>售价</th></tr></thead>
              <tbody>
                ${data.top_products.map((p) => `
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:10px"><img class="thumb" src="${esc(p.cover)}" alt=""><span class="ellipsis">${esc(p.title)}</span></div></td>
                    <td>${p.sales}</td>
                    <td>${money(p.price)}</td>
                  </tr>`).join('') || '<tr><td colspan="3" class="empty">暂无物品</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      `;
    },

    async records() {
      const f = state.filters.records;
      const params = new URLSearchParams({ page: f.page, pageSize: f.pageSize });
      if (f.status) params.set('status', f.status);
      if (f.q) params.set('q', f.q);
      if (f.start) params.set('start', f.start);
      if (f.end) params.set('end', f.end);
      const data = await api(`/api/admin/records?${params}`);
      const tabs = [['', '全部'], ['submitted', '待审核'], ['verified', '已通过'], ['rejected', '已驳回']];
      return `
        <section class="card panel">
          <div class="panel-head">
            <div class="status-tabs">
              ${tabs.map(([value, label]) => `<button class="status-tab ${f.status === value ? 'active' : ''}" data-status="${value}">${label}</button>`).join('')}
            </div>
            <div class="toolbar">
              <input id="records-start" class="input" type="date" value="${f.start}">
              <span style="color:#6b7280">至</span>
              <input id="records-end" class="input" type="date" value="${f.end}">
              <input id="records-q" class="input search" placeholder="编号 / 车牌 / 锁号 / 人员" value="${esc(f.q)}">
              <button id="records-search" class="btn primary"><i data-lucide="search"></i>查询</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>记录编号</th><th>查对人员</th><th>车牌号</th><th>锁号</th><th>照片</th><th>提交人</th><th>时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((r) => `
                  <tr>
                    <td><strong>${esc(r.record_no)}</strong></td>
                    <td>${esc(r.checkers)}</td>
                    <td>${esc(r.vehicle_no || '-')}</td>
                    <td><span class="badge gray">${esc(r.lock_no)}</span></td>
                    <td>${photoThumbs(r)}</td>
                    <td>${esc(r.nickname)}</td>
                    <td>${fmtDateTime(r.created_at)}</td>
                    <td>${badge(r.status, INSPECTION_STATUS)}</td>
                    <td><button class="btn ghost sm" data-open-record="${r.id}"><i data-lucide="eye"></i>查看</button></td>
                  </tr>`).join('') || '<tr><td colspan="9" class="empty">暂无查对记录</td></tr>'}
              </tbody>
            </table>
          </div>
          ${pager({ page: data.page, total: data.total, pageSize: data.pageSize })}
        </section>`;
    },

    async users() {
      const f = state.filters.users;
      const params = new URLSearchParams({ page: f.page, pageSize: f.pageSize });
      if (f.q) params.set('q', f.q);
      const data = await api(`/api/admin/users?${params}`);
      return `
        <section class="card panel">
          <div class="panel-head">
            <h2>用户列表</h2>
            <div class="toolbar">
              <input id="users-q" class="input search" placeholder="昵称 / 手机号 / openid" value="${esc(f.q)}">
              <button id="users-search" class="btn primary"><i data-lucide="search"></i>查询</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>ID</th><th>用户</th><th>手机号</th><th>OpenID</th><th>订单数</th><th>注册时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((u) => `
                  <tr>
                    <td>${u.id}</td>
                    <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc((u.nickname || '用')[0])}</span><strong>${esc(u.nickname || '微信用户')}</strong></div></td>
                    <td>${esc(u.phone || '-')}</td>
                    <td><span class="ellipsis" style="display:inline-block">${esc(u.openid || '-')}</span></td>
                    <td>${u.order_count}</td>
                    <td>${fmtDate(u.created_at)}</td>
                    <td>
                      <label class="switch"><input type="checkbox" ${Number(u.status) === 1 ? 'checked' : ''} data-toggle-user="${u.id}"><span class="track"></span></label>
                    </td>
                    <td><button class="btn ghost sm" data-edit-user="${u.id}"><i data-lucide="edit-3"></i>编辑</button></td>
                  </tr>`).join('') || '<tr><td colspan="8" class="empty">暂无用户</td></tr>'}
              </tbody>
            </table>
          </div>
          ${pager({ page: data.page, total: data.total, pageSize: data.pageSize })}
        </section>`;
    },

    async personnel() {
      const f = state.filters.personnel;
      const params = new URLSearchParams({ page: f.page, pageSize: f.pageSize });
      if (f.q) params.set('q', f.q);
      if (f.department) params.set('department', f.department);
      if (f.status) params.set('status', f.status);
      const [data, deptData] = await Promise.all([
        api(`/api/admin/personnel?${params}`),
        api('/api/admin/personnel/departments')
      ]);
      return `
        <section class="card panel">
          <div class="panel-head">
            <div class="toolbar">
              <input id="personnel-q" class="input search" placeholder="姓名 / 手机号 / 岗位" value="${esc(f.q)}">
              <select id="personnel-department" class="select">
                <option value="">全部科室</option>
                ${deptData.items.map((d) => `<option value="${esc(d)}" ${f.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}
              </select>
              <select id="personnel-status" class="select">
                <option value="">全部状态</option>
                <option value="1" ${f.status === '1' ? 'selected' : ''}>在职</option>
                <option value="0" ${f.status === '0' ? 'selected' : ''}>离职</option>
              </select>
              <button id="personnel-search" class="btn primary"><i data-lucide="search"></i>查询</button>
            </div>
            <button id="add-personnel" class="btn primary"><i data-lucide="plus"></i>新增人员</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>姓名</th><th>科室</th><th>岗位</th><th>手机号</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((p) => `
                  <tr>
                    <td><strong>${esc(p.name)}</strong></td>
                    <td><span class="badge blue">${esc(p.department || '-')}</span></td>
                    <td>${esc(p.position || '-')}</td>
                    <td>${esc(p.phone || '-')}</td>
                    <td>${Number(p.status) === 1 ? '<span class="badge green">在职</span>' : '<span class="badge gray">离职</span>'}</td>
                    <td>
                      <div style="display:flex;gap:6px">
                        <button class="btn ghost sm" data-edit-personnel="${p.id}"><i data-lucide="edit-3"></i>编辑</button>
                        <button class="btn ghost sm" data-delete-personnel="${p.id}"><i data-lucide="trash-2"></i>删除</button>
                      </div>
                    </td>
                  </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无人员</td></tr>'}
              </tbody>
            </table>
          </div>
          ${pager({ page: data.page, total: data.total, pageSize: data.pageSize })}
        </section>`;
    },

    async medicines() {
      const f = state.filters.medicines;
      const params = new URLSearchParams({ page: f.page, pageSize: f.pageSize });
      if (f.q) params.set('q', f.q);
      if (f.status) params.set('status', f.status);
      const data = await api(`/api/admin/medicines?${params}`);
      return `
        <section class="card panel">
          <div class="panel-head">
            <div class="toolbar">
              <input id="medicines-q" class="input search" placeholder="名称 / 批号 / 厂家" value="${esc(f.q)}">
              <select id="medicines-status" class="select">
                <option value="">全部状态</option>
                <option value="normal" ${f.status === 'normal' ? 'selected' : ''}>正常</option>
                <option value="expiring" ${f.status === 'expiring' ? 'selected' : ''}>临期</option>
                <option value="expired" ${f.status === 'expired' ? 'selected' : ''}>过期</option>
              </select>
              <button id="medicines-search" class="btn primary"><i data-lucide="search"></i>查询</button>
            </div>
            <button id="add-medicine" class="btn primary"><i data-lucide="plus"></i>新增药品</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>药品名称</th><th>批号</th><th>生产厂家</th><th>有效期至</th><th>数量</th><th>存放位置</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((m) => `
                  <tr>
                    <td><div class="ellipsis"><strong>${esc(m.name)}</strong><br><span style="color:#6b7280;font-size:12px">${esc(m.spec || '')}</span></div></td>
                    <td>${esc(m.batch_no || '-')}</td>
                    <td><span class="ellipsis" style="display:inline-block">${esc(m.manufacturer || '-')}</span></td>
                    <td>${esc(m.expiry_date || '-')}</td>
                    <td><strong>${m.quantity} ${esc(m.unit || '盒')}</strong></td>
                    <td>${esc(m.storage || '-')}</td>
                    <td>${badge(m.status, MEDICINE_STATUS)}</td>
                    <td>
                      <div style="display:flex;gap:6px">
                        <button class="btn ghost sm" data-edit-medicine="${m.id}"><i data-lucide="edit-3"></i>编辑</button>
                        <button class="btn ghost sm" data-delete-medicine="${m.id}"><i data-lucide="trash-2"></i>删除</button>
                      </div>
                    </td>
                  </tr>`).join('') || '<tr><td colspan="8" class="empty">暂无药品</td></tr>'}
              </tbody>
            </table>
          </div>
          ${pager({ page: data.page, total: data.total, pageSize: data.pageSize })}
        </section>`;
    },

    async admins() {
      const data = await api('/api/admin/admins');
      const currentName = state.admin.username;
      return `
        <section class="card panel">
          <div class="panel-head">
            <h2>管理员账号</h2>
            <button id="add-admin" class="btn primary"><i data-lucide="plus"></i>新增管理员</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>账号</th><th>名称</th><th>角色</th><th>权限</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((a) => `
                  <tr>
                    <td><strong>${esc(a.username)}</strong>${a.username === currentName ? ' <span class="badge blue">当前</span>' : ''}</td>
                    <td>${esc(a.display_name || a.username)}</td>
                    <td>${a.role === 'super' ? '<span class="badge green">超级管理员</span>' : '<span class="badge gray">普通管理员</span>'}</td>
                    <td>
                      ${(a.role === 'super' ? [['*', '全部权限']] : (a.permissions || []).map((p) => [p, (PERMISSION_GROUPS.find(([k]) => k === p) || [])[1] || p]))
                        .slice(0, 3).map(([, label]) => `<span class="badge blue">${esc(label)}</span>`).join(' ')
                        || '<span style="color:#9ca3af">无</span>'}
                      ${a.role !== 'super' && (a.permissions || []).length > 3 ? `<span class="badge gray">+${a.permissions.length - 3}</span>` : ''}
                    </td>
                    <td>
                      <label class="switch"><input type="checkbox" ${Number(a.status) === 1 ? 'checked' : ''} ${a.username === currentName ? 'disabled' : ''} data-toggle-admin="${a.id}"><span class="track"></span></label>
                    </td>
                    <td>
                      <div style="display:flex;gap:6px">
                        <button class="btn ghost sm" data-edit-admin="${a.id}"><i data-lucide="edit-3"></i>编辑</button>
                        ${a.username !== currentName ? `<button class="btn ghost sm" data-delete-admin="${a.id}"><i data-lucide="trash-2"></i>删除</button>` : ''}
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
    },

    async products() {
      const f = state.filters.products;
      const params = new URLSearchParams({ page: f.page, pageSize: f.pageSize });
      if (f.q) params.set('q', f.q);
      if (f.category) params.set('category', f.category);
      if (f.status) params.set('status', f.status);
      const data = await api(`/api/admin/products?${params}`);
      const categories = [...new Set(data.items.map((p) => p.category).filter(Boolean))];
      return `
        <section class="card panel">
          <div class="panel-head">
            <div class="toolbar">
              <input id="products-q" class="input search" placeholder="物品名称" value="${esc(f.q)}">
              <select id="products-category" class="select">
                <option value="">全部分类</option>
                ${categories.map((c) => `<option value="${esc(c)}" ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
              <select id="products-status" class="select">
                <option value="">全部状态</option>
                <option value="1" ${f.status === '1' ? 'selected' : ''}>在售</option>
                <option value="0" ${f.status === '0' ? 'selected' : ''}>下架</option>
              </select>
              <button id="products-search" class="btn primary"><i data-lucide="search"></i>查询</button>
            </div>
            <button id="add-product" class="btn primary"><i data-lucide="plus"></i>新增物品</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>封面</th><th>名称</th><th>分类</th><th>价格</th><th>库存</th><th>销量</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((p) => `
                  <tr>
                    <td><img class="thumb" src="${esc(p.cover)}" alt="" data-photo="${esc(p.cover)}"></td>
                    <td><div class="ellipsis"><strong>${esc(p.title)}</strong><br><span style="color:#6b7280;font-size:12px">${esc(p.subtitle || '')}</span></div></td>
                    <td>${esc(p.category || '-')}</td>
                    <td><strong>${money(p.price)}</strong></td>
                    <td>${p.stock}</td>
                    <td>${p.sales}</td>
                    <td>${Number(p.status) === 1 ? '<span class="badge green">在售</span>' : '<span class="badge gray">下架</span>'}</td>
                    <td>
                      <div style="display:flex;gap:6px">
                        <button class="btn ghost sm" data-edit-product="${p.id}"><i data-lucide="edit-3"></i>编辑</button>
                        <button class="btn ghost sm" data-delete-product="${p.id}"><i data-lucide="trash-2"></i>删除</button>
                      </div>
                    </td>
                  </tr>`).join('') || '<tr><td colspan="8" class="empty">暂无物品</td></tr>'}
              </tbody>
            </table>
          </div>
          ${pager({ page: data.page, total: data.total, pageSize: data.pageSize })}
        </section>`;
    },

    async orders() {
      const f = state.filters.orders;
      const params = new URLSearchParams({ page: f.page, pageSize: f.pageSize });
      if (f.status) params.set('status', f.status);
      if (f.q) params.set('q', f.q);
      const data = await api(`/api/admin/orders?${params}`);
      const tabs = [['', '全部'], ['pending', '待支付'], ['paid', '已支付'], ['shipped', '已发货'], ['completed', '已完成'], ['cancelled', '已取消']];
      return `
        <section class="card panel">
          <div class="panel-head">
            <div class="status-tabs">
              ${tabs.map(([value, label]) => `<button class="status-tab ${f.status === value ? 'active' : ''}" data-status="${value}">${label}</button>`).join('')}
            </div>
            <div class="toolbar">
              <input id="orders-q" class="input search" placeholder="订单号 / 商品 / 联系人" value="${esc(f.q)}">
              <button id="orders-search" class="btn primary"><i data-lucide="search"></i>查询</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>订单号</th><th>商品</th><th>数量</th><th>金额</th><th>用户</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((o) => `
                  <tr>
                    <td><strong>${esc(o.order_no)}</strong></td>
                    <td><div style="display:flex;align-items:center;gap:10px"><img class="thumb" src="${esc(o.cover)}" alt=""><span class="ellipsis">${esc(o.title)}</span></div></td>
                    <td>${o.quantity}</td>
                    <td><strong>${money(o.amount)}</strong></td>
                    <td>${esc(o.nickname)}</td>
                    <td>${badge(o.status, ORDER_STATUS)}</td>
                    <td>${fmtDateTime(o.created_at)}</td>
                    <td><button class="btn ghost sm" data-open-order="${o.id}"><i data-lucide="eye"></i>查看</button></td>
                  </tr>`).join('') || '<tr><td colspan="8" class="empty">暂无订单</td></tr>'}
              </tbody>
            </table>
          </div>
          ${pager({ page: data.page, total: data.total, pageSize: data.pageSize })}
        </section>`;
    },

    async banners() {
      const data = await api('/api/admin/banners');
      return `
        <section class="card panel">
          <div class="panel-head">
            <h2>轮播图</h2>
            <button id="add-banner" class="btn primary"><i data-lucide="plus"></i>新增轮播图</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>预览</th><th>标题</th><th>跳转</th><th>排序</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${data.items.map((b) => `
                  <tr>
                    <td><img class="thumb" src="${esc(b.image)}" alt="" data-photo="${esc(b.image)}"></td>
                    <td><strong>${esc(b.title || '-')}</strong></td>
                    <td>${esc(b.link_type || 'none')}${b.link_value ? ` · ${esc(b.link_value)}` : ''}</td>
                    <td>${b.sort}</td>
                    <td>${Number(b.status) === 1 ? '<span class="badge green">启用</span>' : '<span class="badge gray">停用</span>'}</td>
                    <td>
                      <div style="display:flex;gap:6px">
                        <button class="btn ghost sm" data-edit-banner="${b.id}"><i data-lucide="edit-3"></i>编辑</button>
                        <button class="btn ghost sm" data-delete-banner="${b.id}"><i data-lucide="trash-2"></i>删除</button>
                      </div>
                    </td>
                  </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无轮播图</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>`;
    },

    async settings() {
      const data = await api('/api/admin/settings');
      const s = data.settings;
      return `
        <section class="card panel">
          <div class="panel-head"><h2>基础配置</h2></div>
          <div class="panel-body">
            <form class="form" id="settings-form">
              <div class="form-grid">
                <div class="field">
                  <span>系统名称</span>
                  <input class="input" name="site_name" value="${esc(s.site_name)}">
                </div>
                <div class="field">
                  <span>照片上传</span>
                  <div class="form-row">
                    <label class="switch"><input type="checkbox" name="upload_enabled" ${s.upload_enabled === '1' ? 'checked' : ''}><span class="track"></span></label>
                    <span style="color:#6b7280;font-size:13px">允许小程序上传查对照片</span>
                  </div>
                </div>
                <div class="field">
                  <span>单张照片上限 (MB)</span>
                  <input class="input" name="max_photo_mb" type="number" min="1" max="20" value="${esc(s.max_photo_mb || 8)}">
                </div>
                <div class="field">
                  <span>小程序 AppID</span>
                  <input class="input" name="wechat_appid" value="${esc(s.wechat_appid || '')}" placeholder="wx...">
                </div>
                <div class="field full">
                  <span>小程序 AppSecret</span>
                  <input class="input" name="wechat_secret" type="password" value="${esc(s.wechat_secret || '')}" placeholder="留空时使用环境变量">
                </div>
              </div>
            </form>
          </div>
          <div class="modal-foot">
            <button id="change-password" class="btn ghost"><i data-lucide="key"></i>修改密码</button>
            <button id="settings-save" class="btn primary"><i data-lucide="save"></i>保存设置</button>
          </div>
        </section>`;
    }
  };

  function statCard(icon, label, value, sub, tone) {
    return `
      <div class="card stat-card">
        <div class="stat-icon ${tone}"><i data-lucide="${icon}"></i></div>
        <div class="stat-meta">
          <strong>${value}</strong>
          <span>${esc(label)}</span>
          <div class="stat-sub">${esc(sub)}</div>
        </div>
      </div>`;
  }

  async function openRecordDetail(id) {
    const data = await api(`/api/admin/records/${id}`);
    const r = data.record;
    openModal(`
      <div class="modal-head"><h3>${esc(r.record_no)}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <div class="detail-grid">
          <div class="detail-item"><span>查对人员</span><strong>${esc(r.checkers)}</strong></div>
          <div class="detail-item"><span>车牌号</span><strong>${esc(r.vehicle_no || '-')}</strong></div>
          <div class="detail-item"><span>一次性密码锁锁号</span><strong>${esc(r.lock_no)}</strong></div>
          <div class="detail-item"><span>提交人</span><strong>${esc(r.nickname)} (${esc(r.user_phone || '未留手机')})</strong></div>
          <div class="detail-item"><span>提交时间</span><strong>${fmtDateTime(r.created_at)}</strong></div>
          <div class="detail-item"><span>状态</span><strong>${badge(r.status, INSPECTION_STATUS)}</strong></div>
          <div class="detail-item full"><span>备注</span><strong>${esc(r.remark || '-')}</strong></div>
          ${r.review_remark ? `<div class="detail-item full"><span>审核备注</span><strong>${esc(r.review_remark)}</strong></div>` : ''}
        </div>
        <div class="record-photos">
          ${photoTile('两人查对照片', r.check_photo, 'users')}
          ${photoTile('车内药品物品摆放', r.cargo_photo, 'package')}
          ${photoTile('一次性密码锁锁号', r.lock_photo, 'lock')}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>关闭</button>
        ${r.status !== 'verified' ? `<button class="btn primary" data-verify>通过</button>` : ''}
        ${r.status !== 'rejected' ? `<button class="btn danger" data-reject>驳回</button>` : ''}
        <button class="btn ghost" data-delete>删除</button>
      </div>`, { size: 'lg', onMount: (modalEl) => {
      $$('[data-photo]', modalEl).forEach((el) => el.addEventListener('click', () => openLightbox(el.dataset.photo)));
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-verify]')) {
          try {
            await api(`/api/admin/records/${r.id}`, { method: 'PATCH', body: { status: 'verified', review_remark: '' } });
            toast('已通过', 'success');
            closeModal();
            loadView('records');
          } catch (err) {
            toast(err.message, 'error');
          }
        } else if (e.target.closest('[data-reject]')) {
          rejectRecord(r);
        } else if (e.target.closest('[data-delete]')) {
          if (await confirmModal('删除查对记录', '照片与记录将一并删除，确定吗？', '删除')) {
            try {
              await api(`/api/admin/records/${r.id}`, { method: 'DELETE' });
              toast('已删除', 'success');
              closeModal();
              loadView('records');
            } catch (err) {
              toast(err.message, 'error');
            }
          }
        }
      });
    }});
  }

  function rejectRecord(record) {
    openModal(`
      <div class="modal-head"><h3>驳回查对记录</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <label class="label" for="reject-reason">驳回原因</label>
        <textarea id="reject-reason" class="input" placeholder="请填写驳回原因"></textarea>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn danger" data-submit>确认驳回</button>
      </div>`, { onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-submit]')) {
          const reason = $('#reject-reason', modalEl).value.trim();
          try {
            await api(`/api/admin/records/${record.id}`, { method: 'PATCH', body: { status: 'rejected', review_remark: reason } });
            toast('已驳回', 'success');
            closeModal();
            loadView('records');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  function photoTile(label, src, icon) {
    return `
      <div class="photo-tile">
        ${src ? `<img src="${esc(src)}" alt="${esc(label)}" data-photo="${esc(src)}">` : `<div style="aspect-ratio:16/10;display:grid;place-items:center;color:#9ca3af">暂无照片</div>`}
        <div><i data-lucide="${icon}"></i>${esc(label)}</div>
      </div>`;
  }

  async function editUser(id) {
    const data = await api(`/api/admin/users/${id}`);
    const user = data.user;
    openModal(`
      <div class="modal-head"><h3>编辑用户</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="user-form">
          <div class="form-grid">
            <div class="field"><span>昵称</span><input class="input" name="nickname" value="${esc(user.nickname)}"></div>
            <div class="field"><span>手机号</span><input class="input" name="phone" value="${esc(user.phone)}"></div>
            <div class="field full">
              <span>状态</span>
              <div class="form-row">
                <label class="switch"><input type="checkbox" name="status" ${Number(user.status) === 1 ? 'checked' : ''}><span class="track"></span></label>
                <span style="color:#6b7280;font-size:13px">启用账号</span>
              </div>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#user-form', modalEl));
          try {
            await api(`/api/admin/users/${user.id}`, {
              method: 'PATCH',
              body: {
                nickname: form.get('nickname'),
                phone: form.get('phone'),
                status: form.get('status') ? 1 : 0
              }
            });
            toast('已保存', 'success');
            closeModal();
            loadView('users');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function editPersonnel(id) {
    let person = null;
    if (id) {
      const data = await api(`/api/admin/personnel/${id}`);
      person = data.personnel;
    }
    openModal(`
      <div class="modal-head"><h3>${person ? '编辑人员' : '新增人员'}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="personnel-form">
          <div class="form-grid">
            <div class="field"><span>姓名</span><input class="input" name="name" required value="${esc(person?.name || '')}"></div>
            <div class="field"><span>科室</span><input class="input" name="department" value="${esc(person?.department || '')}" placeholder="如：药房"></div>
            <div class="field"><span>岗位</span><input class="input" name="position" value="${esc(person?.position || '')}" placeholder="如：药师"></div>
            <div class="field"><span>手机号</span><input class="input" name="phone" value="${esc(person?.phone || '')}"></div>
            <div class="field">
              <span>状态</span>
              <div class="form-row">
                <label class="switch"><input type="checkbox" name="status" ${person ? (Number(person.status) === 1 ? 'checked' : '') : 'checked'}><span class="track"></span></label>
                <span style="color:#6b7280;font-size:13px">在职</span>
              </div>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#personnel-form', modalEl));
          const body = {
            name: form.get('name'),
            department: form.get('department'),
            position: form.get('position'),
            phone: form.get('phone'),
            status: form.get('status') ? 1 : 0
          };
          try {
            await api(person ? `/api/admin/personnel/${person.id}` : '/api/admin/personnel', {
              method: person ? 'PUT' : 'POST',
              body
            });
            toast('已保存', 'success');
            closeModal();
            loadView('personnel');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function editMedicine(id) {
    let medicine = null;
    if (id) {
      const data = await api(`/api/admin/medicines/${id}`);
      medicine = data.medicine;
    }
    openModal(`
      <div class="modal-head"><h3>${medicine ? '编辑药品' : '新增药品'}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="medicine-form">
          <div class="form-grid">
            <div class="field"><span>药品名称</span><input class="input" name="name" required value="${esc(medicine?.name || '')}"></div>
            <div class="field"><span>规格</span><input class="input" name="spec" value="${esc(medicine?.spec || '')}" placeholder="如：0.25g*24粒"></div>
            <div class="field"><span>批号</span><input class="input" name="batch_no" value="${esc(medicine?.batch_no || '')}"></div>
            <div class="field"><span>生产厂家</span><input class="input" name="manufacturer" value="${esc(medicine?.manufacturer || '')}"></div>
            <div class="field"><span>有效期至</span><input class="input" name="expiry_date" type="date" value="${esc(medicine?.expiry_date || '')}"></div>
            <div class="field"><span>数量</span><input class="input" name="quantity" type="number" min="0" required value="${medicine?.quantity ?? 0}"></div>
            <div class="field"><span>单位</span><input class="input" name="unit" value="${esc(medicine?.unit || '盒')}"></div>
            <div class="field"><span>存放位置</span><input class="input" name="storage" value="${esc(medicine?.storage || '')}" placeholder="如：药箱 A-01"></div>
            <div class="field">
              <span>状态</span>
              <select class="select" name="status">
                <option value="normal" ${medicine?.status === 'normal' || !medicine ? 'selected' : ''}>正常</option>
                <option value="expiring" ${medicine?.status === 'expiring' ? 'selected' : ''}>临期</option>
                <option value="expired" ${medicine?.status === 'expired' ? 'selected' : ''}>过期</option>
              </select>
            </div>
            <div class="field full"><span>备注</span><textarea class="input" name="remark">${esc(medicine?.remark || '')}</textarea></div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { size: 'lg', onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#medicine-form', modalEl));
          const body = {
            name: form.get('name'),
            spec: form.get('spec'),
            batch_no: form.get('batch_no'),
            manufacturer: form.get('manufacturer'),
            expiry_date: form.get('expiry_date'),
            quantity: Number(form.get('quantity')),
            unit: form.get('unit'),
            storage: form.get('storage'),
            status: form.get('status'),
            remark: form.get('remark')
          };
          try {
            await api(medicine ? `/api/admin/medicines/${medicine.id}` : '/api/admin/medicines', {
              method: medicine ? 'PUT' : 'POST',
              body
            });
            toast('已保存', 'success');
            closeModal();
            loadView('medicines');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function editAdmin(id) {
    let admin = null;
    if (id) {
      const data = await api('/api/admin/admins');
      admin = data.items.find((a) => a.id === id);
    }
    const isSelf = admin && admin.username === state.admin.username;
    const selectedPerms = admin?.role === 'super' ? [] : (admin?.permissions || []);
    openModal(`
      <div class="modal-head"><h3>${admin ? '编辑管理员' : '新增管理员'}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="admin-form">
          <div class="form-grid">
            <div class="field"><span>账号</span><input class="input" name="username" ${admin ? 'disabled' : ''} required value="${esc(admin?.username || '')}"></div>
            <div class="field"><span>名称</span><input class="input" name="display_name" value="${esc(admin?.display_name || '')}"></div>
            <div class="field"><span>密码</span><input class="input" name="password" type="password" ${admin ? '' : 'required'} placeholder="${admin ? '留空则不修改' : '至少 6 位'}"></div>
            <div class="field">
              <span>角色</span>
              <select class="select" name="role" ${isSelf ? 'disabled' : ''}>
                <option value="admin" ${admin?.role !== 'super' ? 'selected' : ''}>普通管理员</option>
                <option value="super" ${admin?.role === 'super' ? 'selected' : ''}>超级管理员</option>
              </select>
            </div>
            <div class="field full" id="admin-status-field">
              <span>状态</span>
              <div class="form-row">
                <label class="switch"><input type="checkbox" name="status" ${admin ? (Number(admin.status) === 1 ? 'checked' : '') : 'checked'} ${isSelf ? 'disabled' : ''}><span class="track"></span></label>
                <span style="color:#6b7280;font-size:13px">启用账号</span>
              </div>
            </div>
            <div class="field full" id="perm-field">
              <span>操作权限</span>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-top:6px">
                ${PERMISSION_GROUPS.map(([key, label]) => `
                  <label class="perm-check"><input type="checkbox" name="perm" value="${key}" ${selectedPerms.includes(key) ? 'checked' : ''}>${label}</label>
                `).join('')}
              </div>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { size: 'lg', onMount: (modalEl) => {
      const roleSelect = $('select[name=role]', modalEl);
      const permField = $('#perm-field', modalEl);
      const togglePerms = () => permField.classList.toggle('hidden', roleSelect.value === 'super');
      togglePerms();
      roleSelect.addEventListener('change', togglePerms);
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#admin-form', modalEl));
          const role = form.get('role') || 'admin';
          const body = {
            username: form.get('username'),
            display_name: form.get('display_name'),
            role,
            status: form.get('status') ? 1 : 0,
            permissions: role === 'super' ? [] : $$('input[name=perm]:checked', modalEl).map((el) => el.value)
          };
          const password = String(form.get('password') || '');
          if (password) body.password = password;
          try {
            await api(admin ? `/api/admin/admins/${admin.id}` : '/api/admin/admins', {
              method: admin ? 'PUT' : 'POST',
              body
            });
            toast('已保存', 'success');
            closeModal();
            if (isSelf && password) {
              showLogin();
            } else {
              loadView('admins');
            }
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function editProduct(id) {
    let product = null;
    if (id) {
      const data = await api(`/api/admin/products/${id}`);
      product = data.product;
    }
    const imagesValue = product ? (product.images || []).join('\n') : '';
    openModal(`
      <div class="modal-head"><h3>${product ? '编辑物品' : '新增物品'}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="product-form">
          <div class="form-grid">
            <div class="field"><span>名称</span><input class="input" name="title" required value="${esc(product?.title || '')}"></div>
            <div class="field"><span>副标题</span><input class="input" name="subtitle" value="${esc(product?.subtitle || '')}"></div>
            <div class="field"><span>分类</span><input class="input" name="category" value="${esc(product?.category || '')}" placeholder="如：医药"></div>
            <div class="field"><span>排序</span><input class="input" name="sort" type="number" value="${product?.sort ?? 0}"></div>
            <div class="field"><span>价格</span><input class="input" name="price" type="number" step="0.01" min="0" required value="${product?.price ?? ''}"></div>
            <div class="field"><span>原价</span><input class="input" name="original_price" type="number" step="0.01" min="0" value="${product?.original_price ?? ''}"></div>
            <div class="field"><span>库存</span><input class="input" name="stock" type="number" min="0" required value="${product?.stock ?? 0}"></div>
            <div class="field">
              <span>状态</span>
              <div class="form-row">
                <label class="switch"><input type="checkbox" name="status" ${product ? (Number(product.status) === 1 ? 'checked' : '') : 'checked'}><span class="track"></span></label>
                <span style="color:#6b7280;font-size:13px">上架</span>
              </div>
            </div>
            <div class="field full"><span>封面图地址</span><input class="input" name="cover" value="${esc(product?.cover || '')}" placeholder="留空则取第一张图片"></div>
            <div class="field full"><span>图片地址（每行一个）</span><textarea class="input" name="images" placeholder="/uploads/... 或 https://...">${esc(imagesValue)}</textarea></div>
            <div class="field full"><span>简介</span><textarea class="input" name="summary">${esc(product?.summary || '')}</textarea></div>
            <div class="field full"><span>详情</span><textarea class="input" name="content">${esc(product?.content || '')}</textarea></div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { size: 'lg', onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#product-form', modalEl));
          const images = String(form.get('images') || '').split('\n').map((s) => s.trim()).filter(Boolean);
          const body = {
            title: form.get('title'),
            subtitle: form.get('subtitle'),
            category: form.get('category'),
            sort: Number(form.get('sort') || 0),
            price: Number(form.get('price')),
            original_price: form.get('original_price') ? Number(form.get('original_price')) : null,
            stock: Number(form.get('stock')),
            status: form.get('status') ? 1 : 0,
            cover: form.get('cover'),
            images,
            summary: form.get('summary'),
            content: form.get('content')
          };
          try {
            await api(product ? `/api/admin/products/${product.id}` : '/api/admin/products', {
              method: product ? 'PUT' : 'POST',
              body
            });
            toast('已保存', 'success');
            closeModal();
            loadView('products');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function openOrderDetail(id) {
    const data = await api(`/api/admin/orders/${id}`);
    const o = data.order;
    const actions = {
      pending: [['paid', '确认支付', 'primary'], ['cancelled', '取消订单', 'danger']],
      paid: [['shipped', '确认发货', 'primary'], ['cancelled', '取消订单', 'danger']],
      shipped: [['completed', '确认完成', 'primary']]
    };
    openModal(`
      <div class="modal-head"><h3>${esc(o.order_no)}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <div class="detail-grid">
          <div class="detail-item"><span>商品</span><strong>${esc(o.title)}</strong></div>
          <div class="detail-item"><span>单价</span><strong>${money(o.price)}</strong></div>
          <div class="detail-item"><span>数量</span><strong>${o.quantity}</strong></div>
          <div class="detail-item"><span>金额</span><strong>${money(o.amount)}</strong></div>
          <div class="detail-item"><span>用户</span><strong>${esc(o.nickname)} (${esc(o.user_phone || '-')})</strong></div>
          <div class="detail-item"><span>状态</span><strong>${badge(o.status, ORDER_STATUS)}</strong></div>
          <div class="detail-item"><span>联系人</span><strong>${esc(o.contact_name)} ${esc(o.contact_phone)}</strong></div>
          <div class="detail-item"><span>地址</span><strong>${esc(o.address || '-')}</strong></div>
          <div class="detail-item"><span>下单时间</span><strong>${fmtDateTime(o.created_at)}</strong></div>
          <div class="detail-item"><span>支付时间</span><strong>${fmtDateTime(o.pay_time)}</strong></div>
          <div class="detail-item full"><span>备注</span><strong>${esc(o.remark || '-')}</strong></div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>关闭</button>
        ${(actions[o.status] || []).map(([status, label, tone]) => `<button class="btn ${tone}" data-status="${status}">${label}</button>`).join('')}
      </div>`, { onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        const btn = e.target.closest('[data-status]');
        if (btn) {
          try {
            await api(`/api/admin/orders/${o.id}/status`, { method: 'PATCH', body: { status: btn.dataset.status } });
            toast('状态已更新', 'success');
            closeModal();
            loadView('orders');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function editBanner(id) {
    let banner = null;
    if (id) {
      const data = await api('/api/admin/banners');
      banner = data.items.find((b) => b.id === id);
    }
    openModal(`
      <div class="modal-head"><h3>${banner ? '编辑轮播图' : '新增轮播图'}</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="banner-form">
          <div class="form-grid">
            <div class="field"><span>标题</span><input class="input" name="title" value="${esc(banner?.title || '')}"></div>
            <div class="field"><span>排序</span><input class="input" name="sort" type="number" value="${banner?.sort ?? 0}"></div>
            <div class="field full"><span>图片地址</span><input class="input" name="image" required value="${esc(banner?.image || '')}" placeholder="/uploads/... 或 https://..."></div>
            <div class="field">
              <span>跳转类型</span>
              <select class="select" name="link_type">
                <option value="none" ${banner?.link_type === 'none' ? 'selected' : ''}>无跳转</option>
                <option value="product" ${banner?.link_type === 'product' ? 'selected' : ''}>物品详情</option>
                <option value="page" ${banner?.link_type === 'page' ? 'selected' : ''}>小程序页面</option>
              </select>
            </div>
            <div class="field">
              <span>跳转值</span>
              <input class="input" name="link_value" value="${esc(banner?.link_value || '')}" placeholder="物品 ID 或页面路径">
            </div>
            <div class="field">
              <span>状态</span>
              <div class="form-row">
                <label class="switch"><input type="checkbox" name="status" ${banner ? (Number(banner.status) === 1 ? 'checked' : '') : 'checked'}><span class="track"></span></label>
                <span style="color:#6b7280;font-size:13px">启用</span>
              </div>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#banner-form', modalEl));
          try {
            await api(banner ? `/api/admin/banners/${banner.id}` : '/api/admin/banners', {
              method: banner ? 'PUT' : 'POST',
              body: {
                title: form.get('title'),
                image: form.get('image'),
                link_type: form.get('link_type'),
                link_value: form.get('link_value'),
                sort: Number(form.get('sort') || 0),
                status: form.get('status') ? 1 : 0
              }
            });
            toast('已保存', 'success');
            closeModal();
            loadView('banners');
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  async function saveSettings() {
    const form = new FormData($('#settings-form'));
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          site_name: form.get('site_name'),
          upload_enabled: form.get('upload_enabled') ? '1' : '0',
          max_photo_mb: Number(form.get('max_photo_mb') || 8),
          wechat_appid: form.get('wechat_appid'),
          wechat_secret: form.get('wechat_secret')
        }
      });
      toast('设置已保存', 'success');
      $('#brand-name').textContent = form.get('site_name') || '开封查对管理系统';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function changePasswordModal() {
    openModal(`
      <div class="modal-head"><h3>修改登录密码</h3><button class="icon-btn" data-close><i data-lucide="x"></i></button></div>
      <div class="modal-body">
        <form class="form" id="password-form">
          <div class="form-grid">
            <div class="field full"><span>原密码</span><input class="input" name="old_password" type="password" required></div>
            <div class="field"><span>新密码</span><input class="input" name="new_password" type="password" required minlength="6"></div>
            <div class="field"><span>确认新密码</span><input class="input" name="confirm_password" type="password" required minlength="6"></div>
          </div>
        </form>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>取消</button>
        <button class="btn primary" data-save><i data-lucide="save"></i>保存</button>
      </div>`, { onMount: (modalEl) => {
      modalEl.addEventListener('click', async (e) => {
        if (e.target.closest('[data-close]')) return closeModal();
        if (e.target.closest('[data-save]')) {
          const form = new FormData($('#password-form', modalEl));
          if (form.get('new_password') !== form.get('confirm_password')) {
            toast('两次输入的新密码不一致', 'error');
            return;
          }
          try {
            await api('/api/admin/password', {
              method: 'POST',
              body: {
                old_password: form.get('old_password'),
                new_password: form.get('new_password')
              }
            });
            toast('密码已修改，请重新登录', 'success');
            closeModal();
            showLogin();
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    }});
  }

  function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#admin-name').textContent = state.admin.display_name || state.admin.username;
    $('#admin-avatar').textContent = (state.admin.display_name || state.admin.username || '管')[0];
    $('#sidebar-admin').textContent = `${state.admin.display_name} · ${state.admin.username}`;
    applyNavPermissions();
    loadView(state.view);
  }

  function showLogin() {
    state.view = 'dashboard';
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    closeModal();
  }

  function init() {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const submitBtn = $('button[type=submit]', e.currentTarget);
      submitBtn.disabled = true;
      try {
        const data = await api('/api/admin/login', {
          method: 'POST',
          body: { username: form.get('username'), password: form.get('password') }
        });
        state.admin = data.admin;
        showApp();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    $('#logout-btn').addEventListener('click', async () => {
      try {
        await api('/api/admin/logout', { method: 'POST' });
      } catch {
        // 忽略退出失败
      }
      showLogin();
    });

    $('#refresh-btn').addEventListener('click', () => loadView(state.view));

    $$('.nav-item').forEach((el) => el.addEventListener('click', () => loadView(el.dataset.view)));
    $('#content').addEventListener('click', (e) => {
      const nav = e.target.closest('[data-view-nav]');
      if (nav) loadView(nav.dataset.viewNav);
    });

    $('#lightbox-close').addEventListener('click', closeLightbox);
    $('#lightbox').addEventListener('click', (e) => {
      if (e.target === $('#lightbox')) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
        closeModal();
      }
    });

    api('/api/admin/me').then((data) => {
      state.admin = data.admin;
      showApp();
    }).catch(() => showLogin());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
