/* ScienceScope gallery runtime (design system v1, 2026-10-16).
   The icon set (Lucide 1.49.0, ISC) and the interaction patterns, written
   without a framework so the previews stay small. The app implements the same
   rules as Preact components in app/ui/; this file is the reference for them:
   anchored overlays that flip to stay on screen, Esc and outside-click close,
   focus returns to the trigger, custom context menus, resizable panels that
   follow the pointer and remember their width, tooltips with a short delay. */
(function () {
  'use strict';

  var ICONS = __ICONS__;
  var ICON_GROUPS = __GROUPS__;
  var LOGO_PATHS = __LOGO__;

  // ---------- Icons ----------
  function icon(name, extra) {
    return (
      '<svg class="ss-i' + (extra ? ' ' + extra : '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (ICONS[name] || '') +
      '</svg>'
    );
  }
  function logo(extra) {
    return (
      '<svg class="ss-logo' + (extra ? ' ' + extra : '') +
      '" viewBox="20 20 474 474" fill="currentColor" aria-hidden="true">' + LOGO_PATHS + '</svg>'
    );
  }
  // Context gauge: a filled wedge inside a thin outline, so it never reads as a spinner.
  // warnAt is the compaction threshold (default 80); 95 and above is always danger.
  function ring(percent, warnAt) {
    var p = Math.max(0, Math.min(100, Number(percent) || 0));
    var c = 2 * Math.PI * 2.5;
    var w = Number(warnAt) || 80;
    var level = p >= 95 ? 'danger' : p >= w ? 'warn' : '';
    return (
      '<svg class="ss-ring" viewBox="0 0 16 16"' + (level ? ' data-level="' + level + '"' : '') +
      ' aria-hidden="true"><circle class="ss-ring__track" cx="8" cy="8" r="6.75"/>' +
      '<circle class="ss-ring__bar" cx="8" cy="8" r="2.5" stroke-dasharray="' + ((c * p) / 100).toFixed(2) +
      ' ' + c.toFixed(2) + '"/></svg>'
    );
  }
  // Replace a placeholder <i> with markup, keeping its inline style.
  function swap(el, html) {
    el.insertAdjacentHTML('afterend', html);
    var style = el.getAttribute('style');
    if (style) el.nextElementSibling.setAttribute('style', style);
    el.remove();
  }
  function hydrate(root) {
    root.querySelectorAll('i[data-i]').forEach(function (el) {
      swap(el, icon(el.getAttribute('data-i'), el.getAttribute('class')));
    });
    root.querySelectorAll('i[data-logo]').forEach(function (el) {
      swap(el, logo(el.getAttribute('class')));
    });
    root.querySelectorAll('i[data-ring]').forEach(function (el) {
      swap(el, ring(el.getAttribute('data-ring'), el.getAttribute('data-warn')));
    });
  }

  // ---------- Placement: preferred side, flip if it does not fit, shift into view ----------
  var OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  function place(el, a, placement, gap) {
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var margin = 8;
    el.style.left = '0px';
    el.style.top = '0px';
    var box = el.getBoundingClientRect();
    var w = box.width;
    var h = box.height;
    var parts = (placement || 'bottom-start').split('-');
    var side = parts[0];
    var align = parts[1] || 'center';
    var fits = {
      bottom: a.bottom + gap + h <= vh - margin,
      top: a.top - gap - h >= margin,
      right: a.right + gap + w <= vw - margin,
      left: a.left - gap - w >= margin,
    };
    if (!fits[side] && fits[OPPOSITE[side]]) side = OPPOSITE[side];
    var x;
    var y;
    if (side === 'top' || side === 'bottom') {
      y = side === 'bottom' ? a.bottom + gap : a.top - gap - h;
      x = align === 'start' ? a.left : align === 'end' ? a.right - w : a.left + (a.width - w) / 2;
    } else {
      x = side === 'right' ? a.right + gap : a.left - gap - w;
      y = align === 'start' ? a.top : align === 'end' ? a.bottom - h : a.top + (a.height - h) / 2;
    }
    x = Math.max(margin, Math.min(x, vw - w - margin));
    y = Math.max(margin, Math.min(y, vh - h - margin));
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    el.setAttribute('data-side', side);
  }
  function pointRect(x, y) {
    return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
  }

  // ---------- Tooltip: 500 ms delay, instant while another tip was just shown ----------
  var tip = null;
  var tipFor = null;
  var tipTimer = 0;
  var tipWarmUntil = 0;
  function showTip(target) {
    var text = target.getAttribute('data-tip');
    if (!text || target.getAttribute('aria-expanded') === 'true') return;
    hideTip(true);
    tip = document.createElement('div');
    tip.className = 'ss-tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    var kbd = target.getAttribute('data-kbd');
    if (kbd) {
      var k = document.createElement('span');
      k.className = 'ss-kbd';
      k.textContent = kbd;
      tip.appendChild(k);
    }
    document.body.appendChild(tip);
    place(tip, target.getBoundingClientRect(), target.getAttribute('data-tip-place') || 'top', 6);
    tipFor = target;
  }
  function hideTip(keepWarm) {
    clearTimeout(tipTimer);
    if (tip) {
      tip.remove();
      tip = null;
      if (keepWarm !== false) tipWarmUntil = Date.now() + 400;
    }
    tipFor = null;
  }
  document.addEventListener('pointerover', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t || t === tipFor) return;
    clearTimeout(tipTimer);
    var delay = tip || Date.now() < tipWarmUntil ? 0 : 500;
    tipTimer = setTimeout(function () {
      showTip(t);
    }, delay);
  });
  document.addEventListener('pointerout', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t && t.matches(':focus-visible')) showTip(t);
  });
  document.addEventListener('focusout', function () {
    hideTip();
  });
  window.addEventListener(
    'scroll',
    function () {
      hideTip(false);
    },
    true,
  );

  // ---------- Overlays: menus, context menus, popovers (one open at a time) ----------
  var open = null;
  function rowOf(el) {
    return el && el.closest && el.closest('.ss-tree-row, .ss-list-row, .ss-msg');
  }
  function openOverlay(el, trigger, opts) {
    closeOverlay(false);
    if (!el) return;
    if (el.parentNode !== document.body) document.body.appendChild(el);
    el.hidden = false;
    var rect = opts.point ? pointRect(opts.point.x, opts.point.y) : trigger.getBoundingClientRect();
    place(el, rect, opts.placement || el.getAttribute('data-place') || 'bottom-start', opts.point ? 2 : 4);
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'true');
      var row = rowOf(trigger);
      if (row) row.setAttribute('data-menu-open', '');
    }
    open = { el: el, trigger: trigger, kind: opts.kind };
    hideTip(false);
    if (opts.kind === 'menu') {
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      if (opts.keyboard) moveActive(el, 1);
    } else if (opts.keyboard) {
      var first = el.querySelector('input, button, [tabindex="0"]');
      if (first) first.focus();
    }
  }
  function closeOverlay(restoreFocus) {
    if (!open) return;
    var o = open;
    open = null;
    o.el.hidden = true;
    o.el.querySelectorAll('[data-active]').forEach(function (n) {
      n.removeAttribute('data-active');
    });
    if (o.trigger) {
      o.trigger.setAttribute('aria-expanded', 'false');
      var row = rowOf(o.trigger);
      if (row) row.removeAttribute('data-menu-open');
      if (restoreFocus) o.trigger.focus({ preventScroll: true });
    }
  }
  function menuItems(menu) {
    return Array.prototype.filter.call(menu.querySelectorAll('.ss-menu__item, .ss-model'), function (n) {
      return n.getAttribute('aria-disabled') !== 'true';
    });
  }
  function moveActive(menu, dir) {
    var list = menuItems(menu);
    if (!list.length) return;
    var cur = list.indexOf(menu.querySelector('[data-active]'));
    var next = dir === 'first' ? 0 : dir === 'last' ? list.length - 1 : (cur + dir + list.length) % list.length;
    if (cur < 0 && dir === -1) next = list.length - 1;
    list.forEach(function (n) {
      n.removeAttribute('data-active');
    });
    list[next].setAttribute('data-active', '');
    list[next].scrollIntoView({ block: 'nearest' });
  }
  function activate(item) {
    var menu = item.closest('.ss-menu, .ss-pop');
    var role = item.getAttribute('role');
    if (role === 'menuitemradio' || item.classList.contains('ss-model')) {
      var scope = item.closest('[data-radio-group]') || menu;
      scope.querySelectorAll('[role="menuitemradio"], .ss-model').forEach(function (n) {
        n.setAttribute(n.classList.contains('ss-model') ? 'aria-selected' : 'aria-checked', 'false');
      });
      item.setAttribute(item.classList.contains('ss-model') ? 'aria-selected' : 'aria-checked', 'true');
      var trigger = open && open.trigger;
      var label = item.getAttribute('data-label');
      if (trigger && label != null) {
        var slot = trigger.querySelector('[data-slot="value"]');
        if (slot) slot.textContent = label;
      }
      if (trigger && item.hasAttribute('data-trigger-class')) {
        trigger.className = item.getAttribute('data-trigger-class');
        var ic = trigger.querySelector('svg.ss-i');
        var name = item.getAttribute('data-icon');
        if (ic && name) ic.outerHTML = icon(name);
        var composer = document.querySelector('.ss-composer');
        if (composer) composer.setAttribute('data-mode', item.getAttribute('data-mode') || '');
      }
    }
    var action = item.getAttribute('data-action');
    if (action && SS.actions[action]) SS.actions[action](item);
    if (menu && menu.classList.contains('ss-menu')) closeOverlay(true);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    var m = t.closest('[data-menu]');
    if (m) {
      e.preventDefault();
      var menu = document.querySelector(m.getAttribute('data-menu'));
      if (open && open.trigger === m) closeOverlay(true);
      else openOverlay(menu, m, { kind: 'menu', keyboard: e.detail === 0 });
      return;
    }
    var p = t.closest('[data-pop]');
    if (p) {
      e.preventDefault();
      var pop = document.querySelector(p.getAttribute('data-pop'));
      if (open && open.trigger === p) closeOverlay(true);
      else openOverlay(pop, p, { kind: 'pop', keyboard: e.detail === 0 });
      return;
    }
    var item = t.closest('.ss-menu__item, .ss-model');
    if (item && item.getAttribute('aria-disabled') !== 'true') {
      activate(item);
      return;
    }
    var seg = t.closest('.ss-seg > button');
    if (seg) {
      Array.prototype.forEach.call(seg.parentElement.children, function (b) {
        b.setAttribute('aria-pressed', b === seg ? 'true' : 'false');
      });
    }
    var tab = t.closest('.ss-tab');
    if (tab) {
      Array.prototype.forEach.call(tab.parentElement.querySelectorAll('.ss-tab'), function (b) {
        b.setAttribute('aria-selected', b === tab ? 'true' : 'false');
      });
    }
    var tw = t.closest('.ss-tree-row__twisty');
    if (tw) {
      var row = tw.closest('.ss-tree-row');
      var expanded = row.getAttribute('aria-expanded') !== 'false';
      row.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      var group = row.nextElementSibling;
      if (group && group.classList.contains('ss-tree')) group.hidden = expanded;
      return;
    }
    var tg = t.closest('[data-toggle]');
    if (tg) {
      var sel = tg.getAttribute('data-toggle');
      var target = sel === 'next' ? tg.nextElementSibling : document.querySelector(sel);
      var on = tg.getAttribute('aria-expanded') === 'true';
      tg.setAttribute('aria-expanded', on ? 'false' : 'true');
      if (target) target.hidden = on;
    }
    var all = t.closest('[data-toggle-all]');
    if (all) {
      var scopeEl = all.closest(all.getAttribute('data-toggle-all')) || document;
      var expand = all.getAttribute('aria-expanded') !== 'true';
      all.setAttribute('aria-expanded', expand ? 'true' : 'false');
      scopeEl.querySelectorAll('[data-toggle="next"]').forEach(function (b) {
        b.setAttribute('aria-expanded', expand ? 'true' : 'false');
        if (b.nextElementSibling) b.nextElementSibling.hidden = !expand;
      });
    }
    var dlg = t.closest('[data-dialog]');
    if (dlg) openDialog(document.querySelector(dlg.getAttribute('data-dialog')), dlg);
    var close = t.closest('[data-close]');
    if (close) closeDialog(close.closest('.ss-scrim'));
    if (t.classList && t.classList.contains('ss-scrim') && !t.hasAttribute('data-dirty')) closeDialog(t);
    var sel1 = t.closest('[data-selectable] > .ss-list-row, [data-selectable] tbody > tr');
    if (sel1 && !t.closest('button, input, a, label')) {
      Array.prototype.forEach.call(sel1.parentElement.children, function (r) {
        r.setAttribute('aria-selected', r === sel1 ? 'true' : 'false');
      });
      sel1.parentElement.dispatchEvent(new CustomEvent('ss-select', { detail: sel1, bubbles: true }));
    }
    var send = t.closest('[data-send-demo]');
    if (send) toggleSend(send);
    var clear = t.closest('[data-batch-clear]');
    if (clear) setBatch(clear.closest('[data-batch]'), false);
  });

  document.addEventListener(
    'pointerdown',
    function (e) {
      hideTip(false);
      if (!open) return;
      if (open.el.contains(e.target)) return;
      if (open.trigger && open.trigger.contains(e.target)) return;
      closeOverlay(false);
    },
    true,
  );

  // The browser's own context menu stays only in text fields and on selected text.
  document.addEventListener('contextmenu', function (e) {
    var t = e.target.closest && e.target.closest('[data-ctx]');
    if (t) {
      e.preventDefault();
      openOverlay(document.querySelector(t.getAttribute('data-ctx')), t, {
        kind: 'menu',
        point: { x: e.clientX, y: e.clientY },
      });
      return;
    }
    var editable = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    var selected = window.getSelection && String(window.getSelection()).trim();
    if (!editable && !selected) e.preventDefault();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        closeOverlay(true);
        return;
      }
      var d = topDialog();
      if (d && !d.hasAttribute('data-dirty')) {
        e.preventDefault();
        closeDialog(d);
        return;
      }
      hideTip(false);
      return;
    }
    var trig = e.target.closest && e.target.closest('[data-menu]');
    if (!open && trig && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openOverlay(document.querySelector(trig.getAttribute('data-menu')), trig, {
        kind: 'menu',
        keyboard: true,
      });
      return;
    }
    if (open && open.kind === 'menu') {
      if (e.key === 'ArrowDown') moveActive(open.el, 1);
      else if (e.key === 'ArrowUp') moveActive(open.el, -1);
      else if (e.key === 'Home') moveActive(open.el, 'first');
      else if (e.key === 'End') moveActive(open.el, 'last');
      else if (e.key === 'Enter' || e.key === ' ') {
        var act = open.el.querySelector('[data-active]');
        if (act) activate(act);
      } else if (e.key === 'Tab') {
        closeOverlay(false);
        return;
      } else return;
      e.preventDefault();
    }
    var d2 = topDialog();
    if (d2 && e.key === 'Tab') trapFocus(d2, e);
  });

  // ---------- Dialogs ----------
  function topDialog() {
    var list = document.querySelectorAll('.ss-scrim:not([hidden])');
    return list.length ? list[list.length - 1] : null;
  }
  function openDialog(scrim, trigger) {
    if (!scrim) return;
    closeOverlay(false);
    scrim.hidden = false;
    scrim._trigger = trigger || null;
    var f = scrim.querySelector('[autofocus], input, textarea, .ss-btn--primary');
    if (f) f.focus();
  }
  function closeDialog(scrim) {
    if (!scrim) return;
    scrim.hidden = true;
    if (scrim._trigger) scrim._trigger.focus({ preventScroll: true });
  }
  function trapFocus(scrim, e) {
    var f = scrim.querySelectorAll('button, input, textarea, [tabindex="0"]');
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------- Splitters: follow the pointer, clamp, remember the width ----------
  function load(key) {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch (err) {
      return 0;
    }
  }
  function save(key, value) {
    if (!key) return;
    try {
      localStorage.setItem(key, String(Math.round(value)));
    } catch (err) {
      /* storage unavailable: the width simply is not remembered */
    }
  }
  function initSplitter(s) {
    if (s.hasAttribute('data-ready')) return;
    s.setAttribute('data-ready', '');
    var target = s.parentElement;
    var dir = s.classList.contains('ss-splitter--start') ? -1 : 1;
    var min = Number(s.getAttribute('data-min')) || 200;
    var max = Number(s.getAttribute('data-max')) || 640;
    var def = Number(s.getAttribute('data-default')) || target.getBoundingClientRect().width;
    var key = s.getAttribute('data-key') ? 'ss-split:' + s.getAttribute('data-key') : null;
    function clamp(w) {
      return Math.max(min, Math.min(max, Math.round(w)));
    }
    function apply(w) {
      target.style.width = w + 'px';
      s.setAttribute('aria-valuenow', String(w));
    }
    s.tabIndex = 0;
    s.setAttribute('role', 'separator');
    s.setAttribute('aria-orientation', 'vertical');
    s.setAttribute('aria-valuemin', String(min));
    s.setAttribute('aria-valuemax', String(max));
    s.setAttribute('data-tip', s.getAttribute('data-tip') || '拖动调整宽度，双击恢复默认');
    var saved = key && load(key);
    if (saved) apply(clamp(saved));
    s.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      hideTip(false);
      s.setPointerCapture(e.pointerId);
      s.setAttribute('data-dragging', '');
      document.documentElement.setAttribute('data-resizing', '');
      var startX = e.clientX;
      var startW = target.getBoundingClientRect().width;
      var nextW = startW;
      var frame = 0;
      function move(ev) {
        nextW = clamp(startW + dir * (ev.clientX - startX));
        if (!frame)
          frame = requestAnimationFrame(function () {
            frame = 0;
            apply(nextW);
          });
      }
      function up() {
        s.removeEventListener('pointermove', move);
        s.removeEventListener('pointerup', up);
        s.removeEventListener('pointercancel', up);
        s.removeAttribute('data-dragging');
        document.documentElement.removeAttribute('data-resizing');
        apply(nextW);
        save(key, nextW);
      }
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', up);
      s.addEventListener('pointercancel', up);
    });
    s.addEventListener('dblclick', function () {
      apply(clamp(def));
      save(key, def);
    });
    s.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowRight' ? 1 : -1) * dir;
      var w = clamp(target.getBoundingClientRect().width + step);
      apply(w);
      save(key, w);
    });
  }

  // ---------- Sliders ----------
  function updateSlider(r) {
    var p = ((r.value - r.min) / (r.max - r.min)) * 100;
    r.style.setProperty('--p', p + '%');
    var out = r.parentElement.querySelector('output');
    if (out) out.textContent = r.value + (r.getAttribute('data-unit') || '');
  }
  document.addEventListener('input', function (e) {
    if (e.target.matches && e.target.matches('.ss-slider > input[type="range"]')) updateSlider(e.target);
  });

  // ---------- Batch selection (review queues) ----------
  // [data-batch] wraps a toolbar and a list. Checking any [data-batch-item]
  // sets data-has-selection on it, which swaps [data-batch-hide] for
  // [data-batch-show] and fills [data-slot="count"].
  function updateBatch(box) {
    var items = box.querySelectorAll('[data-batch-item]');
    var n = 0;
    items.forEach(function (c) {
      if (c.checked) n++;
      var row = c.closest('.ss-list-row');
      if (row) row.toggleAttribute('data-checked', c.checked);
    });
    box.toggleAttribute('data-has-selection', n > 0);
    box.querySelectorAll('[data-slot="count"]').forEach(function (el) {
      el.textContent = n;
    });
    var all = box.querySelector('[data-batch-all]');
    if (all) {
      all.checked = n > 0 && n === items.length;
      all.indeterminate = n > 0 && n < items.length;
    }
  }
  function setBatch(box, on) {
    if (!box) return;
    box.querySelectorAll('[data-batch-item]').forEach(function (c) {
      c.checked = on;
    });
    updateBatch(box);
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    var box = t.closest && t.closest('[data-batch]');
    if (!box) return;
    if (t.hasAttribute('data-batch-all')) setBatch(box, t.checked);
    else if (t.hasAttribute('data-batch-item')) updateBatch(box);
  });

  // ---------- Send / stop demo ----------
  function toggleSend(btn) {
    var running = btn.getAttribute('data-state') === 'running';
    btn.setAttribute('data-state', running ? 'ready' : 'running');
    btn.innerHTML = running ? icon('arrow-up') : '<span class="ss-send__stop"></span>';
    btn.setAttribute('aria-label', running ? '发送' : '停止');
    btn.setAttribute('data-tip', running ? '发送' : '停止');
    btn.setAttribute('data-kbd', running ? 'Enter' : 'Esc');
    var status = document.querySelector('[data-send-status]');
    if (status) status.hidden = running;
  }

  // ---------- Drag a chat into a project ----------
  var dragged = null;
  document.addEventListener('dragstart', function (e) {
    var row = e.target.closest && e.target.closest('[data-drag="chat"]');
    if (!row) return;
    dragged = row;
    row.setAttribute('data-dragging', '');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.textContent.trim());
  });
  document.addEventListener('dragend', function () {
    if (dragged) dragged.removeAttribute('data-dragging');
    dragged = null;
    document.querySelectorAll('[data-drop]').forEach(function (n) {
      n.removeAttribute('data-drop');
    });
  });
  document.addEventListener('dragover', function (e) {
    var target = dragged && e.target.closest && e.target.closest('[data-drop-target]');
    document.querySelectorAll('[data-drop]').forEach(function (n) {
      if (n !== target) n.removeAttribute('data-drop');
    });
    if (!target) return;
    e.preventDefault();
    target.setAttribute('data-drop', '');
  });
  document.addEventListener('drop', function (e) {
    var target = dragged && e.target.closest && e.target.closest('[data-drop-target]');
    if (!target) return;
    e.preventDefault();
    var group = target.nextElementSibling;
    if (group && group.classList.contains('ss-tree')) {
      dragged.classList.remove('ss-tree-row--leaf');
      dragged.classList.add('ss-tree-row--child');
      dragged.removeAttribute('data-drag');
      dragged.removeAttribute('draggable');
      group.appendChild(dragged);
      target.setAttribute('aria-expanded', 'true');
      group.hidden = false;
    }
    toast('已移到「' + target.querySelector('.ss-tree-row__label').textContent + '」', { action: '撤销' });
  });

  // ---------- Toast ----------
  function toast(message, opts) {
    opts = opts || {};
    var region = document.querySelector('.ss-toasts');
    if (!region) {
      region = document.createElement('div');
      region.className = 'ss-toasts';
      region.setAttribute('role', 'status');
      document.body.appendChild(region);
    }
    var el = document.createElement('div');
    el.className = 'ss-toast';
    if (opts.tone) el.setAttribute('data-tone', opts.tone);
    var name = opts.tone === 'danger' ? 'circle-alert' : opts.tone === 'warn' ? 'triangle-alert' : 'circle-check';
    el.innerHTML =
      icon(name) + '<span class="ss-toast__msg"></span>' +
      (opts.action ? '<button class="ss-btn ss-btn--ghost ss-btn--sm" type="button"></button>' : '') +
      '<button class="ss-icon-btn ss-icon-btn--sm" type="button" aria-label="关闭">' + icon('x') + '</button>';
    el.querySelector('.ss-toast__msg').textContent = message;
    if (opts.action) el.querySelector('.ss-btn').textContent = opts.action;
    el.addEventListener('click', function (e) {
      if (e.target.closest('button')) el.remove();
    });
    region.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, opts.action ? 6000 : 4000);
  }

  // ---------- Command palette demo ----------
  function initPalette(root) {
    root.querySelectorAll('.ss-cmd').forEach(function (cmd) {
      if (cmd.hasAttribute('data-ready')) return;
      cmd.setAttribute('data-ready', '');
      var input = cmd.querySelector('.ss-cmd__input > input');
      var items = Array.prototype.slice.call(cmd.querySelectorAll('.ss-cmd__item'));
      function visible() {
        return items.filter(function (n) {
          return !n.hidden;
        });
      }
      function setActive(n) {
        items.forEach(function (x) {
          x.removeAttribute('data-active');
        });
        if (n) {
          n.setAttribute('data-active', '');
          n.scrollIntoView({ block: 'nearest' });
        }
      }
      if (input)
        input.addEventListener('input', function () {
          var q = input.value.trim().toLowerCase();
          items.forEach(function (n) {
            n.hidden = q && n.textContent.toLowerCase().indexOf(q) < 0;
          });
          cmd.querySelectorAll('.ss-cmd__group').forEach(function (g) {
            var next = g.nextElementSibling;
            var any = false;
            while (next && !next.classList.contains('ss-cmd__group')) {
              if (!next.hidden) any = true;
              next = next.nextElementSibling;
            }
            g.hidden = !any;
          });
          setActive(visible()[0]);
        });
      cmd.addEventListener('keydown', function (e) {
        var list = visible();
        var cur = list.indexOf(cmd.querySelector('.ss-cmd__item[data-active]'));
        if (e.key === 'ArrowDown') setActive(list[Math.min(cur + 1, list.length - 1)]);
        else if (e.key === 'ArrowUp') setActive(list[Math.max(cur - 1, 0)]);
        else if (e.key === 'Enter' && list[cur]) {
          toast('打开「' + list[cur].querySelector('span').textContent + '」');
          var s = cmd.closest('.ss-scrim');
          if (s) closeDialog(s);
        } else return;
        e.preventDefault();
      });
    });
  }

  // ---------- Mount (idempotent) ----------
  function mount(root) {
    root = root || document.body;
    hydrate(root);
    root.querySelectorAll('.ss-splitter').forEach(initSplitter);
    root.querySelectorAll('.ss-slider > input[type="range"]').forEach(updateSlider);
    root.querySelectorAll('[data-batch]').forEach(updateBatch);
    initPalette(root);
  }

  var SS = {
    icon: icon,
    logo: logo,
    ring: ring,
    icons: ICONS,
    iconGroups: ICON_GROUPS,
    place: place,
    mount: mount,
    toast: toast,
    openDialog: openDialog,
    closeDialog: closeDialog,
    closeOverlay: closeOverlay,
    actions: {
      toast: function (item) {
        toast(item.getAttribute('data-message') || item.textContent.trim());
      },
    },
  };
  window.SS = SS;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount(document.body);
    });
  } else if (document.body) {
    mount(document.body);
  }
})();
