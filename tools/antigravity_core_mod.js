/**
 * Antigravity Core Enhancements:
 * Real-Time Token, Speed & Performance Monitor (Updated for Antigravity 2.32+ / Electron 44+)
 * Displays turns, steps, tok/s, context size, cache hit rate, and model-aware context window %.
 */

(function () {
  if (typeof window === 'undefined') return;

  // Clean up any old intervals/listeners if re-injected
  if (window.__antigravity_core_mod_installed) {
    try {
      if (window.__antigravity_stats_interval) {
        clearInterval(window.__antigravity_stats_interval);
      }
      if (window.__antigravity_visibility_handler) {
        document.removeEventListener('visibilitychange', window.__antigravity_visibility_handler);
      }
      if (window.__antigravity_blur_handler) {
        window.removeEventListener('blur', window.__antigravity_blur_handler);
      }
      if (window.__antigravity_focus_handler) {
        window.removeEventListener('focus', window.__antigravity_focus_handler);
      }
      if (window.__antigravity_done_timer) {
        clearTimeout(window.__antigravity_done_timer);
      }
      if (window.__antigravity_menu_outside_click) {
        document.removeEventListener('mousedown', window.__antigravity_menu_outside_click, true);
      }
      if (window.__antigravity_menu_keydown) {
        document.removeEventListener('keydown', window.__antigravity_menu_keydown, true);
      }
      if (window.__antigravity_nav_handler) {
        window.removeEventListener('popstate', window.__antigravity_nav_handler);
        window.removeEventListener('hashchange', window.__antigravity_nav_handler);
        window.__antigravity_nav_handler = null;
      }
      if (window.__antigravity_nav_click_handler) {
        document.removeEventListener('click', window.__antigravity_nav_click_handler, true);
        window.__antigravity_nav_click_handler = null;
      }
      if (window.__antigravity_orig_pushState) {
        window.history.pushState = window.__antigravity_orig_pushState;
      }
      if (window.__antigravity_orig_replaceState) {
        window.history.replaceState = window.__antigravity_orig_replaceState;
      }
      if (window.__antigravity_sidebar_hover_el && window.__antigravity_sidebar_hover_fn) {
        try {
          window.__antigravity_sidebar_hover_el.removeEventListener('mouseover', window.__antigravity_sidebar_hover_fn, { passive: true });
          if (window.__antigravity_sidebar_hover_el.dataset) {
            delete window.__antigravity_sidebar_hover_el.dataset.agyHoverWired;
          }
        } catch (_) {}
        window.__antigravity_sidebar_hover_el = null;
        window.__antigravity_sidebar_hover_fn = null;
      }
      const oldMilkStyle = document.getElementById('antigravity-milk-style');
      if (oldMilkStyle) oldMilkStyle.remove();
      const oldChatFrame = document.getElementById('agy-milk-chat-frame');
      if (oldChatFrame) oldChatFrame.remove();
      const oldWpLayer = document.getElementById('antigravity-wallpaper-layer');
      if (oldWpLayer) oldWpLayer.remove();
      const oldStatsBar = document.getElementById('antigravity-token-stats-bar');
      if (oldStatsBar) oldStatsBar.remove();
      const oldWpMenu = document.getElementById('antigravity-wallpaper-menu');
      if (oldWpMenu) oldWpMenu.remove();
      const oldWpCtrl = document.getElementById('antigravity-wallpaper-ctrl');
      if (oldWpCtrl) oldWpCtrl.remove();
      const oldSwarmCorner = document.getElementById('antigravity-swarm-corner-btn');
      if (oldSwarmCorner) oldSwarmCorner.remove();
      const oldCornerDock = document.getElementById('antigravity-corner-dock');
      if (oldCornerDock) oldCornerDock.remove();
      const leftoverPopover = document.getElementById('antigravity-token-popover');
      if (leftoverPopover) leftoverPopover.remove();
      const leftoverSwarm = document.getElementById('antigravity-swarm-modal');
      if (leftoverSwarm) leftoverSwarm.remove();
      if (window.__antigravity_wallpaper_timer) {
        clearInterval(window.__antigravity_wallpaper_timer);
      }
      if (window.__antigravity_overview_observer) {
        window.__antigravity_overview_observer.disconnect();
        window.__antigravity_overview_observer = null;
      }
      if (window.__antigravity_overview_debounce) {
        clearTimeout(window.__antigravity_overview_debounce);
        window.__antigravity_overview_debounce = 0;
      }
      if (typeof window.__antigravity_stop_fx === 'function') {
        window.__antigravity_stop_fx(true);
      }
    } catch (_) {}
  }
  window.__antigravity_core_mod_installed = true;

  const DEFAULT_ZERO_STATS = {
    turns: 0,
    steps: 0,
    plannerSteps: 0,
    speed: 0,
    speedHistory: [],
    contextTokens: '0',
    rawContextTokens: 0,
    lastInput: '0',
    lastCache: '0',
    sessionInput: '0',
    sessionCache: '0',
    totalOutput: '0',
    grandTotalTokens: '0',
    chatTotalTokens: '0',
    subagentTotalTokens: '0',
    subagentCount: 0,
    subagents: [],
    swarmRoot: null,
    grandTotalRaw: 0,
    totalWorkTime: '0s',
    chatWorkTime: '0s',
    subagentWorkTime: '0s',
    totalWorkTimeSec: 0,
    cacheHit: 0,
    sessionCacheHit: 0,
    percent: 0,
    exactPercent: 0,
    modelLimitLabel: '1M',
    apiCost: '$0.00',
    apiCostRaw: 0,
    apiCostChat: '$0.00',
    apiCostSubagents: '$0.00',
    apiCostInput: '$0.00',
    apiCostCache: '$0.00',
    apiCostOutput: '$0.00',
    pricingLabel: '',
    contextInspector: {
      summary: { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, approxTokens: '0' },
      topTools: [],
      files: []
    },
    hasTokens: false
  };

  let lastStatsData = { ...DEFAULT_ZERO_STATS };
  let currentActiveConvId = null;
  let isMountingBar = false;
  let pendingEnsureTokenBar = false;
  let popoverActiveTab = 'overview'; // 'overview' | 'context'
  let selectedSwarmNodeId = null;
  let swarmZoom = 1;
  let swarmPanX = 0;
  let swarmPanY = 0;
  let swarmInitializedView = false;
  let swarmIsDragging = false;

  let agentVisualState = 'idle'; // 'idle' | 'thinking' | 'done'
  let agentDoneUntilMs = 0;
  let agentActivityBumpMs = 0;
  let agentStatsBaselineConvId = null;
  let agentLastSteps = 0;
  let agentLastOutput = '';
  let isWindowBlurred = false;
  let swarmPrevFocusEl = null;
  let popoverPrevFocusEl = null;
  let wpPrevFocusEl = null;
  let wpMenuActiveTab = 'scenes'; // 'scenes' | 'fx'
  let copyFeedbackKey = '';
  let copyFeedbackUntilMs = 0;
  let lastOverviewTreeWalkMs = 0;

  function isAppInactive() {
    return Boolean(document.hidden || isWindowBlurred);
  }

  function isReducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function agyIcon(name, size = 13) {
    const base = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;display:inline-block;vertical-align:middle;"`;
    switch (name) {
      case 'pin':
        return `<svg ${base}><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
      case 'pause':
        return `<svg ${base}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
      case 'play':
        return `<svg ${base}><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
      case 'refresh':
        return `<svg ${base}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
      case 'folder':
        return `<svg ${base}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`;
      case 'copy':
        return `<svg ${base}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      case 'check':
        return `<svg ${base}><polyline points="20 6 9 17 4 12"/></svg>`;
      case 'network':
        return `<svg ${base}><circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.3 11.1 16.7 6.9"/><path d="M7.3 12.9 16.7 17.1"/></svg>`;
      default:
        return '';
    }
  }

  function cssAttrEscape(val) {
    const s = String(val == null ? '' : val);
    return (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape(s)
      : s.replace(/["\\]/g, '\\$&');
  }

  function captureFocusDescriptor(root) {
    try {
      if (!root || typeof root.contains !== 'function') return null;
      const active = document.activeElement;
      if (!active || active === document.body || !root.contains(active)) return null;
      if (active.id) return `#${cssAttrEscape(active.id)}`;
      const attrs = [
        'data-swarm-node',
        'data-pop-tab',
        'data-wp-tab',
        'data-wp-file',
        'data-pin-scope',
        'data-greeting-mode',
        'data-fx-key',
        'data-sub-id',
        'data-file-path',
        'data-wp-action'
      ];
      for (const attr of attrs) {
        const v = active.getAttribute && active.getAttribute(attr);
        if (v !== null && v !== '') return `[${attr}="${cssAttrEscape(v)}"]`;
      }
    } catch (_) {}
    return null;
  }

  function restoreFocusDescriptor(root, selector) {
    if (!root || !selector || typeof root.querySelector !== 'function') return false;
    try {
      const target = root.querySelector(selector);
      if (target && typeof target.focus === 'function') {
        try {
          target.focus({ preventScroll: true });
        } catch (_) {
          target.focus();
        }
        return true;
      }
    } catch (_) {}
    return false;
  }

  function wireTablistArrowKeys(tablistRoot) {
    if (!tablistRoot || typeof tablistRoot.querySelectorAll !== 'function') return;
    const tabs = Array.from(tablistRoot.querySelectorAll('[role="tab"]'));
    if (tabs.length < 2) return;
    tabs.forEach((tb, idx) => {
      tb.onkeydown = (e) => {
        if (!e) return;
        let nextIdx = -1;
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = tabs.length - 1;
        if (nextIdx >= 0) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          const targetTab = tabs[nextIdx];
          if (targetTab) {
            // Focus targetTab before click() so captureFocusDescriptor preserves focus on the new tab across re-render
            if (typeof targetTab.focus === 'function') {
              try { targetTab.focus({ preventScroll: true }); } catch (_) { try { targetTab.focus(); } catch (__) {} }
            }
            if (typeof targetTab.click === 'function') targetTab.click();
          }
        }
      };
    });
  }

  function isCopyFeedbackActive(key) {
    return Boolean(key && copyFeedbackKey === key && Date.now() < copyFeedbackUntilMs);
  }

  function triggerCopyFeedback(key, ms, rerenderFn) {
    copyFeedbackKey = key || '';
    copyFeedbackUntilMs = Date.now() + (ms || 1150);
    setTimeout(() => {
      if (copyFeedbackKey === key && Date.now() >= copyFeedbackUntilMs - 20) {
        copyFeedbackKey = '';
        copyFeedbackUntilMs = 0;
        if (typeof rerenderFn === 'function') rerenderFn();
      }
    }, ms || 1150);
  }

  function hasDomStopIndicator(box) {
    const selectors = 'button[aria-label*="Stop" i], button[aria-label*="Cancel" i], button[title*="Stop" i], button[title*="Cancel" i], [data-testid*="stop" i]';
    try {
      if (box && typeof box.querySelector === 'function' && box.querySelector(selectors)) {
        return true;
      }
      const parent = box && box.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement && typeof parent.querySelector === 'function') {
        const hit = parent.querySelector(selectors);
        if (hit && (!hit.closest || !hit.closest('#antigravity-wallpaper-menu, #antigravity-token-popover, #antigravity-swarm-modal'))) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function syncAgentStateOnUi(box, stats) {
    const now = Date.now();
    const convId = getConversationIdFromLocation();
    if (!convId) {
      agentStatsBaselineConvId = null;
      agentLastSteps = 0;
      agentLastOutput = '';
      agentActivityBumpMs = 0;
    } else if (stats && typeof stats.turns === 'number') {
      if (agentStatsBaselineConvId !== convId) {
        agentStatsBaselineConvId = convId;
        agentLastSteps = stats.steps || 0;
        agentLastOutput = stats.totalOutput || '';
        agentActivityBumpMs = 0;
      } else {
        if ((stats.steps || 0) > agentLastSteps || (stats.totalOutput || '') !== agentLastOutput) {
          agentActivityBumpMs = now;
        }
        agentLastSteps = stats.steps || 0;
        agentLastOutput = stats.totalOutput || '';
      }
    }

    const isThinking = Boolean(
      hasDomStopIndicator(box)
      || (agentActivityBumpMs > 0 && (now - agentActivityBumpMs) < 2400)
    );

    if (isThinking) {
      agentVisualState = 'thinking';
    } else {
      agentVisualState = 'idle';
    }
    agentDoneUntilMs = 0;
    if (window.__antigravity_done_timer) {
      clearTimeout(window.__antigravity_done_timer);
      window.__antigravity_done_timer = 0;
    }

    const targetBox = box || findInputBox();
    if (targetBox && targetBox.classList) {
      if (agentVisualState === 'thinking') {
        targetBox.classList.add('agy-milk-thinking');
      } else {
        targetBox.classList.remove('agy-milk-thinking');
      }
      targetBox.classList.remove('agy-milk-done');
    }
    return agentVisualState;
  }

  function escapeAttr(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getConversationIdFromLocation() {
    const pathname = window.location.pathname || '';
    const match = pathname.match(/\/c\/([a-zA-Z0-9_\-]+)/);
    if (match && match[1] && match[1] !== 'new') {
      return match[1];
    }

    try {
      const hash = window.location.hash || '';
      const hashMatch = hash.match(/\/c\/([a-zA-Z0-9_\-]+)/);
      if (hashMatch && hashMatch[1] && hashMatch[1] !== 'new') {
        return hashMatch[1];
      }
    } catch (_) {}

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryId = urlParams.get('conversationId') || urlParams.get('c');
      if (queryId && queryId !== 'new') return queryId;
    } catch (_) {}

    return null;
  }

  function findInputBox() {
    const direct = document.getElementById('antigravity.agentSidePanelInputBox')
      || document.querySelector('[data-testid="agent-input-box"]')
      || document.querySelector('.bg-card-border.rounded-2xl');
    if (direct) return direct;

    const container = document.querySelector('div.flex.flex-col.w-full.shrink-0');
    if (!container) return null;

    const children = Array.from(container.children).filter(
      (el) => el && el.id !== 'antigravity-token-stats-bar'
    );
    return children.length > 0 ? children[children.length - 1] : null;
  }

  let lastKnownModelName = '';

  function looksLikeFileOrPathLabel(text) {
    // e.g. "argon_notes.md", "src/flash.ts", "C:\\pro\\x" - attachment chips, not the model picker.
    // Note: extension must start with a letter ([a-z]) with no whitespace before '.', so version numbers like "Gemini 3.8 Flash" are never rejected.
    return /[\\/]/.test(text) || /\S\.[a-z][a-z0-9]{0,5}$/i.test(text);
  }

  function getActiveModelName(box) {
    try {
      const targetBox = box || findInputBox();
      if (!targetBox) return lastKnownModelName;
      const scopes = [targetBox];
      if (targetBox.parentElement) scopes.push(targetBox.parentElement);
      const modelPattern = /\b(hydrogen|neon|argon|carbon|3\.8\s*flash|gemini\s*3\.8|flash)\b/i;
      let firstMatch = '';
      for (const scope of scopes) {
        if (!scope || typeof scope.querySelectorAll !== 'function') continue;
        const buttons = scope.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.closest && btn.closest('#antigravity-token-stats-bar, #antigravity-wallpaper-menu, #antigravity-wallpaper-ctrl, #antigravity-corner-dock')) {
            continue;
          }
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || text.length < 2 || text.length > 48 || !modelPattern.test(text)) continue;
          if (looksLikeFileOrPathLabel(text)) continue;
          // A real model picker is a dropdown trigger: prefer it over any other lookalike button
          const isDropdownTrigger = Boolean(btn.getAttribute && (btn.getAttribute('aria-haspopup') || btn.hasAttribute('aria-expanded')));
          if (isDropdownTrigger) {
            lastKnownModelName = text;
            return text;
          }
          if (!firstMatch) firstMatch = text;
        }
      }
      if (firstMatch) {
        lastKnownModelName = firstMatch;
        return firstMatch;
      }
    } catch (_) {}
    return lastKnownModelName;
  }

  function isLightSurface() {
    try {
      const bg = window.getComputedStyle(document.body).backgroundColor;
      const m = bg && bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\s*\)/i);
      if (m && (m[4] === undefined || parseFloat(m[4]) > 0.05)) {
        const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
        return lum > 0.55;
      }
    } catch (_) {}
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch (_) {
      return false;
    }
  }

  function isMilkWallpaperActive() {
    const layer = typeof document.getElementById === 'function' ? document.getElementById('antigravity-wallpaper-layer') : null;
    return Boolean(layer && layer.style && layer.style.display !== 'none' && wallpaperFiles.length > 0);
  }

  function syncSurfaceThemeClass() {
    try {
      const root = document.documentElement;
      if (!root || !root.classList) return;
      const light = !isMilkWallpaperActive() && isLightSurface();
      root.classList.toggle('agy-light-surface', light);
    } catch (_) {}
  }

  async function fetchStats(modelName) {
    const convId = getConversationIdFromLocation();

    if (convId !== currentActiveConvId) {
      currentActiveConvId = convId;
      lastStatsData = { ...DEFAULT_ZERO_STATS };
    }

    if (!convId || convId === 'new') {
      currentActiveConvId = null;
      lastStatsData = { ...DEFAULT_ZERO_STATS };
      return lastStatsData;
    }

    try {
      if (window.antigravityTokenBridge && typeof window.antigravityTokenBridge.getStats === 'function') {
        const res = await window.antigravityTokenBridge.getStats(convId, modelName);
        if (getConversationIdFromLocation() !== convId) {
          currentActiveConvId = null;
          lastStatsData = { ...DEFAULT_ZERO_STATS };
          return lastStatsData;
        }
        if (res && typeof res.turns === 'number') {
          const hasTokens = typeof res.hasTokens === 'boolean'
            ? res.hasTokens
            : (res.contextTokens !== '0' && res.contextTokens !== 0 && res.contextTokens !== undefined);
          const exactPercent = typeof res.exactPercent === 'number' ? res.exactPercent : (res.percent || 0);
          lastStatsData = { ...DEFAULT_ZERO_STATS, ...res, hasTokens, exactPercent };
          return lastStatsData;
        }
      }
    } catch (_) {}
    return lastStatsData;
  }

  async function ensureTokenBar() {
    if (document.hidden) return;
    if (isMountingBar) {
      pendingEnsureTokenBar = true;
      return;
    }
    const box = findInputBox();
    if (!box || !box.parentElement) return;

    isMountingBar = true;
    try {
      let bar = document.getElementById('antigravity-token-stats-bar');
      const modelName = getActiveModelName(box);
      const stats = await fetchStats(modelName);
      const light = !isMilkWallpaperActive() && isLightSurface();
      syncSurfaceThemeClass();
      const palette = light
        ? {
            muted: '#52525b',
            strong: '#18181b',
            pillBg: 'rgba(0, 0, 0, 0.05)',
            pillBorder: 'rgba(0, 0, 0, 0.14)',
            track: 'rgba(0, 0, 0, 0.14)',
            barBg: 'rgba(248, 248, 250, 0.90)',
            barBorder: 'rgba(0, 0, 0, 0.09)'
          }
        : {
            muted: 'rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.80)',
            strong: '#f8f0e8',
            pillBg: 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.16)',
            pillBorder: 'rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.46)',
            track: 'rgba(248, 224, 192, 0.16)',
            barBg: 'rgba(9, 10, 16, 0.84)',
            barBorder: 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.38)'
          };

      const convIdNow = getConversationIdFromLocation();
      const isIdleHome = !convIdNow && !stats.hasTokens && (stats.turns || 0) === 0 && (stats.steps || 0) === 0;

      const statsHash = [
        stats.turns,
        stats.steps,
        stats.plannerSteps,
        stats.speed,
        stats.contextTokens,
        stats.lastInput,
        stats.lastCache,
        stats.totalOutput,
        stats.grandTotalTokens,
        stats.subagentCount,
        stats.totalWorkTimeSec,
        stats.cacheHit,
        stats.sessionCacheHit,
        stats.percent,
        stats.exactPercent,
        stats.modelLimitLabel,
        stats.apiCost,
        stats.contextInspector && stats.contextInspector.summary ? stats.contextInspector.summary.total : 0,
        stats.hasTokens ? 1 : 0,
        isIdleHome ? 1 : 0,
        light ? 'L' : 'D',
        modelName
      ].join('|');

      if (!bar || box.nextElementSibling !== bar) {
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'antigravity-token-stats-bar';
          bar.style.cssText = [
            'display: flex',
            'align-items: center',
            'justify-content: space-between',
            'width: 100%',
            'margin-top: 4px',
            'padding: 7px 12px',
            'border-radius: 6px',
            `background: ${palette.barBg}`,
            `border: 1px solid ${palette.barBorder}`,
            'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'font-size: 12px',
            'font-variant-numeric: tabular-nums',
            `color: ${palette.muted}`,
            'user-select: none',
            'box-sizing: border-box',
            'line-height: 1.4',
            'position: relative'
          ].join(';');
        }
        box.insertAdjacentElement('afterend', bar);
      }

      if (bar.dataset.statsHash !== statsHash) {
        bar.dataset.statsHash = statsHash;
        bar.style.color = palette.muted;
        bar.style.background = palette.barBg;
        bar.style.borderColor = palette.barBorder;

        const progressColor = getContextProgressColor(stats.percent);
        const percentText = stats.hasTokens && stats.percent === 0 ? '<1%' : `${stats.percent}%`;
        const arcDash = stats.hasTokens ? Math.max(1, Math.min(100, stats.exactPercent || stats.percent)) : 0;

        const leftTitle = escapeAttr(
          `Ходы: ${stats.turns} | Записей в логе: ${stats.steps} (ответов модели: ${stats.plannerSteps}) | Скорость генерации: ${stats.speed} tok/s`
        );
        const midTitle = escapeAttr(
          `Текущий контекст: ${stats.contextTokens} tok (новые: ${stats.lastInput}, кэш: ${stats.lastCache}) | Кэш шага: ${stats.cacheHit}% (за сессию: ${stats.sessionCacheHit}%) | Сгенерировано всего: ${stats.totalOutput}`
        );
        const totalTitle = escapeAttr(
          stats.subagentCount > 0
            ? `Всего прогнано через чат (с субагентами): ${stats.grandTotalTokens} tok | Основной чат: ${stats.chatTotalTokens} | Субагенты (${stats.subagentCount}): ${stats.subagentTotalTokens}`
            : `Всего прогнано через чат: ${stats.grandTotalTokens} tok (включая кэш и генерацию)`
        );
        const subagentSuffix = stats.subagentCount > 0
          ? ` <span style="opacity: 0.75;">(+${stats.subagentCount} sub)</span>`
          : '';
        const pillTitle = escapeAttr(
          `Контекстное окно${modelName ? ` (${modelName})` : ''}: ${stats.contextTokens} tok (${stats.exactPercent}% от лимита ${stats.modelLimitLabel})`
        );
        const workTimeTitle = escapeAttr(
          stats.subagentCount > 0
            ? `Суммарное время работы ИИ (с субагентами): ${stats.totalWorkTime} | Основной чат: ${stats.chatWorkTime} | Субагенты (${stats.subagentCount}): ${stats.subagentWorkTime}`
            : `Время активной работы ИИ в чате: ${stats.totalWorkTime}`
        );
        const costTitle = escapeAttr(
          `Стоимость чата по API (${stats.pricingLabel || modelName || 'Gemini'}): ${stats.apiCost}`
          + ` | Input: ${stats.apiCostInput} · Cache: ${stats.apiCostCache} · Output: ${stats.apiCostOutput}`
          + (stats.subagentCount > 0 ? ` | Чат: ${stats.apiCostChat} · Субагенты: ${stats.apiCostSubagents}` : '')
        );

        const progressArc = stats.hasTokens
          ? `<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${progressColor}" stroke-width="4" stroke-dasharray="${arcDash}, 100" stroke-linecap="round" />`
          : '';

        // Render into a dedicated child container so #antigravity-token-popover (a sibling inside bar)
        // is never detached/re-attached via removeChild/appendChild (which resets scrollTop in Chromium).
        let barContent = bar.querySelector && bar.querySelector('#antigravity-token-bar-content');
        if (!barContent) {
          const keptPopover = document.getElementById('antigravity-token-popover');
          if (keptPopover && keptPopover.parentElement === bar) {
            bar.removeChild(keptPopover);
          }
          bar.innerHTML = '';
          barContent = document.createElement('div');
          barContent.id = 'antigravity-token-bar-content';
          barContent.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px;';
          bar.appendChild(barContent);
          if (keptPopover) {
            bar.appendChild(keptPopover);
          }
        }

        const popOpenNow = Boolean(
          document.getElementById('antigravity-token-popover')
          && document.getElementById('antigravity-token-popover').style
          && document.getElementById('antigravity-token-popover').style.display !== 'none'
        );

        const monoValStyle = `color: ${palette.strong}; font-weight: 600; font-family: var(--agy-font-mono, Consolas, monospace);`;
        const metricsLeftHtml = isIdleHome
          ? `<div style="display: flex; align-items: center; gap: 6px; color: ${palette.muted};">
               <span style="width: 6px; height: 6px; border-radius: 2px; background: rgb(var(--agy-accent-bright-rgb, 255, 68, 82)); opacity: 0.85; display: inline-block;"></span>
               <span>Монитор: новый чат</span>
             </div>`
          : `<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px;">
            <div style="display: flex; align-items: center; gap: 5px;" title="${leftTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: 0.84;">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span><strong style="${monoValStyle}">${stats.turns}</strong> turns <strong style="${monoValStyle}">${stats.steps}</strong> steps · <strong style="${monoValStyle}">${stats.speed}</strong> tok/s</span>
            </div>

            <div style="display: flex; align-items: center; gap: 5px;" title="${midTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: 0.84;">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              </svg>
              <span><strong style="${monoValStyle}">${stats.contextTokens}</strong> tok · Cache hit <strong style="${monoValStyle}">${stats.cacheHit}%</strong></span>
            </div>

            <div style="display: flex; align-items: center; gap: 5px;" title="${totalTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: 0.84;">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              <span><strong style="${monoValStyle}">${stats.grandTotalTokens}</strong> total${subagentSuffix}</span>
            </div>
          </div>`;

        const rightMetricsHtml = isIdleHome
          ? ''
          : `<span aria-hidden="true" style="width: 1px; height: 12px; background: var(--agy-border-subtle, rgba(248, 224, 192, 0.16)); display: inline-block;"></span>
            <div style="display: flex; align-items: center; gap: 3px;" title="${costTitle}">
              <span><strong style="${monoValStyle}">${escapeAttr(formatUniformCost(stats.apiCost))}</strong></span>
            </div>

            <div style="display: flex; align-items: center; gap: 4px;" title="${workTimeTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity: 0.84;">
                <path d="M5 22h14"></path>
                <path d="M5 2h14"></path>
                <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path>
                <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path>
              </svg>
              <span><strong style="${monoValStyle}">${escapeAttr(stats.totalWorkTime)}</strong></span>
            </div>`;

        barContent.innerHTML = `
          ${metricsLeftHtml}

          <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
            ${rightMetricsHtml}

            <button id="antigravity-token-pill" type="button" aria-haspopup="dialog" aria-expanded="${popOpenNow ? 'true' : 'false'}" style="
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 3px 9px;
              border-radius: 4px;
              background: ${palette.pillBg};
              border: 1px solid ${palette.pillBorder};
              color: ${palette.strong};
              font: inherit;
              font-family: var(--agy-font-mono, Consolas, monospace);
              user-select: none;
              cursor: pointer;
              transition: background 0.15s ease, border-color 0.15s ease;
            " aria-label="${pillTitle}" title="${pillTitle} (ЛКМ: подробная статистика)">
              <svg width="13" height="13" viewBox="0 0 36 36" aria-hidden="true">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${palette.track}" stroke-width="4" />
                ${progressArc}
              </svg>
              <span style="color: ${palette.strong}; font-weight: 600;">${escapeAttr(percentText)}</span>
            </button>
          </div>
        `;

        const pillEl = bar.querySelector && bar.querySelector('#antigravity-token-pill');
        if (pillEl) {
          pillEl.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            toggleTokenPopover(bar, lastStatsData, getActiveModelName(box));
          };
        }
      }

      const openPopover = document.getElementById('antigravity-token-popover');
      if (openPopover && openPopover.style && openPopover.style.display !== 'none') {
        if (openPopover.parentElement !== bar) {
          bar.appendChild(openPopover);
        }
        renderTokenPopover(openPopover, stats, modelName);
      }

      const openSwarm = document.getElementById('antigravity-swarm-modal');
      if (openSwarm && openSwarm.style && openSwarm.style.display !== 'none') {
        renderSwarmModal(openSwarm, stats, modelName);
      }

      syncAgentStateOnUi(box, stats);
      updateSwarmCornerButton(stats, modelName);
      if (milkBackdropNodes.length > 0) {
        for (const mb of milkBackdropNodes) {
          if (mb && mb.isConnected) constrainTablesInDialogBox(mb);
        }
      }
      if (wallpaperFiles.length > 0) {
        ensureHomeWallpaper();
      }
    } finally {
      isMountingBar = false;
      if (pendingEnsureTokenBar) {
        pendingEnsureTokenBar = false;
        setTimeout(() => { ensureTokenBar(); }, 0);
      }
    }
  }

  function copyTextToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(String(text)).catch(() => {});
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text);
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatUniformCost(raw) {
    if (raw === null || raw === undefined || raw === '') return '$0.00';
    const str = String(raw).trim();
    const m = str.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)$/);
    if (!m) return str;
    const num = Number(m[1]);
    if (!Number.isFinite(num) || num <= 0) return '$0.00';
    if (num < 0.01) return `$${num.toFixed(3)}`;
    return `$${num.toFixed(2)}`;
  }

  function buildSpeedSparklineSvg(speeds) {
    const arr = Array.isArray(speeds) ? speeds.filter((n) => typeof n === 'number' && n > 0) : [];
    const w = 248;
    const h = 38;
    if (arr.length === 0) {
      return `<div style="height:${h}px;display:flex;align-items:center;justify-content:center;color:var(--agy-text-muted, rgba(248, 224, 192, 0.78));font-size:12px;border:1px dashed var(--agy-border-hairline, rgba(248,224,192,0.12));border-radius:4px;">Ожидание замеров скорости...</div>`;
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const medianV = sorted[Math.floor(sorted.length / 2)] || sorted[0];
    const maxV = Math.max(...arr, 10);
    const minV = Math.min(...arr);
    // Compress extreme outliers (e.g. single 896 tok/s spike flattening normal ~68 tok/s history)
    const useSqrtScale = arr.length >= 3 && maxV > medianV * 2.5;
    const mapV = (v) => (useSqrtScale ? Math.sqrt(Math.max(0, v)) : v);
    const mappedMin = mapV(minV * 0.6);
    const mappedMax = mapV(maxV);
    const span = Math.max(useSqrtScale ? 1 : 10, mappedMax - mappedMin);
    const padX = 6;
    const padY = 5;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;

    let peakIdx = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > arr[peakIdx]) peakIdx = i;
    }

    const pts = arr.map((v, i) => {
      const x = arr.length === 1 ? w / 2 : padX + (i / (arr.length - 1)) * innerW;
      const norm = Math.max(0, Math.min(1, (mapV(v) - mappedMin) / span));
      const y = padY + innerH - norm * innerH;
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), v };
    });

    const polyPoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const areaPoints = arr.length > 1
      ? `${pts[0].x},${h - 2} ${polyPoints} ${pts[pts.length - 1].x},${h - 2}`
      : `${padX},${h - 2} ${padX},${pts[0].y} ${w - padX},${pts[0].y} ${w - padX},${h - 2}`;

    const lastIdx = pts.length - 1;
    const lastPt = pts[lastIdx];
    const peakPt = pts[peakIdx];
    const peakDot = (arr.length > 1 && peakIdx !== lastIdx)
      ? `<circle cx="${peakPt.x}" cy="${peakPt.y}" r="2.2" fill="rgb(var(--agy-accent-bright-rgb, 255, 68, 82))" />`
      : '';
    const lastDot = `<circle cx="${lastPt.x}" cy="${lastPt.y}" r="2.7" fill="rgb(var(--agy-secondary-rgb, 248, 224, 192))" />`;

    return `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;width:100%;height:${h}px;border-radius:4px;background:rgba(0,0,0,0.28);border:1px solid var(--agy-border-hairline, rgba(248,224,192,0.10));">
        <polygon points="${areaPoints}" fill="rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.11)" />
        ${arr.length > 1 ? `<polyline points="${polyPoints}" fill="none" stroke="rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.86)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />` : `<line x1="${padX}" y1="${pts[0].y}" x2="${w - padX}" y2="${pts[0].y}" stroke="rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.86)" stroke-width="1.6" stroke-dasharray="3,3" />`}
        ${peakDot}
        ${lastDot}
      </svg>
    `;
  }

  function closeTokenPopover(restoreFocus) {
    const pop = document.getElementById('antigravity-token-popover');
    if (pop && pop.style) {
      pop.style.display = 'none';
    }
    const pill = document.getElementById('antigravity-token-pill');
    if (pill) {
      pill.setAttribute('aria-expanded', 'false');
    }
    const prev = popoverPrevFocusEl;
    popoverPrevFocusEl = null;
    if (restoreFocus) {
      const target = (prev && prev.isConnected && typeof prev.focus === 'function') ? prev : pill;
      if (target && typeof target.focus === 'function') {
        try { target.focus(); } catch (_) {}
      }
    }
  }

  function wrapSvgTextLines(text, maxChars = 35, maxLines = 2) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [''];
    const rawWords = clean.split(' ');
    // Expand overly long unbroken tokens (e.g. C:\Users\...\file.png) into chunked segments
    const tokens = [];
    for (const rw of rawWords) {
      let rem = rw;
      while (rem.length > maxChars) {
        let cut = maxChars;
        for (let j = maxChars; j >= Math.floor(maxChars * 0.45); j--) {
          const ch = rem[j - 1];
          if (ch === '\\' || ch === '/' || ch === '-' || ch === '_' || ch === '.') {
            cut = j;
            break;
          }
        }
        tokens.push({ text: rem.slice(0, cut), joinSpace: tokens.length > 0 && rem === rw });
        rem = rem.slice(cut);
      }
      if (rem) {
        tokens.push({ text: rem, joinSpace: tokens.length > 0 && rem === rw });
      }
    }

    const lines = [];
    let cur = '';
    const pushEllipsis = () => {
      const idx = lines.length - 1;
      if (idx < 0) return;
      const prev = lines[idx];
      lines[idx] = prev.length >= maxChars ? `${prev.slice(0, maxChars - 1)}…` : `${prev}…`;
    };

    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      const sep = cur && tk.joinSpace ? ' ' : '';
      if (!cur) {
        cur = tk.text;
      } else if ((cur.length + sep.length + tk.text.length) <= maxChars) {
        cur = `${cur}${sep}${tk.text}`;
      } else {
        lines.push(cur);
        if (lines.length >= maxLines) {
          pushEllipsis();
          return lines;
        }
        cur = tk.text;
      }
    }
    if (cur) {
      if (lines.length >= maxLines) {
        pushEllipsis();
      } else if (cur.length > maxChars) {
        lines.push(`${cur.slice(0, maxChars - 1)}…`);
      } else {
        lines.push(cur);
      }
    }
    return lines.slice(0, maxLines);
  }

  function cleanRoleLabel(raw) {
    let s = String(raw == null ? '' : raw).trim();
    while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  function computeSwarmLayout(s, convId, selId) {
    const subagents = Array.isArray(s.subagents) ? s.subagents : [];
    const rootNode = s.swarmRoot || {
      id: convId || 'root',
      role: 'Main Chat',
      steps: s.steps || 0,
      turns: s.turns || 0,
      tokens: s.chatTotalTokens || '0',
      rawTokens: 0,
      cost: s.apiCostChat || '$0.00',
      workTime: s.chatWorkTime || '0s',
      lastTool: '',
      isActive: agentVisualState === 'thinking'
    };

    if (subagents.length === 0) {
      return { empty: true, rootEntry: rootNode, activeCount: 0, maxDepth: 0, svgW: 400, svgH: 200, svgInner: '', sel: rootNode };
    }

    const nodeMap = new Map();
    const childrenMap = new Map();
    const rootEntry = { ...rootNode, role: cleanRoleLabel(rootNode.role || 'Main Chat'), parentId: null, depth: 0 };
    nodeMap.set(rootEntry.id, rootEntry);
    childrenMap.set(rootEntry.id, []);

    for (const rawSub of subagents) {
      const cleanRole = cleanRoleLabel(rawSub.role || 'Subagent');
      const item = {
        ...rawSub,
        role: cleanRole,
        parentId: rawSub.parentId || rootEntry.id,
        depth: Math.max(1, rawSub.depth || 1)
      };
      nodeMap.set(item.id, item);
      if (!childrenMap.has(item.id)) childrenMap.set(item.id, []);
    }

    for (const n of nodeMap.values()) {
      if (n.id === rootEntry.id) continue;
      const pId = nodeMap.has(n.parentId) ? n.parentId : rootEntry.id;
      n.parentId = pId;
      childrenMap.get(pId).push(n);
    }

    const nodeW = 308;
    const nodeH = 82;
    const colGap = 46;
    const rowGap = 12;
    const padX = 24;
    const padY = 20;
    const unitH = nodeH + rowGap;

    const subtreeH = new Map();
    let maxDepth = 0;

    function measureTree(node, depth) {
      node.depth = depth;
      if (depth > maxDepth) maxDepth = depth;
      const kids = childrenMap.get(node.id) || [];
      if (kids.length === 0) {
        subtreeH.set(node.id, unitH);
        return unitH;
      }
      let sum = 0;
      for (const k of kids) {
        sum += measureTree(k, depth + 1);
      }
      const h = Math.max(unitH, sum);
      subtreeH.set(node.id, h);
      return h;
    }

    const totalTreeH = measureTree(rootEntry, 0);
    const posMap = new Map();

    function layoutTree(node, topY) {
      const h = subtreeH.get(node.id) || unitH;
      const x = padX + node.depth * (nodeW + colGap);
      const y = topY + (h - nodeH) / 2;
      posMap.set(node.id, { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), node });
      const kids = childrenMap.get(node.id) || [];
      let curY = topY;
      for (const k of kids) {
        const kh = subtreeH.get(k.id) || unitH;
        layoutTree(k, curY);
        curY += kh;
      }
    }

    layoutTree(rootEntry, padY);

    const svgW = Math.max(520, padX * 2 + (maxDepth + 1) * nodeW + maxDepth * colGap);
    const svgH = Math.max(240, Math.round(totalTreeH + padY * 2 + 16));

    const activeSelId = (selId && posMap.has(selId))
      ? selId
      : ((subagents.find((x) => x.isActive) || subagents[0] || rootEntry).id);

    let edgesSvg = '';
    for (const item of posMap.values()) {
      const n = item.node;
      if (!n.parentId || !posMap.has(n.parentId)) continue;
      const pPos = posMap.get(n.parentId);
      const x1 = pPos.x + nodeW;
      const y1 = Number((pPos.y + nodeH / 2).toFixed(1));
      const x2 = item.x;
      const y2 = Number((item.y + nodeH / 2).toFixed(1));
      const cx = Number(((x1 + x2) / 2).toFixed(1));
      const pathD = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      const isLive = Boolean(n.isActive);
      const isSelEdge = n.id === activeSelId || n.parentId === activeSelId;
      const strokeCol = isLive
        ? 'rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.95)'
        : (isSelEdge ? 'rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.65)' : 'rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.28)');
      edgesSvg += `<path d="${pathD}" fill="none" stroke="${strokeCol}" stroke-width="${isLive || isSelEdge ? 2 : 1.35}" ${isLive ? 'class="agy-swarm-edge-active"' : ''} />`;
    }

    let defsSvg = '';
    let nodesSvg = '';
    const activeCount = subagents.filter((x) => x.isActive).length;
    let nodeClipIdx = 0;
    for (const item of posMap.values()) {
      const n = item.node;
      const isRoot = n.depth === 0;
      const isSelected = n.id === activeSelId;
      const isLive = Boolean(n.isActive);
      const clipId = `agy-sn-clip-${nodeClipIdx++}`;
      const titleClipId = `${clipId}-t`;

      const bgCol = isSelected
        ? 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.30)'
        : (isRoot ? 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.14)' : 'rgba(14, 15, 24, 0.96)');
      const borderCol = isSelected
        ? 'rgb(var(--agy-secondary-rgb, 248, 224, 192))'
        : (isLive
          ? 'rgb(var(--agy-accent-bright-rgb, 255, 68, 82))'
          : (isRoot ? 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.62)' : 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.42)'));

      const rawLabel = isRoot ? 'Main Chat' : cleanSwarmDisplayText(n.role || 'Subagent') || 'Subagent';
      const shortLabel = rawLabel.length > 30 ? `${rawLabel.slice(0, 29)}…` : rawLabel;
      const tagText = isLive ? 'LIVE' : (isRoot ? 'ROOT' : `S${n.depth}`);
      const cleanTask = cleanSwarmDisplayText(n.task || '');
      const cleanType = cleanSwarmDisplayText(n.agentType || '');
      const cleanTarget = cleanSwarmDisplayText(n.lastTarget || '');
      const rawTask = (cleanTask || cleanTarget || n.lastTool || (isRoot ? 'Основной чат' : 'Субагент')).replace(/\s+/g, ' ').trim();
      const taskLines = wrapSvgTextLines(rawTask, 40, 2);
      const taskLine1 = taskLines[0] || '';
      const taskLine2 = taskLines[1] || '';
      const toolLabel = (n.lastTool && n.lastTool !== 'Ответ модели') ? n.lastTool : '';
      const actionHint = toolLabel ? ` · ${toolLabel}` : '';
      const rawMeta = `${n.tokens || '0'} tok · ${formatUniformCost(n.cost || '$0')} · ${n.workTime || '0s'}${actionHint}`;
      const metaLine = rawMeta.length > 46 ? `${rawMeta.slice(0, 45)}…` : rawMeta;
      const fullTooltip = [
        rawLabel + (cleanType ? ` [${cleanType}]` : ''),
        cleanTask ? `Задача: ${cleanTask}` : '',
        n.modelLabel ? `Модель: ${cleanSwarmDisplayText(n.modelLabel)}` : '',
        n.lastTool ? `Действие: ${n.lastTool}${cleanTarget ? ` (${cleanTarget})` : ''}` : ''
      ].filter(Boolean).join('\n');
      const nodeAriaLabel = `${rawLabel} (${tagText}). ${rawTask}. ${metaLine}`;

      const tagReserve = isLive ? 54 : (isRoot ? 48 : 34);
      defsSvg += `
        <clipPath id="${clipId}"><rect x="${item.x + 8}" y="${item.y + 4}" width="${nodeW - 16}" height="${nodeH - 8}" rx="3" /></clipPath>
        <clipPath id="${titleClipId}"><rect x="${item.x + 8}" y="${item.y + 4}" width="${nodeW - 16 - tagReserve}" height="22" /></clipPath>
      `;

      nodesSvg += `
        <g class="agy-swarm-node-g" data-swarm-node="${escapeAttr(n.id)}" tabindex="0" role="button" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${escapeAttr(nodeAriaLabel)}" style="cursor:pointer;">
          <title>${escapeAttr(fullTooltip)}</title>
          <rect x="${item.x}" y="${item.y}" width="${nodeW}" height="${nodeH}" rx="5" fill="${bgCol}" stroke="${borderCol}" stroke-width="${isSelected ? 1.8 : 1.1}" />
          <text x="${item.x + 12}" y="${item.y + 20}" clip-path="url(#${titleClipId})" fill="#f8f0e8" font-size="12.5" font-weight="${isSelected || isRoot ? '700' : '600'}" style="pointer-events:none;">${escapeAttr(shortLabel)}</text>
          <text x="${item.x + nodeW - (isLive ? 21 : 11)}" y="${item.y + 19}" text-anchor="end" fill="${isLive ? 'rgb(var(--agy-accent-bright-rgb, 255, 68, 82))' : 'rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.80)'}" font-size="12" font-weight="700" font-family="var(--agy-font-mono, Consolas, monospace)" style="pointer-events:none;">${escapeAttr(tagText)}</text>
          ${isLive ? `<circle cx="${item.x + nodeW - 11}" cy="${item.y + 15}" r="3.2" fill="rgb(var(--agy-accent-bright-rgb, 255, 68, 82))" class="agy-swarm-node-pulse" />` : ''}
          <g clip-path="url(#${clipId})">
            <text x="${item.x + 12}" y="${item.y + 38}" fill="rgba(248,224,192,0.92)" font-size="12" style="pointer-events:none;">${escapeAttr(taskLine1)}</text>
            ${taskLine2 ? `<text x="${item.x + 12}" y="${item.y + 53}" fill="rgba(248,224,192,0.82)" font-size="12" style="pointer-events:none;">${escapeAttr(taskLine2)}</text>` : ''}
            <text x="${item.x + 12}" y="${item.y + 71}" fill="rgba(248,240,232,0.78)" font-size="12" font-family="var(--agy-font-mono, Consolas, monospace)" style="pointer-events:none;">${escapeAttr(metaLine)}</text>
          </g>
        </g>
      `;
    }

    const selItem = posMap.get(activeSelId);
    const sel = selItem ? selItem.node : rootEntry;
    return {
      empty: false,
      rootEntry,
      activeCount,
      maxDepth,
      svgW,
      svgH,
      svgInner: `<defs>${defsSvg}</defs>${edgesSvg}${nodesSvg}`,
      sel
    };
  }

  function closeSwarmModal() {
    const modal = document.getElementById('antigravity-swarm-modal');
    if (modal && modal.style) {
      modal.style.display = 'none';
    }
    const prev = swarmPrevFocusEl;
    swarmPrevFocusEl = null;
    if (prev && prev.isConnected && typeof prev.focus === 'function') {
      try { prev.focus(); } catch (_) {}
    }
  }

  function cleanSwarmDisplayText(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/\\r\\n|\\n|\\r/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function applySwarmCanvasTransform(modal) {
    if (!modal) return;
    const stageEl = modal.querySelector && modal.querySelector('#agy-swarm-stage');
    if (stageEl && stageEl.style) {
      stageEl.style.left = `${Math.round(swarmPanX)}px`;
      stageEl.style.top = `${Math.round(swarmPanY)}px`;
      stageEl.style.transform = 'none';
    }
    const svgEl = modal.querySelector && modal.querySelector('#agy-swarm-svg');
    if (svgEl) {
      const baseW = Number(svgEl.getAttribute && svgEl.getAttribute('data-base-w')) || 480;
      const baseH = Number(svgEl.getAttribute && svgEl.getAttribute('data-base-h')) || 240;
      const drawW = Math.max(1, Math.round(baseW * swarmZoom));
      const drawH = Math.max(1, Math.round(baseH * swarmZoom));
      if (typeof svgEl.setAttribute === 'function') {
        svgEl.setAttribute('width', String(drawW));
        svgEl.setAttribute('height', String(drawH));
      }
      if (svgEl.style) {
        svgEl.style.width = `${drawW}px`;
        svgEl.style.height = `${drawH}px`;
      }
    }
    const zoomLbl = modal.querySelector && modal.querySelector('#agy-swarm-zoom-lbl');
    if (zoomLbl) {
      zoomLbl.textContent = `${Math.round(swarmZoom * 100)}%`;
    }
  }

  function fitSwarmCanvasToViewport(modal, svgW, svgH, minScale = 0.45) {
    if (!modal) return;
    const vp = modal.querySelector && modal.querySelector('#agy-swarm-viewport');
    const vpW = (vp && vp.clientWidth) ? vp.clientWidth : 820;
    const vpH = (vp && vp.clientHeight) ? vp.clientHeight : 440;
    const scaleX = (vpW - 24) / Math.max(1, svgW);
    const scaleY = (vpH - 24) / Math.max(1, svgH);
    const fit = Math.max(minScale, Math.min(1.15, Math.min(scaleX, scaleY)));
    swarmZoom = Number(fit.toFixed(3));
    const drawW = svgW * swarmZoom;
    const drawH = svgH * swarmZoom;
    swarmPanX = drawW <= vpW - 24 ? Math.round((vpW - drawW) / 2) : 16;
    swarmPanY = drawH <= vpH - 24 ? Math.round((vpH - drawH) / 2) : 16;
    applySwarmCanvasTransform(modal);
  }

  function renderSwarmModal(modal, stats, modelName) {
    if (!modal) return;
    const s = stats || DEFAULT_ZERO_STATS;
    const convId = getConversationIdFromLocation() || '';
    const subagents = Array.isArray(s.subagents) ? s.subagents : [];
    const layout = computeSwarmLayout(s, convId, selectedSwarmNodeId);

    const rootInfo = layout.rootEntry || {};
    const renderKey = [
      convId,
      modelName,
      selectedSwarmNodeId || '',
      s.grandTotalTokens,
      s.apiCost,
      s.subagentCount,
      rootInfo.isActive ? 1 : 0,
      rootInfo.steps || 0,
      rootInfo.tokens || '',
      rootInfo.lastTool || '',
      subagents.map((x) => `${x.id}:${x.steps}:${x.tokens || ''}:${x.cost || ''}:${x.workTime || ''}:${x.isActive ? 1 : 0}:${x.lastTool || ''}:${x.lastTarget || ''}:${(x.task || '').length}`).join(',')
    ].join('|');

    if (modal.dataset && modal.dataset.renderKey === renderKey) {
      return;
    }
    // Do not rebuild the DOM while the user is dragging the graph (would abort the drag)
    if (swarmIsDragging && modal.dataset && modal.dataset.renderKey) {
      return;
    }
    if (modal.dataset) modal.dataset.renderKey = renderKey;

    const prevSwarmFocus = captureFocusDescriptor(modal);
    const prevTaskBox = modal.querySelector && modal.querySelector('#agy-swarm-task-box');
    const prevTaskScrollTop = prevTaskBox ? prevTaskBox.scrollTop : 0;
    const prevSelNodeId = modal.dataset ? (modal.dataset.selNodeId || '') : '';

    const sel = layout.sel || {};
    const swarmCopyKey = sel.id ? `swarm:${sel.id}` : '';
    const swarmCopied = isCopyFeedbackActive(swarmCopyKey);
    const statusBadge = sel.isActive
      ? '<span class="agy-wp-menu-pill is-on">ACTIVE</span>'
      : '<span class="agy-wp-menu-pill is-off">DONE</span>';
    const shortSelId = sel.id && sel.id.length > 14 ? `${sel.id.slice(0, 10)}…` : (sel.id || '');
    const cleanSelRole = cleanSwarmDisplayText(sel.role || 'Node') || 'Node';
    const cleanSelType = cleanSwarmDisplayText(sel.agentType || '');
    const cleanSelModel = cleanSwarmDisplayText(sel.modelLabel || '');
    const cleanSelTask = cleanSwarmDisplayText(sel.task || '');
    const cleanSelTarget = cleanSwarmDisplayText(sel.lastTarget || '');
    const typeAndModel = [cleanSelType, cleanSelModel].filter(Boolean).join(' · ');
    const actionCombined = sel.lastTool
      ? (cleanSelTarget ? `${sel.lastTool} (${cleanSelTarget})` : sel.lastTool)
      : '—';
    const filesMeta = sel.filesCount > 0 ? ` · Файлов: <strong style="color:var(--agy-text-primary, #ffffff);">${sel.filesCount}</strong>` : '';
    const taskBlockHtml = cleanSelTask
      ? `<div id="agy-swarm-task-box" style="margin:6px 0 7px;padding:6px 9px;border-radius:4px;background:rgba(0,0,0,0.28);font-size:12px;line-height:1.45;color:var(--agy-text-primary, rgba(248,240,232,0.94));max-height:62px;overflow-y:auto;">
           <span style="color:var(--agy-text-muted, rgba(248,224,192,0.82));font-weight:600;margin-right:5px;">Задача:</span>${escapeAttr(cleanSelTask)}
         </div>`
      : '';

    const bodyHtml = layout.empty
      ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--agy-text-muted, rgba(248,224,192,0.82));font-size:13px;gap:8px;">
           <div style="opacity:0.86;color:rgb(var(--agy-accent-bright-rgb, 255, 68, 82));">${agyIcon('network', 28)}</div>
           <div style="color:var(--agy-text-primary, #f8f0e8);font-weight:600;">В этом чате субагенты ещё не запускались</div>
           <div style="font-size:12px;">Как только агент вызовет субагентов, здесь появится интерактивное дерево роя</div>
         </div>`
      : `
        <div id="agy-swarm-viewport" style="position:relative;flex:1;overflow:hidden;border-radius:6px;background:rgba(5,6,11,0.82);border:1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.26);cursor:grab;touch-action:none;">
          <div id="agy-swarm-stage" style="position:absolute;top:0;left:0;">
            <svg id="agy-swarm-svg" data-base-w="${layout.svgW}" data-base-h="${layout.svgH}" width="${Math.max(1, Math.round(layout.svgW * swarmZoom))}" height="${Math.max(1, Math.round(layout.svgH * swarmZoom))}" viewBox="0 0 ${layout.svgW} ${layout.svgH}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" style="display:block;">
              ${layout.svgInner}
            </svg>
          </div>
          <div style="position:absolute;bottom:8px;right:10px;padding:3px 9px;border-radius:4px;background:rgba(5,6,11,0.88);border:1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.28);font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));pointer-events:none;">
            Перетаскивайте фон · Колёсико: масштаб · Клик / Enter: детали · Стрелки: узлы
          </div>
        </div>

        <div style="margin-top:10px;padding:10px 12px;border-radius:6px;background:rgba(var(--agy-accent-rgb, 198, 52, 60), 0.09);border:1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.38);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <span style="font-weight:700;color:var(--agy-text-primary, #f8f0e8);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(cleanSelRole)}</span>
              <span class="agy-mono" style="font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));">${sel.depth ? `S${sel.depth}` : 'Корень'}</span>
              ${typeAndModel ? `<span style="font-size:12px;padding:1px 6px;border-radius:4px;background:var(--agy-surface-subtle, rgba(248,224,192,0.06));color:var(--agy-text-secondary, rgba(248,240,232,0.88));white-space:nowrap;">${escapeAttr(typeAndModel)}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              ${statusBadge}
              ${sel.id ? `<button type="button" id="agy-swarm-copy-id" data-copy-id="${escapeAttr(sel.id)}" class="agy-wp-menu-chip agy-mono" style="padding:3px 8px;font-size:12px;" title="Скопировать ID: ${escapeAttr(sel.id)}">${swarmCopied ? `${agyIcon('check', 12)}<span>Скопировано</span>` : `<span>${escapeAttr(shortSelId)}</span>${agyIcon('copy', 12)}`}</button>` : ''}
            </div>
          </div>
          ${taskBlockHtml}
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--agy-text-secondary, rgba(248,240,232,0.88));margin-top:${cleanSelTask ? '0' : '5px'};">
            <span>Токены: <strong class="agy-mono" style="color:var(--agy-text-primary, #ffffff);">${escapeAttr(sel.tokens || '0')}</strong> · API: <strong class="agy-mono" style="color:var(--agy-text-primary, #ffffff);">${escapeAttr(formatUniformCost(sel.cost))}</strong> · Шаги: <strong class="agy-mono" style="color:var(--agy-text-primary, #ffffff);">${sel.steps || 0}</strong> · Время: <strong class="agy-mono" style="color:var(--agy-text-primary, #ffffff);">${escapeAttr(sel.workTime || '0s')}</strong>${filesMeta}</span>
            <span style="color:var(--agy-text-muted, rgba(248,224,192,0.84));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%;">Действие: <strong style="color:var(--agy-text-primary, #f8f0e8);">${escapeAttr(actionCombined)}</strong></span>
          </div>
        </div>
      `;

    modal.innerHTML = `
      <div id="antigravity-swarm-card" style="
        width: min(1040px, 92vw);
        height: min(720px, 84vh);
        display: flex;
        flex-direction: column;
        padding: 14px 16px;
        border-radius: 6px;
        background: var(--agy-surface-panel, rgba(11, 12, 19, 0.97));
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.50);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.84);
        color: var(--agy-text-primary, #f8f0e8);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-variant-numeric: tabular-nums;
        box-sizing: border-box;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-shrink:0;">
          <div style="display:flex;flex-direction:column;min-width:0;">
            <span id="agy-swarm-title" style="font-weight:700;color:var(--agy-text-primary, #f8f0e8);font-size:14px;">Карта роя субагентов</span>
            <span class="agy-mono" style="font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));">
              Узлов: ${subagents.length + 1} (1 + ${subagents.length}) · Глубина: ${layout.maxDepth} · Активно: ${layout.activeCount} · Всего: ${escapeAttr(s.grandTotalTokens || '0')} tok (${escapeAttr(formatUniformCost(s.apiCost))})
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            ${layout.empty ? '' : `
              <button type="button" id="agy-swarm-zoom-out" class="agy-wp-menu-chip agy-mono" title="Уменьшить" aria-label="Уменьшить масштаб">−</button>
              <button type="button" id="agy-swarm-zoom-fit" class="agy-wp-menu-chip" title="Вписать весь граф в окно"><span id="agy-swarm-zoom-lbl" class="agy-mono">${Math.round(swarmZoom * 100)}%</span> · Вписать</button>
              <button type="button" id="agy-swarm-zoom-in" class="agy-wp-menu-chip agy-mono" title="Увеличить" aria-label="Увеличить масштаб">+</button>
            `}
            <button type="button" id="agy-swarm-close" class="agy-wp-menu-chip" style="padding:4px 9px;" title="Закрыть (Esc)" aria-label="Закрыть карту роя">✕</button>
          </div>
        </div>
        ${bodyHtml}
      </div>
    `;

    const cardEl = modal.querySelector && modal.querySelector('#antigravity-swarm-card');
    if (cardEl) {
      cardEl.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
    }

    const closeBtn = modal.querySelector && modal.querySelector('#agy-swarm-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        closeSwarmModal();
      };
    }

    if (!layout.empty) {
      if (!swarmInitializedView) {
        swarmInitializedView = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => fitSwarmCanvasToViewport(modal, layout.svgW, layout.svgH, 0.85));
        } else {
          fitSwarmCanvasToViewport(modal, layout.svgW, layout.svgH, 0.85);
        }
      } else {
        applySwarmCanvasTransform(modal);
      }

      const vp = modal.querySelector && modal.querySelector('#agy-swarm-viewport');
      if (vp) {
        let isDragging = false;
        let activePointerId = null;
        let startX = 0;
        let startY = 0;
        let origPanX = 0;
        let origPanY = 0;

        vp.onpointerdown = (e) => {
          if (typeof e.button === 'number' && e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest('[data-swarm-node]')) return;
          isDragging = true;
          swarmIsDragging = true;
          activePointerId = e.pointerId != null ? e.pointerId : null;
          startX = e.clientX;
          startY = e.clientY;
          origPanX = swarmPanX;
          origPanY = swarmPanY;
          vp.style.cursor = 'grabbing';
          if (activePointerId != null && typeof vp.setPointerCapture === 'function') {
            try { vp.setPointerCapture(activePointerId); } catch (_) {}
          }
        };
        vp.onpointermove = (e) => {
          if (!isDragging) return;
          if (activePointerId != null && e.pointerId != null && e.pointerId !== activePointerId) return;
          swarmPanX = origPanX + (e.clientX - startX);
          swarmPanY = origPanY + (e.clientY - startY);
          applySwarmCanvasTransform(modal);
        };
        const endDrag = (e) => {
          if (!isDragging) return;
          if (activePointerId != null && e && typeof vp.releasePointerCapture === 'function') {
            try { vp.releasePointerCapture(activePointerId); } catch (_) {}
          }
          isDragging = false;
          swarmIsDragging = false;
          activePointerId = null;
          vp.style.cursor = 'grab';
        };
        vp.onpointerup = endDrag;
        vp.onpointercancel = endDrag;

        vp.onwheel = (e) => {
          if (e && e.preventDefault) e.preventDefault();
          const rect = vp.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          const nextZoom = Math.max(0.28, Math.min(2.4, swarmZoom * factor));
          const ratio = nextZoom / swarmZoom;
          swarmPanX = mx - (mx - swarmPanX) * ratio;
          swarmPanY = my - (my - swarmPanY) * ratio;
          swarmZoom = Number(nextZoom.toFixed(3));
          applySwarmCanvasTransform(modal);
        };
      }

      const zoomAroundCenter = (nextZoomRaw) => {
        const vpEl = modal.querySelector && modal.querySelector('#agy-swarm-viewport');
        const vpW = (vpEl && vpEl.clientWidth) ? vpEl.clientWidth : 820;
        const vpH = (vpEl && vpEl.clientHeight) ? vpEl.clientHeight : 440;
        const cx = vpW / 2;
        const cy = vpH / 2;
        const nextZoom = Math.max(0.28, Math.min(2.4, Number(nextZoomRaw.toFixed(3))));
        const ratio = nextZoom / Math.max(0.01, swarmZoom);
        swarmPanX = cx - (cx - swarmPanX) * ratio;
        swarmPanY = cy - (cy - swarmPanY) * ratio;
        swarmZoom = nextZoom;
        applySwarmCanvasTransform(modal);
      };

      const zOut = modal.querySelector && modal.querySelector('#agy-swarm-zoom-out');
      if (zOut) {
        zOut.onclick = (e) => {
          e.stopPropagation();
          zoomAroundCenter(swarmZoom * 0.85);
        };
      }
      const zIn = modal.querySelector && modal.querySelector('#agy-swarm-zoom-in');
      if (zIn) {
        zIn.onclick = (e) => {
          e.stopPropagation();
          zoomAroundCenter(swarmZoom * 1.18);
        };
      }
      const zFit = modal.querySelector && modal.querySelector('#agy-swarm-zoom-fit');
      if (zFit) {
        zFit.onclick = (e) => {
          e.stopPropagation();
          fitSwarmCanvasToViewport(modal, layout.svgW, layout.svgH);
        };
      }

      const swarmNodes = modal.querySelectorAll ? Array.from(modal.querySelectorAll('[data-swarm-node]')) : [];
      const selectSwarmNode = (nid, focusSelected) => {
        if (!nid) return;
        selectedSwarmNodeId = nid;
        if (modal.dataset) modal.dataset.renderKey = '';
        renderSwarmModal(modal, lastStatsData, modelName);
        if (focusSelected && modal.querySelector) {
          const sameNode = modal.querySelector(`[data-swarm-node="${CSS && CSS.escape ? CSS.escape(nid) : nid.replace(/"/g, '\\"')}"]`) || modal.querySelector('[data-swarm-node]');
          if (sameNode && typeof sameNode.focus === 'function') {
            try { sameNode.focus(); } catch (_) {}
          }
        }
      };

      swarmNodes.forEach((sn, idx) => {
        sn.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const nid = sn.dataset ? sn.dataset.swarmNode : '';
          if (nid && nid !== selectedSwarmNodeId) selectSwarmNode(nid, false);
        };
        sn.onkeydown = (e) => {
          if (!e) return;
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.preventDefault) e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            const nid = sn.dataset ? sn.dataset.swarmNode : '';
            if (nid) selectSwarmNode(nid, true);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            if (e.preventDefault) e.preventDefault();
            const nextNode = swarmNodes[(idx + 1) % swarmNodes.length];
            if (nextNode && typeof nextNode.focus === 'function') nextNode.focus();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            if (e.preventDefault) e.preventDefault();
            const prevNode = swarmNodes[(idx - 1 + swarmNodes.length) % swarmNodes.length];
            if (prevNode && typeof prevNode.focus === 'function') prevNode.focus();
          }
        };
      });

      const swarmCopyBtn = modal.querySelector && modal.querySelector('#agy-swarm-copy-id');
      if (swarmCopyBtn) {
        swarmCopyBtn.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const cid = swarmCopyBtn.dataset ? swarmCopyBtn.dataset.copyId : '';
          if (cid && copyTextToClipboard(cid)) {
            swarmCopyBtn.innerHTML = `${agyIcon('check', 12)}<span>Скопировано</span>`;
            triggerCopyFeedback(`swarm:${cid}`, 1100, () => {
              if (modal.isConnected && modal.style && modal.style.display !== 'none') {
                if (modal.dataset) modal.dataset.renderKey = '';
                renderSwarmModal(modal, lastStatsData, modelName);
              }
            });
          }
        };
      }
    }

    if (modal.dataset) modal.dataset.selNodeId = sel.id || '';
    const nextTaskBox = modal.querySelector && modal.querySelector('#agy-swarm-task-box');
    if (nextTaskBox && prevTaskScrollTop > 0 && prevSelNodeId && prevSelNodeId === (sel.id || '')) {
      nextTaskBox.scrollTop = prevTaskScrollTop;
    }
    if (prevSwarmFocus) {
      restoreFocusDescriptor(modal, prevSwarmFocus);
    }
  }

  function toggleSwarmModal(stats, modelName) {
    ensureMilkThemeStyles();
    installWallpaperMenuDismissListeners();
    closeTokenPopover(false);
    closeWallpaperMenu();
    let modal = document.getElementById('antigravity-swarm-modal');
    if (modal && modal.style && modal.style.display !== 'none') {
      closeSwarmModal();
      return;
    }
    swarmPrevFocusEl = document.activeElement || null;
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'antigravity-swarm-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'agy-swarm-title');
      modal.style.cssText = [
        'position: fixed',
        'inset: 0',
        'z-index: 10020',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'background: rgba(5, 6, 12, 0.86)',
        'backdrop-filter: blur(4px)',
        '-webkit-backdrop-filter: blur(4px)'
      ].join(';');
      modal.onclick = () => closeSwarmModal();
      modal.onkeydown = (e) => {
        if (!e || e.key !== 'Tab') return;
        const focusables = Array.from(modal.querySelectorAll('button:not([disabled]), [data-swarm-node][tabindex="0"], [tabindex]:not([tabindex="-1"])'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const inside = modal.contains && modal.contains(document.activeElement);
        if (!inside) {
          if (e.preventDefault) e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          if (e.preventDefault) e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          if (e.preventDefault) e.preventDefault();
          first.focus();
        }
      };
      (document.body || document.documentElement).appendChild(modal);
    }
    swarmInitializedView = false;
    swarmIsDragging = false;
    if (modal.dataset) modal.dataset.renderKey = '';
    modal.style.display = 'flex';
    renderSwarmModal(modal, stats, modelName);
    const focusTarget = (modal.querySelector && (modal.querySelector('#agy-swarm-close') || modal.querySelector('[data-swarm-node]'))) || null;
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus(); } catch (_) {}
    }
  }

  function getContextProgressColor(percent) {
    if (percent > 85) return '#ff2a3c';
    if (percent > 65) return '#f59e0b';
    return 'rgb(var(--agy-secondary-rgb, 248, 224, 192))';
  }

  function renderTokenPopover(popover, stats, modelName) {
    if (!popover) return;
    const s = stats || DEFAULT_ZERO_STATS;
    const convId = getConversationIdFromLocation() || '';
    const shortConv = convId ? (convId.length > 12 ? `${convId.slice(0, 8)}…` : convId) : 'Нет чата';
    const progressColor = getContextProgressColor(s.percent);
    const barWidth = s.hasTokens ? Math.max(2, Math.min(100, s.exactPercent || s.percent)) : 0;

    const speeds = Array.isArray(s.speedHistory) ? s.speedHistory : (s.speed > 0 ? [s.speed] : []);
    const peakSpeed = speeds.length > 0 ? Math.max(...speeds) : (s.speed || 0);
    const minSpeed = speeds.length > 0 ? Math.min(...speeds) : (s.speed || 0);

    const subagents = Array.isArray(s.subagents) ? s.subagents : [];
    const inspector = s.contextInspector || {};
    const inspSummary = inspector.summary || { reads: 0, edits: 0, cmds: 0, web: 0, mcp: 0, subagents: 0, other: 0, total: 0, approxTokens: '0' };
    const topTools = Array.isArray(inspector.topTools) ? inspector.topTools : [];
    const inspFiles = Array.isArray(inspector.files) ? inspector.files : [];

    const renderKey = [
      popoverActiveTab,
      convId,
      modelName,
      s.turns,
      s.steps,
      s.plannerSteps,
      s.speed,
      speeds.join(','),
      s.contextTokens,
      s.lastInput,
      s.lastCache,
      s.totalOutput,
      s.grandTotalTokens,
      s.subagentCount,
      s.totalWorkTime,
      s.cacheHit,
      s.sessionCacheHit,
      s.exactPercent,
      s.apiCost,
      s.pricingLabel,
      subagents.map((x) => `${x.id}:${x.steps}:${x.tokens || ''}:${x.cost || ''}:${x.workTime || ''}:${x.isActive ? 1 : 0}`).join(','),
      inspSummary.total,
      inspSummary.approxTokens,
      inspFiles.map((f) => `${f.name}:${f.reads}:${f.edits}`).join(',')
    ].join('|');

    if (popover.dataset && popover.dataset.renderKey === renderKey) {
      return;
    }
    if (popover.dataset) popover.dataset.renderKey = renderKey;
    const prevPopFocus = captureFocusDescriptor(popover);
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Монитор сессии');

    const subRowsHtml = subagents.map((sub, idx) => {
      const roleText = escapeAttr(sub.role || `Subagent #${idx + 1}`);
      const subIdAttr = escapeAttr(sub.id || '');
      const costPart = sub.cost ? ` · ${escapeAttr(formatUniformCost(sub.cost))}` : '';
      const subMeta = `${escapeAttr(sub.tokens || '0')} tok${costPart} · ${escapeAttr(sub.workTime || '0s')}`;
      const isCopied = isCopyFeedbackActive(`sub:${sub.id || ''}`);
      return `
        <button type="button" class="agy-pop-sub-row" data-sub-id="${subIdAttr}" title="ЛКМ: скопировать ID субагента (${subIdAttr})">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:124px;font-weight:600;color:var(--agy-text-primary, #f8f0e8);">${isCopied ? 'Скопировано' : roleText}</span>
          <span class="agy-mono" style="color:var(--agy-text-muted, rgba(248,224,192,0.82));font-size:12px;flex-shrink:0;">${subMeta}</span>
        </button>
      `;
    }).join('');

    const subSectionHtml = subagents.length > 0 ? `
      <div style="margin-top:9px;padding-top:8px;border-top:1px solid var(--agy-border-hairline, rgba(248,224,192,0.10));">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));">
          <span>Субагенты (${s.subagentCount || subagents.length})</span>
          <span class="agy-mono">${escapeAttr(s.subagentTotalTokens)} tok · ${escapeAttr(formatUniformCost(s.apiCostSubagents))}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:102px;overflow-y:auto;padding-right:2px;">
          ${subRowsHtml}
        </div>
      </div>
    ` : '';

    const costDetails = `In ${escapeAttr(formatUniformCost(s.apiCostInput))} · Кэш ${escapeAttr(formatUniformCost(s.apiCostCache))} · Out ${escapeAttr(formatUniformCost(s.apiCostOutput))}`;

    const overviewHtml = `
      <div style="margin-bottom:9px;">
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <span style="color:var(--agy-text-secondary, rgba(248,240,232,0.88));">Заполнение окна</span>
          <strong class="agy-mono" style="color:var(--agy-text-primary, #ffffff);font-weight:600;">${escapeAttr(s.contextTokens)} / ${escapeAttr(s.modelLimitLabel)} (${s.exactPercent}%)</strong>
        </div>
        <div style="width:100%;height:5px;border-radius:2px;background:var(--agy-border-subtle, rgba(248,224,192,0.14));overflow:hidden;">
          <div style="width:${barWidth}%;height:100%;border-radius:2px;background:${progressColor};transition:width 0.25s ease;"></div>
        </div>
      </div>

      <div style="margin-bottom:8px;padding:7px 9px;border-radius:4px;background:rgba(var(--agy-accent-rgb, 198, 52, 60), 0.10);border:1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.30);">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span class="agy-pop-stat-lbl">Стоимость по API</span>
          <span class="agy-mono" style="font-size:13px;font-weight:700;color:var(--agy-text-primary, #ffffff);">${escapeAttr(formatUniformCost(s.apiCost))}</span>
        </div>
        <div class="agy-mono" style="font-size:12px;color:var(--agy-text-secondary, rgba(248,240,232,0.86));margin-top:2px;">
          <span>${costDetails}</span>
        </div>
        <div style="font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.78));margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(s.pricingLabel || 'Gemini API')}</div>
      </div>

      <div class="agy-pop-metric-grid">
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Вход шага (In / Кэш)</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.lastInput)} / ${escapeAttr(s.lastCache)}</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Кэш (шаг / сессия)</span>
          <span class="agy-pop-stat-val">${s.cacheHit}% / ${s.sessionCacheHit}%</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Сгенерировано (Out)</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.totalOutput)} tok</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Всего прогнано</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.grandTotalTokens)} tok</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Ходы / Ответов ИИ</span>
          <span class="agy-pop-stat-val">${s.turns} / ${s.plannerSteps} <span style="opacity:0.78;font-weight:400;">(${s.steps})</span></span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Активное время</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.totalWorkTime)}</span>
        </div>
      </div>

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));margin-bottom:4px;">
          <span>Скорость: <strong class="agy-mono" style="color:var(--agy-text-primary, #f8f0e8);">${s.speed} tok/s</strong></span>
          <span class="agy-mono">мин ${minSpeed} · пик ${peakSpeed} tok/s</span>
        </div>
        ${buildSpeedSparklineSvg(speeds)}
      </div>
      ${subSectionHtml}
    `;

    const topToolsHtml = topTools.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${topTools.map((t) => `<span class="agy-pop-tool-chip agy-mono">${escapeAttr(t.name)} ×${t.count}</span>`).join('')}</div>`
      : '';

    const filesRowsHtml = inspFiles.length > 0
      ? inspFiles.map((f) => {
          const isHot = (f.reads || 0) >= 3 && (f.edits || 0) === 0;
          const badgeR = f.reads > 0 ? `<span style="opacity:0.88;">R×${f.reads}</span>` : '';
          const badgeE = f.edits > 0 ? `<span style="color:rgb(var(--agy-secondary-rgb, 248, 224, 192));font-weight:700;">E×${f.edits}</span>` : '';
          const badges = [badgeR, badgeE].filter(Boolean).join(' ');
          const isCopied = isCopyFeedbackActive(`file:${f.path || ''}`);
          return `
            <button type="button" class="agy-pop-sub-row${isHot ? ' is-warn' : ''}" data-file-path="${escapeAttr(f.path)}" title="${escapeAttr(f.path)} (ЛКМ: скопировать путь)">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;font-weight:${f.edits > 0 ? '600' : '500'};color:${f.edits > 0 ? 'var(--agy-text-primary, #f8f0e8)' : 'var(--agy-text-secondary, rgba(248,240,232,0.88))'};">${isCopied ? 'Скопировано' : escapeAttr(f.name)}</span>
              <span class="agy-mono" style="display:flex;gap:5px;font-size:12px;flex-shrink:0;">${badges}</span>
            </button>
          `;
        }).join('')
      : `<div style="padding:10px;text-align:center;color:var(--agy-text-muted, rgba(248,224,192,0.78));font-size:12px;border:1px dashed var(--agy-border-hairline, rgba(248,224,192,0.12));border-radius:4px;">Файлы в этом чате ещё не читались</div>`;

    const contextHtml = `
      <div class="agy-pop-metric-grid cols-3">
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Чтение</span>
          <span class="agy-pop-stat-val">${inspSummary.reads}</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Правки</span>
          <span class="agy-pop-stat-val">${inspSummary.edits}</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Команды</span>
          <span class="agy-pop-stat-val">${inspSummary.cmds}</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">Веб</span>
          <span class="agy-pop-stat-val">${inspSummary.web}</span>
        </div>
        <div class="agy-pop-metric-cell">
          <span class="agy-pop-stat-lbl">MCP / Суб</span>
          <span class="agy-pop-stat-val">${inspSummary.mcp} / ${inspSummary.subagents}</span>
        </div>
        <div class="agy-pop-metric-cell" title="Примерный объём ответов инструментов (символы / 4)">
          <span class="agy-pop-stat-lbl">Вывод тулзов</span>
          <span class="agy-pop-stat-val">~${escapeAttr(inspSummary.approxTokens || '0')}</span>
        </div>
      </div>
      ${topToolsHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));margin-bottom:5px;">
        <span>Файлы в контексте (${inspFiles.length})</span>
        <span>клик — копировать путь</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:175px;overflow-y:auto;padding-right:2px;">
        ${filesRowsHtml}
      </div>
    `;

    const __popScrolls = popover.querySelectorAll
      ? Array.from(popover.querySelectorAll('div')).filter((d) => d.style && d.style.overflowY === 'auto').map((d) => d.scrollTop)
      : [];
    popover.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="display:flex;flex-direction:column;min-width:0;">
          <span style="font-weight:700;color:var(--agy-text-primary, #f8f0e8);font-size:13px;">Монитор сессии</span>
          <span style="font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.78));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(modelName || 'Авто-модель')} · <span class="agy-mono">${escapeAttr(s.modelLimitLabel)}</span></span>
        </div>
        ${convId ? `<button type="button" id="agy-pop-copy-conv" class="agy-wp-menu-chip agy-mono" title="Скопировать ID чата: ${escapeAttr(convId)}">${isCopyFeedbackActive(`conv:${convId}`) ? `${agyIcon('check', 12)}<span>Скопировано</span>` : `<span>${escapeAttr(shortConv)}</span>${agyIcon('copy', 12)}`}</button>` : ''}
      </div>

      <div id="agy-pop-tablist" role="tablist" aria-label="Разделы монитора" style="display:flex;gap:5px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid var(--agy-border-hairline, rgba(248,224,192,0.10));">
        <button type="button" role="tab" aria-selected="${popoverActiveTab === 'overview' ? 'true' : 'false'}" class="agy-wp-menu-chip${popoverActiveTab === 'overview' ? ' is-active' : ''}" data-pop-tab="overview" style="flex:1;padding:4px 6px;">Обзор · <span class="agy-mono">${escapeAttr(formatUniformCost(s.apiCost))}</span></button>
        <button type="button" role="tab" aria-selected="${popoverActiveTab === 'context' ? 'true' : 'false'}" class="agy-wp-menu-chip${popoverActiveTab === 'context' ? ' is-active' : ''}" data-pop-tab="context" style="flex:1;padding:4px 6px;">Инспектор (<span class="agy-mono">${inspSummary.total}</span>)</button>
      </div>

      <div role="tabpanel">
        ${popoverActiveTab === 'context' ? contextHtml : overviewHtml}
      </div>
    `;

    if (__popScrolls.length > 0) {
      const scrollers = Array.from(popover.querySelectorAll('div')).filter((d) => d.style && d.style.overflowY === 'auto');
      scrollers.forEach((d, i) => { if (typeof __popScrolls[i] === 'number') d.scrollTop = __popScrolls[i]; });
    }

    const tabBtns = popover.querySelectorAll ? popover.querySelectorAll('[data-pop-tab]') : [];
    for (const tb of tabBtns) {
      tb.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const nextTab = tb.dataset ? tb.dataset.popTab : 'overview';
        if (nextTab && nextTab !== popoverActiveTab) {
          popoverActiveTab = nextTab;
          if (popover.dataset) popover.dataset.renderKey = '';
          renderTokenPopover(popover, lastStatsData, modelName);
        }
      };
    }
    const popTablist = popover.querySelector && popover.querySelector('#agy-pop-tablist');
    if (popTablist) wireTablistArrowKeys(popTablist);

    const copyBtn = popover.querySelector && popover.querySelector('#agy-pop-copy-conv');
    if (copyBtn && convId) {
      copyBtn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (copyTextToClipboard(convId)) {
          copyBtn.innerHTML = `${agyIcon('check', 12)}<span>Скопировано</span>`;
          triggerCopyFeedback(`conv:${convId}`, 1600, () => {
            if (popover.isConnected && popover.style && popover.style.display !== 'none') {
              if (popover.dataset) popover.dataset.renderKey = '';
              renderTokenPopover(popover, lastStatsData, modelName);
            }
          });
        }
      };
    }

    const subBtns = popover.querySelectorAll ? popover.querySelectorAll('.agy-pop-sub-row') : [];
    for (const btn of subBtns) {
      btn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const subId = btn.dataset ? (btn.dataset.subId || '') : '';
        const filePath = btn.dataset ? (btn.dataset.filePath || '') : '';
        const val = subId || filePath;
        const fbKey = subId ? `sub:${subId}` : `file:${filePath}`;
        if (val && copyTextToClipboard(val)) {
          const firstSpan = btn.querySelector && btn.querySelector('span');
          if (firstSpan) firstSpan.textContent = 'Скопировано';
          triggerCopyFeedback(fbKey, 1500, () => {
            if (popover.isConnected && popover.style && popover.style.display !== 'none') {
              if (popover.dataset) popover.dataset.renderKey = '';
              renderTokenPopover(popover, lastStatsData, modelName);
            }
          });
        }
      };
    }
    if (prevPopFocus) {
      restoreFocusDescriptor(popover, prevPopFocus);
    }
  }

  function toggleTokenPopover(bar, stats, modelName) {
    if (!bar) return;
    ensureMilkThemeStyles();
    installWallpaperMenuDismissListeners();
    let popover = document.getElementById('antigravity-token-popover');
    if (popover && popover.style && popover.style.display !== 'none') {
      closeTokenPopover(false);
      return;
    }
    popoverPrevFocusEl = document.activeElement || null;
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'antigravity-token-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', 'Монитор сессии');
      popover.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
    }
    if (popover.parentElement !== bar) {
      bar.appendChild(popover);
    }
    if (popover.dataset) popover.dataset.renderKey = '';
    renderTokenPopover(popover, stats, modelName);
    popover.style.display = 'block';
    const pill = document.getElementById('antigravity-token-pill');
    if (pill) pill.setAttribute('aria-expanded', 'true');
    const popFocusTarget = popover.querySelector && (popover.querySelector('[role="tab"][aria-selected="true"]') || popover.querySelector('button'));
    if (popFocusTarget && typeof popFocusTarget.focus === 'function') {
      try { popFocusTarget.focus({ preventScroll: true }); } catch (_) { try { popFocusTarget.focus(); } catch (__) {} }
    }
  }

  // =========================================================================
  // Home Screen Wallpaper Engine (periodic rotation, crossfade, auto-hide)
  // =========================================================================
  const WALLPAPER_ROTATE_MS = 45000;
  let wallpaperFiles = [];
  let wallpaperLastScanMs = 0;
  let wallpaperIndex = 0;
  let wallpaperActiveSlot = 0;
  let wallpaperLastSwitchMs = 0;
  let wallpaperBusy = false;
  let wallpaperSlotUrls = [null, null];
  let wallpaperBlobCache = new Map();
  let wallpaperThumbCache = new Map();
  let wallpaperThumbInflight = new Map();
  let wpLockHintMsg = '';
  let wpLockHintTimer = 0;
  let isCheckingWallpaper = false;
  let wallpaperTransitionRestoreTimer = 0;
  let backdropScanSignature = '';
  let backdropScanSkips = 0;

  let wallpaperTransparentNodes = [];
  let wallpaperClearedGradients = [];
  let milkBackdropNodes = [];
  let milkScrollFeedEl = null;
  let milkChatFrameEl = null;
  let milkFrameStageEl = null;
  let milkFrameFeedEl = null;
  let milkFrameColEl = null;
  let milkFrameRaf = 0;
  let milkFrameResizeObs = null;
  let milkScrollBoundFeed = null;
  let milkSidebarEl = null;
  let milkHeaderEl = null;
  let milkHeaderEls = [];
  let milkGreetingEl = null;
  let milkOverviewCardEl = null;
  let milkActiveSidebarItem = null;

  const FX_PREFS_STORAGE_KEY = 'agy_milk_fx_prefs_v1';
  const DEFAULT_FX_PREFS = {
    autoRotate: false,
    particles: true,
    crt: true,
    parallax: true,
    spotlight: true,
    vhsSwitch: true,
    scrimOpacity: 100,
    greetingMode: 'center',
    homeWpFile: '',
    chatWpFile: ''
  };

  function loadFxPrefs() {
    try {
      if (window.localStorage && typeof window.localStorage.getItem === 'function') {
        const raw = window.localStorage.getItem(FX_PREFS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            return { ...DEFAULT_FX_PREFS, ...parsed };
          }
        }
      }
    } catch (_) {}
    return { ...DEFAULT_FX_PREFS };
  }

  function saveFxPrefs() {
    try {
      if (window.localStorage && typeof window.localStorage.setItem === 'function') {
        window.localStorage.setItem(FX_PREFS_STORAGE_KEY, JSON.stringify(fxPrefs));
      }
    } catch (_) {}
    try {
      const bridge = window.antigravityTokenBridge;
      if (bridge && typeof bridge.setFxPrefs === 'function') {
        const ret = bridge.setFxPrefs({ ...fxPrefs });
        if (ret && typeof ret.catch === 'function') ret.catch(() => {});
      }
    } catch (_) {}
  }

  function applyScrimStyle(inChat) {
    const scrim = document.getElementById('antigravity-wp-scrim');
    if (!scrim) return;
    const rawPct = typeof fxPrefs.scrimOpacity === 'number' && !Number.isNaN(fxPrefs.scrimOpacity)
      ? fxPrefs.scrimOpacity
      : 100;
    const mult = Math.max(0, Math.min(1, rawPct / 100));
    const a = (base) => (base * mult).toFixed(3);
    scrim.style.background = inChat
      ? `radial-gradient(circle at center, rgba(10,10,14,${a(0.24)}) 0%, rgba(10,10,14,${a(0.58)}) 100%)`
      : `radial-gradient(circle at center, rgba(10,10,14,${a(0.14)}) 0%, rgba(10,10,14,${a(0.52)}) 100%), linear-gradient(to top, rgba(10,10,14,${a(0.86)}) 0%, rgba(10,10,14,${a(0.12)}) 38%, rgba(10,10,14,${a(0.20)}) 100%)`;
    scrim.style.backdropFilter = 'none';
  }

  let fxPrefs = loadFxPrefs();
  let fxPrefsHydrated = false;
  let fxPrefsHydratePromise = null;

  function hydrateFxPrefsFromDisk() {
    if (fxPrefsHydrated) return Promise.resolve(fxPrefs);
    if (fxPrefsHydratePromise) return fxPrefsHydratePromise;
    fxPrefsHydratePromise = (async () => {
      try {
        const bridge = window.antigravityTokenBridge;
        if (bridge && typeof bridge.getFxPrefs === 'function') {
          const diskPrefs = await bridge.getFxPrefs();
          if (diskPrefs && typeof diskPrefs === 'object') {
            fxPrefs = { ...DEFAULT_FX_PREFS, ...fxPrefs, ...diskPrefs };
            try {
              if (window.localStorage && typeof window.localStorage.setItem === 'function') {
                window.localStorage.setItem(FX_PREFS_STORAGE_KEY, JSON.stringify(fxPrefs));
              }
            } catch (_) {}
          } else if (typeof bridge.setFxPrefs === 'function' && (fxPrefs.homeWpFile || fxPrefs.chatWpFile)) {
            const ret = bridge.setFxPrefs({ ...fxPrefs });
            if (ret && typeof ret.catch === 'function') ret.catch(() => {});
          }
        }
      } catch (_) {}
      fxPrefsHydrated = true;
      return fxPrefs;
    })();
    return fxPrefsHydratePromise;
  }
  // Fixed crimson/red Milk palette used uniformly across all wallpapers
  const RED_PALETTE = {
    accent: '198, 52, 60',
    bright: '255, 68, 82',
    secondary: '248, 224, 192',
    spotlight: '245, 165, 145',
    dust: '224, 64, 76'
  };
  let currentDynamicPalette = { ...RED_PALETTE };

  function applyDynamicPalette() {
    currentDynamicPalette = { ...RED_PALETTE };
    try {
      const rootStyle = document.documentElement && document.documentElement.style;
      if (rootStyle && typeof rootStyle.setProperty === 'function') {
        rootStyle.setProperty('--agy-accent-rgb', currentDynamicPalette.accent);
        rootStyle.setProperty('--agy-accent-bright-rgb', currentDynamicPalette.bright);
        rootStyle.setProperty('--agy-secondary-rgb', currentDynamicPalette.secondary);
        rootStyle.setProperty('--agy-spotlight-rgb', currentDynamicPalette.spotlight);
      }
    } catch (_) {}
    syncSurfaceThemeClass();

    if (typeof FX_PALETTE !== 'undefined' && Array.isArray(FX_PALETTE)) {
      FX_PALETTE[0] = currentDynamicPalette.bright;
      FX_PALETTE[1] = currentDynamicPalette.accent;
      FX_PALETTE[2] = currentDynamicPalette.secondary;
      FX_PALETTE[3] = currentDynamicPalette.dust;
      if (typeof fxParticles !== 'undefined' && Array.isArray(fxParticles)) {
        for (let i = 0; i < fxParticles.length; i++) {
          fxParticles[i].color = FX_PALETTE[i % FX_PALETTE.length];
        }
      }
    }
  }

  const MOD_OWNED_IDS = new Set([
    'antigravity-milk-style',
    'agy-milk-chat-frame',
    'antigravity-wallpaper-layer',
    'antigravity-wallpaper-menu',
    'antigravity-wallpaper-ctrl',
    'antigravity-wp-camera',
    'antigravity-wp-slot-0',
    'antigravity-wp-slot-1',
    'antigravity-wp-scrim',
    'antigravity-wp-spotlight',
    'antigravity-wp-fx-canvas',
    'antigravity-wp-crt',
    'antigravity-corner-dock',
    'antigravity-swarm-corner-btn',
    'antigravity-swarm-modal',
    'antigravity-token-stats-bar',
    'antigravity-token-popover'
  ]);

  function isModOwnedNode(el) {
    return Boolean(el && el.id && MOD_OWNED_IDS.has(el.id));
  }

  const OVERVIEW_PANEL_CSS = `
      html body .agy-milk-overview-card,
      .agy-milk-overview-card {
        background-color: rgba(11, 10, 17, 0.93) !important;
        background-image: linear-gradient(170deg, rgba(var(--agy-accent-rgb, 198, 52, 60), 0.12) 0%, rgba(11, 10, 17, 0.92) 48%, rgba(8, 8, 14, 0.96) 100%) !important;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.46) !important;
        border-radius: 6px !important;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.68), inset 0 1px 0 rgba(248, 224, 192, 0.06) !important;
        scrollbar-width: thin;
        scrollbar-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36) transparent;
        transition: border-color 0.35s ease, box-shadow 0.35s ease, background-color 0.3s ease;
      }
      .agy-milk-overview-card * {
        scrollbar-width: thin;
        scrollbar-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36) transparent;
      }
      .agy-milk-overview-card > div:not([role="button"]),
      .agy-milk-overview-card > div > div:not([role="button"]),
      .agy-milk-overview-inner-bg {
        background-color: transparent !important;
        box-shadow: none !important;
      }
      .agy-milk-overview-sep,
      .agy-milk-overview-card hr,
      .agy-milk-overview-card [class*="border-t"],
      .agy-milk-overview-card [class*="border-b"] {
        border-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.26) !important;
      }
      .agy-milk-overview-line {
        background-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.26) !important;
      }
      .agy-milk-overview-card button,
      .agy-milk-overview-card [role="button"],
      .agy-milk-overview-card [role="menuitem"],
      .agy-milk-overview-card [class*="cursor-pointer"],
      .agy-milk-overview-card a {
        transition: background-color 0.15s ease, color 0.15s ease, border-color 0.2s ease;
      }
      .agy-milk-overview-card button:hover,
      .agy-milk-overview-card [role="button"]:hover,
      .agy-milk-overview-card [role="menuitem"]:hover,
      .agy-milk-overview-card [class*="cursor-pointer"]:hover,
      .agy-milk-overview-card a:hover {
        background-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.18) !important;
      }
      .agy-milk-overview-card :is(button, a, [role="button"], [tabindex]):focus-visible {
        outline: 2px solid rgb(var(--agy-secondary-rgb, 248, 224, 192)) !important;
        outline-offset: 2px !important;
      }
      .agy-milk-overview-badge {
        background-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.26) !important;
        border: 1px solid rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.44) !important;
        border-radius: 4px !important;
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace) !important;
        font-variant-numeric: tabular-nums !important;
        color: rgb(var(--agy-secondary-rgb, 248, 224, 192)) !important;
      }
  `;

  function ensureMilkThemeStyles() {
    if (!document.documentElement || !document.documentElement.style || !document.documentElement.style.getPropertyValue || !document.documentElement.style.getPropertyValue('--agy-accent-rgb')) {
      applyDynamicPalette(currentDynamicPalette);
    } else {
      syncSurfaceThemeClass();
    }
    let style = document.getElementById('antigravity-milk-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'antigravity-milk-style';
      (document.head || document.documentElement || document.body).appendChild(style);
    }
    const nextCss = `
      :root {
        --agy-font-mono: "Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, SFMono-Regular, Menlo, monospace;
        --agy-surface-panel: rgba(11, 12, 19, 0.97);
        --agy-surface-card: rgba(16, 17, 26, 0.94);
        --agy-surface-subtle: rgba(248, 224, 192, 0.05);
        --agy-border-structural: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.44);
        --agy-border-subtle: rgba(248, 224, 192, 0.14);
        --agy-border-hairline: rgba(248, 224, 192, 0.10);
        --agy-text-primary: #f8f0e8;
        --agy-text-secondary: rgba(248, 240, 232, 0.88);
        --agy-text-muted: rgba(248, 224, 192, 0.78);
      }
      :root.agy-light-surface {
        --agy-surface-panel: rgba(252, 250, 248, 0.98);
        --agy-surface-card: rgba(244, 240, 237, 0.96);
        --agy-surface-subtle: rgba(0, 0, 0, 0.05);
        --agy-border-structural: rgba(24, 24, 27, 0.18);
        --agy-border-subtle: rgba(0, 0, 0, 0.14);
        --agy-border-hairline: rgba(0, 0, 0, 0.09);
        --agy-text-primary: #18181b;
        --agy-text-secondary: #27272a;
        --agy-text-muted: #52525b;
      }
      :root.agy-light-surface .agy-wp-menu-chip.is-active,
      :root.agy-light-surface .agy-wp-menu-pill.is-on {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.90);
        border-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 1);
        color: #ffffff;
      }
      .agy-mono {
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace);
        font-variant-numeric: tabular-nums;
      }
      @keyframes agy-milk-input-pulse {
        0%, 100% {
          border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.52);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
        }
        50% {
          border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.92);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.62);
        }
      }
      ::selection {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.38) !important;
        color: #fbf2ea !important;
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36) transparent;
      }
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36);
        border-radius: 9999px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.65);
      }
      .agy-milk-dialog-box {
        background-color: rgba(10, 11, 18, 0.92) !important;
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.38) !important;
        border-radius: 6px !important;
        padding: 14px 20px !important;
        box-sizing: border-box !important;
        min-width: 0 !important;
        overflow-x: clip !important;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.54) !important;
        transition: border-color 0.35s ease, box-shadow 0.35s ease;
      }
      .agy-milk-dialog-box.agy-milk-dialog-framed {
        background-color: transparent !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }
      .agy-milk-scroll-feed {
        clip-path: inset(1px 0 1px 0) !important;
      }
      #agy-milk-chat-frame {
        position: absolute;
        z-index: 1;
        pointer-events: none;
        box-sizing: border-box;
        background-color: rgba(10, 11, 18, 0.92);
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.38);
        border-radius: 6px;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.54);
        transition: border-color 0.35s ease, box-shadow 0.35s ease;
        display: none;
      }
      .agy-milk-table-wrap {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin-inline: 0 !important;
        left: auto !important;
        right: auto !important;
        transform: none !important;
        box-sizing: border-box !important;
      }
      .agy-milk-table-scroll {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: auto !important;
        box-sizing: border-box !important;
      }
      .agy-milk-dialog-box table,
      .agy-milk-dialog-box [role="table"],
      .agy-milk-table {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin-inline: 0 !important;
        left: auto !important;
        right: auto !important;
        transform: none !important;
        box-sizing: border-box !important;
      }
      .agy-milk-dialog-box th,
      .agy-milk-dialog-box td {
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
        white-space: normal !important;
      }
      .agy-milk-dialog-box th code,
      .agy-milk-dialog-box td code {
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }
      .agy-milk-dialog-box pre {
        background-color: rgba(7, 8, 14, 0.80) !important;
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.26) !important;
        border-radius: 4px !important;
      }
      .agy-milk-dialog-box :not(pre) > code {
        background-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.16) !important;
        border-radius: 4px !important;
      }
      .agy-milk-input-box:not(.agy-milk-input-shell),
      .agy-milk-input-surface {
        background-color: rgba(10, 11, 18, 0.93) !important;
        background-image: none !important;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.48) !important;
        border-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.48) !important;
        transition: border-color 0.35s ease, box-shadow 0.35s ease;
      }
      .agy-milk-input-box.agy-milk-input-shell {
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      .agy-milk-input-inner-clear {
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }
      .agy-milk-input-box:not(.agy-milk-input-shell):focus-within,
      .agy-milk-input-surface:focus-within {
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.78) !important;
      }
      .agy-milk-input-box.agy-milk-thinking:not(.agy-milk-input-shell),
      .agy-milk-input-box.agy-milk-thinking .agy-milk-input-surface {
        animation: agy-milk-input-pulse 1.8s ease-in-out infinite !important;
      }
      [role="menu"],
      [role="listbox"],
      [role="tooltip"],
      [data-radix-popper-content-wrapper] > [role="dialog"],
      [data-radix-popper-content-wrapper] > div,
      .monaco-menu-container,
      .monaco-hover,
      .quick-input-widget,
      .monaco-dialog-box {
        background-color: var(--agy-surface-panel, rgba(11, 12, 19, 0.97)) !important;
        color: var(--agy-text-primary, #f8f0e8) !important;
        border: 1px solid var(--agy-border-structural, rgba(248, 224, 192, 0.20)) !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.68) !important;
      }
      .agy-milk-sidebar {
        background-color: rgba(10, 10, 15, 0.90) !important;
        background-image: linear-gradient(180deg, rgba(var(--agy-accent-rgb, 198, 52, 60), 0.12) 0%, rgba(12, 10, 16, 0.86) 30%, rgba(8, 8, 13, 0.95) 100%) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-right: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36) !important;
        box-shadow: inset -1px 0 0 rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.10), 6px 0 24px rgba(0, 0, 0, 0.44);
        transition: border-color 0.45s ease, background-color 0.35s ease;
      }
      .agy-milk-sidebar > div,
      .agy-milk-sidebar > nav {
        background-color: transparent !important;
      }
      .agy-milk-sidebar button[aria-label*="New Conversation"],
      .agy-milk-sidebar a[href="/"] {
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.44) !important;
        border-radius: 4px !important;
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.15) !important;
        box-shadow: inset 0 1px 0 rgba(248, 224, 192, 0.06);
      }
      .agy-milk-sidebar button[aria-label*="New Conversation"]:hover,
      .agy-milk-sidebar a[href="/"]:hover {
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.78) !important;
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.26) !important;
      }
      .agy-milk-sidebar a,
      .agy-milk-sidebar button {
        transition: background-color 0.18s ease, border-color 0.25s ease, box-shadow 0.2s ease;
      }
      .agy-milk-sidebar a:hover,
      .agy-milk-sidebar button:hover {
        background-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.13) !important;
      }
      .agy-milk-sidebar-active {
        border: 1px solid rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.56) !important;
        border-radius: 4px !important;
        background-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.22) !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.34) !important;
      }
      .agy-milk-sidebar div:has(> button + button):not(:has(a)),
      .agy-milk-sidebar div:has(> [role="button"] + [role="button"]):not(:has(a)),
      .agy-milk-sidebar div:has(> span > button):not(:has(a)),
      .agy-milk-sidebar [class*="absolute"]:has(svg):not(:has(a)),
      .agy-milk-sidebar a > div:has(svg):not(:first-child),
      .agy-milk-sidebar button > div:has(svg):not(:first-child),
      .agy-milk-sidebar-actions-clear,
      .agy-milk-sidebar-actions-clear > * {
        background-color: transparent !important;
        background-image: none !important;
      }
      .agy-milk-header {
        background-color: rgba(11, 10, 16, 0.90) !important;
        background-image: linear-gradient(90deg, rgba(var(--agy-accent-rgb, 198, 52, 60), 0.12) 0%, rgba(12, 10, 16, 0.88) 42%, rgba(9, 9, 14, 0.94) 100%) !important;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.34) !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.36);
        transition: border-color 0.45s ease, background-color 0.35s ease;
      }
      @keyframes agy-milk-greeting-reveal {
        0% {
          opacity: 0;
          clip-path: inset(0 100% 0 0);
        }
        12% {
          opacity: 1;
        }
        100% {
          opacity: 1;
          clip-path: inset(0 0 0 0);
        }
      }
      .agy-milk-greeting {
        position: relative;
        width: max-content !important;
        max-width: min(88vw, 760px) !important;
        margin-left: auto !important;
        margin-right: auto !important;
        padding: 9px 20px !important;
        border-radius: 4px !important;
        background: rgba(9, 9, 15, 0.88) !important;
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.52) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.58) !important;
        color: rgb(var(--agy-secondary-rgb, 248, 224, 192)) !important;
        font-size: clamp(20px, 2.0vw, 27px) !important;
        line-height: 1.3 !important;
        font-weight: 500 !important;
        text-align: center !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.90) !important;
        letter-spacing: 0.015em;
        transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease, border-color 0.3s ease;
      }
      .agy-milk-greeting > * {
        font-size: inherit !important;
        line-height: inherit !important;
      }
      .agy-milk-greeting-anim {
        animation: agy-milk-greeting-reveal 0.85s cubic-bezier(0.22, 1, 0.36, 1) 1 both;
      }
      .agy-milk-greeting.agy-milk-greeting-top {
        transform: translateY(clamp(-155px, -17vh, -72px)) !important;
      }
      .agy-milk-greeting.agy-milk-greeting-center {
        transform: translateY(0) !important;
      }
      .agy-milk-greeting.agy-milk-greeting-bottom {
        transform: translateY(clamp(48px, 11vh, 105px)) !important;
      }
      .agy-milk-greeting.agy-milk-greeting-hidden {
        display: none !important;
      }
      ${OVERVIEW_PANEL_CSS}
      #antigravity-corner-dock {
        display: flex;
        align-items: center;
        gap: 8px;
        font-variant-numeric: tabular-nums;
      }
      #antigravity-token-stats-bar,
      #antigravity-swarm-modal {
        font-variant-numeric: tabular-nums;
      }
      #antigravity-wallpaper-ctrl,
      #antigravity-swarm-corner-btn {
        border-color: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.48) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.52);
      }
      #antigravity-wallpaper-ctrl:hover,
      #antigravity-swarm-corner-btn:hover,
      #antigravity-token-pill:hover {
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.84) !important;
      }
      #antigravity-swarm-corner-btn.has-subagents {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.24) !important;
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.72) !important;
        color: #f8f0e8 !important;
      }
      #antigravity-token-popover {
        position: absolute;
        bottom: calc(100% + 6px);
        right: 8px;
        z-index: 10001;
        width: min(332px, calc(100vw - 24px));
        max-height: calc(100vh - 96px);
        overflow-y: auto;
        padding: 12px 14px;
        border-radius: 6px;
        background: var(--agy-surface-panel, rgba(11, 12, 19, 0.97));
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.50);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.74);
        color: var(--agy-text-primary, #f8f0e8);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        user-select: none;
        box-sizing: border-box;
      }
      .agy-pop-metric-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 12px;
        padding: 6px 0 8px;
        margin-bottom: 8px;
        border-top: 1px solid var(--agy-border-hairline, rgba(248, 224, 192, 0.10));
        border-bottom: 1px solid var(--agy-border-hairline, rgba(248, 224, 192, 0.10));
      }
      .agy-pop-metric-grid.cols-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px 8px;
      }
      .agy-pop-metric-cell {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }
      .agy-pop-stat-lbl {
        font-size: 12px;
        color: var(--agy-text-muted, rgba(248, 224, 192, 0.78));
      }
      .agy-pop-stat-val {
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--agy-text-primary, #f8f0e8);
      }
      .agy-pop-sub-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        width: 100%;
        padding: 5px 8px;
        border-radius: 4px;
        border: 1px solid var(--agy-border-hairline, rgba(248, 224, 192, 0.10));
        background: var(--agy-surface-subtle, rgba(248, 224, 192, 0.04));
        color: var(--agy-text-primary, #f8f0e8);
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .agy-pop-sub-row:hover {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.18);
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.55);
      }
      .agy-pop-sub-row.is-warn {
        border-color: rgba(245, 158, 11, 0.45);
        background: rgba(245, 158, 11, 0.10);
      }
      .agy-pop-tool-chip {
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 12px;
        background: var(--agy-surface-subtle, rgba(248, 224, 192, 0.06));
        border: 1px solid var(--agy-border-hairline, rgba(248, 224, 192, 0.10));
        color: var(--agy-text-secondary, rgba(248, 240, 232, 0.88));
      }
      @keyframes agy-swarm-flow {
        to { stroke-dashoffset: -16; }
      }
      @keyframes agy-swarm-pulse {
        0%, 100% { opacity: 0.35; transform: scale(1); }
        50% { opacity: 0.95; transform: scale(1.06); }
      }
      .agy-swarm-edge-active {
        stroke-dasharray: 4 4;
        animation: agy-swarm-flow 0.7s linear infinite;
      }
      .agy-swarm-node-pulse {
        transform-box: fill-box;
        transform-origin: center;
        animation: agy-swarm-pulse 1.5s ease-in-out infinite;
      }
      .agy-wp-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(
          to right,
          rgb(var(--agy-accent-bright-rgb, 255, 68, 82)) 0%,
          rgb(var(--agy-accent-bright-rgb, 255, 68, 82)) var(--agy-slider-pct, 100%),
          var(--agy-border-subtle, rgba(248, 224, 192, 0.18)) var(--agy-slider-pct, 100%)
        );
        cursor: pointer;
      }
      .agy-wp-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 2px;
        background: rgb(var(--agy-accent-bright-rgb, 255, 68, 82));
        border: 1.5px solid #f8f0e8;
        cursor: pointer;
      }
      #antigravity-wallpaper-menu {
        position: absolute;
        bottom: 52px;
        right: 16px;
        z-index: 10000;
        width: min(416px, calc(100vw - 24px));
        max-height: calc(100vh - 80px);
        overflow-y: auto;
        padding: 14px 16px;
        border-radius: 6px;
        background: var(--agy-surface-panel, rgba(11, 12, 19, 0.97));
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.50);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.76);
        color: var(--agy-text-primary, #f8f0e8);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        user-select: none;
        box-sizing: border-box;
      }
      .agy-wp-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--agy-border-hairline, rgba(248, 224, 192, 0.10));
      }
      .agy-wp-thumb-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--agy-border-hairline, rgba(248, 224, 192, 0.10));
      }
      .agy-wp-thumb-btn {
        position: relative;
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        aspect-ratio: 16 / 9;
        padding: 0;
        margin: 0;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.28);
        background: rgba(16, 17, 26, 0.92);
        color: rgba(248, 240, 232, 0.85);
        cursor: pointer;
        display: block;
        transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease, opacity 0.15s ease;
      }
      .agy-wp-thumb-btn:hover {
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.76);
        transform: translateY(-1px);
      }
      .agy-wp-thumb-btn.is-active {
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.96);
        box-shadow: 0 0 0 1px rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.65), 0 4px 10px rgba(0, 0, 0, 0.45);
      }
      .agy-wp-thumb-btn.is-locked:not(.is-active) {
        cursor: not-allowed;
        transform: none;
      }
      .agy-wp-thumb-btn.is-locked:not(.is-active) .agy-wp-thumb-img,
      .agy-wp-thumb-btn.is-locked:not(.is-active) .agy-wp-thumb-fallback {
        opacity: 0.42;
        filter: grayscale(0.28);
      }
      .agy-wp-thumb-btn.is-locked:not(.is-active):hover {
        border-color: rgba(248, 224, 192, 0.22);
        transform: none;
      }
      .agy-wp-thumb-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        object-fit: cover;
        display: block;
        z-index: 1;
        opacity: 1;
        pointer-events: none;
      }
      .agy-wp-thumb-fallback {
        position: absolute;
        inset: 0;
        z-index: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace);
        font-size: 12px;
        font-weight: 700;
        color: rgba(248, 240, 232, 0.68);
        background: rgba(14, 15, 24, 0.94);
        pointer-events: none;
      }
      .agy-wp-thumb-idx {
        position: absolute;
        left: 4px;
        bottom: 4px;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 5px;
        border-radius: 3px;
        background: rgba(8, 8, 12, 0.88);
        color: #f8f0e8;
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace);
        font-size: 12px;
        font-weight: 700;
        line-height: 14px;
        pointer-events: none;
      }
      .agy-wp-thumb-pins {
        position: absolute;
        top: 4px;
        right: 4px;
        z-index: 2;
        padding: 1px 5px;
        border-radius: 3px;
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.95);
        border: 1px solid rgba(255, 204, 204, 0.50);
        color: #ffffff;
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace);
        font-size: 12px;
        font-weight: 800;
        line-height: 14px;
        letter-spacing: 0.02em;
        pointer-events: none;
      }
      .agy-wp-lock-note {
        margin: 0 0 8px;
        padding: 5px 8px;
        border-radius: 4px;
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.20);
        border: 1px solid rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.48);
        color: #ffe2e2;
        font-size: 12px;
        line-height: 1.35;
      }
      @keyframes agyWpLockPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 82, 0.75); }
        50% { box-shadow: 0 0 0 4px rgba(255, 68, 82, 0.25); }
      }
      .agy-wp-menu-chip.is-lock-pulse {
        animation: agyWpLockPulse 0.45s ease 2;
        border-color: rgba(255, 130, 138, 0.95) !important;
      }
      .agy-wp-menu-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 4px 9px;
        border-radius: 4px;
        border: 1px solid var(--agy-border-subtle, rgba(248, 224, 192, 0.14));
        background: var(--agy-surface-subtle, rgba(248, 224, 192, 0.05));
        color: var(--agy-text-secondary, rgba(248, 240, 232, 0.88));
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .agy-wp-menu-chip:hover {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.22);
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.65);
        color: var(--agy-text-primary, #ffffff);
      }
      .agy-wp-menu-chip.is-active {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36);
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.92);
        color: #ffffff;
      }
      .agy-wp-menu-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 5px 7px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--agy-text-secondary, rgba(248, 240, 232, 0.90));
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease;
      }
      .agy-wp-menu-toggle:hover {
        background: var(--agy-surface-subtle, rgba(248, 224, 192, 0.06));
      }
      .agy-wp-menu-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 4px;
        font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .agy-wp-menu-pill.is-on {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.34);
        border: 1px solid rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.72);
        color: rgb(var(--agy-secondary-rgb, 248, 224, 192));
      }
      .agy-wp-menu-pill.is-off {
        background: var(--agy-surface-subtle, rgba(248, 224, 192, 0.06));
        border: 1px solid var(--agy-border-subtle, rgba(248, 224, 192, 0.16));
        color: var(--agy-text-muted, rgba(248, 224, 192, 0.78));
      }
      #antigravity-wallpaper-layer {
        transition: opacity 0.65s ease, filter 0.65s ease;
      }
      #antigravity-wallpaper-layer.agy-wp-sleeping {
        opacity: 0.52 !important;
        filter: brightness(0.72) saturate(0.75);
      }
      #antigravity-wp-camera {
        position: absolute;
        inset: 0;
        transform-origin: center center;
        will-change: transform;
      }
      #antigravity-wp-spotlight {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.35s ease;
      }
      #antigravity-wp-crt {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
        background-image:
          repeating-linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0) 0px,
            rgba(255, 255, 255, 0) 2px,
            rgba(6, 4, 10, 0.20) 3px,
            rgba(201, 59, 61, 0.03) 4px
          ),
          radial-gradient(circle at center, transparent 58%, rgba(12, 4, 10, 0.34) 100%);
        opacity: 0.55;
      }
      #antigravity-wp-fx-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        z-index: 2;
        pointer-events: none;
        display: block;
      }
      #antigravity-token-pill:focus-visible,
      #antigravity-swarm-corner-btn:focus-visible,
      #antigravity-wallpaper-ctrl:focus-visible,
      #antigravity-wallpaper-menu button:focus-visible,
      #antigravity-token-popover button:focus-visible,
      #antigravity-swarm-modal button:focus-visible,
      .agy-wp-menu-chip:focus-visible,
      .agy-wp-menu-toggle:focus-visible,
      .agy-wp-thumb-btn:focus-visible,
      .agy-pop-sub-row:focus-visible,
      .agy-wp-slider:focus-visible {
        outline: 2px solid rgb(var(--agy-secondary-rgb, 248, 224, 192)) !important;
        outline-offset: 2px !important;
      }
      .agy-swarm-node-g:focus-visible {
        outline: none;
      }
      .agy-swarm-node-g:focus-visible rect:first-of-type {
        stroke: rgb(var(--agy-accent-bright-rgb, 255, 68, 82)) !important;
        stroke-width: 2.4px !important;
        stroke-dasharray: 4 2;
      }
      @media (prefers-reduced-motion: reduce) {
        .agy-milk-input-box.agy-milk-thinking,
        .agy-milk-greeting-anim,
        .agy-swarm-edge-active,
        .agy-swarm-node-pulse,
        .agy-wp-menu-chip.is-lock-pulse {
          animation: none !important;
        }
        #antigravity-wallpaper-layer,
        #antigravity-wp-spotlight,
        #agy-milk-chat-frame,
        .agy-milk-dialog-box,
        .agy-milk-input-box,
        .agy-milk-sidebar,
        .agy-milk-header,
        .agy-milk-greeting,
        .agy-wp-thumb-btn,
        .agy-wp-menu-chip {
          transition: none !important;
        }
      }
    `;
    if (style.textContent !== nextCss) {
      style.textContent = nextCss;
    }
  }

  function hideChatFrameBackdrop() {
    if (milkFrameRaf && typeof cancelAnimationFrame === 'function') {
      try { cancelAnimationFrame(milkFrameRaf); } catch (_) {}
      milkFrameRaf = 0;
    }
    if (milkChatFrameEl && milkChatFrameEl.style) {
      milkChatFrameEl.style.display = 'none';
    }
    if (milkScrollFeedEl && milkScrollFeedEl.classList) {
      try { milkScrollFeedEl.classList.remove('agy-milk-scroll-feed'); } catch (_) {}
    }
    milkScrollFeedEl = null;
    milkFrameStageEl = null;
    milkFrameFeedEl = null;
    milkFrameColEl = null;
  }

  function syncChatFrameGeometry() {
    milkFrameRaf = 0;
    const frame = milkChatFrameEl;
    const stage = milkFrameStageEl;
    const feed = milkFrameFeedEl;
    const col = milkFrameColEl;
    if (!frame || !stage || !feed || !col || !stage.isConnected || !feed.isConnected || !col.isConnected) {
      if (frame && frame.style) frame.style.display = 'none';
      return;
    }
    try {
      const stageRect = stage.getBoundingClientRect();
      const feedRect = feed.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      const visTop = Math.max(feedRect.top, colRect.top);
      const visBottom = Math.min(feedRect.bottom, colRect.bottom);
      const h = visBottom - visTop;
      if (colRect.width < 120 || h < 24) {
        frame.style.display = 'none';
        if (col.classList) col.classList.remove('agy-milk-dialog-framed');
        return;
      }
      if (col.classList && !col.classList.contains('agy-milk-dialog-framed')) {
        col.classList.add('agy-milk-dialog-framed');
      }
      const left = Math.round(colRect.left - stageRect.left - (stage.clientLeft || 0));
      const top = Math.round(visTop - stageRect.top - (stage.clientTop || 0));
      const width = Math.round(colRect.width);
      const height = Math.round(h);
      frame.style.left = `${left}px`;
      frame.style.top = `${top}px`;
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      frame.style.display = 'block';
    } catch (_) {
      frame.style.display = 'none';
    }
  }

  function scheduleChatFrameSync() {
    if (milkFrameRaf) return;
    if (typeof requestAnimationFrame === 'function') {
      milkFrameRaf = requestAnimationFrame(syncChatFrameGeometry);
    } else {
      syncChatFrameGeometry();
    }
  }

  function syncPromptBarSpacing(feed, box, inChat) {
    if (!box) return;
    try {
      const surfaceEl = (typeof box.querySelector === 'function' ? box.querySelector('.agy-milk-input-surface') : null) || box;
      const bar = typeof document.getElementById === 'function' ? document.getElementById('antigravity-token-stats-bar') : null;
      const TARGET_GAP = 6;

      let actualTopGap = TARGET_GAP;
      if (inChat && feed && typeof feed.getBoundingClientRect === 'function' && typeof surfaceEl.getBoundingClientRect === 'function') {
        const feedRect = feed.getBoundingClientRect();
        const surfaceRect = surfaceEl.getBoundingClientRect();
        const curBoxMt = parseFloat(box.style && box.style.marginTop) || 0;
        const rawTopGap = (surfaceRect.top - feedRect.bottom) - curBoxMt;
        if (rawTopGap >= -4 && rawTopGap <= 18) {
          const nextBoxMt = Math.max(0, Math.min(12, Math.round(TARGET_GAP - rawTopGap)));
          if (Math.abs(nextBoxMt - curBoxMt) >= 1) {
            box.style.marginTop = `${nextBoxMt}px`;
          }
          actualTopGap = rawTopGap + nextBoxMt;
        } else if (box.style && box.style.marginTop) {
          box.style.removeProperty('margin-top');
        }
      } else if (box.style && box.style.marginTop) {
        box.style.removeProperty('margin-top');
      }

      if (bar && bar.isConnected && typeof bar.getBoundingClientRect === 'function' && typeof surfaceEl.getBoundingClientRect === 'function') {
        const sRect = surfaceEl.getBoundingClientRect();
        const bRect = bar.getBoundingClientRect();
        const curBarMt = parseFloat(bar.style && bar.style.marginTop) || 0;
        const rawBotGap = (bRect.top - sRect.bottom) - curBarMt;
        if (rawBotGap >= -4 && rawBotGap <= 24) {
          const wantGap = (inChat && feed) ? Math.max(4, Math.min(10, Math.round(actualTopGap))) : 6;
          const nextBarMt = Math.max(-12, Math.min(12, Math.round(wantGap - rawBotGap)));
          if (Math.abs(nextBarMt - curBarMt) >= 1) {
            bar.style.marginTop = `${nextBarMt}px`;
          }
        }
      }
    } catch (_) {}
  }

  function clearChatMessageBackdrops() {
    for (const node of milkBackdropNodes) {
      try {
        if (node && node.classList) {
          node.classList.remove('agy-milk-dialog-box');
          node.classList.remove('agy-milk-dialog-framed');
        }
      } catch (_) {}
    }
    milkBackdropNodes = [];
    hideChatFrameBackdrop();
  }

  function ensureSidebarAndHeaderTheme(stage, box, convId) {
    try {
      // 1. Detect & theme left sidebar
      const anchor = typeof document.querySelector === 'function'
        ? document.querySelector('button[aria-label*="New Conversation"], a[href="/"]')
        : null;
      let nextSidebar = null;
      if (anchor) {
        let cur = anchor.parentElement;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          if (cur.contains && stage && cur.contains(stage)) break;
          const r = typeof cur.getBoundingClientRect === 'function' ? cur.getBoundingClientRect() : null;
          if (stage && cur.parentElement === stage.parentElement) {
            nextSidebar = cur;
            break;
          }
          if (r && r.width >= 140 && r.width <= 460 && r.height >= (window.innerHeight || 600) * 0.5) {
            nextSidebar = cur;
          }
          cur = cur.parentElement;
        }
      }
      if (milkSidebarEl && milkSidebarEl !== nextSidebar && milkSidebarEl.classList) {
        milkSidebarEl.classList.remove('agy-milk-sidebar');
      }
      if (nextSidebar && nextSidebar.classList) {
        nextSidebar.classList.add('agy-milk-sidebar');
        milkSidebarEl = nextSidebar;
        if (milkSidebarEl.dataset && milkSidebarEl.dataset.agyHoverWired !== '1' && typeof milkSidebarEl.addEventListener === 'function') {
          milkSidebarEl.dataset.agyHoverWired = '1';
          const clearActionStripInRow = (target) => {
            let row = target;
            while (row && row !== milkSidebarEl) {
              const r = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null;
              if (r && r.width >= 120 && r.height >= 22 && r.height <= 64) {
                const kids = typeof row.querySelectorAll === 'function' ? row.querySelectorAll('div, span') : [];
                for (const el of kids) {
                  if (!el || el === row) continue;
                  const er = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
                  if (!er || er.width > 140 || er.height > 44 || er.width < 24) continue;
                  const btns = typeof el.querySelectorAll === 'function' ? el.querySelectorAll('button, [role="button"], svg') : [];
                  if (btns.length >= 2 && el.classList) {
                    el.classList.add('agy-milk-sidebar-actions-clear');
                  }
                }
                break;
              }
              row = row.parentElement;
            }
          };
          const hoverFn = (e) => {
            if (!e || !e.target) return;
            clearActionStripInRow(e.target);
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => clearActionStripInRow(e.target));
            }
          };
          milkSidebarEl.addEventListener('mouseover', hoverFn, { passive: true });
          window.__antigravity_sidebar_hover_el = milkSidebarEl;
          window.__antigravity_sidebar_hover_fn = hoverFn;
        }
      }

      // Highlight active conversation row in sidebar
      let nextActiveItem = null;
      if (convId && milkSidebarEl && typeof milkSidebarEl.querySelectorAll === 'function') {
        const links = milkSidebarEl.querySelectorAll('a[href*="/c/"], button[data-conversation-id]');
        for (const item of links) {
          const href = item.getAttribute ? (item.getAttribute('href') || '') : '';
          const dataId = item.dataset ? item.dataset.conversationId : '';
          if ((href && href.includes(`/c/${convId}`)) || dataId === convId) {
            nextActiveItem = item;
            break;
          }
        }
      }
      if (milkActiveSidebarItem && milkActiveSidebarItem !== nextActiveItem && milkActiveSidebarItem.classList) {
        milkActiveSidebarItem.classList.remove('agy-milk-sidebar-active');
      }
      if (nextActiveItem && nextActiveItem.classList) {
        nextActiveItem.classList.add('agy-milk-sidebar-active');
      }
      milkActiveSidebarItem = nextActiveItem;

      // 2. Detect & theme top header/titlebar strips
      const nextHeaders = [];
      const addHeaderCandidate = (el) => {
        if (!el || nextHeaders.includes(el)) return;
        if (el === stage || el === milkSidebarEl || el === box) return;
        if (el.id && el.id.startsWith('antigravity-')) return;
        if (stage && el.contains && el.contains(stage)) return;
        if (box && el.contains && el.contains(box)) return;
        nextHeaders.push(el);
      };
      if (typeof document.querySelectorAll === 'function') {
        for (const hEl of document.querySelectorAll('header, [role="banner"], [role="menubar"], [class*="titlebar" i]')) {
          const hr = typeof hEl.getBoundingClientRect === 'function' ? hEl.getBoundingClientRect() : null;
          if (!hr || hr.height === 0 || (hr.top <= 84 && hr.height <= 68 && hr.width >= 300)) {
            addHeaderCandidate(hEl);
          }
        }
      }
      if (stage) {
        const searchRoots = [];
        let anc = stage.parentElement;
        let hops = 0;
        while (anc && hops < 10) {
          searchRoots.push(anc);
          if (anc === document.body) break;
          anc = anc.parentElement;
          hops++;
        }
        if (document.body && !searchRoots.includes(document.body)) {
          searchRoots.push(document.body);
        }
        for (const root of searchRoots) {
          if (!root || !root.children) continue;
          for (const ch of Array.from(root.children)) {
            if (!ch || ch === stage || ch === milkSidebarEl || ch === box) continue;
            if (ch.id === 'antigravity-wallpaper-layer' || ch.id === 'antigravity-wallpaper-ctrl' || ch.id === 'antigravity-wallpaper-menu' || ch.id === 'antigravity-corner-dock' || ch.id === 'antigravity-swarm-corner-btn') continue;
            if (ch.contains && (ch.contains(stage) || (box && ch.contains(box)))) continue;
            const r = typeof ch.getBoundingClientRect === 'function' ? ch.getBoundingClientRect() : null;
            if (!r) continue;
            if (r.top <= 84 && r.height >= 20 && r.height <= 64 && r.width >= 360) {
              addHeaderCandidate(ch);
            } else if (r.top <= 24 && r.height > 64 && r.height <= 130 && r.width >= 360 && ch.children) {
              for (const sub of Array.from(ch.children)) {
                if (!sub || (sub.contains && sub.contains(stage))) continue;
                const sr = typeof sub.getBoundingClientRect === 'function' ? sub.getBoundingClientRect() : null;
                if (sr && sr.top <= 84 && sr.height >= 20 && sr.height <= 64 && sr.width >= 360) {
                  addHeaderCandidate(sub);
                }
              }
            }
          }
        }
      }
      for (const oldH of milkHeaderEls) {
        if (oldH && !nextHeaders.includes(oldH) && oldH.classList) {
          oldH.classList.remove('agy-milk-header');
        }
      }
      for (const h of nextHeaders) {
        if (h && h.classList) h.classList.add('agy-milk-header');
      }
      milkHeaderEls = nextHeaders;
      milkHeaderEl = nextHeaders[0] || null;
    } catch (_) {}
  }

  function normalizeGreetingMode(mode) {
    return (mode === 'top' || mode === 'center' || mode === 'bottom' || mode === 'hidden') ? mode : 'center';
  }

  function applyGreetingModeClass(el) {
    if (!el || !el.classList) return;
    const mode = normalizeGreetingMode(fxPrefs.greetingMode);
    el.classList.remove('agy-milk-greeting-top', 'agy-milk-greeting-center', 'agy-milk-greeting-bottom', 'agy-milk-greeting-hidden');
    el.classList.add(`agy-milk-greeting-${mode}`);
  }

  function clearHomeGreetingTheme() {
    if (milkGreetingEl && milkGreetingEl.classList) {
      milkGreetingEl.classList.remove(
        'agy-milk-greeting',
        'agy-milk-greeting-anim',
        'agy-milk-greeting-top',
        'agy-milk-greeting-center',
        'agy-milk-greeting-bottom',
        'agy-milk-greeting-hidden'
      );
    }
    milkGreetingEl = null;
  }

  function ensureHomeGreetingTheme(stage, box, inChat) {
    try {
      if (inChat || !stage || typeof stage.querySelectorAll !== 'function') {
        clearHomeGreetingTheme();
        return;
      }
      const greetingRe = /welcome back|good to see you|what'?s next|where should we pick up|ready when you are|how can i help|с возвращением|рад.*видеть|чем займ[её]мся/i;
      const boxRect = box && typeof box.getBoundingClientRect === 'function' ? box.getBoundingClientRect() : null;
      const hasBoxGeom = Boolean(boxRect && boxRect.height > 0 && boxRect.top > 0);
      const nodes = stage.querySelectorAll('h1, h2, h3, h4, p, div, span');
      let matchEl = null;
      let matchScore = -1;
      const limit = Math.min(nodes.length, 360);
      for (let i = 0; i < limit; i++) {
        const el = nodes[i];
        if (!el || el === stage || el === box || el === milkSidebarEl || milkHeaderEls.includes(el)) continue;
        if (el.id && el.id.startsWith('antigravity-')) continue;
        if (box && ((box.contains && box.contains(el)) || (el.contains && el.contains(box)))) continue;
        if (el.closest && el.closest('#antigravity-wallpaper-layer, #antigravity-wallpaper-menu, #antigravity-wallpaper-ctrl, #antigravity-corner-dock, #antigravity-token-stats-bar, button, a, [role="button"], [role="menu"]')) continue;
        if (el.querySelector && el.querySelector('textarea, input, button, a, select, [role="button"]')) continue;
        const txt = (el.textContent || '').trim();
        if (txt.length < 6 || txt.length > 160) continue;
        if (el.tagName === 'SPAN' && el.parentElement && !el.parentElement.querySelector('textarea, input, button')) {
          const pTxt = (el.parentElement.textContent || '').trim();
          if (pTxt.length >= 6 && pTxt.length <= 160) continue;
        }
        const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        if (r && r.height > 140) continue;
        if (hasBoxGeom && r && r.height > 0 && (r.bottom > boxRect.top + 16 || r.top < 24 || r.width < 80)) continue;

        let fontPx = 0;
        try {
          fontPx = parseFloat(window.getComputedStyle(el).fontSize || '0') || 0;
        } catch (_) {}
        const isPhrase = greetingRe.test(txt);
        const isHeadingTag = el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3';
        const isLargeText = fontPx >= 17;
        const isAbovePromptWide = Boolean(hasBoxGeom && r && r.height >= 16 && r.width >= 160 && r.bottom <= boxRect.top);
        if (!isPhrase && !isHeadingTag && !isLargeText && !isAbovePromptWide) continue;

        let score = 0;
        if (isPhrase) score += 10;
        if (isHeadingTag) score += 5;
        if (isLargeText) score += 4;
        if (isAbovePromptWide) score += 2;
        if (score >= matchScore) {
          matchScore = score;
          matchEl = el;
        }
      }
      if (!matchEl) {
        clearHomeGreetingTheme();
        return;
      }
      if (milkGreetingEl && milkGreetingEl !== matchEl) {
        clearHomeGreetingTheme();
      }
      if (matchEl.classList) {
        matchEl.classList.add('agy-milk-greeting');
        applyGreetingModeClass(matchEl);
        if (!isReducedMotion() && (!matchEl.dataset || matchEl.dataset.agyGreetingTyped !== '1')) {
          matchEl.classList.add('agy-milk-greeting-anim');
          if (matchEl.dataset) matchEl.dataset.agyGreetingTyped = '1';
        }
      }
      milkGreetingEl = matchEl;
    } catch (_) {}
  }

  function hasOverviewCardLandmarks(text) {
    if (!text) return false;
    // Allow JSX-concatenated TitleCase boundaries like "OverviewReviewFilesTerminalExtensionsSubagents5Background Tasks14"
    const hasOverview = /Overview(?=$|[^a-z])/.test(text);
    const hasActions = /(?:Review|Files|Terminal|Extensions)(?=$|[^a-z])/.test(text);
    const hasSubs = /Subagents(?=$|[^a-z])/.test(text);
    const hasBgTasks = /Background Tasks(?=$|[^a-z])/.test(text);
    return (hasOverview && hasActions) || (hasSubs && hasBgTasks);
  }

  function clearOverviewPanelTheme() {
    if (milkOverviewCardEl) {
      if (milkOverviewCardEl.classList) {
        milkOverviewCardEl.classList.remove('agy-milk-overview-card');
      }
      if (typeof milkOverviewCardEl.querySelectorAll === 'function') {
        const clean = milkOverviewCardEl.querySelectorAll('.agy-milk-overview-sep, .agy-milk-overview-badge, .agy-milk-overview-inner-bg, .agy-milk-overview-line');
        for (let i = 0; i < clean.length; i++) {
          clean[i].classList.remove('agy-milk-overview-sep', 'agy-milk-overview-badge', 'agy-milk-overview-inner-bg', 'agy-milk-overview-line');
        }
      }
    }
    milkOverviewCardEl = null;
  }

  function ensureOverviewPanelStylesInScope(el) {
    try {
      if (!el || typeof el.getRootNode !== 'function') return;
      const root = el.getRootNode();
      if (!root || root === document) return;
      const hostTarget = root.head || root;
      if (!hostTarget || typeof hostTarget.querySelector !== 'function') return;
      if (!hostTarget.querySelector('style[data-agy-milk-overview="1"]')) {
        const ownerDoc = root.ownerDocument || document;
        const st = ownerDoc.createElement('style');
        st.setAttribute('data-agy-milk-overview', '1');
        st.textContent = OVERVIEW_PANEL_CSS;
        hostTarget.appendChild(st);
      }
    } catch (_) {}
  }

  function ensureOverviewPanelTheme(stage, box) {
    try {
      ensureMilkThemeStyles();
      const itemRe = /(Overview|Review|Files|Terminal|Extensions|Subagents|Background Tasks)(?=$|[^a-z])/;
      const scrollFeed = stage && box ? findScrollFeedInStage(stage, box) : null;
      const chatTargets = stage && box ? findChatMessageTargets(stage, box) : [];
      const isInsideChatStream = (el) => {
        if (!el) return false;
        if (el.closest && el.closest('.agy-milk-dialog-box, article, [data-message-id], table, pre, code')) return true;
        for (let i = 0; i < chatTargets.length; i++) {
          const ct = chatTargets[i];
          if (ct && (ct === el || (ct.contains && ct.contains(el)))) return true;
        }
        return false;
      };

      let cardCandidate = null;
      if (milkOverviewCardEl && milkOverviewCardEl.isConnected) {
        const isNativeClass = milkOverviewCardEl.classList && milkOverviewCardEl.classList.contains('animate-overview-panel');
        const prevTxt = (milkOverviewCardEl.textContent || '');
        if ((isNativeClass || (hasOverviewCardLandmarks(prevTxt) && prevTxt.length <= 360)) && !isInsideChatStream(milkOverviewCardEl)) {
          let visible = true;
          try {
            const cst = window.getComputedStyle(milkOverviewCardEl);
            if (cst && (cst.display === 'none' || cst.visibility === 'hidden')) visible = false;
          } catch (_) {}
          if (visible) cardCandidate = milkOverviewCardEl;
        }
      }

      const maxH = (window.innerHeight || 900) * 0.94;
      const scoreOverviewAncestors = (startEl) => {
        let cur = startEl;
        let bestCard = null;
        let bestScore = -999;
        for (let depth = 0; cur && depth < 16; depth++) {
          if (cur === stage || cur === document.body || cur === document.documentElement || cur === milkSidebarEl || milkHeaderEls.includes(cur)) break;
          if (stage && cur.contains && cur.contains(stage)) break;
          if (isModOwnedNode(cur)) break;
          if (box && (cur === box || (cur.contains && cur.contains(box)))) break;
          if (cur.classList && cur.classList.contains('agy-milk-dialog-box')) break;
          if (cur.nodeType && cur.nodeType !== 1) {
            cur = cur.parentNode || cur.parentElement;
            continue;
          }
          if (isInsideChatStream(cur)) break;

          const isNativePanel = Boolean(cur.classList && cur.classList.contains('animate-overview-panel'));
          const cText = (cur.textContent || '').trim();
          if (!isNativePanel && cText.length > 360) break;
          if (isNativePanel || hasOverviewCardLandmarks(cText)) {
            const win = (cur.ownerDocument && cur.ownerDocument.defaultView) || window;
            const r = typeof cur.getBoundingClientRect === 'function' ? cur.getBoundingClientRect() : null;
            if (r && r.width > 540) break;
            if (r && r.height > maxH) break;
            const fitsCard = !r || r.width === 0 || (r.width >= 150 && r.width <= 540 && r.height >= 90 && r.height <= maxH);
            if (fitsCard) {
              let score = 1;
              if (cur.classList && cur.classList.contains('animate-overview-panel')) score += 12;
              if (/Overview(?=$|[^a-z])/.test(cText) && (/Subagents(?=$|[^a-z])/.test(cText) || /Background Tasks(?=$|[^a-z])/.test(cText))) {
                score += 6;
              }
              if (cText.length <= 240) score += 6;
              if (r && r.width >= 180 && r.width <= 440) score += 5;
              const svgs = typeof cur.querySelectorAll === 'function' ? cur.querySelectorAll('svg').length : 0;
              if (svgs >= 4) score += 10;
              const roleAttr = cur.getAttribute ? (cur.getAttribute('role') || '') : '';
              if (roleAttr === 'dialog' || roleAttr === 'menu') score += 8;
              if (scrollFeed && scrollFeed.contains && scrollFeed.contains(cur)) score -= 20;

              let posFloating = false;
              try {
                const st = win.getComputedStyle(cur);
                if (st && (st.display === 'none' || st.visibility === 'hidden')) {
                  cur = cur.parentElement;
                  continue;
                }
                if (st && (st.position === 'fixed' || st.position === 'absolute')) {
                  posFloating = true;
                  score += 10;
                }
                const hasBorder = st && parseFloat(st.borderTopWidth) > 0;
                const hasRadius = st && parseFloat(st.borderRadius) > 0;
                const hasBg = st && st.backgroundColor && st.backgroundColor !== 'transparent' && st.backgroundColor !== 'rgba(0, 0, 0, 0)';
                if (hasBorder) score += 4;
                if (hasRadius) score += 4;
                if (hasBg) score += 3;
                if (!hasBorder && !hasRadius && !hasBg) score -= 2;
              } catch (_) {}

              // Do not pick plain scrollFeed prose unless it is clearly a floating/dialog UI
              if (scrollFeed && scrollFeed.contains && scrollFeed.contains(cur) && !posFloating && svgs < 3 && roleAttr !== 'dialog' && roleAttr !== 'menu') {
                cur = cur.parentElement;
                continue;
              }

              if (score > bestScore) {
                bestScore = score;
                bestCard = cur;
              }
            }
          }
          cur = cur.parentElement || (cur.parentNode && cur.parentNode.host ? cur.parentNode.host : null);
        }
        return bestCard ? { el: bestCard, score: bestScore } : null;
      };

      let bestOverall = null;
      const considerHit = (hit) => {
        if (!hit || !hit.el) return;
        if (!bestOverall || hit.score > bestOverall.score) {
          bestOverall = hit;
        }
      };

      // Pass 1: Fast floating-popover / dialog selector match across document & open iframes
      if (!cardCandidate) {
        const popSel = '.animate-overview-panel, [role="dialog"], [role="menu"], [data-radix-popper-content-wrapper] > *, [data-state="open"]';
        const fastRoots = [];
        if (document.body) fastRoots.push(document.body);
        try {
          const frames = document.querySelectorAll('iframe');
          for (let i = 0; i < Math.min(frames.length, 8); i++) {
            try {
              const fDoc = frames[i].contentDocument;
              if (fDoc && fDoc.body) fastRoots.push(fDoc.body);
            } catch (_) {}
          }
        } catch (_) {}
        for (const rootEl of fastRoots) {
          if (!rootEl || typeof rootEl.querySelectorAll !== 'function') continue;
          const pops = rootEl.querySelectorAll(popSel);
          for (let i = 0; i < pops.length; i++) {
            const p = pops[i];
            if (!p || isModOwnedNode(p) || p === box || (box && box.contains && box.contains(p))) continue;
            if ((p.classList && p.classList.contains('animate-overview-panel')) || hasOverviewCardLandmarks(p.textContent || '')) {
              considerHit(scoreOverviewAncestors(p));
            }
          }
        }
        if (bestOverall) cardCandidate = bestOverall.el;
      }

      // Pass 2: Throttled heavy shadowRoot + TreeWalker fallback (avoids 6000-node DOM walks on every chat token)
      const nowOverviewMs = Date.now();
      if (!cardCandidate && typeof NodeFilter !== 'undefined' && (lastOverviewTreeWalkMs === 0 || (nowOverviewMs - lastOverviewTreeWalkMs) >= 2000)) {
        lastOverviewTreeWalkMs = nowOverviewMs;
        const searchRoots = [];
        if (document.body) searchRoots.push({ doc: document, root: document.body });
        try {
          const frames = document.querySelectorAll('iframe');
          for (let i = 0; i < Math.min(frames.length, 8); i++) {
            try {
              const fDoc = frames[i].contentDocument;
              if (fDoc && fDoc.body) searchRoots.push({ doc: fDoc, root: fDoc.body });
            } catch (_) {}
          }
        } catch (_) {}

        const seenRoots = new Set();
        for (let idx = 0; idx < searchRoots.length && idx < 24; idx++) {
          const entry = searchRoots[idx];
          if (!entry || !entry.root || seenRoots.has(entry.root)) continue;
          seenRoots.add(entry.root);
          try {
            if (typeof entry.root.querySelectorAll === 'function') {
              const all = entry.root.querySelectorAll('*');
              const cap = Math.min(all.length, 600);
              for (let k = 0; k < cap; k++) {
                if (all[k] && all[k].shadowRoot && !seenRoots.has(all[k].shadowRoot)) {
                  searchRoots.push({ doc: entry.doc, root: all[k].shadowRoot });
                }
              }
            }
          } catch (_) {}
        }

        const popSel = '.animate-overview-panel, [role="dialog"], [role="menu"], [data-radix-popper-content-wrapper] > *, [data-state="open"]';
        for (const entry of searchRoots) {
          if (!entry || !entry.root || entry.root === document.body || typeof entry.root.querySelectorAll !== 'function') continue;
          const pops = entry.root.querySelectorAll(popSel);
          for (let i = 0; i < pops.length; i++) {
            const p = pops[i];
            if (!p || isModOwnedNode(p) || p === box || (box && box.contains && box.contains(p))) continue;
            if ((p.classList && p.classList.contains('animate-overview-panel')) || hasOverviewCardLandmarks(p.textContent || '')) {
              considerHit(scoreOverviewAncestors(p));
            }
          }
        }

        const labelRe = /^(?:Overview|Subagents|Background Tasks)\b/i;
        const skipTags = new Set(['SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'PRE', 'CODE', 'TEXTAREA', 'INPUT', 'BLOCKQUOTE']);
        for (const entry of searchRoots) {
          if (!entry || !entry.doc || !entry.root || typeof entry.doc.createTreeWalker !== 'function') continue;
          const walker = entry.doc.createTreeWalker(
            entry.root,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            {
              acceptNode(node) {
                if (!node) return NodeFilter.FILTER_SKIP;
                if (node.nodeType === 1) {
                  const tag = (node.tagName || '').toUpperCase();
                  if (skipTags.has(tag)) return NodeFilter.FILTER_REJECT;
                  if (node === box || node === milkSidebarEl || isModOwnedNode(node)) return NodeFilter.FILTER_REJECT;
                  if (node.classList && node.classList.contains('agy-milk-dialog-box')) return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_SKIP;
                }
                if (node.nodeType === 3) {
                  const txt = node.nodeValue ? node.nodeValue.trim() : '';
                  if (txt.length >= 6 && txt.length <= 32 && labelRe.test(txt)) {
                    return NodeFilter.FILTER_ACCEPT;
                  }
                }
                return NodeFilter.FILTER_SKIP;
              }
            }
          );

          let curText;
          let safety = 0;
          while ((curText = walker.nextNode()) && safety++ < 6000) {
            const anchor = curText.parentElement;
            if (!anchor || milkHeaderEls.includes(anchor)) continue;
            if (isInsideChatStream(anchor)) continue;
            if (anchor.closest && anchor.closest('#antigravity-wallpaper-layer, #antigravity-wallpaper-menu, #antigravity-corner-dock, #antigravity-token-stats-bar, #antigravity-swarm-modal, .agy-milk-dialog-box')) {
              continue;
            }
            considerHit(scoreOverviewAncestors(anchor));
          }
        }
        if (bestOverall) cardCandidate = bestOverall.el;
      } else if (!cardCandidate && bestOverall) {
        cardCandidate = bestOverall.el;
      }

      if (!cardCandidate) {
        clearOverviewPanelTheme();
        return;
      }
      if (milkOverviewCardEl && milkOverviewCardEl !== cardCandidate) {
        clearOverviewPanelTheme();
      }
      ensureOverviewPanelStylesInScope(cardCandidate);
      if (cardCandidate.classList) {
        cardCandidate.classList.add('agy-milk-overview-card');
      }
      milkOverviewCardEl = cardCandidate;

      // Subtle divider tinting, inner opaque wrapper cleanup, & crimson count pills
      if (typeof cardCandidate.querySelectorAll === 'function') {
        const inner = cardCandidate.querySelectorAll('div, span');
        const innerCap = Math.min(inner.length, 160);
        const cardWin = (cardCandidate.ownerDocument && cardCandidate.ownerDocument.defaultView) || window;
        for (let i = 0; i < innerCap; i++) {
          const sub = inner[i];
          if (!sub || !sub.classList) continue;
          try {
            const st = cardWin.getComputedStyle(sub);
            if (st && (parseFloat(st.borderTopWidth) > 0 || parseFloat(st.borderBottomWidth) > 0)) {
              sub.classList.add('agy-milk-overview-sep');
            }
            const t = (sub.textContent || '').trim();
            const sr = typeof sub.getBoundingClientRect === 'function' ? sub.getBoundingClientRect() : null;
            if (sr && sr.height > 0 && sr.height <= 2 && sr.width >= 100 && !t) {
              sub.classList.add('agy-milk-overview-line');
              continue;
            }
            if (/^\d{1,4}$/.test(t) && (!sub.children || sub.children.length === 0)) {
              const p1 = sub.parentElement ? (sub.parentElement.textContent || '') : '';
              const p2 = sub.parentElement && sub.parentElement.parentElement ? (sub.parentElement.parentElement.textContent || '') : '';
              if ((p1.length < 60 && itemRe.test(p1)) || (p2.length < 60 && itemRe.test(p2))) {
                sub.classList.add('agy-milk-overview-badge');
              }
            } else if (st && st.backgroundColor && st.backgroundColor !== 'transparent' && st.backgroundColor !== 'rgba(0, 0, 0, 0)') {
              const alphaMatch = st.backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/i);
              const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
              if (alpha >= 0.45 && sub.tagName === 'DIV' && (!sub.getAttribute || sub.getAttribute('role') !== 'button')) {
                sub.classList.add('agy-milk-overview-inner-bg');
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function findScrollFeedInStage(stage, box) {
    if (!stage) return null;
    const stageH = typeof stage.getBoundingClientRect === 'function' ? stage.getBoundingClientRect().height : 600;
    const queue = stage.children ? Array.from(stage.children) : [];
    let best = null;
    let visited = 0;
    while (queue.length > 0 && visited < 80) {
      const node = queue.shift();
      visited++;
      if (!node || node === box || (box.contains && box.contains(node))) continue;
      if (node.id === 'antigravity-wallpaper-layer' || node.id === 'agy-milk-chat-frame' || node.id === 'antigravity-wallpaper-ctrl' || node.id === 'antigravity-wallpaper-menu' || node.id === 'antigravity-wp-fx-canvas' || node.id === 'antigravity-corner-dock') continue;
      try {
        const st = window.getComputedStyle(node);
        const isScroll = st && (st.overflowY === 'auto' || st.overflowY === 'scroll');
        const r = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
        if (isScroll && (!r || r.height >= stageH * 0.35)) {
          if (!node.contains || !node.contains(box)) return node;
          best = node;
        }
      } catch (_) {}
      if (node.children) {
        for (const ch of Array.from(node.children)) queue.push(ch);
      }
    }
    return best;
  }

  function findChatMessageTargets(stage, box) {
    const feed = findScrollFeedInStage(stage, box);
    if (!feed) return [];
    const boxW = typeof box.getBoundingClientRect === 'function' ? box.getBoundingClientRect().width : 720;
    const maxColW = boxW + 140;

    let cur = feed;
    for (let depth = 0; depth < 6; depth++) {
      if (!cur || !cur.children) break;
      const kids = Array.from(cur.children).filter(
        (c) => c && c !== box && (!box.contains || !box.contains(c)) && (!c.contains || !c.contains(box))
      );
      if (kids.length === 1) {
        const only = kids[0];
        const r = typeof only.getBoundingClientRect === 'function' ? only.getBoundingClientRect() : null;
        if (!r || r.width > maxColW) {
          cur = only;
          continue;
        }
        if ((only.textContent || '').trim().length > 0) {
          return [only];
        }
        break;
      }
      break;
    }

    if (cur !== feed) {
      const r = typeof cur.getBoundingClientRect === 'function' ? cur.getBoundingClientRect() : null;
      if ((!r || (r.width >= 260 && r.width <= maxColW)) && (!cur.contains || !cur.contains(box)) && (cur.textContent || '').trim().length > 0) {
        return [cur];
      }
    }

    const targets = [];
    if (cur && cur.children) {
      for (const ch of Array.from(cur.children)) {
        if (!ch || ch === box || (box.contains && box.contains(ch)) || (ch.contains && ch.contains(box))) continue;
        try {
          const r = typeof ch.getBoundingClientRect === 'function' ? ch.getBoundingClientRect() : null;
          if (r && (r.width < 240 || r.width > maxColW || r.height < 28)) continue;
          if ((ch.textContent || '').trim().length === 0) continue;
          targets.push(ch);
        } catch (_) {}
      }
    }
    return targets;
  }

  function constrainTablesInDialogBox(dialogBox) {
    if (!dialogBox || typeof dialogBox.querySelectorAll !== 'function') return;
    const tables = dialogBox.querySelectorAll('table, [role="table"]');
    if (!tables || tables.length === 0) return;

    let boxRect = null;
    try {
      boxRect = typeof dialogBox.getBoundingClientRect === 'function' ? dialogBox.getBoundingClientRect() : null;
    } catch (_) {}

    const wrapEls = new Set();
    const scrollEls = new Set();

    for (const tbl of tables) {
      if (tbl.classList) tbl.classList.add('agy-milk-table');
      if (tbl.parentElement && tbl.parentElement !== dialogBox) {
        scrollEls.add(tbl.parentElement);
      }
      let cur = tbl.parentElement;
      let hops = 0;
      while (cur && cur !== dialogBox && cur !== document.body && hops < 12) {
        hops++;
        let isProtruding = false;
        if (boxRect && boxRect.width > 0 && typeof cur.getBoundingClientRect === 'function') {
          try {
            const r = cur.getBoundingClientRect();
            if (r.width > boxRect.width + 1 || r.left < boxRect.left - 1 || r.right > boxRect.right + 1) {
              isProtruding = true;
            }
          } catch (_) {}
        }
        const isPureTableWrapper = typeof cur.querySelector === 'function'
          ? !cur.querySelector('p, h1, h2, h3, h4, ul, ol, pre, blockquote')
          : false;
        if (isProtruding || isPureTableWrapper) {
          wrapEls.add(cur);
        }
        cur = cur.parentElement;
      }
    }

    for (const el of wrapEls) {
      try {
        if (el.classList && !el.classList.contains('agy-milk-table-wrap')) {
          el.classList.add('agy-milk-table-wrap');
        }
      } catch (_) {}
    }
    for (const el of scrollEls) {
      try {
        if (el.classList && !el.classList.contains('agy-milk-table-scroll')) {
          el.classList.add('agy-milk-table-scroll');
        }
      } catch (_) {}
    }
  }

  function syncInputSurfaceTheme(box) {
    if (!box || !box.classList) return;
    box.classList.add('agy-milk-input-box');
    try {
      const field = typeof box.querySelector === 'function'
        ? box.querySelector('textarea, [contenteditable="true"], [role="textbox"]')
        : null;
      const chain = [];
      let cur = field ? field.parentElement : null;
      while (cur && cur !== box && chain.length < 10) {
        if (cur.tagName === 'DIV') chain.push(cur);
        cur = cur.parentElement;
      }

      let surfaceEl = null;
      for (let i = chain.length - 1; i >= 0; i--) {
        const el = chain[i];
        let isCard = false;
        try {
          const st = window.getComputedStyle(el);
          const hasBg = Boolean(st && st.backgroundColor && st.backgroundColor !== 'transparent' && st.backgroundColor !== 'rgba(0, 0, 0, 0)');
          const hasBorder = Boolean(st && (parseFloat(st.borderTopWidth) > 0 || parseFloat(st.borderBottomWidth) > 0));
          const hasRadius = Boolean(st && parseFloat(st.borderRadius) >= 8);
          const hasBtns = Boolean(el.querySelector && el.querySelector('button, [role="button"]'));
          if (hasBtns && (hasBg || hasBorder || hasRadius)) {
            isCard = true;
          } else if (hasBg && (hasBorder || hasRadius)) {
            isCard = true;
          }
        } catch (_) {}
        if (!isCard && el.className && typeof el.className === 'string' && /(rounded|bg-card|bg-input|border)/.test(el.className)) {
          isCard = true;
        }
        if (isCard) {
          surfaceEl = el;
          break;
        }
      }

      const prevSurfaces = box.querySelectorAll ? box.querySelectorAll('.agy-milk-input-surface, .agy-milk-input-inner-clear') : [];
      for (let i = 0; i < prevSurfaces.length; i++) {
        const ps = prevSurfaces[i];
        if (ps && ps.classList && ps !== surfaceEl) {
          ps.classList.remove('agy-milk-input-surface', 'agy-milk-input-inner-clear');
        }
      }

      if (surfaceEl && surfaceEl !== box) {
        box.classList.add('agy-milk-input-shell');
        surfaceEl.classList.add('agy-milk-input-surface');
        surfaceEl.classList.remove('agy-milk-input-inner-clear');
        for (let i = 0; i < chain.length; i++) {
          const innerEl = chain[i];
          if (innerEl === surfaceEl) break;
          if (innerEl && innerEl.classList && (!innerEl.querySelector || !innerEl.querySelector('button, [role="button"]'))) {
            innerEl.classList.add('agy-milk-input-inner-clear');
          }
        }
      } else {
        box.classList.remove('agy-milk-input-shell');
      }
    } catch (_) {}
  }

  function ensureChatMessageBackdrop(stage, box, inChat) {
    ensureMilkThemeStyles();
    if (box) {
      syncInputSurfaceTheme(box);
    }
    if (!inChat) {
      syncPromptBarSpacing(null, box, false);
      clearChatMessageBackdrops();
      return;
    }
    const feed = findScrollFeedInStage(stage, box);
    syncPromptBarSpacing(feed, box, true);
    const targets = findChatMessageTargets(stage, box);
    const nextSet = new Set(targets);
    for (const prev of milkBackdropNodes) {
      if (!nextSet.has(prev) && prev && prev.classList) {
        try {
          prev.classList.remove('agy-milk-dialog-box');
          prev.classList.remove('agy-milk-dialog-framed');
        } catch (_) {}
      }
    }
    for (const el of targets) {
      if (el && el.classList && !el.classList.contains('agy-milk-dialog-box')) {
        el.classList.add('agy-milk-dialog-box');
      }
      constrainTablesInDialogBox(el);
    }
    milkBackdropNodes = targets;

    if (stage && feed && targets.length === 1 && targets[0]) {
      const col = targets[0];
      if (milkScrollFeedEl && milkScrollFeedEl !== feed && milkScrollFeedEl.classList) {
        try { milkScrollFeedEl.classList.remove('agy-milk-scroll-feed'); } catch (_) {}
      }
      if (feed.classList && !feed.classList.contains('agy-milk-scroll-feed')) {
        feed.classList.add('agy-milk-scroll-feed');
      }
      milkScrollFeedEl = feed;

      if (!milkChatFrameEl) {
        milkChatFrameEl = document.getElementById('agy-milk-chat-frame');
      }
      if (!milkChatFrameEl) {
        milkChatFrameEl = document.createElement('div');
        milkChatFrameEl.id = 'agy-milk-chat-frame';
      }
      const wpLayer = document.getElementById('antigravity-wallpaper-layer');
      if (wpLayer && wpLayer.parentElement === stage) {
        if (milkChatFrameEl.parentElement !== stage || milkChatFrameEl.previousElementSibling !== wpLayer) {
          stage.insertBefore(milkChatFrameEl, wpLayer.nextSibling);
        }
      } else if (milkChatFrameEl.parentElement !== stage) {
        stage.insertBefore(milkChatFrameEl, stage.firstChild);
      }

      if (milkScrollBoundFeed !== feed) {
        if (milkScrollBoundFeed && milkScrollBoundFeed.__agyFrameScrollHandler) {
          try { milkScrollBoundFeed.removeEventListener('scroll', milkScrollBoundFeed.__agyFrameScrollHandler); } catch (_) {}
        }
        const onFeedScroll = () => scheduleChatFrameSync();
        feed.__agyFrameScrollHandler = onFeedScroll;
        feed.addEventListener('scroll', onFeedScroll, { passive: true });
        milkScrollBoundFeed = feed;
      }

      if (typeof ResizeObserver === 'function') {
        if (!milkFrameResizeObs) {
          milkFrameResizeObs = new ResizeObserver(() => scheduleChatFrameSync());
        }
        if (milkFrameFeedEl !== feed || milkFrameColEl !== col) {
          try { milkFrameResizeObs.disconnect(); } catch (_) {}
          try { milkFrameResizeObs.observe(feed); } catch (_) {}
          try { milkFrameResizeObs.observe(col); } catch (_) {}
        }
      }

      milkFrameStageEl = stage;
      milkFrameFeedEl = feed;
      milkFrameColEl = col;
      syncChatFrameGeometry();
    } else {
      for (const el of targets) {
        if (el && el.classList) el.classList.remove('agy-milk-dialog-framed');
      }
      hideChatFrameBackdrop();
    }
  }

  function findMainStage(box) {
    if (!box) return null;
    const minH = (window.innerHeight || 600) * 0.6;
    const boxRect = typeof box.getBoundingClientRect === 'function' ? box.getBoundingClientRect() : null;
    const boxW = boxRect ? boxRect.width : 0;
    let cur = box.parentElement;
    let fallback = null;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.id === 'root' || cur.id === 'app') break;
      // Only stop when reaching the app-level wrapper that includes the left New Conversation sidebar
      const hasLeftSidebar = cur.querySelector && cur.querySelector('button[aria-label*="New Conversation"], a[href="/"]');
      if (hasLeftSidebar) break;
      if (typeof cur.getBoundingClientRect === 'function') {
        const rect = cur.getBoundingClientRect();
        if (rect.height >= minH && rect.width >= 320) {
          if (!fallback) fallback = cur;
          let isScrollContainer = false;
          try {
            const st = window.getComputedStyle(cur);
            if (st && (st.overflowY === 'auto' || st.overflowY === 'scroll')) isScrollContainer = true;
          } catch (_) {}
          if (rect.width > boxW + 16 && !isScrollContainer) {
            return cur;
          }
        }
      } else if (!fallback) {
        fallback = cur;
      }
      cur = cur.parentElement;
    }
    return fallback || box.parentElement;
  }

  function restoreStageBackdrops() {
    for (const node of wallpaperTransparentNodes) {
      try {
        if (node && node.style) {
          if (node.dataset && 'agyOrigBg' in node.dataset) {
            node.style.backgroundColor = node.dataset.agyOrigBg;
            delete node.dataset.agyOrigBg;
          } else {
            node.style.removeProperty('background-color');
          }
        }
      } catch (_) {}
    }
    wallpaperTransparentNodes = [];
    for (const node of wallpaperClearedGradients) {
      try {
        if (node && node.style) {
          if (node.dataset && 'agyOrigBgImg' in node.dataset) {
            node.style.backgroundImage = node.dataset.agyOrigBgImg;
            delete node.dataset.agyOrigBgImg;
          } else {
            node.style.removeProperty('background-image');
          }
        }
      } catch (_) {}
    }
    wallpaperClearedGradients = [];
  }

  function clearLargeOpaqueBackdrops(stage, box) {
    if (!stage || !box) return;
    // Drop references to DOM nodes React has already unmounted (prevents memory leak)
    wallpaperTransparentNodes = wallpaperTransparentNodes.filter((n) => n && n.isConnected);
    wallpaperClearedGradients = wallpaperClearedGradients.filter((n) => n && n.isConnected);
    milkBackdropNodes = milkBackdropNodes.filter((n) => n && n.isConnected);
    const minH = (window.innerHeight || 600) * 0.45;
    const stageRect = typeof stage.getBoundingClientRect === 'function' ? stage.getBoundingClientRect() : null;
    const minW = stageRect ? stageRect.width * 0.6 : 320;
    const areaW = stageRect ? stageRect.width * 0.78 : minW;
    const areaH = stageRect ? stageRect.height * 0.5 : minH;

    const candidates = [];
    let p = box.parentElement;
    while (p && p !== stage && p !== document.body) {
      candidates.push(p);
      p = p.parentElement;
    }
    if (stage.children) {
      for (const ch of Array.from(stage.children)) {
        if (ch && ch.id !== 'antigravity-wallpaper-layer' && ch.id !== 'agy-milk-chat-frame' && ch.id !== 'antigravity-wallpaper-ctrl' && ch.id !== 'antigravity-wallpaper-menu' && ch.id !== 'antigravity-wp-fx-canvas' && ch.id !== 'antigravity-corner-dock' && ch !== box && (!box.contains || !box.contains(ch))) {
          candidates.push(ch);
          if (ch.children) {
            for (const sub of Array.from(ch.children)) {
              if (sub && sub !== box && (!box.contains || !box.contains(sub))) candidates.push(sub);
            }
          }
        }
      }
    }

    const bgWrites = [];
    for (const el of candidates) {
      if (!el || el === box || (box.contains && box.contains(el))) continue;
      if (el.classList && (el.classList.contains('agy-milk-dialog-box') || el.classList.contains('agy-milk-input-box') || el.classList.contains('agy-milk-overview-card'))) continue;
      if (el.dataset && ('agyOrigBg' in el.dataset) && el.style && el.style.backgroundColor === 'transparent') continue;
      try {
        const containsBox = typeof el.contains === 'function' ? el.contains(box) : false;
        if (typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          if (containsBox) {
            if (r.height < minH || r.width < minW) continue;
          } else {
            // Clear full-width scroll/chat-area wrappers above inputBox, but never individual narrower message bubbles
            if (r.height < areaH || r.width < areaW) continue;
          }
        }
        const st = window.getComputedStyle(el);
        const bg = st ? st.backgroundColor : '';
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
          bgWrites.push(el);
        }
      } catch (_) {}
    }

    // Also clear wide fade-out gradient strips (e.g. above the input box)
    const boxW = typeof box.getBoundingClientRect === 'function' ? box.getBoundingClientRect().width : 300;
    const minGradW = Math.max(240, Math.min(stageRect ? stageRect.width * 0.45 : boxW * 0.8, boxW * 0.8));
    const gradCandidates = [];
    const collectShallow = (node, depth) => {
      if (!node || depth > 8 || node === box || (box.contains && box.contains(node))) return;
      if (node.id === 'antigravity-wallpaper-layer' || node.id === 'agy-milk-chat-frame' || node.id === 'antigravity-wallpaper-ctrl' || node.id === 'antigravity-wallpaper-menu' || node.id === 'antigravity-wp-fx-canvas' || node.id === 'antigravity-corner-dock') return;
      gradCandidates.push(node);
      if (node.children) {
        for (const ch of Array.from(node.children)) collectShallow(ch, depth + 1);
      }
    };
    collectShallow(stage, 0);
    let anc = box.parentElement;
    while (anc && anc !== stage && anc !== document.body) {
      if (anc.children) {
        for (const sib of Array.from(anc.children)) {
          if (sib !== box && (!box.contains || !box.contains(sib))) gradCandidates.push(sib);
        }
      }
      anc = anc.parentElement;
    }

    const gradWrites = [];
    for (const el of gradCandidates) {
      if (!el || el === box || (box.contains && box.contains(el))) continue;
      if (el.dataset && ('agyOrigBgImg' in el.dataset) && el.style && el.style.backgroundImage === 'none') continue;
      try {
        if (typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          if (r.height < 6 || r.height > 220 || r.width < minGradW) continue;
        }
        const st = window.getComputedStyle(el);
        if (st && st.backgroundImage && st.backgroundImage.includes('gradient')) {
          gradWrites.push(el);
        }
      } catch (_) {}
    }

    // Batch all style writes after all layout/computedStyle reads
    for (const el of bgWrites) {
      try {
        if (el.dataset && !('agyOrigBg' in el.dataset)) {
          el.dataset.agyOrigBg = el.style.backgroundColor || '';
        }
        if (el.style.setProperty) {
          el.style.setProperty('background-color', 'transparent', 'important');
        } else {
          el.style.backgroundColor = 'transparent';
        }
        if (!wallpaperTransparentNodes.includes(el)) {
          wallpaperTransparentNodes.push(el);
        }
      } catch (_) {}
    }
    for (const el of gradWrites) {
      try {
        if (el.dataset && !('agyOrigBgImg' in el.dataset)) {
          el.dataset.agyOrigBgImg = el.style.backgroundImage || '';
        }
        if (el.style.setProperty) {
          el.style.setProperty('background-image', 'none', 'important');
        } else {
          el.style.backgroundImage = 'none';
        }
        if (!wallpaperClearedGradients.includes(el)) {
          wallpaperClearedGradients.push(el);
        }
      } catch (_) {}
    }
  }

  function ensureStageChildrenAbove(container) {
    if (!container || !container.children) return;
    for (const child of Array.from(container.children)) {
      if (!child || child === milkSidebarEl || child === milkHeaderEl || milkHeaderEls.includes(child)) continue;
      if (child.id === 'antigravity-wallpaper-layer' || child.id === 'agy-milk-chat-frame' || child.id === 'antigravity-wallpaper-ctrl' || child.id === 'antigravity-wallpaper-menu' || child.id === 'antigravity-wp-fx-canvas' || child.id === 'antigravity-corner-dock') continue;
      try {
        const st = window.getComputedStyle(child);
        if (st && st.position === 'static') {
          child.style.position = 'relative';
        }
        if (st && (st.zIndex === 'auto' || st.zIndex === '0')) {
          child.style.zIndex = '1';
        }
      } catch (_) {}
    }
  }

  async function refreshWallpaperList(force) {
    const now = Date.now();
    if (!force && wallpaperFiles.length > 0 && (now - wallpaperLastScanMs) < 120000) {
      return wallpaperFiles;
    }
    try {
      if (window.antigravityTokenBridge && typeof window.antigravityTokenBridge.listWallpapers === 'function') {
        const list = await window.antigravityTokenBridge.listWallpapers();
        if (Array.isArray(list)) {
          wallpaperFiles = list;
          wallpaperLastScanMs = now;
          if (wallpaperIndex >= wallpaperFiles.length) wallpaperIndex = 0;
        }
      }
    } catch (_) {}
    return wallpaperFiles;
  }

  async function showWallpaperAt(idx, opts = {}) {
    if (wallpaperBusy || wallpaperFiles.length === 0) return;
    if (!window.antigravityTokenBridge || typeof window.antigravityTokenBridge.readWallpaper !== 'function') return;

    const layer = document.getElementById('antigravity-wallpaper-layer');
    if (!layer) return;

    const immediate = Boolean(opts.immediate);
    const preserveTimer = Boolean(opts.preserveTimer);

    wallpaperBusy = true;
    try {
      const safeIdx = ((idx % wallpaperFiles.length) + wallpaperFiles.length) % wallpaperFiles.length;
      const fileName = wallpaperFiles[safeIdx];

      let cached = wallpaperBlobCache.get(fileName);
      if (cached) {
        // Refresh LRU position
        wallpaperBlobCache.delete(fileName);
        wallpaperBlobCache.set(fileName, cached);
      } else {
        const payload = await window.antigravityTokenBridge.readWallpaper(fileName);
        if (!payload || !payload.bytes) return;
        const blob = new Blob([payload.bytes], { type: payload.mime || 'image/png' });
        const url = URL.createObjectURL(blob);
        cached = { url, mime: payload.mime || 'image/png' };
        wallpaperBlobCache.set(fileName, cached);
        if (wallpaperBlobCache.size > 12) {
          const protectedUrls = new Set([wallpaperSlotUrls[0], wallpaperSlotUrls[1]]);
          const protectedNames = new Set([fileName, fxPrefs.homeWpFile, fxPrefs.chatWpFile]);
          for (const [key, val] of wallpaperBlobCache) {
            if (wallpaperBlobCache.size <= 12) break;
            if (protectedNames.has(key) || (val && protectedUrls.has(val.url))) continue;
            wallpaperBlobCache.delete(key);
            if (val && val.url && typeof URL.revokeObjectURL === 'function') {
              try { URL.revokeObjectURL(val.url); } catch (_) {}
            }
          }
        }
      }

      const nextUrl = cached.url;
      const isVideo = typeof cached.mime === 'string' && cached.mime.startsWith('video/');

      const nextSlot = wallpaperActiveSlot === 0 ? 1 : 0;
      const prevSlot = wallpaperActiveSlot;
      const slotEls = [
        document.getElementById('antigravity-wp-slot-0'),
        document.getElementById('antigravity-wp-slot-1')
      ];
      const targetSlotEl = slotEls[nextSlot];
      const prevSlotEl = slotEls[prevSlot];
      if (!targetSlotEl) return;

      targetSlotEl.innerHTML = '';
      applyDynamicPalette();
      if (isVideo) {
        const vid = document.createElement('video');
        vid.src = nextUrl;
        vid.autoplay = true;
        vid.loop = true;
        vid.muted = true;
        vid.playsInline = true;
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        targetSlotEl.appendChild(vid);
        if (typeof vid.play === 'function') {
          const playRet = vid.play();
          if (playRet && typeof playRet.catch === 'function') playRet.catch(() => {});
        }
      } else {
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;image-rendering:-webkit-optimize-contrast;';
        img.src = nextUrl;
        targetSlotEl.appendChild(img);
      }

      wallpaperSlotUrls[nextSlot] = nextUrl;

      if (wallpaperTransitionRestoreTimer) {
        clearTimeout(wallpaperTransitionRestoreTimer);
        wallpaperTransitionRestoreTimer = 0;
      }

      if (immediate) {
        targetSlotEl.style.transition = 'none';
        targetSlotEl.style.opacity = '1';
        targetSlotEl.style.filter = '';
        targetSlotEl.style.transform = '';
        if (prevSlotEl) {
          prevSlotEl.style.transition = 'none';
          prevSlotEl.style.opacity = '0';
        }
        // Restore crossfade transition for future switches (single tracked timer, no stale overwrites)
        wallpaperTransitionRestoreTimer = setTimeout(() => {
          wallpaperTransitionRestoreTimer = 0;
          targetSlotEl.style.transition = 'opacity 1.1s ease';
          if (prevSlotEl) prevSlotEl.style.transition = 'opacity 1.1s ease';
        }, 30);
      } else if (fxPrefs.vhsSwitch) {
        triggerVhsChannelSwitch(targetSlotEl, prevSlotEl);
      } else {
        targetSlotEl.style.transition = 'opacity 1.1s ease';
        targetSlotEl.style.opacity = '1';
        if (prevSlotEl) {
          prevSlotEl.style.transition = 'opacity 1.1s ease';
          prevSlotEl.style.opacity = '0';
        }
      }

      if (prevSlotEl) {
        const prevVid = prevSlotEl.querySelector && prevSlotEl.querySelector('video');
        if (prevVid && prevVid.pause) prevVid.pause();
      }

      wallpaperActiveSlot = nextSlot;
      wallpaperIndex = safeIdx;
      if (!preserveTimer || wallpaperLastSwitchMs === 0) {
        wallpaperLastSwitchMs = Date.now();
      }

      updateWallpaperCtrlLabel(fileName);
    } finally {
      wallpaperBusy = false;
    }
  }

  // =========================================================================
  // Atmospheric FX (pixel particles on Home + Chat; CRT glitch on Home)
  // Runs while !document.hidden
  // =========================================================================
  const FX_PARTICLE_COUNT = 240;
  const FX_PALETTE = [
    '255, 68, 82',   // #ff4452 bright crimson pixel
    '198, 52, 60',   // #c6343c deep crimson
    '248, 224, 192', // #f8e0c0 warm cream highlight
    '224, 64, 76'    // #e0404c red glow dust
  ];
  let fxRafId = 0;
  let fxGlitchWaitTimer = 0;
  let fxGlitchEndTimer = 0;
  let fxGlitchActiveUntil = 0;
  let fxGlitchSlices = [];
  let fxChannelSwitchUntil = 0;
  let fxChannelSwitchBands = [];
  let fxVhsSwitchTimer = 0;
  let fxVhsRestoreTimer = 0;
  let fxLastFrameMs = 0;
  let fxParticles = [];
  let fxLastSizeKey = '';
  let fxPointer = { x: -9999, y: -9999, active: false };
  let fxCam = { nx: 0, ny: 0, sx: 600, sy: 400, lightAlpha: 0, lastStateCheckMs: 0 };
  let fxMouseListenerInstalled = false;

  function triggerVhsChannelSwitch(targetSlotEl, prevSlotEl) {
    if (fxVhsSwitchTimer) {
      clearTimeout(fxVhsSwitchTimer);
      fxVhsSwitchTimer = 0;
    }
    if (fxVhsRestoreTimer) {
      clearTimeout(fxVhsRestoreTimer);
      fxVhsRestoreTimer = 0;
    }
    if (isReducedMotion()) {
      if (targetSlotEl && targetSlotEl.style) {
        targetSlotEl.style.transition = 'none';
        targetSlotEl.style.filter = '';
        targetSlotEl.style.transform = '';
        targetSlotEl.style.opacity = '1';
      }
      if (prevSlotEl && prevSlotEl.style) {
        prevSlotEl.style.transition = 'none';
        prevSlotEl.style.opacity = '0';
      }
      fxChannelSwitchBands = [];
      fxChannelSwitchUntil = 0;
      return;
    }
    if (targetSlotEl && targetSlotEl.style) {
      targetSlotEl.style.transition = 'opacity 0.22s ease, filter 0.16s ease, transform 0.16s ease';
      targetSlotEl.style.filter = 'contrast(1.34) saturate(1.45) brightness(1.14)';
      targetSlotEl.style.transform = `translateX(${Math.random() < 0.5 ? 4 : -4}px) scaleY(1.012)`;
      targetSlotEl.style.opacity = '1';
    }
    if (prevSlotEl && prevSlotEl.style) {
      prevSlotEl.style.transition = 'opacity 0.20s ease';
      prevSlotEl.style.opacity = '0';
    }

    fxChannelSwitchBands = [];
    for (let i = 0; i < 5; i++) {
      fxChannelSwitchBands.push({
        yNorm: 0.08 + Math.random() * 0.84,
        h: 2 + Math.floor(Math.random() * 6),
        dx: (Math.random() - 0.5) * 28,
        alpha: 0.16 + Math.random() * 0.24,
        bright: i % 2 === 0
      });
    }
    fxChannelSwitchUntil = Date.now() + 260;

    fxVhsSwitchTimer = setTimeout(() => {
      fxVhsSwitchTimer = 0;
      if (targetSlotEl && targetSlotEl.style) {
        targetSlotEl.style.filter = '';
        targetSlotEl.style.transform = '';
      }
    }, 150);

    fxVhsRestoreTimer = setTimeout(() => {
      fxVhsRestoreTimer = 0;
      if (targetSlotEl && targetSlotEl.style) targetSlotEl.style.transition = 'opacity 1.1s ease';
      if (prevSlotEl && prevSlotEl.style) prevSlotEl.style.transition = 'opacity 1.1s ease';
      fxChannelSwitchBands = [];
    }, 280);

    const canvas = document.getElementById('antigravity-wp-fx-canvas');
    if (canvas && !isAppInactive()) {
      canvas.style.display = 'block';
      if (!fxRafId && typeof requestAnimationFrame === 'function') {
        fxRafId = requestAnimationFrame(stepHomeAtmosphereFrame);
      }
    }
  }

  function clearSlotGlitchTransforms() {
    for (const id of ['antigravity-wp-slot-0', 'antigravity-wp-slot-1']) {
      const slot = document.getElementById(id);
      if (slot && slot.style) {
        slot.style.transform = '';
        slot.style.filter = '';
      }
    }
    fxGlitchSlices = [];
    fxGlitchActiveUntil = 0;
  }

  function stopHomeGlitchOnly() {
    if (fxGlitchWaitTimer) {
      clearTimeout(fxGlitchWaitTimer);
      fxGlitchWaitTimer = 0;
    }
    if (fxGlitchEndTimer) {
      clearTimeout(fxGlitchEndTimer);
      fxGlitchEndTimer = 0;
    }
    clearSlotGlitchTransforms();
    const crt = document.getElementById('antigravity-wp-crt');
    if (crt) crt.style.display = 'none';
  }
  window.__antigravity_stop_home_crt = stopHomeGlitchOnly;

  function stopHomeAtmosphereFx(fullTeardown, keepCanvasVisible) {
    if (fxRafId && typeof cancelAnimationFrame === 'function') {
      try { cancelAnimationFrame(fxRafId); } catch (_) {}
    }
    fxRafId = 0;
    if (wallpaperTransitionRestoreTimer) {
      clearTimeout(wallpaperTransitionRestoreTimer);
      wallpaperTransitionRestoreTimer = 0;
    }
    if (fxVhsSwitchTimer) {
      clearTimeout(fxVhsSwitchTimer);
      fxVhsSwitchTimer = 0;
    }
    if (fxVhsRestoreTimer) {
      clearTimeout(fxVhsRestoreTimer);
      fxVhsRestoreTimer = 0;
    }
    fxChannelSwitchBands = [];
    fxChannelSwitchUntil = 0;
    stopHomeGlitchOnly();

    const spotlight = document.getElementById('antigravity-wp-spotlight');
    if (spotlight && spotlight.style) {
      spotlight.style.opacity = '0';
      if (!keepCanvasVisible) spotlight.style.display = 'none';
    }
    fxCam.lightAlpha = 0;

    const canvas = document.getElementById('antigravity-wp-fx-canvas');
    if (canvas && !keepCanvasVisible) {
      canvas.style.display = 'none';
      try {
        const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      } catch (_) {}
    }
    if (fullTeardown) {
      if (window.__antigravity_fx_mousemove) {
        try { document.removeEventListener('mousemove', window.__antigravity_fx_mousemove); } catch (_) {}
        window.__antigravity_fx_mousemove = null;
      }
      if (window.__antigravity_fx_mouseleave) {
        try { document.removeEventListener('mouseleave', window.__antigravity_fx_mouseleave); } catch (_) {}
        window.__antigravity_fx_mouseleave = null;
      }
      fxMouseListenerInstalled = false;
      if (wallpaperBlobCache && typeof wallpaperBlobCache.values === 'function') {
        for (const entry of wallpaperBlobCache.values()) {
          if (entry && entry.url && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(entry.url); } catch (_) {}
          }
        }
        wallpaperBlobCache.clear();
      }
      if (wallpaperThumbCache && typeof wallpaperThumbCache.values === 'function') {
        for (const entry of wallpaperThumbCache.values()) {
          if (entry && entry.revokeOnClear && entry.url && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(entry.url); } catch (_) {}
          }
        }
        wallpaperThumbCache.clear();
      }
      wallpaperThumbInflight.clear();
      if (wpLockHintTimer) {
        clearTimeout(wpLockHintTimer);
        wpLockHintTimer = 0;
      }
      wpLockHintMsg = '';
    }
  }
  window.__antigravity_stop_fx = stopHomeAtmosphereFx;

  function initFxParticles(w, h) {
    const arr = [];
    const safeW = Math.max(w, 320);
    const safeH = Math.max(h, 240);
    for (let i = 0; i < FX_PARTICLE_COUNT; i++) {
      const r = Math.random();
      const speedRoll = Math.random();
      let speedVy;
      let speedVxSpread;
      if (speedRoll < 0.40) {
        // Slow drifting dust
        speedVy = -(0.08 + Math.random() * 0.16);
        speedVxSpread = 0.18;
      } else if (speedRoll < 0.75) {
        // Medium floaters
        speedVy = -(0.28 + Math.random() * 0.36);
        speedVxSpread = 0.30;
      } else {
        // Fast rising sparks
        speedVy = -(0.72 + Math.random() * 0.78);
        speedVxSpread = 0.46;
      }
      arr.push({
        x: Math.random() * safeW,
        y: Math.random() * safeH,
        vx: (Math.random() - 0.5) * speedVxSpread,
        vy: speedVy,
        swayAmp: 0.08 + Math.random() * 0.22,
        swayFreq: 0.45 + Math.random() * 0.90,
        size: r < 0.28 ? 4 : (r < 0.72 ? 3 : 2),
        alpha: 0.45 + Math.random() * 0.47,
        phase: Math.random() * Math.PI * 2,
        color: FX_PALETTE[Math.floor(Math.random() * FX_PALETTE.length)]
      });
    }
    return arr;
  }

  function scheduleNextHomeGlitch() {
    if (fxGlitchWaitTimer) clearTimeout(fxGlitchWaitTimer);
    if (isAppInactive() || getConversationIdFromLocation() || isReducedMotion()) return;
    const delayMs = 15000 + Math.floor(Math.random() * 5000);
    fxGlitchWaitTimer = setTimeout(() => {
      fxGlitchWaitTimer = 0;
      if (isAppInactive() || getConversationIdFromLocation()) return;
      const layer = document.getElementById('antigravity-wallpaper-layer');
      if (!layer || layer.style.display === 'none') return;

      const activeSlot = document.getElementById(`antigravity-wp-slot-${wallpaperActiveSlot}`);
      const shiftX = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.floor(Math.random() * 4));
      if (activeSlot && activeSlot.style) {
        activeSlot.style.transform = `translateX(${shiftX}px) skewX(${shiftX > 0 ? '-0.45deg' : '0.45deg'})`;
        activeSlot.style.filter = 'contrast(1.16) saturate(1.3) drop-shadow(2px 0 0 rgba(201,59,61,0.42))';
      }

      const canvas = document.getElementById('antigravity-wp-fx-canvas');
      const h = canvas ? (canvas.height || 720) : 720;
      const w = canvas ? (canvas.width || 1280) : 1280;
      fxGlitchSlices = [
        { y: Math.floor(h * (0.18 + Math.random() * 0.25)), h: 2 + Math.floor(Math.random() * 4), dx: -shiftX * 2, w },
        { y: Math.floor(h * (0.52 + Math.random() * 0.30)), h: 2 + Math.floor(Math.random() * 3), dx: shiftX * 2, w }
      ];
      fxGlitchActiveUntil = Date.now() + 100;

      if (fxGlitchEndTimer) clearTimeout(fxGlitchEndTimer);
      fxGlitchEndTimer = setTimeout(() => {
        fxGlitchEndTimer = 0;
        clearSlotGlitchTransforms();
        scheduleNextHomeGlitch();
      }, 100);
    }, delayMs);
  }

  function installHomeMouseTracker() {
    if (fxMouseListenerInstalled) return;
    fxMouseListenerInstalled = true;
    const onMove = (e) => {
      if (isAppInactive()) return;
      const targetEl = document.getElementById('antigravity-wp-fx-canvas') || document.getElementById('antigravity-wallpaper-layer');
      if (!targetEl || typeof targetEl.getBoundingClientRect !== 'function') return;
      const r = targetEl.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      fxPointer.active = inside;
      if (inside) {
        fxPointer.x = e.clientX - r.left;
        fxPointer.y = e.clientY - r.top;
      }
    };
    const onLeave = () => {
      fxPointer.active = false;
    };
    window.__antigravity_fx_mousemove = onMove;
    window.__antigravity_fx_mouseleave = onLeave;
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave, { passive: true });
  }

  function stepHomeAtmosphereFrame(ts) {
    fxRafId = 0;
    if (isAppInactive() || isReducedMotion()) {
      stopHomeAtmosphereFx(false, isWindowBlurred && !document.hidden);
      return;
    }
    const canvas = document.getElementById('antigravity-wp-fx-canvas');
    const layer = document.getElementById('antigravity-wallpaper-layer');
    if (!canvas || !layer || layer.style.display === 'none') {
      stopHomeAtmosphereFx(false, false);
      return;
    }

    const vhsActive = fxChannelSwitchUntil > Date.now() && fxChannelSwitchBands.length > 0;
    const anyRafNeed = Boolean(fxPrefs.particles || fxPrefs.parallax || fxPrefs.spotlight || vhsActive);
    if (anyRafNeed && typeof requestAnimationFrame === 'function') {
      fxRafId = requestAnimationFrame(stepHomeAtmosphereFrame);
    }
    // Cap to ~30 FPS so ambient effects consume negligible GPU
    if (fxLastFrameMs && (ts - fxLastFrameMs) < 32) return;
    fxLastFrameMs = ts || Date.now();

    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return;

    const hostEl = canvas.parentElement || layer;
    const r = typeof hostEl.getBoundingClientRect === 'function'
      ? hostEl.getBoundingClientRect()
      : { width: 1200, height: 800 };
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const sizeKey = `${w}x${h}`;
    if (sizeKey !== fxLastSizeKey || canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      fxLastSizeKey = sizeKey;
      fxParticles = initFxParticles(w, h);
    } else if (fxParticles.length === 0) {
      fxParticles = initFxParticles(w, h);
    }

    // Periodic lightweight agent UI state check (~3x/sec) for fast Thinking/Done border reaction
    if (fxLastFrameMs - fxCam.lastStateCheckMs >= 350) {
      fxCam.lastStateCheckMs = fxLastFrameMs;
      syncAgentStateOnUi(null, lastStatsData);
    }

    // Smoothly interpolate camera parallax & warm spotlight
    const targetNx = (fxPrefs.parallax && fxPointer.active) ? ((fxPointer.x / w) - 0.5) * 2 : 0;
    const targetNy = (fxPrefs.parallax && fxPointer.active) ? ((fxPointer.y / h) - 0.5) * 2 : 0;
    fxCam.nx += (targetNx - fxCam.nx) * 0.08;
    fxCam.ny += (targetNy - fxCam.ny) * 0.08;
    if (fxPointer.active) {
      fxCam.sx += (fxPointer.x - fxCam.sx) * 0.16;
      fxCam.sy += (fxPointer.y - fxCam.sy) * 0.16;
    }
    const wantSpot = Boolean(fxPrefs.spotlight && fxPointer.active);
    fxCam.lightAlpha += ((wantSpot ? 1 : 0) - fxCam.lightAlpha) * 0.10;

    const tSec = fxLastFrameMs * 0.001;

    // 1. Subtle breathing + depth parallax on wallpaper camera wrapper
    const camEl = document.getElementById('antigravity-wp-camera');
    if (camEl && camEl.style) {
      if (fxPrefs.parallax) {
        const breathScale = 1.048 + Math.sin(tSec * 0.26) * 0.014;
        const breathX = Math.sin(tSec * 0.18) * 3.5;
        const breathY = Math.cos(tSec * 0.14) * 2.5;
        const camX = breathX - fxCam.nx * 9;
        const camY = breathY - fxCam.ny * 6;
        camEl.style.transform = `translate3d(${camX.toFixed(2)}px, ${camY.toFixed(2)}px, 0) scale(${breathScale.toFixed(4)})`;
      } else {
        camEl.style.transform = '';
      }
    }

    // 2. Warm spotlight following cursor smoothly
    const spotlightEl = document.getElementById('antigravity-wp-spotlight');
    if (spotlightEl && spotlightEl.style) {
      if (fxPrefs.spotlight) {
        spotlightEl.style.display = 'block';
        spotlightEl.style.opacity = fxCam.lightAlpha.toFixed(3);
        if (fxCam.lightAlpha > 0.01) {
          spotlightEl.style.background = `radial-gradient(360px circle at ${Math.round(fxCam.sx)}px ${Math.round(fxCam.sy)}px, rgba(${currentDynamicPalette.spotlight}, 0.18) 0%, rgba(${currentDynamicPalette.bright}, 0.06) 44%, transparent 72%)`;
        }
      } else {
        spotlightEl.style.opacity = '0';
        spotlightEl.style.display = 'none';
      }
    }

    // 3. Foreground particles with depth parallax + agent-state boost
    ctx.clearRect(0, 0, w, h);
    const inChat = Boolean(getConversationIdFromLocation());

    if (fxPrefs.particles) {
      const radiusSq = 145 * 145;
      const stateSpeedMult = agentVisualState === 'thinking' ? 1.55 : (agentVisualState === 'done' ? 1.25 : 1.0);
      const stateAlphaBoost = agentVisualState === 'thinking' ? 1.12 : (agentVisualState === 'done' ? 1.18 : 1.0);
      const pShiftX = fxPrefs.parallax ? (-fxCam.nx * 20) : 0;
      const pShiftY = fxPrefs.parallax ? (-fxCam.ny * 14) : 0;

      for (let i = 0; i < fxParticles.length; i++) {
        const p = fxParticles[i];
        p.x += (p.vx + Math.sin(tSec * p.swayFreq + p.phase) * p.swayAmp) * (agentVisualState === 'thinking' ? 1.2 : 1.0);
        p.y += p.vy * stateSpeedMult;

        if (fxPointer.active) {
          const dx = p.x - fxPointer.x;
          const dy = p.y - fxPointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 4 && d2 < radiusSq) {
            const force = (1 - d2 / radiusSq) * 0.65;
            const dist = Math.sqrt(d2);
            p.x += (dx / dist) * force;
            p.y += (dy / dist) * force;
          }
        }

        if (p.y < -8) { p.y = h + 4; p.x = Math.random() * w; }
        if (p.x < -8) p.x = w + 4;
        if (p.x > w + 8) p.x = -4;

        const flicker = 0.80 + 0.20 * Math.sin(tSec * 2.2 + p.phase);
        const finalAlpha = Math.min(1, p.alpha * flicker * stateAlphaBoost);
        const px = Math.round(((p.x + pShiftX) % w + w) % w);
        const py = Math.round(((p.y + pShiftY) % h + h) % h);

        if (p.size >= 3) {
          ctx.fillStyle = `rgba(${p.color}, ${(finalAlpha * 0.22).toFixed(3)})`;
          ctx.fillRect(px - 1, py - 1, p.size + 2, p.size + 2);
        }
        ctx.fillStyle = `rgba(${p.color}, ${finalAlpha.toFixed(3)})`;
        ctx.fillRect(px, py, p.size, p.size);
      }
    }

    if (!inChat && fxGlitchActiveUntil > Date.now() && fxGlitchSlices.length > 0) {
      for (const s of fxGlitchSlices) {
        ctx.fillStyle = `rgba(${currentDynamicPalette.accent}, 0.24)`;
        ctx.fillRect(Math.max(0, s.dx), s.y, w, s.h);
        ctx.fillStyle = `rgba(${currentDynamicPalette.secondary}, 0.14)`;
        ctx.fillRect(0, s.y + 1, w, 1);
      }
    }

    if (vhsActive) {
      ctx.fillStyle = `rgba(${currentDynamicPalette.secondary}, 0.05)`;
      ctx.fillRect(0, 0, w, h);
      for (const band of fxChannelSwitchBands) {
        const y = Math.floor(h * band.yNorm);
        const jitterX = Math.round(band.dx * (0.5 + Math.random()));
        ctx.fillStyle = band.bright
          ? `rgba(${currentDynamicPalette.secondary}, ${band.alpha.toFixed(3)})`
          : `rgba(${currentDynamicPalette.bright}, ${band.alpha.toFixed(3)})`;
        ctx.fillRect(Math.max(0, jitterX), y, w, band.h);
      }
    }
  }

  function syncHomeAtmosphereFx(enableActive, enableHomeCrt, layer) {
    const crt = document.getElementById('antigravity-wp-crt');
    const canvas = document.getElementById('antigravity-wp-fx-canvas');
    const spotlight = document.getElementById('antigravity-wp-spotlight');
    if (!enableActive || !layer) {
      stopHomeAtmosphereFx(false, isWindowBlurred && !document.hidden);
      return;
    }
    const reduced = isReducedMotion();
    if (enableHomeCrt && fxPrefs.crt) {
      if (crt) crt.style.display = 'block';
      if (reduced) {
        stopHomeGlitchOnly();
        if (crt) crt.style.display = 'block';
      } else if (!fxGlitchWaitTimer && !fxGlitchEndTimer) {
        scheduleNextHomeGlitch();
      }
    } else {
      stopHomeGlitchOnly();
    }
    if (spotlight) {
      spotlight.style.display = (!reduced && fxPrefs.spotlight) ? 'block' : 'none';
      if (reduced || !fxPrefs.spotlight) spotlight.style.opacity = '0';
    }
    const vhsActive = !reduced && fxChannelSwitchUntil > Date.now();
    const showCanvas = !reduced && Boolean(fxPrefs.particles || vhsActive || (enableHomeCrt && fxPrefs.crt));
    if (canvas) {
      canvas.style.display = showCanvas ? 'block' : 'none';
    }
    const needsRaf = !reduced && Boolean(fxPrefs.particles || fxPrefs.parallax || fxPrefs.spotlight || vhsActive);
    if (needsRaf) {
      installHomeMouseTracker();
      if (!fxRafId && typeof requestAnimationFrame === 'function') {
        fxRafId = requestAnimationFrame(stepHomeAtmosphereFrame);
      }
    } else {
      if (fxRafId && typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(fxRafId); } catch (_) {}
      }
      fxRafId = 0;
      const camEl = document.getElementById('antigravity-wp-camera');
      if (camEl && camEl.style) camEl.style.transform = '';
      if (canvas && !showCanvas) {
        try {
          const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
          if (ctx && canvas.width > 0 && canvas.height > 0) ctx.clearRect(0, 0, canvas.width, canvas.height);
        } catch (_) {}
      }
    }
  }

  function getWallpaperMenuHost(ctrlEl) {
    if (!ctrlEl) return null;
    if (ctrlEl.parentElement && ctrlEl.parentElement.id === 'antigravity-corner-dock') {
      return ctrlEl.parentElement.parentElement;
    }
    return ctrlEl.parentElement;
  }

  function updateSwarmCornerButton(stats) {
    const btn = document.getElementById('antigravity-swarm-corner-btn');
    if (!btn) return;
    const s = stats || lastStatsData || DEFAULT_ZERO_STATS;
    const count = s.subagentCount || 0;
    const activeCount = Array.isArray(s.subagents) ? s.subagents.filter((x) => x && x.isActive).length : 0;
    if (btn.classList) {
      if (count > 0) btn.classList.add('has-subagents');
      else btn.classList.remove('has-subagents');
    }
    const pulseDot = activeCount > 0
      ? '<span style="width:6px;height:6px;border-radius:2px;background:rgb(var(--agy-accent-bright-rgb,255,68,82));display:inline-block;flex-shrink:0;"></span>'
      : '';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.92;flex-shrink:0;">
        <circle cx="5" cy="12" r="2.5"></circle>
        <circle cx="19" cy="6" r="2.5"></circle>
        <circle cx="19" cy="18" r="2.5"></circle>
        <path d="M7.3 11.1 16.7 6.9"></path>
        <path d="M7.3 12.9 16.7 17.1"></path>
      </svg>
      <span>${count > 0 ? `Рой · ${count}` : 'Рой'}</span>
      ${pulseDot}
    `;
    btn.title = count > 0
      ? `Карта роя субагентов (${count}, активно: ${activeCount}) · Нажмите, чтобы открыть граф`
      : 'Карта роя агентов · Нажмите, чтобы открыть';
  }

  async function ensureHomeWallpaper() {
    if (isCheckingWallpaper) return;
    isCheckingWallpaper = true;
    try {
      await hydrateFxPrefsFromDisk();
      ensureMilkThemeStyles();
      const convId = getConversationIdFromLocation();
      const inChat = Boolean(convId);
      let layer = document.getElementById('antigravity-wallpaper-layer');
      let dock = document.getElementById('antigravity-corner-dock');
      let ctrl = document.getElementById('antigravity-wallpaper-ctrl');

      if (document.hidden) {
        stopHomeAtmosphereFx(false);
        return;
      }

      const box = findInputBox();
      if (!box) return;
      const stage = findMainStage(box);
      if (!stage) return;

      const files = await refreshWallpaperList(false);
      if (!files || files.length === 0) {
        stopHomeAtmosphereFx(false);
        if (layer) layer.style.display = 'none';
        if (ctrl) ctrl.style.display = 'none';
        closeWallpaperMenu(false);
        syncSurfaceThemeClass();
        clearChatMessageBackdrops();
        restoreStageBackdrops();
        return;
      }

      ensureSidebarAndHeaderTheme(stage, box, convId);
      ensureHomeGreetingTheme(stage, box, inChat);
      ensureOverviewPanelTheme(stage, box);

      try {
        const stageStyle = window.getComputedStyle(stage);
        if (stageStyle && stageStyle.position === 'static') {
          stage.style.position = 'relative';
        }
      } catch (_) {}

      const needsRemount = !layer || layer.parentElement !== stage;
      if (needsRemount) {
        if (!layer) {
          layer = document.createElement('div');
          layer.id = 'antigravity-wallpaper-layer';
          layer.style.cssText = [
            'position: absolute',
            'inset: 0',
            'z-index: 0',
            'pointer-events: none',
            'overflow: hidden',
            'border-radius: inherit',
            'background: #0a0a0e'
          ].join(';');
          layer.innerHTML = `
            <div id="antigravity-wp-camera" style="position:absolute;inset:0;transform-origin:center center;will-change:transform;">
              <div id="antigravity-wp-slot-0" style="position:absolute;inset:0;opacity:0;transition:opacity 1.1s ease;"></div>
              <div id="antigravity-wp-slot-1" style="position:absolute;inset:0;opacity:0;transition:opacity 1.1s ease;"></div>
            </div>
            <div id="antigravity-wp-scrim" style="position:absolute;inset:0;transition:background 0.35s ease;"></div>
            <div id="antigravity-wp-spotlight" style="display:none;"></div>
            <canvas id="antigravity-wp-fx-canvas" style="display:none;"></canvas>
            <div id="antigravity-wp-crt" style="display:none;"></div>
          `;
        }
        stage.insertBefore(layer, stage.firstChild);
      }

      applyScrimStyle(inChat);

      let camEl = document.getElementById('antigravity-wp-camera');
      if (!camEl) {
        camEl = document.createElement('div');
        camEl.id = 'antigravity-wp-camera';
        camEl.style.cssText = 'position:absolute;inset:0;transform-origin:center center;will-change:transform;';
        const s0 = document.getElementById('antigravity-wp-slot-0');
        const s1 = document.getElementById('antigravity-wp-slot-1');
        layer.insertBefore(camEl, layer.firstChild);
        if (s0) camEl.appendChild(s0);
        if (s1) camEl.appendChild(s1);
      }

      let spotlightEl = document.getElementById('antigravity-wp-spotlight');
      if (!spotlightEl) {
        spotlightEl = document.createElement('div');
        spotlightEl.id = 'antigravity-wp-spotlight';
        spotlightEl.style.display = 'none';
      }
      if (spotlightEl.parentElement !== layer) {
        layer.appendChild(spotlightEl);
      }

      let fxCanvasEl = document.getElementById('antigravity-wp-fx-canvas');
      if (!fxCanvasEl) {
        fxCanvasEl = document.createElement('canvas');
        fxCanvasEl.id = 'antigravity-wp-fx-canvas';
        fxCanvasEl.style.display = 'none';
      }
      if (fxCanvasEl.parentElement !== layer) {
        layer.appendChild(fxCanvasEl);
      }
      let crtEl = document.getElementById('antigravity-wp-crt');
      if (!crtEl) {
        crtEl = document.createElement('div');
        crtEl.id = 'antigravity-wp-crt';
        crtEl.style.display = 'none';
      }
      if (crtEl.parentElement !== layer) {
        layer.appendChild(crtEl);
      }

      if (!dock || dock.parentElement !== stage) {
        if (!dock) {
          dock = document.createElement('div');
          dock.id = 'antigravity-corner-dock';
          dock.style.cssText = [
            'position: absolute',
            'top: auto',
            'bottom: 14px',
            'right: 16px',
            'z-index: 9999',
            'display: flex',
            'align-items: center',
            'gap: 8px'
          ].join(';');
        }
        stage.appendChild(dock);
      }

      const cornerPillBaseCss = [
        'display: inline-flex',
        'align-items: center',
        'justify-content: center',
        'gap: 6px',
        'min-height: 31px',
        'padding: 6px 13px',
        'border-radius: 6px',
        'font-family: var(--agy-font-mono, "Cascadia Mono", Consolas, monospace)',
        'font-variant-numeric: tabular-nums',
        'font-size: 12.5px',
        'font-weight: 600',
        'line-height: 1',
        'color: rgba(248, 240, 232, 0.92)',
        'background: rgba(11, 12, 19, 0.84)',
        'border: 1px solid rgba(var(--agy-accent-rgb, 198, 52, 60), 0.48)',
        'backdrop-filter: blur(8px)',
        'cursor: pointer',
        'opacity: 0.92',
        'transition: opacity 0.15s ease, background 0.15s ease, border-color 0.25s ease, transform 0.12s ease'
      ].join(';');

      let swarmCornerBtn = document.getElementById('antigravity-swarm-corner-btn');
      if (!swarmCornerBtn || swarmCornerBtn.parentElement !== dock) {
        if (!swarmCornerBtn) {
          swarmCornerBtn = document.createElement('button');
          swarmCornerBtn.id = 'antigravity-swarm-corner-btn';
          swarmCornerBtn.type = 'button';
          swarmCornerBtn.style.cssText = cornerPillBaseCss;
          swarmCornerBtn.onmouseenter = () => { swarmCornerBtn.style.opacity = '1'; };
          swarmCornerBtn.onmouseleave = () => { swarmCornerBtn.style.opacity = '0.90'; };
          swarmCornerBtn.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            const curBox = findInputBox();
            toggleSwarmModal(lastStatsData, getActiveModelName(curBox));
          };
        }
        dock.appendChild(swarmCornerBtn);
      }
      updateSwarmCornerButton(lastStatsData);

      if (!ctrl || ctrl.parentElement !== dock) {
        if (!ctrl) {
          ctrl = document.createElement('button');
          ctrl.id = 'antigravity-wallpaper-ctrl';
          ctrl.type = 'button';
          ctrl.style.cssText = cornerPillBaseCss;
          ctrl.setAttribute('aria-haspopup', 'dialog');
          ctrl.setAttribute('aria-expanded', 'false');
          ctrl.setAttribute('aria-controls', 'antigravity-wallpaper-menu');
          ctrl.onmouseenter = () => { ctrl.style.opacity = '1'; };
          ctrl.onmouseleave = () => { ctrl.style.opacity = '0.90'; };
          ctrl.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            const existingMenu = document.getElementById('antigravity-wallpaper-menu');
            if (existingMenu && existingMenu.style && existingMenu.style.display !== 'none') {
              closeWallpaperMenu(false);
            } else {
              openWallpaperMenu(getWallpaperMenuHost(ctrl), true);
            }
          };
          ctrl.oncontextmenu = async (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (e && e.stopPropagation) e.stopPropagation();
            await refreshWallpaperList(false);
            const curInChat = Boolean(getConversationIdFromLocation());
            if (isWallpaperLockedHere(curInChat)) {
              triggerWallpaperLockHint(curInChat);
              wpMenuActiveTab = 'scenes';
              openWallpaperMenu(getWallpaperMenuHost(ctrl), true);
              return;
            }
            await refreshWallpaperList(true);
            if (wallpaperFiles.length > 0) {
              await showWallpaperAt(wallpaperIndex + 1);
            }
          };
        }
        dock.appendChild(ctrl);
      }

      const staleMenuBtn = document.getElementById('antigravity-wallpaper-menu-btn');
      if (staleMenuBtn) staleMenuBtn.remove();

      let wpMenu = document.getElementById('antigravity-wallpaper-menu');
      if (wpMenu && wpMenu.parentElement !== stage) {
        stage.appendChild(wpMenu);
      }

      dock.style.top = 'auto';
      dock.style.bottom = '14px';

      // Heavy style scan (getComputedStyle over many nodes): only when the DOM/size/chat actually changed,
      // plus a forced refresh every ~20 ticks as a safety net.
      let scanSig = '';
      try {
        const sr = typeof stage.getBoundingClientRect === 'function' ? stage.getBoundingClientRect() : null;
        scanSig = [
          convId || '',
          Math.round(sr ? sr.width : 0),
          Math.round(sr ? sr.height : 0),
          stage.getElementsByTagName ? stage.getElementsByTagName('*').length : 0
        ].join('|');
      } catch (_) {}
      if (needsRemount || scanSig !== backdropScanSignature || backdropScanSkips >= 20) {
        backdropScanSignature = scanSig;
        backdropScanSkips = 0;
        clearLargeOpaqueBackdrops(stage, box);
      } else {
        backdropScanSkips++;
      }
      ensureChatMessageBackdrop(stage, box, inChat);
      ensureStageChildrenAbove(stage);
      layer.style.display = 'block';
      syncSurfaceThemeClass();
      if (layer.classList) {
        if (isWindowBlurred) layer.classList.add('agy-wp-sleeping');
        else layer.classList.remove('agy-wp-sleeping');
      }
      ctrl.style.display = files.length > 0 ? 'inline-flex' : 'none';
      syncHomeAtmosphereFx(!isAppInactive(), !inChat && !isAppInactive(), layer);

      const vids = layer.querySelectorAll ? layer.querySelectorAll('video') : [];
      for (const v of vids) {
        if (v.parentElement && v.parentElement.style && v.parentElement.style.opacity === '1' && v.paused && typeof v.play === 'function') {
          const playRet = v.play();
          if (playRet && typeof playRet.catch === 'function') playRet.catch(() => {});
        }
      }

      const slot0 = document.getElementById('antigravity-wp-slot-0');
      const slot1 = document.getElementById('antigravity-wp-slot-1');
      const hasVisibleSlot = (slot0 && slot0.style.opacity === '1' && slot0.children && slot0.children.length > 0)
        || (slot1 && slot1.style.opacity === '1' && slot1.children && slot1.children.length > 0);

      const pinnedFile = inChat ? fxPrefs.chatWpFile : fxPrefs.homeWpFile;
      const pinnedIdx = (pinnedFile && files.includes(pinnedFile)) ? files.indexOf(pinnedFile) : -1;
      const now = Date.now();

      if (pinnedIdx !== -1 && (wallpaperIndex !== pinnedIdx || wallpaperLastSwitchMs === 0 || needsRemount || !hasVisibleSlot)) {
        await showWallpaperAt(pinnedIdx, { immediate: wallpaperLastSwitchMs === 0 || needsRemount || !hasVisibleSlot, preserveTimer: true });
      } else if (wallpaperLastSwitchMs === 0) {
        await showWallpaperAt(wallpaperIndex, { immediate: true });
      } else if (needsRemount || !hasVisibleSlot) {
        // React unmounted & remounted the stage on navigation — restore current wallpaper immediately
        await showWallpaperAt(wallpaperIndex, { immediate: true, preserveTimer: true });
      } else if (pinnedIdx === -1 && fxPrefs.autoRotate && files.length > 1 && (now - wallpaperLastSwitchMs) >= WALLPAPER_ROTATE_MS) {
        await showWallpaperAt(wallpaperIndex + 1);
      } else if (ctrl && !ctrl.textContent && files.length > 0) {
        updateWallpaperCtrlLabel(files[wallpaperIndex]);
      }
    } finally {
      isCheckingWallpaper = false;
    }
  }

  function formatWallpaperSceneName(fileName) {
    if (!fileName) return '';
    return String(fileName)
      .replace(/^\d+[_-]?/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || fileName;
  }

  function isWallpaperLockedHere(inChat) {
    const pinned = inChat ? fxPrefs.chatWpFile : fxPrefs.homeWpFile;
    return Boolean(pinned && wallpaperFiles.includes(pinned));
  }

  function triggerWallpaperLockHint(inChat) {
    const btnLabel = inChat ? 'Чат' : 'Home';
    wpLockHintMsg = `Обои закреплены для «${btnLabel}». Нажмите «${btnLabel}» ниже, чтобы открепить.`;
    if (wpLockHintTimer) {
      clearTimeout(wpLockHintTimer);
    }
    wpLockHintTimer = setTimeout(() => {
      wpLockHintTimer = 0;
      wpLockHintMsg = '';
      const menu = document.getElementById('antigravity-wallpaper-menu');
      if (menu && menu.style && menu.style.display !== 'none') {
        renderWallpaperMenu(menu);
      }
    }, 3200);
  }

  function clearWallpaperThumbCache() {
    for (const entry of wallpaperThumbCache.values()) {
      if (entry && entry.revokeOnClear && entry.url && typeof URL.revokeObjectURL === 'function') {
        try { URL.revokeObjectURL(entry.url); } catch (_) {}
      }
    }
    wallpaperThumbCache.clear();
  }

  function drawMediaCoverBlobUrl(mediaEl, srcW, srcH) {
    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 135;
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx || typeof canvas.toBlob !== 'function') {
          resolve(null);
          return;
        }
        const w = Math.max(1, srcW || 240);
        const h = Math.max(1, srcH || 135);
        const scale = Math.max(canvas.width / w, canvas.height / h);
        const dw = w * scale;
        const dh = h * scale;
        const dx = (canvas.width - dw) / 2;
        const dy = (canvas.height - dh) / 2;
        ctx.drawImage(mediaEl, dx, dy, dw, dh);
        canvas.toBlob((blob) => {
          if (!blob || blob.size < 32) {
            resolve(null);
            return;
          }
          try {
            resolve(URL.createObjectURL(blob));
          } catch (_) {
            resolve(null);
          }
        }, 'image/jpeg', 0.85);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function buildWallpaperThumb(fileName) {
    const fullCached = wallpaperBlobCache.get(fileName);
    let tempUrl = fullCached ? fullCached.url : '';
    let mime = fullCached ? fullCached.mime : '';
    let ownsTempUrl = false;

    if (!tempUrl) {
      if (!window.antigravityTokenBridge || typeof window.antigravityTokenBridge.readWallpaper !== 'function') {
        return null;
      }
      const payload = await window.antigravityTokenBridge.readWallpaper(fileName);
      if (!payload || !payload.bytes) return null;
      mime = payload.mime || 'image/png';
      const blob = new Blob([payload.bytes], { type: mime });
      tempUrl = URL.createObjectURL(blob);
      ownsTempUrl = true;
    }

    const isVideo = (typeof mime === 'string' && mime.startsWith('video/')) || /\.(mp4|webm)$/i.test(fileName);
    const probeCanvas = document.createElement('canvas');
    const hasCanvasCtx = Boolean(probeCanvas && probeCanvas.getContext && probeCanvas.getContext('2d') && typeof probeCanvas.toBlob === 'function');
    if (!hasCanvasCtx) {
      const entry = { url: tempUrl, kind: isVideo ? 'video' : 'img', isVideo, revokeOnClear: ownsTempUrl };
      wallpaperThumbCache.set(fileName, entry);
      return entry;
    }

    try {
      let thumbBlobUrl = null;
      if (isVideo) {
        thumbBlobUrl = await new Promise((resolve) => {
          const vid = document.createElement('video');
          let done = false;
          const finish = (res) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { vid.removeAttribute('src'); vid.load && vid.load(); } catch (_) {}
            resolve(res);
          };
          const capture = async () => {
            if (done) return;
            const res = (vid.videoWidth > 0 && vid.videoHeight > 0)
              ? await drawMediaCoverBlobUrl(vid, vid.videoWidth, vid.videoHeight)
              : null;
            finish(res);
          };
          const timer = setTimeout(() => { capture(); }, 4500);
          vid.muted = true;
          vid.playsInline = true;
          vid.preload = 'auto';
          vid.onloadeddata = () => {
            try {
              if (vid.duration && isFinite(vid.duration) && vid.duration > 0.35 && vid.currentTime < 0.05) {
                vid.onseeked = () => { capture(); };
                vid.currentTime = Math.min(0.25, vid.duration * 0.1);
                return;
              }
              capture();
            } catch (_) {
              finish(null);
            }
          };
          vid.onerror = () => finish(null);
          vid.src = tempUrl;
        });
      } else {
        thumbBlobUrl = await new Promise((resolve) => {
          const img = new Image();
          let done = false;
          const finish = (res) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(res);
          };
          const timer = setTimeout(() => finish(null), 4500);
          img.onload = async () => {
            try {
              if (typeof img.decode === 'function') {
                try { await img.decode(); } catch (_) {}
              }
              const res = await drawMediaCoverBlobUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
              finish(res);
            } catch (_) {
              finish(null);
            }
          };
          img.onerror = () => finish(null);
          img.src = tempUrl;
        });
      }

      if (thumbBlobUrl) {
        if (ownsTempUrl && typeof URL.revokeObjectURL === 'function') {
          try { URL.revokeObjectURL(tempUrl); } catch (_) {}
        }
        const entry = { url: thumbBlobUrl, kind: 'img', isVideo, revokeOnClear: true };
        wallpaperThumbCache.set(fileName, entry);
        return entry;
      }
      const fallbackEntry = { url: tempUrl, kind: isVideo ? 'video' : 'img', isVideo, revokeOnClear: ownsTempUrl };
      wallpaperThumbCache.set(fileName, fallbackEntry);
      return fallbackEntry;
    } catch (_) {
      if (ownsTempUrl && typeof URL.revokeObjectURL === 'function') {
        try { URL.revokeObjectURL(tempUrl); } catch (_) {}
      }
      return null;
    }
  }

  function ensureWallpaperThumb(fileName) {
    if (!fileName) return Promise.resolve(null);
    if (wallpaperThumbCache.has(fileName)) return Promise.resolve(wallpaperThumbCache.get(fileName));
    if (wallpaperThumbInflight.has(fileName)) return wallpaperThumbInflight.get(fileName);
    const p = buildWallpaperThumb(fileName).finally(() => {
      wallpaperThumbInflight.delete(fileName);
    });
    wallpaperThumbInflight.set(fileName, p);
    return p;
  }

  function applyThumbToCard(cardEl, entry, fileName) {
    if (!cardEl || !entry || !entry.url) return;
    if (cardEl.querySelector && cardEl.querySelector('.agy-wp-thumb-img')) return;
    const oldFallback = cardEl.querySelector && cardEl.querySelector('.agy-wp-thumb-fallback');
    const mediaStyle = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;display:block;z-index:1;opacity:1;pointer-events:none;';
    if (entry.kind === 'video') {
      const vid = document.createElement('video');
      vid.className = 'agy-wp-thumb-img';
      vid.style.cssText = mediaStyle;
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      vid.onloadeddata = () => {
        if (oldFallback && oldFallback.parentElement) oldFallback.parentElement.removeChild(oldFallback);
      };
      vid.onerror = () => {
        if (vid.parentElement) vid.parentElement.removeChild(vid);
        if (fileName) wallpaperThumbCache.delete(fileName);
      };
      vid.src = `${entry.url}#t=0.2`;
      cardEl.insertBefore(vid, cardEl.firstChild || null);
      return;
    }
    const img = document.createElement('img');
    img.className = 'agy-wp-thumb-img';
    img.style.cssText = mediaStyle;
    img.alt = '';
    img.draggable = false;
    img.onload = () => {
      if (oldFallback && oldFallback.parentElement) oldFallback.parentElement.removeChild(oldFallback);
    };
    img.onerror = () => {
      if (img.parentElement) img.parentElement.removeChild(img);
      if (fileName) wallpaperThumbCache.delete(fileName);
    };
    img.src = entry.url;
    cardEl.insertBefore(img, cardEl.firstChild || null);
  }

  function updateWallpaperCtrlLabel(fileName) {
    const ctrl = document.getElementById('antigravity-wallpaper-ctrl');
    if (ctrl && wallpaperFiles.length > 0) {
      const inChat = Boolean(getConversationIdFromLocation());
      const curFile = fileName || wallpaperFiles[wallpaperIndex] || '';
      const isPinnedHere = Boolean(curFile && ((inChat && fxPrefs.chatWpFile === curFile) || (!inChat && fxPrefs.homeWpFile === curFile)));
      const iconHtml = isPinnedHere
        ? agyIcon('pin', 12)
        : (fxPrefs.autoRotate ? '' : agyIcon('pause', 12));
      if (ctrl.dataset) {
        ctrl.dataset.pinned = isPinnedHere ? '1' : '0';
        ctrl.dataset.paused = (!isPinnedHere && !fxPrefs.autoRotate) ? '1' : '0';
      }
      ctrl.innerHTML = `<span>${wallpaperIndex + 1}/${wallpaperFiles.length}</span>${iconHtml}`;
      ctrl.title = isPinnedHere
        ? `Обои: ${curFile} [Закреплено] (ЛКМ: меню сцен и FX)`
        : `Обои: ${curFile} (ЛКМ: меню сцен и FX · ПКМ: следующая сцена)`;
      ctrl.setAttribute('aria-label', ctrl.title);
    }
    const menu = document.getElementById('antigravity-wallpaper-menu');
    if (menu && menu.style && menu.style.display !== 'none') {
      renderWallpaperMenu(menu);
    }
  }

  function closeWallpaperMenu(restoreFocus) {
    const menu = document.getElementById('antigravity-wallpaper-menu');
    if (menu && menu.style) {
      menu.style.display = 'none';
    }
    const ctrl = document.getElementById('antigravity-wallpaper-ctrl');
    if (ctrl) {
      ctrl.setAttribute('aria-expanded', 'false');
    }
    const prev = wpPrevFocusEl;
    wpPrevFocusEl = null;
    if (restoreFocus) {
      const target = (prev && prev.isConnected && typeof prev.focus === 'function') ? prev : ctrl;
      if (target && typeof target.focus === 'function') {
        try { target.focus(); } catch (_) {}
      }
    }
  }

  function installWallpaperMenuDismissListeners() {
    if (!window.__antigravity_menu_outside_click) {
      window.__antigravity_menu_outside_click = (e) => {
        const t = e && e.target;
        const menu = document.getElementById('antigravity-wallpaper-menu');
        if (menu && menu.style && menu.style.display !== 'none') {
          const ctrl = document.getElementById('antigravity-wallpaper-ctrl');
          const insideMenu = Boolean(t && menu.contains && menu.contains(t));
          const insideCtrl = Boolean(t && ctrl && ctrl.contains && ctrl.contains(t));
          if (!t || (!insideMenu && !insideCtrl)) {
            closeWallpaperMenu(false);
          }
        }
        const pop = document.getElementById('antigravity-token-popover');
        if (pop && pop.style && pop.style.display !== 'none') {
          const pill = document.getElementById('antigravity-token-pill');
          if (!t || ((!pop.contains || !pop.contains(t)) && (!pill || !pill.contains || !pill.contains(t)))) {
            closeTokenPopover(false);
          }
        }
      };
      document.addEventListener('mousedown', window.__antigravity_menu_outside_click, true);
    }
    if (!window.__antigravity_menu_keydown) {
      window.__antigravity_menu_keydown = (e) => {
        if (e && e.key === 'Escape') {
          const active = document.activeElement;
          const menu = document.getElementById('antigravity-wallpaper-menu');
          const pop = document.getElementById('antigravity-token-popover');
          const swarm = document.getElementById('antigravity-swarm-modal');
          const menuOpen = Boolean(menu && menu.style && menu.style.display !== 'none');
          const popOpen = Boolean(pop && pop.style && pop.style.display !== 'none');
          const swarmOpen = Boolean(swarm && swarm.style && swarm.style.display !== 'none');
          if (!menuOpen && !popOpen && !swarmOpen) return;
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          const restoreWp = Boolean(menuOpen && active && menu.contains && menu.contains(active));
          const restorePop = Boolean(popOpen && active && pop.contains && pop.contains(active));
          if (menuOpen) closeWallpaperMenu(restoreWp);
          if (popOpen) closeTokenPopover(restorePop);
          if (swarmOpen) closeSwarmModal();
        }
      };
      document.addEventListener('keydown', window.__antigravity_menu_keydown, true);
    }
  }

  function renderWallpaperMenu(menu) {
    if (!menu) return;
    const prevWpFocus = captureFocusDescriptor(menu);
    menu.innerHTML = '';

    const currentFile = wallpaperFiles[wallpaperIndex] || '';
    const inChat = Boolean(getConversationIdFromLocation());
    const activePinFile = inChat ? fxPrefs.chatWpFile : fxPrefs.homeWpFile;
    const isLockedHere = Boolean(activePinFile && wallpaperFiles.includes(activePinFile));

    // Header row: Обои count + Refresh + Auto-rotate toggle
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;';
    const title = document.createElement('span');
    title.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-weight:700;color:var(--agy-text-primary, #f8f0e8);font-size:13px;flex:1;';
    title.innerHTML = `<span>Обои <span class="agy-mono">(${wallpaperFiles.length > 0 ? wallpaperIndex + 1 : 0}/${wallpaperFiles.length})</span></span>${isLockedHere ? agyIcon('pin', 12) : ''}`;
    hdr.appendChild(title);

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'agy-wp-menu-chip';
    refreshBtn.setAttribute('data-wp-action', 'refresh');
    refreshBtn.style.padding = '3px 7px';
    refreshBtn.innerHTML = agyIcon('refresh', 13);
    refreshBtn.setAttribute('aria-label', 'Обновить список обоев из папки');
    refreshBtn.title = 'Обновить список обоев из папки';
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      clearWallpaperThumbCache();
      await refreshWallpaperList(true);
      updateWallpaperCtrlLabel();
      renderWallpaperMenu(menu);
    };
    hdr.appendChild(refreshBtn);

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    const autoVisualOn = !isLockedHere && Boolean(fxPrefs.autoRotate);
    autoBtn.className = `agy-wp-menu-pill ${autoVisualOn ? 'is-on' : 'is-off'}`;
    autoBtn.setAttribute('data-wp-action', 'auto');
    autoBtn.style.cursor = 'pointer';
    autoBtn.setAttribute('aria-pressed', autoVisualOn ? 'true' : 'false');
    if (isLockedHere) {
      autoBtn.setAttribute('aria-disabled', 'true');
      autoBtn.title = `Автопереключение приостановлено, пока сцена закреплена для «${inChat ? 'Чат' : 'Home'}»`;
      autoBtn.innerHTML = `${agyIcon('pin', 11)}<span>Авто: ЗАКР.</span>`;
    } else {
      autoBtn.title = fxPrefs.autoRotate ? 'Автопереключение каждые 45с (нажмите, чтобы поставить на паузу)' : 'Включить автопереключение каждые 45с';
      autoBtn.innerHTML = `${agyIcon(fxPrefs.autoRotate ? 'play' : 'pause', 11)}<span>${fxPrefs.autoRotate ? 'Авто: ВКЛ' : 'Авто: ПАУЗА'}</span>`;
    }
    autoBtn.onclick = (e) => {
      e.stopPropagation();
      const liveInChat = Boolean(getConversationIdFromLocation());
      if (isWallpaperLockedHere(liveInChat)) {
        triggerWallpaperLockHint(liveInChat);
        renderWallpaperMenu(menu);
        return;
      }
      fxPrefs.autoRotate = !fxPrefs.autoRotate;
      if (fxPrefs.autoRotate) wallpaperLastSwitchMs = Date.now();
      saveFxPrefs();
      updateWallpaperCtrlLabel();
    };
    hdr.appendChild(autoBtn);
    menu.appendChild(hdr);

    // 2-Tab switcher: Сцены | Вид и FX
    const tabsRow = document.createElement('div');
    tabsRow.className = 'agy-wp-tabs';
    tabsRow.setAttribute('role', 'tablist');
    tabsRow.setAttribute('aria-label', 'Разделы настроек фона');

    const tabDefs = [
      { id: 'scenes', label: 'Сцены' },
      { id: 'fx', label: 'Вид и FX' }
    ];
    for (const td of tabDefs) {
      const tb = document.createElement('button');
      tb.type = 'button';
      tb.setAttribute('role', 'tab');
      tb.setAttribute('data-wp-tab', td.id);
      const active = wpMenuActiveTab === td.id;
      tb.setAttribute('aria-selected', active ? 'true' : 'false');
      tb.className = `agy-wp-menu-chip${active ? ' is-active' : ''}`;
      tb.style.flex = '1';
      tb.textContent = td.label;
      tb.onclick = (e) => {
        e.stopPropagation();
        if (wpMenuActiveTab !== td.id) {
          wpMenuActiveTab = td.id;
          renderWallpaperMenu(menu);
        }
      };
      tabsRow.appendChild(tb);
    }
    wireTablistArrowKeys(tabsRow);
    menu.appendChild(tabsRow);

    if (wpMenuActiveTab === 'scenes') {
      // Wallpaper thumbnail grid + Pin for Home / Chat
      if (wallpaperFiles.length > 0) {
        const grid = document.createElement('div');
        grid.className = 'agy-wp-thumb-grid';
        const pendingThumbs = [];

        for (let i = 0; i < wallpaperFiles.length; i++) {
          const fname = wallpaperFiles[i];
          const isVid = /\.(mp4|webm)$/i.test(fname);
          const isHomePin = fxPrefs.homeWpFile === fname;
          const isChatPin = fxPrefs.chatWpFile === fname;
          const tileLocked = isLockedHere && fname !== activePinFile;

          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = `agy-wp-thumb-btn${i === wallpaperIndex ? ' is-active' : ''}${tileLocked ? ' is-locked' : ''}`;
          tile.setAttribute('data-wp-file', fname);

          const fb = document.createElement('span');
          fb.className = 'agy-wp-thumb-fallback';
          fb.innerHTML = isVid ? `<span>${i + 1}</span>${agyIcon('play', 10)}` : `${i + 1}`;
          tile.appendChild(fb);

          const cachedThumb = wallpaperThumbCache.get(fname);
          if (cachedThumb && cachedThumb.url) {
            applyThumbToCard(tile, cachedThumb, fname);
          } else {
            pendingThumbs.push({ fname, tile });
          }

          const idxBadge = document.createElement('span');
          idxBadge.className = 'agy-wp-thumb-idx';
          idxBadge.innerHTML = isVid ? `<span>${i + 1}</span>${agyIcon('play', 9)}` : `${i + 1}`;
          tile.appendChild(idxBadge);

          if (isHomePin || isChatPin) {
            const pinBadge = document.createElement('span');
            pinBadge.className = 'agy-wp-thumb-pins';
            pinBadge.textContent = `${isHomePin ? 'H' : ''}${isChatPin ? 'C' : ''}`;
            tile.appendChild(pinBadge);
          }

          const sceneLabel = formatWallpaperSceneName(fname);
          tile.title = `${i + 1}. ${sceneLabel} (${fname})`
            + (isHomePin ? ' [Закреплено: Home]' : '')
            + (isChatPin ? ' [Закреплено: Чат]' : '')
            + (tileLocked ? ` — Заблокировано: нажмите «${inChat ? 'Чат' : 'Home'}» ниже, чтобы открепить` : '');
          tile.setAttribute('aria-label', tile.title);

          tile.onclick = async (e) => {
            e.stopPropagation();
            const liveInChat = Boolean(getConversationIdFromLocation());
            const livePinFile = liveInChat ? fxPrefs.chatWpFile : fxPrefs.homeWpFile;
            if (isWallpaperLockedHere(liveInChat)) {
              if (fname !== livePinFile || wallpaperIndex !== i) {
                triggerWallpaperLockHint(liveInChat);
                renderWallpaperMenu(menu);
              }
              return;
            }
            await showWallpaperAt(i);
            renderWallpaperMenu(menu);
          };
          grid.appendChild(tile);
        }
        menu.appendChild(grid);

        if (pendingThumbs.length > 0) {
          let cursor = 0;
          const concurrency = Math.min(3, pendingThumbs.length);
          for (let w = 0; w < concurrency; w++) {
            (async () => {
              while (cursor < pendingThumbs.length) {
                const item = pendingThumbs[cursor++];
                if (!item || !item.tile || item.tile.isConnected === false) continue;
                const entry = await ensureWallpaperThumb(item.fname);
                if (entry && entry.url && item.tile.isConnected !== false) {
                  applyThumbToCard(item.tile, entry, item.fname);
                }
              }
            })();
          }
        }

        // Pin controls for current wallpaper
        const pinRow = document.createElement('div');
        pinRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;';
        const pinLbl = document.createElement('span');
        pinLbl.style.cssText = 'font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));';
        pinLbl.textContent = 'Закрепить текущие:';
        pinRow.appendChild(pinLbl);

        const pinBtns = document.createElement('div');
        pinBtns.style.cssText = 'display:flex;gap:5px;';

        const homePinIdx = fxPrefs.homeWpFile ? wallpaperFiles.indexOf(fxPrefs.homeWpFile) : -1;
        const homePinActive = homePinIdx >= 0;
        const pinHomeBtn = document.createElement('button');
        pinHomeBtn.type = 'button';
        pinHomeBtn.className = `agy-wp-menu-chip${homePinActive ? ' is-active' : ''}${wpLockHintMsg && !inChat && homePinActive ? ' is-lock-pulse' : ''}`;
        pinHomeBtn.setAttribute('data-pin-scope', 'home');
        pinHomeBtn.setAttribute('aria-pressed', homePinActive ? 'true' : 'false');
        pinHomeBtn.innerHTML = homePinActive ? `<span>Home #${homePinIdx + 1}</span>${agyIcon('pin', 12)}` : 'Home';
        pinHomeBtn.title = homePinActive
          ? `На главном экране: #${homePinIdx + 1} (${fxPrefs.homeWpFile}) — нажмите, чтобы открепить`
          : 'Закрепить текущие обои для главного экрана';
        pinHomeBtn.onclick = (e) => {
          e.stopPropagation();
          const liveFile = wallpaperFiles[wallpaperIndex] || '';
          fxPrefs.homeWpFile = homePinActive ? '' : liveFile;
          if (wpLockHintTimer) {
            clearTimeout(wpLockHintTimer);
            wpLockHintTimer = 0;
          }
          wpLockHintMsg = '';
          saveFxPrefs();
          updateWallpaperCtrlLabel(liveFile);
        };

        const chatPinIdx = fxPrefs.chatWpFile ? wallpaperFiles.indexOf(fxPrefs.chatWpFile) : -1;
        const chatPinActive = chatPinIdx >= 0;
        const pinChatBtn = document.createElement('button');
        pinChatBtn.type = 'button';
        pinChatBtn.className = `agy-wp-menu-chip${chatPinActive ? ' is-active' : ''}${wpLockHintMsg && inChat && chatPinActive ? ' is-lock-pulse' : ''}`;
        pinChatBtn.setAttribute('data-pin-scope', 'chat');
        pinChatBtn.setAttribute('aria-pressed', chatPinActive ? 'true' : 'false');
        pinChatBtn.innerHTML = chatPinActive ? `<span>Чат #${chatPinIdx + 1}</span>${agyIcon('pin', 12)}` : 'Чат';
        pinChatBtn.title = chatPinActive
          ? `В чатах: #${chatPinIdx + 1} (${fxPrefs.chatWpFile}) — нажмите, чтобы открепить`
          : 'Закрепить текущие обои для экранов чата';
        pinChatBtn.onclick = (e) => {
          e.stopPropagation();
          const liveFile = wallpaperFiles[wallpaperIndex] || '';
          fxPrefs.chatWpFile = chatPinActive ? '' : liveFile;
          if (wpLockHintTimer) {
            clearTimeout(wpLockHintTimer);
            wpLockHintTimer = 0;
          }
          wpLockHintMsg = '';
          saveFxPrefs();
          updateWallpaperCtrlLabel(liveFile);
        };

        pinBtns.appendChild(pinHomeBtn);
        pinBtns.appendChild(pinChatBtn);
        pinRow.appendChild(pinBtns);
        menu.appendChild(pinRow);

        if (wpLockHintMsg) {
          const lockNote = document.createElement('div');
          lockNote.className = 'agy-wp-lock-note';
          lockNote.style.marginTop = '4px';
          lockNote.textContent = wpLockHintMsg;
          menu.appendChild(lockNote);
        }
      }
      if (prevWpFocus) restoreFocusDescriptor(menu, prevWpFocus);
      return;
    }

    // Tab 2: Вид и FX
    // Home greeting position & visibility
    const greetRow = document.createElement('div');
    greetRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--agy-border-hairline, rgba(255,255,255,0.09));';
    const greetLbl = document.createElement('span');
    greetLbl.style.cssText = 'font-size:12px;color:var(--agy-text-muted, rgba(248,224,192,0.82));';
    greetLbl.textContent = 'Приветствие:';
    greetRow.appendChild(greetLbl);

    const greetBtns = document.createElement('div');
    greetBtns.style.cssText = 'display:flex;gap:4px;';
    const curGreetMode = normalizeGreetingMode(fxPrefs.greetingMode);
    const greetOpts = [
      { id: 'top', label: 'Выше' },
      { id: 'center', label: 'Центр' },
      { id: 'bottom', label: 'Ниже' },
      { id: 'hidden', label: 'Скрыть' }
    ];
    for (const opt of greetOpts) {
      const gBtn = document.createElement('button');
      gBtn.type = 'button';
      gBtn.className = `agy-wp-menu-chip${curGreetMode === opt.id ? ' is-active' : ''}`;
      gBtn.setAttribute('data-greeting-mode', opt.id);
      gBtn.setAttribute('aria-pressed', curGreetMode === opt.id ? 'true' : 'false');
      gBtn.textContent = opt.label;
      gBtn.onclick = (e) => {
        e.stopPropagation();
        fxPrefs.greetingMode = opt.id;
        saveFxPrefs();
        if (milkGreetingEl) applyGreetingModeClass(milkGreetingEl);
        renderWallpaperMenu(menu);
      };
      greetBtns.appendChild(gBtn);
    }
    greetRow.appendChild(greetBtns);
    menu.appendChild(greetRow);

    // Scrim opacity slider (0..100%)
    const scrimVal = typeof fxPrefs.scrimOpacity === 'number' && !Number.isNaN(fxPrefs.scrimOpacity)
      ? Math.max(0, Math.min(100, Math.round(fxPrefs.scrimOpacity)))
      : 100;
    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--agy-border-hairline, rgba(255,255,255,0.09));';
    const sliderHdr = document.createElement('div');
    sliderHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-size:12px;color:var(--agy-text-secondary, rgba(248,240,232,0.88));';
    const sliderLbl = document.createElement('label');
    sliderLbl.setAttribute('for', 'agy-wp-scrim-slider');
    sliderLbl.textContent = 'Затемнение фона';
    const sliderNum = document.createElement('span');
    sliderNum.className = 'agy-mono';
    sliderNum.style.cssText = 'font-weight:700;color:var(--agy-text-primary, #f8f0e8);';
    sliderNum.textContent = `${scrimVal}%`;
    sliderHdr.appendChild(sliderLbl);
    sliderHdr.appendChild(sliderNum);

    const slider = document.createElement('input');
    slider.id = 'agy-wp-scrim-slider';
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = String(scrimVal);
    slider.className = 'agy-wp-slider';
    slider.style.setProperty('--agy-slider-pct', `${scrimVal}%`);
    slider.setAttribute('aria-label', 'Затемнение фона');
    slider.oninput = (e) => {
      e.stopPropagation();
      const v = Number(slider.value);
      fxPrefs.scrimOpacity = v;
      sliderNum.textContent = `${v}%`;
      slider.style.setProperty('--agy-slider-pct', `${v}%`);
      applyScrimStyle(Boolean(getConversationIdFromLocation()));
    };
    slider.onchange = (e) => {
      e.stopPropagation();
      saveFxPrefs();
    };
    sliderWrap.appendChild(sliderHdr);
    sliderWrap.appendChild(slider);
    menu.appendChild(sliderWrap);

    // Effect toggles
    const toggleDefs = [
      { key: 'particles', label: 'Частицы' },
      { key: 'crt', label: 'CRT и глитч (Home)' },
      { key: 'parallax', label: 'Живая камера + параллакс' },
      { key: 'spotlight', label: 'Тёплый спотлайт' },
      { key: 'vhsSwitch', label: 'VHS-переключение' }
    ];
    for (const item of toggleDefs) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'agy-wp-menu-toggle';
      row.setAttribute('data-fx-key', item.key);
      const isOn = Boolean(fxPrefs[item.key]);
      row.setAttribute('aria-pressed', isOn ? 'true' : 'false');
      const lbl = document.createElement('span');
      lbl.textContent = item.label;
      const pill = document.createElement('span');
      pill.className = `agy-wp-menu-pill ${isOn ? 'is-on' : 'is-off'}`;
      pill.textContent = isOn ? 'ON' : 'OFF';
      row.appendChild(lbl);
      row.appendChild(pill);
      row.onclick = (e) => {
        e.stopPropagation();
        const liveInChat = Boolean(getConversationIdFromLocation());
        fxPrefs[item.key] = !fxPrefs[item.key];
        saveFxPrefs();
        renderWallpaperMenu(menu);
        const layer = document.getElementById('antigravity-wallpaper-layer');
        syncHomeAtmosphereFx(!isAppInactive(), !liveInChat && !isAppInactive(), layer);
      };
      menu.appendChild(row);
    }

    // Open wallpapers folder button
    if (window.antigravityTokenBridge && typeof window.antigravityTokenBridge.openWallpapersDir === 'function') {
      const footer = document.createElement('div');
      footer.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid var(--agy-border-hairline, rgba(255,255,255,0.09));display:flex;';
      const openDirBtn = document.createElement('button');
      openDirBtn.type = 'button';
      openDirBtn.className = 'agy-wp-menu-chip';
      openDirBtn.setAttribute('data-wp-action', 'open-dir');
      openDirBtn.style.cssText = 'width:100%;padding:5px 8px;display:flex;align-items:center;justify-content:center;gap:6px;';
      openDirBtn.innerHTML = `${agyIcon('folder', 13)}<span>Открыть папку обоев</span>`;
      openDirBtn.onclick = (e) => {
        e.stopPropagation();
        window.antigravityTokenBridge.openWallpapersDir().catch(() => {});
      };
      footer.appendChild(openDirBtn);
      menu.appendChild(footer);
    }
    if (prevWpFocus) restoreFocusDescriptor(menu, prevWpFocus);
  }

  function openWallpaperMenu(stage, pinned) {
    if (!stage) return;
    installWallpaperMenuDismissListeners();
    let menu = document.getElementById('antigravity-wallpaper-menu');
    const wasHidden = !menu || !menu.style || menu.style.display === 'none';
    if (wasHidden) {
      wpPrevFocusEl = document.activeElement || null;
    }
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'antigravity-wallpaper-menu';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', 'Настройки сцен и эффектов');
      menu.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
    }
    if (menu.parentElement !== stage) {
      stage.appendChild(menu);
    }
    renderWallpaperMenu(menu);
    menu.style.display = 'block';
    const ctrl = document.getElementById('antigravity-wallpaper-ctrl');
    if (ctrl) ctrl.setAttribute('aria-expanded', 'true');
    if (wasHidden) {
      const wpFocusTarget = menu.querySelector && (menu.querySelector('[role="tab"][aria-selected="true"]') || menu.querySelector('button'));
      if (wpFocusTarget && typeof wpFocusTarget.focus === 'function') {
        try { wpFocusTarget.focus({ preventScroll: true }); } catch (_) { try { wpFocusTarget.focus(); } catch (__) {} }
      }
    }
  }

  // Instant navigation listeners for SPA URL changes & New Conversation clicks
  function handlePossibleNavigation() {
    lastOverviewTreeWalkMs = 0;
    const id = getConversationIdFromLocation();
    if (!id) {
      currentActiveConvId = null;
      lastStatsData = { ...DEFAULT_ZERO_STATS };
    } else if (typeof window.__antigravity_stop_home_crt === 'function') {
      window.__antigravity_stop_home_crt();
    }
    setTimeout(() => {
      ensureTokenBar();
      ensureHomeWallpaper();
    }, 0);
    setTimeout(() => {
      ensureTokenBar();
      ensureHomeWallpaper();
    }, 80);
    setTimeout(() => {
      ensureHomeWallpaper();
    }, 260);
  }

  if (!window.__antigravity_orig_pushState) {
    window.__antigravity_orig_pushState = window.history.pushState;
  }
  if (!window.__antigravity_orig_replaceState) {
    window.__antigravity_orig_replaceState = window.history.replaceState;
  }

  const origPush = window.__antigravity_orig_pushState;
  window.history.pushState = function (...args) {
    origPush.apply(this, args);
    handlePossibleNavigation();
  };

  const origReplace = window.__antigravity_orig_replaceState;
  window.history.replaceState = function (...args) {
    origReplace.apply(this, args);
    handlePossibleNavigation();
  };

  window.__antigravity_nav_handler = handlePossibleNavigation;
  window.addEventListener('popstate', handlePossibleNavigation);
  window.addEventListener('hashchange', handlePossibleNavigation);

  window.__antigravity_nav_click_handler = (e) => {
    const target = e && e.target;
    const link = target && target.closest && target.closest('a[href="/"], a[href^="/?"], button[aria-label*="New Conversation"]');
    if (link) {
      currentActiveConvId = null;
      lastStatsData = { ...DEFAULT_ZERO_STATS };
      setTimeout(() => {
        ensureTokenBar();
        ensureHomeWallpaper();
      }, 10);
    }
    if (!target || !target.closest || !target.closest('#antigravity-wallpaper-layer, #antigravity-wallpaper-menu, #antigravity-corner-dock, #antigravity-token-stats-bar, #antigravity-swarm-modal')) {
      const syncOv = () => {
        const curBox = findInputBox();
        ensureOverviewPanelTheme(curBox ? findMainStage(curBox) : null, curBox);
      };
      setTimeout(syncOv, 50);
      setTimeout(syncOv, 220);
    }
  };
  document.addEventListener('click', window.__antigravity_nav_click_handler, true);

  function initAll() {
    isWindowBlurred = typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
    window.__antigravity_visibility_handler = () => {
      if (document.hidden) {
        stopHomeAtmosphereFx(false, false);
      } else {
        ensureTokenBar();
        ensureHomeWallpaper();
      }
    };
    window.__antigravity_blur_handler = () => {
      if (typeof document.hasFocus === 'function' && document.hasFocus()) return;
      isWindowBlurred = true;
      const layer = document.getElementById('antigravity-wallpaper-layer');
      if (layer && layer.classList) layer.classList.add('agy-wp-sleeping');
      stopHomeAtmosphereFx(false, !document.hidden);
    };
    window.__antigravity_focus_handler = () => {
      isWindowBlurred = false;
      const layer = document.getElementById('antigravity-wallpaper-layer');
      if (layer && layer.classList) layer.classList.remove('agy-wp-sleeping');
      if (!document.hidden) {
        ensureTokenBar();
        ensureHomeWallpaper();
      }
    };
    document.addEventListener('visibilitychange', window.__antigravity_visibility_handler);
    window.addEventListener('blur', window.__antigravity_blur_handler);
    window.addEventListener('focus', window.__antigravity_focus_handler);
    window.__antigravity_stats_interval = setInterval(() => {
      ensureTokenBar();
      const curBox = findInputBox();
      ensureOverviewPanelTheme(curBox ? findMainStage(curBox) : null, curBox);
    }, 1000);
    window.__antigravity_wallpaper_timer = setInterval(ensureHomeWallpaper, 3000);
    if (typeof MutationObserver === 'function' && document.body) {
      try {
        const obs = new MutationObserver((mutations) => {
          let added = false;
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (m.addedNodes && m.addedNodes.length > 0) {
              for (let j = 0; j < m.addedNodes.length; j++) {
                const n = m.addedNodes[j];
                if (n && n.nodeType === 1 && !isModOwnedNode(n)) {
                  added = true;
                  break;
                }
              }
            }
            if (added) break;
          }
          if (!added) return;
          if (window.__antigravity_overview_debounce) clearTimeout(window.__antigravity_overview_debounce);
          window.__antigravity_overview_debounce = setTimeout(() => {
            window.__antigravity_overview_debounce = 0;
            const curBox = findInputBox();
            ensureOverviewPanelTheme(curBox ? findMainStage(curBox) : null, curBox);
          }, 60);
        });
        obs.observe(document.body, { childList: true, subtree: true });
        window.__antigravity_overview_observer = obs;
      } catch (_) {}
    }
    ensureTokenBar();
    ensureHomeWallpaper();
    const initBox = findInputBox();
    ensureOverviewPanelTheme(initBox ? findMainStage(initBox) : null, initBox);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
