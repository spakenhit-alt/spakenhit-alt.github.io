/* スパ研 巡検ログ — 画面の動き
 * 投稿された文字はすべて textContent で入れているので、HTMLとして解釈されることはありません。
 */
(function () {
  'use strict';

  var CFG = window.JUNKEN_CONFIG || {};
  var API = String(CFG.API_URL || '').trim();
  var DEMO = !API;
  var KEY = /^#[0-9a-fA-F]{6}$/.test(CFG.KEY_COLOR || '') ? CFG.KEY_COLOR : '#0017C1';
  document.documentElement.style.setProperty('--key', KEY);

  /* ---------------- 端末に覚えておくもの ---------------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('junken.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('junken.' + k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では覚えない */ } },
    del: function (k) { try { localStorage.removeItem('junken.' + k); } catch (e) { /* noop */ } }
  };
  var clientId = store.get('clientId', null);
  if (!clientId) {
    clientId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    store.set('clientId', clientId);
  }
  var liked = new Set(store.get('liked', []));
  function saveLiked() { store.set('liked', Array.from(liked)); }

  /* ---------------- 小さな部品 ---------------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  // 固定のアイコン用（利用者の文字は通さない）
  function icon(markup) {
    var t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }
  var ICON = {
    pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    nav: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none;margin-top:2px;color:var(--key)" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    locate: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
  };

  var main = document.getElementById('main');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  function firstChar(s) { return Array.from(String(s || '？'))[0] || '？'; }
  function norm(s) { return String(s || '').replace(/[\s　（）()・]/g, '').toLowerCase(); }
  function shopLabel(s) { return s.area ? s.name + '（' + s.area + '）' : s.name; }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date();
    var md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
  }
  function hasLoc(s) { return s.lat != null && s.lng != null && isFinite(s.lat) && isFinite(s.lng); }

  /* ---------------- 通信 ---------------- */
  function apiGet() {
    if (DEMO) return demo.feed();
    return fetch(API + '?action=feed', { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    if (DEMO) return demo.post(body);
    // Content-Type を付けない（text/plain）ことで Apps Script に直接送れます
    return fetch(API, { method: 'POST', body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  /* ---------------- データ ---------------- */
  var feed = { shops: [], posts: [] };
  var shopById = {}, postsByShop = {}, shopsNumbered = [];

  function load() {
    return apiGet().then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || '読み込めませんでした');
      feed = { shops: r.shops || [], posts: r.posts || [] };
      derive();
    });
  }
  function derive() {
    shopById = {}; postsByShop = {};
    feed.shops.forEach(function (s) { shopById[s.id] = s; postsByShop[s.id] = []; });
    feed.posts.forEach(function (p) { (postsByShop[p.shopId] = postsByShop[p.shopId] || []).push(p); });
    // 初めて行った順に番号をふる
    shopsNumbered = feed.shops.slice().sort(function (a, b) {
      return firstVisit(a.id) < firstVisit(b.id) ? -1 : 1;
    });
    shopsNumbered.forEach(function (s, i) { s.num = i + 1; });
  }
  function firstVisit(id) {
    var ps = postsByShop[id] || [];
    return ps.reduce(function (m, p) { return p.createdAt < m ? p.createdAt : m; }, '9999');
  }
  /** そのお店で、いいねがいちばん多い投稿（同じなら新しい方） */
  function bestPost(shopId) {
    var ps = postsByShop[shopId] || [];
    return ps.slice().sort(function (a, b) {
      return b.likes - a.likes || (a.createdAt < b.createdAt ? 1 : -1);
    })[0] || null;
  }

  /* ---------------- 画面の切り替え ---------------- */
  var mapInstance = null;
  var routes = { '': renderTimeline, shop: renderTimeline, map: renderMap, post: renderPost, admin: renderAdmin, print: renderPrint };

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/');
    var name = routes.hasOwnProperty(parts[0]) ? parts[0] : '';
    var arg = parts[1] ? decodeURIComponent(parts[1]) : '';

    Array.prototype.forEach.call(document.querySelectorAll('.tabs a'), function (a) { a.removeAttribute('aria-current'); });
    var tab = name === 'map' ? 'map' : (name === '' || name === 'shop') ? 'timeline' : null;
    if (tab) document.querySelector('.tabs a[data-tab="' + tab + '"]').setAttribute('aria-current', 'page');
    document.getElementById('fab').hidden = ['post', 'admin', 'print'].indexOf(name) >= 0;
    document.body.classList.toggle('wide', name === 'print');

    var dlg = document.getElementById('map-dialog');
    if (dlg.open) dlg.close();
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
    main.replaceChildren();
    routes[name](arg);
    window.scrollTo(0, 0);
  }

  /* ---------------- タイムライン ---------------- */
  function renderTimeline(shopId) {
    var posts = feed.posts;
    document.title = 'スパ研 巡検ログ';
    if (shopId) {
      var s = shopById[shopId];
      posts = posts.filter(function (p) { return p.shopId === shopId; });
      main.append(h('div', { class: 'filter-bar' },
        h('span', null, h('b', null, s ? shopLabel(s) : 'このお店'), ' の投稿（' + posts.length + '）'),
        h('a', { href: '#/' }, 'すべて表示')));
      if (s) document.title = s.name + ' — スパ研 巡検ログ';
    }
    if (!posts.length) {
      main.append(h('p', { class: 'empty' }, 'まだ投稿がありません。最初の記録をどうぞ。'));
      return;
    }
    posts.forEach(function (p) { main.append(postCard(p)); });
  }

  function postCard(p) {
    var s = shopById[p.shopId];
    var guest = p.role === 'guest';
    return h('article', { class: 'post' },
      h('div', { class: 'avatar' + (guest ? ' guest' : ''), 'aria-hidden': 'true' }, firstChar(p.name)),
      h('div', { class: 'post-body' },
        h('div', { class: 'who' },
          h('b', null, p.name),
          guest && h('span', { class: 'chip' }, 'ゲスト'),
          h('time', { class: 'muted', datetime: p.createdAt }, fmtDate(p.createdAt))),
        s && h('a', { class: 'shop-link', href: '#/shop/' + encodeURIComponent(s.id) }, icon(ICON.pin), shopLabel(s)),
        p.order && h('div', { class: 'order' }, '頼んだもの：' + p.order),
        h('p', { class: 'text' + (p.isTanka ? ' tanka' : '') }, p.text),
        p.photoUrl && h('img', { class: 'photo', src: p.photoUrl, alt: p.name + 'さんの写真', loading: 'lazy', referrerpolicy: 'no-referrer' }),
        likeButton(p)));
  }

  function likeButton(p) {
    var b = h('button', { class: 'like', type: 'button' }, icon(ICON.heart), h('span'));
    paintLike(b, liked.has(p.id), p.likes);
    b.addEventListener('click', function () {
      if (b.disabled) return;
      var wasOn = liked.has(p.id), before = p.likes;
      b.disabled = true;
      setLike(p, b, !wasOn, before + (wasOn ? -1 : 1));
      apiPost({ action: 'like', postId: p.id, clientId: clientId }).then(function (r) {
        if (!r || !r.ok) throw new Error();
        setLike(p, b, r.liked, r.likes);
      }).catch(function () {
        setLike(p, b, wasOn, before);
        toast('いいねできませんでした。時間をおいて試してください');
      }).then(function () { b.disabled = false; });
    });
    return b;
  }
  function setLike(p, b, on, count) {
    p.likes = Math.max(0, count);
    if (on) liked.add(p.id); else liked.delete(p.id);
    saveLiked();
    paintLike(b, on, p.likes);
  }
  function paintLike(b, on, count) {
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', (on ? 'いいね済み ' : 'いいね ') + count + '件');
    b.querySelector('span').textContent = count;
  }

  /* ---------------- 地図 ---------------- */
  function pinHtml(num) {
    return '<div class="pin"><svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39c-8-11-13-17-13-24a13 13 0 0 1 26 0c0 7-5 13-13 24z" fill="' + KEY + '" stroke="#FFFFFF" stroke-width="2"/></svg><span>' + Number(num) + '</span></div>';
  }

  function renderMap() {
    document.title = '地図 — スパ研 巡検ログ';
    var mapEl = h('div', { id: 'map', role: 'region', 'aria-label': '行ったお店の地図' });
    main.append(mapEl);
    var located = shopsNumbered.filter(hasLoc);

    if (window.L) {
      var map = L.map(mapEl);
      mapInstance = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      if (located.length) map.fitBounds(L.latLngBounds(located.map(function (s) { return [s.lat, s.lng]; })).pad(0.35), { maxZoom: 16 });
      else map.setView([35.684, 139.46], 13);

      located.forEach(function (s) {
        var ic = L.divIcon({ className: '', html: pinHtml(s.num), iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36] });
        L.marker([s.lat, s.lng], { icon: ic, title: s.name, alt: s.name }).addTo(map).bindPopup(function () { return popupFor(s); }, { maxWidth: 280, autoPanPaddingTopLeft: [64, 16], autoPanPaddingBottomRight: [16, 16] });
      });

      var Locate = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
          var wrap = L.DomUtil.create('div', 'leaflet-bar');
          var btn = h('button', { class: 'locate', type: 'button', 'aria-label': '現在地を表示', title: '現在地を表示' }, icon(ICON.locate));
          wrap.append(btn);
          L.DomEvent.disableClickPropagation(wrap);
          btn.addEventListener('click', function () {
            if (!navigator.geolocation) { toast('この端末では現在地を使えません'); return; }
            navigator.geolocation.getCurrentPosition(function (pos) {
              var ll = [pos.coords.latitude, pos.coords.longitude];
              L.circleMarker(ll, { radius: 8, color: '#FFFFFF', weight: 3, fillColor: '#0017C1', fillOpacity: 1 }).addTo(map);
              map.setView(ll, 15);
            }, function () { toast('現在地を取得できませんでした'); }, { enableHighAccuracy: true, timeout: 10000 });
          });
          return wrap;
        }
      });
      map.addControl(new Locate());
    } else {
      mapEl.append(h('p', { class: 'empty' }, '地図を読み込めませんでした'));
    }

    main.append(h('h2', { class: 'list-title' }, '行ったお店（' + shopsNumbered.length + '）'));
    shopsNumbered.forEach(function (s) {
      var n = (postsByShop[s.id] || []).length;
      main.append(h('a', { class: 'shop-row', href: '#/shop/' + encodeURIComponent(s.id) },
        h('span', { class: 'num' }, s.num),
        h('span', { class: 'grow' }, h('b', null, s.name),
          h('span', { class: 'muted' }, [s.area, '投稿 ' + n + '件', hasLoc(s) ? null : '位置未登録'].filter(Boolean).join(' ／ '))),
        icon('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4D4D4D" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>')));
    });

    var tools = h('div', { class: 'map-tools' },
      h('button', { class: 'btn-text', type: 'button', onclick: downloadKml }, icon(ICON.download), ' 全部のお店を保存（Googleマイマップ用）'),
      h('div', { class: 'hint' }, 'KMLファイルを保存して、Googleマイマップの「インポート」で取り込めます'));
    if (store.get('mapApp', null)) {
      tools.append(h('button', { class: 'btn-text', type: 'button', onclick: function (e) { store.del('mapApp'); e.target.remove(); toast('地図アプリの選択を元に戻しました'); } }, '地図アプリの選択を元に戻す'));
    }
    main.append(tools);
  }

  function popupFor(s) {
    var best = bestPost(s.id);
    var n = (postsByShop[s.id] || []).length;
    return h('div', { class: 'popup' },
      h('h3', null, shopLabel(s)),
      best && h('p', { class: 'text' + (best.isTanka ? ' tanka' : '') }, best.text),
      best && h('div', { class: 'muted' }, best.name + (best.order ? '・' + best.order : '') + '・いいね ' + best.likes),
      h('div', { class: 'popup-actions' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: function () { openInMapApp(s); } }, icon(ICON.nav), '地図アプリで開く'),
        h('a', { href: '#/shop/' + encodeURIComponent(s.id) }, '投稿 ' + n + '件')));
  }

  function mapUrls(s) {
    var q = s.name + (s.area ? ' ' + s.area : '');
    var google = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    var apple = 'https://maps.apple.com/?q=' + encodeURIComponent(s.name) + (hasLoc(s) ? '&ll=' + s.lat + ',' + s.lng : '&address=' + encodeURIComponent(s.area || ''));
    return { google: google, apple: apple };
  }

  function openInMapApp(s) {
    var urls = mapUrls(s);
    var pref = store.get('mapApp', null);
    if (pref === 'google' || pref === 'apple') { window.open(urls[pref], '_blank', 'noopener'); return; }
    var dlg = document.getElementById('map-dialog');
    if (!dlg.showModal) { window.open(urls.google, '_blank', 'noopener'); return; }
    document.getElementById('map-dialog-title').textContent = s.name + 'を地図アプリで開く';
    document.getElementById('map-dialog-area').textContent = s.area || '';
    var g = document.getElementById('open-google'), a = document.getElementById('open-apple');
    var remember = document.getElementById('remember-app');
    remember.checked = false;
    g.href = urls.google; a.href = urls.apple;
    g.onclick = function () { if (remember.checked) store.set('mapApp', 'google'); dlg.close(); };
    a.onclick = function () { if (remember.checked) store.set('mapApp', 'apple'); dlg.close(); };
    dlg.showModal();
  }

  function downloadKml() {
    var esc = function (v) { return String(v).replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); };
    var marks = shopsNumbered.filter(hasLoc).map(function (s) {
      var b = bestPost(s.id);
      var n = (postsByShop[s.id] || []).length;
      var desc = [s.area, b ? b.text + ' — ' + b.name : '', '投稿 ' + n + '件'].filter(Boolean).join('\n');
      return '<Placemark><name>' + esc(s.num + '. ' + s.name) + '</name><description>' + esc(desc) + '</description>' +
        '<Point><coordinates>' + s.lng + ',' + s.lat + ',0</coordinates></Point></Placemark>';
    }).join('\n');
    var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>スパ研 巡検ログ</name>\n' + marks + '\n</Document></kml>\n';
    var url = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
    var a = h('a', { href: url, download: 'supaken-junken.kml' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------------- 投稿 ---------------- */
  function field(labelText, inputEl, opts) {
    opts = opts || {};
    return h('div', { class: 'field', hidden: !!opts.hidden },
      h('label', { for: inputEl.id }, labelText, opts.req ? h('span', { class: 'req' }, '※必須') : (opts.optional ? h('span', { class: 'opt-label' }, opts.optional) : null)),
      inputEl, opts.after || null);
  }

  function renderPost() {
    document.title = '巡検を記録 — スパ研 巡検ログ';
    var savedPass = store.get('pass', null);
    var role = savedPass ? 'member' : 'guest';
    var selectedShop = null;
    var photoData = null;

    var err = h('p', { class: 'error', role: 'alert', hidden: true });
    var segM = h('button', { type: 'button' }, 'メンバー');
    var segG = h('button', { type: 'button' }, 'ゲスト');
    var notice = h('div', { class: 'notice' }, icon(ICON.info), h('span', null, 'ゲストの投稿は、すぱけん部員が確認してから公開されます。'));

    var passIn = h('input', { id: 'f-pass', class: 'input', type: 'password', autocomplete: 'current-password' });
    var passField = field('合言葉', passIn, { req: true, after: h('div', { class: 'hint' }, '一度入れると、この端末では次から入力しなくて大丈夫です') });

    var shopIn = h('input', { id: 'f-shop', class: 'input', autocomplete: 'off', maxlength: 40, placeholder: '例：サハラ' });
    var sugg = h('ul', { class: 'suggest', hidden: true });
    var areaIn = h('input', { id: 'f-area', class: 'input', maxlength: 30, placeholder: '例：国立・富士見台、府中本町' });
    var areaField = field('場所', areaIn, { req: true, hidden: true, after: h('div', { class: 'hint' }, '新しいお店です。地図にのせるため、最寄り駅や地域を入れてください') });

    var orderIn = h('input', { id: 'f-order', class: 'input', maxlength: 60, placeholder: '例：チーズナン、チャイ' });
    var textIn = h('textarea', { id: 'f-text', class: 'input', maxlength: 140, placeholder: '五七五七七でも、ひとことでも', 'aria-describedby': 'f-count' });
    var counter = h('div', { id: 'f-count', class: 'counter' }, '0 / 140文字');
    var tankaIn = h('input', { id: 'f-tanka', type: 'checkbox' });
    var nameIn = h('input', { id: 'f-name', class: 'input', maxlength: 20, autocomplete: 'nickname', placeholder: '例：みどり', value: store.get('name', '') });
    var photoIn = h('input', { id: 'f-photo', class: 'input', type: 'file', accept: 'image/*' });
    var preview = h('img', { class: 'preview', alt: '選んだ写真', hidden: true });
    var photoField = field('写真', photoIn, { optional: 'メンバーのみ・任意', after: preview });
    var hp = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off' });
    var submit = h('button', { class: 'btn btn-fill', type: 'submit' }, '投稿する');

    function exactShop() {
      var q = norm(shopIn.value);
      if (!q) return null;
      var area = norm(areaIn.value);
      return feed.shops.filter(function (s) { return norm(s.name) === q && (!area || areaField.hidden || norm(s.area) === area); })[0] || null;
    }

    function updateSugg() {
      var q = norm(shopIn.value);
      sugg.replaceChildren();
      if (!q || selectedShop) { sugg.hidden = true; areaField.hidden = !q || !!selectedShop || !!exactShop(); return; }
      var matches = feed.shops.filter(function (s) { return norm(s.name).indexOf(q) >= 0; }).slice(0, 5);
      matches.forEach(function (s) {
        sugg.append(h('li', null, h('button', {
          type: 'button',
          onclick: function () { selectedShop = s; shopIn.value = s.name; sugg.hidden = true; areaField.hidden = true; orderIn.focus(); }
        }, h('span', null, shopLabel(s)), h('span', { class: 'muted' }, '投稿 ' + (postsByShop[s.id] || []).length + '件'))));
      });
      var exact = exactShop();
      if (!exact) {
        sugg.append(h('li', null, h('button', {
          type: 'button', class: 'new',
          onclick: function () { sugg.hidden = true; areaField.hidden = false; areaIn.focus(); }
        }, '＋「' + shopIn.value.trim() + '」を新しいお店として追加')));
      }
      sugg.hidden = false;
      areaField.hidden = !!exact;
    }
    shopIn.addEventListener('input', function () { selectedShop = null; updateSugg(); });

    textIn.addEventListener('input', function () {
      var n = textIn.value.length;
      counter.textContent = n + ' / 140文字';
      counter.classList.toggle('over', n > 140);
    });

    photoIn.addEventListener('change', function () {
      var f = photoIn.files && photoIn.files[0];
      photoData = null; preview.hidden = true;
      if (!f) return;
      resizeImage(f, 1280).then(function (url) {
        photoData = url; preview.src = url; preview.hidden = false;
      }).catch(function () { toast('写真を読み込めませんでした'); });
    });

    function setRole(r) {
      role = r;
      segM.setAttribute('aria-pressed', String(r === 'member'));
      segG.setAttribute('aria-pressed', String(r === 'guest'));
      notice.hidden = r !== 'guest';
      passField.hidden = !(r === 'member' && !store.get('pass', null));
      photoField.hidden = r !== 'member';
    }
    segM.addEventListener('click', function () { setRole('member'); });
    segG.addEventListener('click', function () { setRole('guest'); });

    function showErr(msg, focusEl) {
      err.textContent = msg;
      err.hidden = false;
      Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (x) { x.removeAttribute('aria-invalid'); });
      if (focusEl) { focusEl.setAttribute('aria-invalid', 'true'); focusEl.focus(); }
      else err.scrollIntoView({ block: 'center' });
    }

    var form = h('form', { class: 'form', novalidate: true },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' },
        h('h1', null, '巡検を記録'),
        h('a', { href: '#/' }, 'キャンセル')),
      h('fieldset', { class: 'field' }, h('legend', null, '投稿する人'), h('div', { class: 'seg' }, segM, segG)),
      notice, passField,
      h('div', { class: 'field' },
        h('label', { for: 'f-shop' }, '店名', h('span', { class: 'req' }, '※必須')), shopIn, sugg),
      areaField,
      field('頼んだメニュー', orderIn, { optional: '任意' }),
      h('div', { class: 'field' },
        h('label', { for: 'f-text' }, '短歌か一言', h('span', { class: 'req' }, '※必須')), textIn, counter,
        h('label', { class: 'check', for: 'f-tanka' }, tankaIn, '短歌として表示する（明朝体）')),
      field('名前', nameIn, { optional: 'ニックネームでOK' }),
      photoField,
      h('div', { class: 'hp', 'aria-hidden': 'true' }, hp),
      h('p', { class: 'rules' }, 'お店の悪口や、ほかのお客さん・店員さんのことは書かないでください。'),
      err, submit);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var text = textIn.value.trim();
      if (!shopIn.value.trim()) return showErr('店名を入れてください', shopIn);
      if (!text) return showErr('短歌か一言を書いてください', textIn);
      if (text.length > 140) return showErr('140文字までです', textIn);
      var shop = selectedShop || exactShop();
      var area = areaIn.value.trim();
      if (!shop && !area) { areaField.hidden = false; return showErr('新しいお店の場所を入れてください', areaIn); }
      var passphrase = null;
      if (role === 'member') {
        passphrase = store.get('pass', null) || passIn.value;
        if (!passphrase) return showErr('合言葉を入れてください', passIn);
      }
      submit.disabled = true;
      submit.textContent = '送信中…';
      apiPost({
        action: 'post', role: role, passphrase: passphrase,
        shopId: shop ? shop.id : '', shopName: shopIn.value.trim(), area: area,
        order: orderIn.value.trim(), text: text, isTanka: tankaIn.checked,
        name: nameIn.value.trim(), photo: role === 'member' ? photoData : null,
        clientId: clientId, website: hp.value
      }).then(function (r) {
        if (!r || !r.ok) {
          if (role === 'member' && r && /合言葉/.test(r.error || '')) { store.del('pass'); passField.hidden = false; }
          throw new Error((r && r.error) || '送信できませんでした');
        }
        if (role === 'member') store.set('pass', passphrase);
        store.set('name', nameIn.value.trim());
        if (r.status === 'published') {
          return load().then(function () { toast('投稿しました'); location.hash = '#/'; });
        }
        main.replaceChildren(h('div', { class: 'form' },
          h('h1', null, 'ありがとうございます'),
          h('p', null, '投稿を受け取りました。すぱけん部員が確認してから公開されます。'),
          h('a', { class: 'btn btn-outline', href: '#/' }, 'タイムラインにもどる')));
      }).catch(function (ex) {
        showErr(ex.message || '送信できませんでした。通信状態を確かめてください');
      }).then(function () {
        submit.disabled = false;
        submit.textContent = '投稿する';
      });
    });

    main.append(form);
    setRole(role);
  }

  function resizeImage(file, max) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  /* ---------------- メンバー用（承認・お店の位置） ---------------- */
  function renderAdmin() {
    document.title = 'メンバー用 — スパ研 巡検ログ';
    var wrap = h('div', { class: 'form' });
    main.append(wrap);
    var pass = store.get('pass', null);
    if (!pass) loginView(); else adminView('pending');

    function loginView() {
      var passIn = h('input', { id: 'a-pass', class: 'input', type: 'password', autocomplete: 'current-password' });
      var err = h('p', { class: 'error', role: 'alert', hidden: true });
      var f = h('form', { class: 'form', style: 'padding:0' },
        h('h1', null, 'メンバー用'),
        h('p', null, 'ゲストの投稿の確認と、お店の位置の修正ができます。'),
        field('合言葉', passIn, { req: true, after: DEMO ? h('div', { class: 'hint' }, '見本データの合言葉は demo です') : null }),
        err,
        h('button', { class: 'btn btn-fill', type: 'submit' }, '入る'));
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        apiPost({ action: 'checkPass', passphrase: passIn.value }).then(function (r) {
          if (r && r.ok) { store.set('pass', passIn.value); adminView('pending'); }
          else { err.textContent = '合言葉が違います'; err.hidden = false; passIn.setAttribute('aria-invalid', 'true'); passIn.focus(); }
        }).catch(function () { err.textContent = '通信できませんでした'; err.hidden = false; });
      });
      wrap.replaceChildren(f);
      passIn.focus();
    }

    function denied(r) {
      if (r && /合言葉/.test(r.error || '')) { store.del('pass'); loginView(); return true; }
      return false;
    }

    function adminView(tab) {
      var labels = { pending: '承認待ち', published: '公開中', hidden: '非表示', shops: 'お店の位置' };
      var tabs = h('div', { class: 'admin-tabs', role: 'group', 'aria-label': '表示する投稿' });
      Object.keys(labels).forEach(function (k) {
        tabs.append(h('button', { class: 'btn btn-outline', type: 'button', 'aria-pressed': String(k === tab), onclick: function () { adminView(k); } }, labels[k]));
      });
      var list = h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('p', { class: 'muted' }, '読み込み中…'));
      wrap.replaceChildren(
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' },
          h('h1', null, 'メンバー用'),
          h('button', { class: 'btn-text', type: 'button', onclick: function () { store.del('pass'); loginView(); } }, 'ログアウト')),
        tabs, list);
      if (tab === 'shops') shopsView(list); else postsView(list, tab);
    }

    function postsView(list, status) {
      apiPost({ action: 'adminList', passphrase: store.get('pass', ''), status: status }).then(function (r) {
        if (denied(r)) return;
        if (!r.ok) throw new Error(r.error);
        list.replaceChildren();
        if (!r.posts.length) { list.append(h('p', { class: 'empty' }, 'ありません')); return; }
        r.posts.forEach(function (p) {
          var actions = h('div', { class: 'card-actions' });
          var act = function (to, label, fill) {
            actions.append(h('button', {
              class: 'btn ' + (fill ? 'btn-fill' : 'btn-outline'), type: 'button',
              onclick: function (e) {
                e.target.disabled = true;
                apiPost({ action: 'moderate', passphrase: store.get('pass', ''), postId: p.id, status: to }).then(function (r2) {
                  if (denied(r2)) return;
                  if (!r2.ok) throw new Error(r2.error);
                  toast(to === 'published' ? '公開しました' : '非表示にしました');
                  return load().then(function () { adminView(status); });
                }).catch(function (ex) { e.target.disabled = false; toast(ex.message || 'できませんでした'); });
              }
            }, label));
          };
          if (status === 'pending') { act('published', '承認して公開', true); act('hidden', '非表示にする'); }
          else if (status === 'published') act('hidden', '非表示にする');
          else act('published', '公開する', true);
          list.append(h('div', { class: 'card' },
            h('div', { class: 'who', style: 'justify-content:space-between' },
              h('span', { class: 'who' }, h('b', null, p.name), p.role === 'guest' && h('span', { class: 'chip' }, 'ゲスト')),
              h('span', { class: 'muted' }, fmtDate(p.createdAt))),
            p.shop && h('div', { style: 'font-size:14px;font-weight:700' }, shopLabel(p.shop)),
            p.order && h('div', { class: 'muted' }, '頼んだもの：' + p.order),
            h('p', { class: 'text' + (p.isTanka ? ' tanka' : '') }, p.text),
            actions));
        });
      }).catch(function (ex) { list.replaceChildren(h('p', { class: 'error' }, ex.message || '読み込めませんでした')); });
    }

    function shopsView(list) {
      apiPost({ action: 'adminShops', passphrase: store.get('pass', '') }).then(function (r) {
        if (denied(r)) return;
        if (!r.ok) throw new Error(r.error);
        list.replaceChildren(h('p', { class: 'muted' }, '新しいお店の位置は自動で探しますが、ずれることがあります。「位置を直す」から地図をタップして直せます。'));
        r.shops.forEach(function (s) {
          var row = h('div', { class: 'card' },
            h('b', null, shopLabel(s)),
            h('span', { class: hasLoc(s) ? 'muted' : 'error' }, hasLoc(s) ? '位置：登録済み' : '位置：未登録（地図に出ません）'),
            h('div', { class: 'card-actions' }, h('button', { class: 'btn btn-outline', type: 'button', onclick: function () { pickLocation(s, row); } }, '位置を直す')));
          list.append(row);
        });
      }).catch(function (ex) { list.replaceChildren(h('p', { class: 'error' }, ex.message || '読み込めませんでした')); });
    }

    function pickLocation(s, row) {
      if (!window.L) { toast('地図を読み込めませんでした'); return; }
      var box = h('div', { id: 'pick-map', role: 'region', 'aria-label': s.name + 'の位置を選ぶ地図' });
      var save = h('button', { class: 'btn btn-fill', type: 'button', disabled: true }, 'この位置で保存');
      var panel = h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' },
        h('p', { class: 'muted', style: 'margin:0' }, 'お店の場所をタップしてください'), box, save);
      Array.prototype.forEach.call(document.querySelectorAll('#pick-map'), function (old) { old.parentNode.remove(); });
      row.append(panel);
      if (mapInstance) { mapInstance.remove(); mapInstance = null; }
      var map = L.map(box);
      mapInstance = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      var start = hasLoc(s) ? [s.lat, s.lng] : [35.684, 139.46];
      map.setView(start, hasLoc(s) ? 17 : 13);
      var marker = hasLoc(s) ? L.marker(start).addTo(map) : null;
      var chosen = null;
      map.on('click', function (e) {
        chosen = e.latlng;
        if (marker) marker.setLatLng(chosen); else marker = L.marker(chosen).addTo(map);
        save.disabled = false;
      });
      save.addEventListener('click', function () {
        if (!chosen) return;
        save.disabled = true;
        apiPost({ action: 'setShopLocation', passphrase: store.get('pass', ''), shopId: s.id, lat: chosen.lat, lng: chosen.lng }).then(function (r) {
          if (denied(r)) return;
          if (!r.ok) throw new Error(r.error);
          toast('位置を保存しました');
          return load().then(function () { adminView('shops'); });
        }).catch(function (ex) { save.disabled = false; toast(ex.message || '保存できませんでした'); });
      });
    }
  }

  /* ---------------- 印刷用 散歩マップ（略図） ---------------- */
  // 駅と路線は位置関係がわかる程度の略図用データです
  var STATIONS = {
    '立川': [35.6980, 139.4137], '国立': [35.6990, 139.4466], '西国分寺': [35.6997, 139.4655], '国分寺': [35.7005, 139.4803],
    '西国立': [35.6950, 139.4220], '矢川': [35.6837, 139.4329], '谷保': [35.6800, 139.4475], '西府': [35.6727, 139.4592],
    '分倍河原': [35.6686, 139.4685], '府中本町': [35.6658, 139.4772], '北府中': [35.6812, 139.4718],
    '中河原': [35.6594, 139.4577], '府中': [35.6721, 139.4799], '東府中': [35.6688, 139.4950]
  };
  var LINES = [
    { name: 'JR中央線', color: '#FB5B01', stops: ['立川', '国立', '西国分寺', '国分寺'] },
    { name: 'JR南武線', color: '#D2A400', stops: ['立川', '西国立', '矢川', '谷保', '西府', '分倍河原', '府中本町'] },
    { name: '京王線', color: '#4979F5', stops: ['中河原', '分倍河原', '府中', '東府中'] },
    { name: 'JR武蔵野線', color: '#259D63', stops: ['府中本町', '北府中', '西国分寺'], dash: '7 5' }
  ];
  var RIVER = [[35.6560, 139.4100], [35.6560, 139.4400], [35.6580, 139.4600], [35.6610, 139.4750], [35.6600, 139.4900], [35.6570, 139.5050]];
  var NS = 'http://www.w3.org/2000/svg';
  function s_(tag, attrs, text) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
  }

  function renderPrint() {
    document.title = '巡検マップ（印刷用） — スパ研 巡検ログ';
    var W = 760, H = 762;
    var located = shopsNumbered.filter(hasLoc);

    // 表示範囲：府中・国立の基本範囲＋お店
    var lats = [35.6600, 35.7020], lngs = [139.4300, 139.4900];
    located.forEach(function (s) { lats.push(s.lat); lngs.push(s.lng); });
    var latMin = Math.min.apply(null, lats), latMax = Math.max.apply(null, lats);
    var lngMin = Math.min.apply(null, lngs), lngMax = Math.max.apply(null, lngs);
    var padLat = (latMax - latMin) * 0.08, padLng = (lngMax - lngMin) * 0.08;
    latMin -= padLat; latMax += padLat; lngMin -= padLng; lngMax += padLng;
    var kx = Math.cos((latMin + latMax) / 2 * Math.PI / 180);
    var scale = Math.min(W / ((lngMax - lngMin) * kx), H / (latMax - latMin));
    var ox = (W - (lngMax - lngMin) * kx * scale) / 2, oy = (H - (latMax - latMin) * scale) / 2;
    function P(lat, lng) { return [ox + (lng - lngMin) * kx * scale, oy + (latMax - lat) * scale]; }

    var svgEl = s_('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '巡検したお店の略図' });
    svgEl.append(s_('rect', { width: W, height: H, fill: '#F2F2F2' }));
    svgEl.append(s_('polyline', { points: RIVER.map(function (p) { return P(p[0], p[1]).join(','); }).join(' '), fill: 'none', stroke: '#D9E6FF', 'stroke-width': 26, 'stroke-linecap': 'round' }));
    var rv = P(35.6575, 139.4420);
    svgEl.append(s_('text', { x: rv[0], y: rv[1] + 5, 'font-size': 13, fill: '#4D4D4D' }, '多摩川'));
    var u1 = P(35.6975, 139.4415), u2 = P(35.6930, 139.4505);
    svgEl.append(s_('rect', { x: u1[0], y: u1[1], width: u2[0] - u1[0], height: u2[1] - u1[1], rx: 6, fill: '#C2E5D1' }));
    svgEl.append(s_('text', { x: u1[0], y: u2[1] + 16, 'font-size': 13, fill: '#333333' }, '一橋大学'));
    var a1 = P(35.6990, 139.4466), a2 = P(35.6820, 139.4466);
    svgEl.append(s_('line', { x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1], stroke: '#FFFFFF', 'stroke-width': 9 }));
    svgEl.append(s_('text', { x: a1[0] + 8, y: (a1[1] + a2[1]) / 2, 'font-size': 12, fill: '#4D4D4D' }, '大学通り'));

    LINES.forEach(function (ln) {
      var pts = ln.stops.map(function (n) { return P(STATIONS[n][0], STATIONS[n][1]).join(','); }).join(' ');
      var attrs = { points: pts, fill: 'none', stroke: ln.color, 'stroke-width': 4, 'stroke-linejoin': 'round' };
      if (ln.dash) attrs['stroke-dasharray'] = ln.dash;
      svgEl.append(s_('polyline', attrs));
    });
    var obstacles = [];
    Object.keys(STATIONS).forEach(function (n) {
      var p = P(STATIONS[n][0], STATIONS[n][1]);
      obstacles.push({ x: p[0] - 7, y: p[1] - 22, w: 18 + n.length * 14, h: 30 });
      svgEl.append(s_('circle', { cx: p[0], cy: p[1], r: 6, fill: '#FFFFFF', stroke: '#1A1A1A', 'stroke-width': 2 }));
      svgEl.append(s_('text', { x: p[0] + 9, y: p[1] - 7, 'font-size': 14, 'font-weight': 700, fill: '#1A1A1A', 'paint-order': 'stroke', stroke: '#F2F2F2', 'stroke-width': 4 }, n));
    });

    var leaders = s_('g', {});
    svgEl.append(leaders);
    var pins = [];
    located.forEach(function (s) {
      var p = P(s.lat, s.lng);
      pins.push({ s: s, x: p[0], y: p[1] });
      var g = s_('g', {});
      g.append(s_('path', { d: 'M' + p[0] + ' ' + p[1] + ' c-7 -10 -12 -15 -12 -22 a12 12 0 0 1 24 0 c0 7 -5 12 -12 22z', fill: KEY, stroke: '#FFFFFF', 'stroke-width': 2 }));
      g.append(s_('text', { x: p[0], y: p[1] - 17, 'font-size': 13, 'font-weight': 700, fill: '#FFFFFF', 'text-anchor': 'middle' }, String(s.num)));
      svgEl.append(g);
    });

    var mapBox = h('div', { class: 'pm-map' }, svgEl);

    var list = h('div', { class: 'pm-list' });
    shopsNumbered.forEach(function (s) {
      list.append(h('div', null, h('span', { class: 'num' }, s.num), h('span', null, h('b', null, s.name), s.area ? h('br') : null, s.area ? h('span', { class: 'pm-note' }, s.area) : null)));
    });
    if (!shopsNumbered.length) list.append(h('p', { class: 'muted' }, 'まだお店がありません'));

    var legend = h('div', { class: 'pm-legend' });
    LINES.forEach(function (ln) {
      legend.append(h('div', null, h('span', { class: 'line', style: 'border-top-color:' + ln.color + (ln.dash ? ';border-top-style:dashed' : '') }), ln.name));
    });

    var qrBox = h('div', { class: 'pm-qr', 'aria-label': 'このサイトのQRコード', role: 'img' });
    var siteUrl = location.href.split('#')[0];
    try {
      if (window.qrcode) {
        var qr = window.qrcode(0, 'M');
        qr.addData(siteUrl);
        qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); // ライブラリが作る固定のSVG
      }
    } catch (e) { qrBox.textContent = ''; }

    var side = h('div', { class: 'pm-side' },
      h('div', null,
        h('div', { class: 'muted', style: 'font-size:13px' }, 'スパイス研究会'),
        h('h1', null, '巡検マップ'),
        h('div', null, '府中・国立 スパイス散歩')),
      list, legend,
      h('div', { class: 'pm-foot' }, qrBox,
        h('div', null, '歌と記録の続きはWebで。', h('br'), '行った人なら誰でも投稿できます。', h('br'), h('b', null, 'Instagram ' + (CFG.INSTAGRAM || '')))),
      h('div', { class: 'pm-note' }, '吹き出しは、各店でいちばん「いいね」が多い投稿です。地図は位置関係を示した略図です。'));

    var page = h('div', { class: 'sheet-a4' }, mapBox, side);
    main.append(
      h('div', { class: 'print-tools no-print' },
        h('button', { class: 'btn btn-fill', type: 'button', onclick: function () { window.print(); } }, '印刷する／PDFで保存'),
        h('a', { href: '#/map' }, '地図にもどる'),
        h('p', { class: 'muted', style: 'margin:0;flex-basis:100%' }, '印刷の設定で「横向き」「余白なし」「背景のグラフィック」をオンにしてください。')),
      h('div', { class: 'print-wrap' }, page));

    var place = function () { placeBubbles(mapBox, leaders, pins, W, H, obstacles); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place); else setTimeout(place, 300);
  }

  /** 吹き出しを、ピンの近くの空いている場所に順番に置く */
  function placeBubbles(box, leaders, pins, W, H, obstacles) {
    var placed = pins.map(function (p) { return { x: p.x - 13, y: p.y - 36, w: 26, h: 38 }; });
    // 駅名にかぶるのは、ピンや吹き出しにかぶるより軽く数える
    var soft = (obstacles || []).map(function (o) { return { x: o.x, y: o.y, w: o.w, h: o.h, weight: 0.3 }; });
    var M = 8, GAP = 26;
    function overlap(a, b) {
      var x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      var y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return x * y;
    }
    pins.forEach(function (pin) {
      var best = bestPost(pin.s.id);
      if (!best) return;
      var el = h('div', { class: 'bub' },
        h('b', null, pin.s.num + '　' + pin.s.name),
        h('p', { class: 'text' + (best.isTanka ? ' tanka' : '') }, best.text),
        h('div', { class: 'by' }, best.name + (best.role === 'guest' ? '（ゲスト）' : '') + (best.order ? ' ／ ' + best.order : '') + ' ／ いいね ' + best.likes));
      el.style.visibility = 'hidden';
      box.append(el);
      var w = el.offsetWidth, hgt = el.offsetHeight;
      var cy = pin.y - 18;
      var cands = [
        { x: pin.x + GAP, y: cy - hgt / 2 }, { x: pin.x - GAP - w, y: cy - hgt / 2 },
        { x: pin.x - w / 2, y: pin.y - 40 - GAP - hgt }, { x: pin.x - w / 2, y: pin.y + GAP },
        { x: pin.x + GAP, y: pin.y - 40 - GAP - hgt }, { x: pin.x - GAP - w, y: pin.y - 40 - GAP - hgt },
        { x: pin.x + GAP, y: pin.y + GAP }, { x: pin.x - GAP - w, y: pin.y + GAP }
      ];
      // 候補が足りないときは少し遠くも探す
      [1.8, 2.8].forEach(function (k) {
        cands.push({ x: pin.x + GAP * k, y: cy - hgt / 2 - GAP * k }, { x: pin.x - GAP * k - w, y: cy - hgt / 2 + GAP * k });
      });
      var chosen = null, bestScore = Infinity;
      cands.forEach(function (c) {
        var r = { x: Math.min(Math.max(c.x, M), W - w - M), y: Math.min(Math.max(c.y, M), H - hgt - M), w: w, h: hgt };
        var score = placed.reduce(function (sum, q) { return sum + overlap(r, q); }, 0) +
          soft.reduce(function (sum, q) { return sum + overlap(r, q) * q.weight; }, 0);
        if (score < bestScore) { bestScore = score; chosen = r; }
      });
      placed.push({ x: chosen.x - 4, y: chosen.y - 4, w: w + 8, h: hgt + 8 });
      el.style.left = chosen.x + 'px';
      el.style.top = chosen.y + 'px';
      el.style.visibility = '';
      // ピンから吹き出しへの線
      var tx = Math.min(Math.max(pin.x, chosen.x), chosen.x + w);
      var ty = Math.min(Math.max(pin.y - 18, chosen.y), chosen.y + hgt);
      leaders.append(s_('line', { x1: pin.x, y1: pin.y - 18, x2: tx, y2: ty, stroke: '#1A1A1A', 'stroke-width': 1.5 }));
    });
  }

  /* ---------------- 見本データ（API_URL が空のときだけ） ---------------- */
  var demo = (function () {
    var t = function (d) { return new Date(d).toISOString(); };
    var shops = [
      { id: 's1', name: 'サハラ', area: '国立・富士見台', lat: 35.6817531, lng: 139.4471024, createdAt: t('2026-10-16T19:00:00+09:00') },
      { id: 's2', name: 'ビーメスワール', area: '府中本町', lat: 35.667042, lng: 139.4749006, createdAt: t('2026-10-23T20:00:00+09:00') }
    ];
    var posts = [
      { id: 'p3', createdAt: t('2026-10-16T20:10:00+09:00'), shopId: 's1', order: 'ネパールセット', text: 'おかわりの　ナンを断る　勇気なく\n満ちてゆく腹　満ちてゆく夜', isTanka: true, name: 'あやか', role: 'member', status: 'published', photoUrl: '', likes: 12 },
      { id: 'p1', createdAt: t('2026-10-23T20:40:00+09:00'), shopId: 's2', order: 'チーズナン、チャイ', text: 'チャイはカルダモン強め。うちの配合より甘くて、ミルクが濃い。', isTanka: false, name: 'しなもん', role: 'member', status: 'published', photoUrl: '', likes: 8 },
      { id: 'p2', createdAt: t('2026-10-23T21:14:00+09:00'), shopId: 's2', order: 'モモ', text: '初めてのネパール料理。モモが最高でした。', isTanka: false, name: 'みどり', role: 'guest', status: 'published', photoUrl: '', likes: 3 },
      { id: 'p4', createdAt: t('2026-10-24T12:40:00+09:00'), shopId: 's1', order: 'チキンカレー', text: 'スープのサービスがうれしい。', isTanka: false, name: 'ゲストさん', role: 'guest', status: 'pending', photoUrl: '', likes: 0 }
    ];
    var likesBy = {};
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    var later = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 150); }); };
    var shopOf = function (id) { return shops.filter(function (s) { return s.id === id; })[0]; };
    var PASS = 'demo';
    return {
      feed: function () {
        var ps = posts.filter(function (p) { return p.status === 'published'; }).map(clone)
          .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
        var used = {};
        ps.forEach(function (p) { used[p.shopId] = true; });
        return later({ ok: true, shops: shops.filter(function (s) { return used[s.id]; }).map(clone), posts: ps });
      },
      post: function (b) {
        var ok = b.passphrase === PASS;
        switch (b.action) {
          case 'checkPass': return later({ ok: ok });
          case 'like': {
            var p = posts.filter(function (x) { return x.id === b.postId; })[0];
            if (!p) return later({ ok: false, error: '投稿が見つかりません' });
            var k = p.id + '|' + b.clientId;
            if (likesBy[k]) { delete likesBy[k]; p.likes = Math.max(0, p.likes - 1); return later({ ok: true, liked: false, likes: p.likes }); }
            likesBy[k] = true; p.likes++;
            return later({ ok: true, liked: true, likes: p.likes });
          }
          case 'post': {
            if (b.role === 'member' && !ok) return later({ ok: false, error: '合言葉が違います' });
            var shopId = b.shopId;
            if (!shopId) {
              shopId = 's' + (shops.length + 1);
              shops.push({ id: shopId, name: b.shopName, area: b.area, lat: null, lng: null, createdAt: new Date().toISOString() });
            }
            var status = b.role === 'member' ? 'published' : 'pending';
            posts.push({ id: 'p' + (posts.length + 1) + Date.now(), createdAt: new Date().toISOString(), shopId: shopId, order: b.order, text: b.text, isTanka: !!b.isTanka, name: b.name || '名無し', role: b.role, status: status, photoUrl: b.photo || '', likes: 0 });
            return later({ ok: true, status: status });
          }
          case 'adminList':
            if (!ok) return later({ ok: false, error: '合言葉が違います' });
            return later({ ok: true, posts: posts.filter(function (p) { return p.status === b.status; }).map(function (p) { var o = clone(p); o.shop = clone(shopOf(p.shopId)); return o; }) });
          case 'moderate':
            if (!ok) return later({ ok: false, error: '合言葉が違います' });
            posts.forEach(function (p) { if (p.id === b.postId) p.status = b.status; });
            return later({ ok: true });
          case 'adminShops':
            if (!ok) return later({ ok: false, error: '合言葉が違います' });
            return later({ ok: true, shops: shops.map(clone) });
          case 'setShopLocation':
            if (!ok) return later({ ok: false, error: '合言葉が違います' });
            var s = shopOf(b.shopId); if (s) { s.lat = b.lat; s.lng = b.lng; }
            return later({ ok: true });
        }
        return later({ ok: false, error: '不明な操作です' });
      }
    };
  })();

  /* ---------------- はじまり ---------------- */
  if (DEMO) document.getElementById('demo-banner').hidden = false;
  main.append(h('p', { class: 'empty' }, '読み込み中…'));
  var routing = false;
  function start() {
    load().then(function () {
      if (!routing) { window.addEventListener('hashchange', route); routing = true; }
      route();
    }).catch(function (e) {
      main.replaceChildren(h('div', { class: 'empty' },
        h('p', null, '読み込めませんでした。' + (e && e.message ? '（' + e.message + '）' : '')),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: function () { main.replaceChildren(h('p', { class: 'empty' }, '読み込み中…')); start(); } }, 'もう一度読み込む')));
    });
  }
  start();
})();
