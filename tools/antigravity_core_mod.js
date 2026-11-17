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
      const oldWpMenu = document.getElementById('antigravity-wallpaper-menu');
      if (oldWpMenu) oldWpMenu.remove();
      const oldWpCtrl = document.getElementById('antigravity-wallpaper-ctrl');
      if (oldWpCtrl) oldWpCtrl.remove();
      const leftoverPopover = document.getElementById('antigravity-token-popover');
      if (leftoverPopover) leftoverPopover.remove();
      const leftoverSwarm = document.getElementById('antigravity-swarm-modal');
      if (leftoverSwarm) leftoverSwarm.remove();
      if (window.__antigravity_wallpaper_timer) {
        clearInterval(window.__antigravity_wallpaper_timer);
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

  function isAppInactive() {
    return Boolean(document.hidden || isWindowBlurred);
  }

  function hasDomStopIndicator(box) {
    const selectors = 'button[aria-label*="Stop" i], button[aria-label*="Cancel" i], button[title*="Stop" i], button[title*="Cancel" i], [data-testid*="stop" i]';
    try {
      if (box && typeof box.querySelector === 'function' && box.querySelector(selectors)) {
        return true;
      }
      if (typeof document.querySelector === 'function' && document.querySelector(selectors)) {
        return true;
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
      agentDoneUntilMs = 0;
    } else if (agentVisualState === 'thinking') {
      agentVisualState = 'done';
      agentDoneUntilMs = now + 1700;
      if (window.__antigravity_done_timer) clearTimeout(window.__antigravity_done_timer);
      window.__antigravity_done_timer = setTimeout(() => {
        window.__antigravity_done_timer = 0;
        syncAgentStateOnUi(findInputBox(), lastStatsData);
      }, 1750);
    } else if (agentVisualState === 'done' && now >= agentDoneUntilMs) {
      agentVisualState = 'idle';
      agentDoneUntilMs = 0;
    }

    const targetBox = box || findInputBox();
    if (targetBox && targetBox.classList) {
      if (agentVisualState === 'thinking') {
        targetBox.classList.add('agy-milk-thinking');
      } else {
        targetBox.classList.remove('agy-milk-thinking');
      }
      if (agentVisualState === 'done') {
        targetBox.classList.add('agy-milk-done');
      } else {
        targetBox.classList.remove('agy-milk-done');
      }
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
      const modelPattern = /\b(hydrogen|argon|carbon|3\.8\s*flash|gemini\s*3\.8|flash)\b/i;
      let firstMatch = '';
      for (const scope of scopes) {
        if (!scope || typeof scope.querySelectorAll !== 'function') continue;
        const buttons = scope.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.closest && btn.closest('#antigravity-token-stats-bar, #antigravity-wallpaper-menu, #antigravity-wallpaper-ctrl')) {
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
      const m = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
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
    if (isMountingBar || document.hidden) return;
    const box = findInputBox();
    if (!box || !box.parentElement) return;

    isMountingBar = true;
    try {
      let bar = document.getElementById('antigravity-token-stats-bar');
      const modelName = getActiveModelName(box);
      const stats = await fetchStats(modelName);
      const light = isLightSurface();
      const palette = light
        ? {
            muted: '#52525b',
            strong: '#18181b',
            pillBg: 'rgba(0, 0, 0, 0.05)',
            pillBorder: 'rgba(0, 0, 0, 0.12)',
            track: 'rgba(0, 0, 0, 0.14)'
          }
        : {
            muted: '#9ca3af',
            strong: '#f3f4f6',
            pillBg: 'rgba(255, 255, 255, 0.06)',
            pillBorder: 'rgba(255, 255, 255, 0.1)',
            track: 'rgba(255, 255, 255, 0.12)'
          };

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
            'padding: 6px 12px 4px 12px',
            'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'font-size: 11.5px',
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

        const progressColor = stats.percent > 85 ? '#ef4444' : stats.percent > 65 ? '#f59e0b' : '#22c55e';
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

        barContent.innerHTML = `
          <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px;">
            <div style="display: flex; align-items: center; gap: 5px;" title="${leftTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span><strong style="color: ${palette.strong}; font-weight: 600;">${stats.turns}</strong> turns <strong style="color: ${palette.strong}; font-weight: 600;">${stats.steps}</strong> steps · <strong style="color: ${palette.strong}; font-weight: 600;">${stats.speed}</strong> tok/s</span>
            </div>

            <div style="display: flex; align-items: center; gap: 5px;" title="${midTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              </svg>
              <span><strong style="color: ${palette.strong}; font-weight: 600;">${stats.contextTokens}</strong> tok · Cache hit <strong style="color: ${palette.strong}; font-weight: 600;">${stats.cacheHit}%</strong></span>
            </div>

            <div style="display: flex; align-items: center; gap: 5px;" title="${totalTitle}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              <span><strong style="color: ${palette.strong}; font-weight: 600;">${stats.grandTotalTokens}</strong> total${subagentSuffix}</span>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 3px;" title="${costTitle}">
              <span><strong style="color: ${palette.strong}; font-weight: 600;">${escapeAttr(stats.apiCost || '$0.00')}</strong></span>
            </div>

            <div style="display: flex; align-items: center; gap: 4px;" title="${workTimeTitle}">
              <svg width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.75;">
                <path d="M5 22h14"></path>
                <path d="M5 2h14"></path>
                <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path>
                <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path>
              </svg>
              <span><strong style="color: ${palette.strong}; font-weight: 600;">${escapeAttr(stats.totalWorkTime)}</strong></span>
            </div>

            <button id="antigravity-swarm-btn" type="button" style="
              display: flex;
              align-items: center;
              gap: 4px;
              padding: 2px 7px;
              border-radius: 9999px;
              background: ${stats.subagentCount > 0 ? palette.pillBg : 'transparent'};
              border: 1px solid ${stats.subagentCount > 0 ? palette.pillBorder : 'rgba(128,128,128,0.22)'};
              color: ${stats.subagentCount > 0 ? palette.strong : palette.muted};
              font-size: 11px;
              font-weight: 600;
              user-select: none;
              cursor: pointer;
              transition: background 0.15s ease, border-color 0.15s ease;
            " title="Открыть карту роя субагентов (${stats.subagentCount || 0})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.85;">
                <circle cx="5" cy="12" r="2.5"></circle>
                <circle cx="19" cy="6" r="2.5"></circle>
                <circle cx="19" cy="18" r="2.5"></circle>
                <path d="M7.3 11.1 16.7 6.9"></path>
                <path d="M7.3 12.9 16.7 17.1"></path>
              </svg>
              <span>${stats.subagentCount > 0 ? stats.subagentCount : 'Рой'}</span>
            </button>

            <div id="antigravity-token-pill" style="
              display: flex;
              align-items: center;
              gap: 6px;
              padding: 2px 8px;
              border-radius: 9999px;
              background: ${palette.pillBg};
              border: 1px solid ${palette.pillBorder};
              user-select: none;
              cursor: pointer;
              transition: background 0.15s ease, border-color 0.15s ease;
            " title="${pillTitle} (ЛКМ: подробная статистика)">
              <svg width="13" height="13" viewBox="0 0 36 36">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${palette.track}" stroke-width="4" />
                ${progressArc}
              </svg>
              <span style="color: ${palette.strong}; font-weight: 600;">${escapeAttr(percentText)}</span>
            </div>
          </div>
        `;

        const pillEl = bar.querySelector && bar.querySelector('#antigravity-token-pill');
        if (pillEl) {
          pillEl.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            toggleTokenPopover(bar, lastStatsData, getActiveModelName(box));
          };
        }

        const swarmBtn = bar.querySelector && bar.querySelector('#antigravity-swarm-btn');
        if (swarmBtn) {
          swarmBtn.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            toggleSwarmModal(lastStatsData, getActiveModelName(box));
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

  function buildSpeedSparklineSvg(speeds) {
    const arr = Array.isArray(speeds) ? speeds.filter((n) => typeof n === 'number' && n > 0) : [];
    const w = 248;
    const h = 38;
    if (arr.length === 0) {
      return `<div style="height:${h}px;display:flex;align-items:center;justify-content:center;color:rgba(243,244,246,0.42);font-size:10.5px;border:1px dashed rgba(255,255,255,0.10);border-radius:6px;">Ожидание замеров скорости...</div>`;
    }
    const maxV = Math.max(...arr, 10);
    const minV = Math.min(...arr);
    const span = Math.max(10, maxV - minV * 0.6);
    const baseV = minV * 0.6;
    const padX = 5;
    const padY = 5;
    const innerW = w - padX * 2;
    const innerH = h - padY * 2;

    const pts = arr.map((v, i) => {
      const x = arr.length === 1 ? w / 2 : padX + (i / (arr.length - 1)) * innerW;
      const y = padY + innerH - Math.max(0, Math.min(1, (v - baseV) / span)) * innerH;
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), v };
    });

    const polyPoints = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const areaPoints = arr.length > 1
      ? `${pts[0].x},${h - 2} ${polyPoints} ${pts[pts.length - 1].x},${h - 2}`
      : `${padX},${h - 2} ${padX},${pts[0].y} ${w - padX},${pts[0].y} ${w - padX},${h - 2}`;

    const dots = pts.map((p, idx) => {
      const isLast = idx === pts.length - 1;
      const r = isLast ? 2.6 : 1.7;
      const fill = isLast ? 'rgb(var(--agy-secondary-rgb, 248, 224, 192))' : 'rgb(var(--agy-accent-bright-rgb, 255, 68, 82))';
      return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" />`;
    }).join('');

    return `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;width:100%;height:${h}px;border-radius:6px;background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.07);">
        <polygon points="${areaPoints}" fill="rgba(var(--agy-accent-rgb, 198, 52, 60), 0.22)" />
        ${arr.length > 1 ? `<polyline points="${polyPoints}" fill="none" stroke="rgb(var(--agy-accent-bright-rgb, 255, 68, 82))" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />` : `<line x1="${padX}" y1="${pts[0].y}" x2="${w - padX}" y2="${pts[0].y}" stroke="rgb(var(--agy-accent-bright-rgb, 255, 68, 82))" stroke-width="1.8" stroke-dasharray="3,3" />`}
        ${dots}
      </svg>
    `;
  }

  function closeTokenPopover() {
    const pop = document.getElementById('antigravity-token-popover');
    if (pop && pop.style) {
      pop.style.display = 'none';
    }
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

    const nodeW = 166;
    const nodeH = 40;
    const colGap = 44;
    const rowGap = 10;
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

    const svgW = Math.max(480, padX * 2 + (maxDepth + 1) * nodeW + maxDepth * colGap);
    const svgH = Math.max(240, Math.round(totalTreeH + padY * 2));

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

    let nodesSvg = '';
    const activeCount = subagents.filter((x) => x.isActive).length;
    for (const item of posMap.values()) {
      const n = item.node;
      const isRoot = n.depth === 0;
      const isSelected = n.id === activeSelId;
      const isLive = Boolean(n.isActive);

      const bgCol = isSelected
        ? 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.36)'
        : (isRoot ? 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.24)' : 'rgba(18, 20, 30, 0.96)');
      const borderCol = isSelected
        ? 'rgb(var(--agy-secondary-rgb, 248, 224, 192))'
        : (isLive ? 'rgb(var(--agy-accent-bright-rgb, 255, 68, 82))' : 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.52)');
      const barCol = isLive
        ? 'rgb(var(--agy-accent-bright-rgb, 255, 68, 82))'
        : (isRoot ? 'rgb(var(--agy-secondary-rgb, 248, 224, 192))' : 'rgba(var(--agy-accent-rgb, 198, 52, 60), 0.88)');

      const rawLabel = isRoot ? 'Main Chat' : (n.role || 'Subagent');
      const shortLabel = rawLabel.length > 22 ? `${rawLabel.slice(0, 21)}…` : rawLabel;
      const metaLine = isRoot
        ? `${n.tokens || '0'} tok · ${n.cost || '$0'} · ${n.workTime || '0s'}`
        : `S${n.depth} · ${n.tokens || '0'} · ${n.cost || '$0'} · ${n.workTime || '0s'}`;

      nodesSvg += `
        <g class="agy-swarm-node-g" data-swarm-node="${escapeAttr(n.id)}" style="cursor:pointer;">
          <rect x="${item.x}" y="${item.y}" width="${nodeW}" height="${nodeH}" rx="7" fill="${bgCol}" stroke="${borderCol}" stroke-width="${isSelected ? 2 : 1.2}" />
          <rect x="${item.x}" y="${item.y}" width="4" height="${nodeH}" rx="2" fill="${barCol}" />
          ${isLive ? `<circle cx="${item.x + nodeW - 9}" cy="${item.y + 9}" r="3.2" fill="rgb(var(--agy-accent-bright-rgb, 255, 68, 82))" class="agy-swarm-node-pulse" />` : ''}
          <text x="${item.x + 10}" y="${item.y + 16}" fill="#f8f0e8" font-size="11" font-weight="${isSelected || isRoot ? '700' : '600'}" style="pointer-events:none;">${escapeAttr(shortLabel)}</text>
          <text x="${item.x + 10}" y="${item.y + 30}" fill="rgba(243,244,246,0.70)" font-size="9.5" style="pointer-events:none;">${escapeAttr(metaLine)}</text>
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
      svgInner: edgesSvg + nodesSvg,
      sel
    };
  }

  function closeSwarmModal() {
    const modal = document.getElementById('antigravity-swarm-modal');
    if (modal && modal.style) {
      modal.style.display = 'none';
    }
  }

  function applySwarmCanvasTransform(modal) {
    if (!modal) return;
    const stageEl = modal.querySelector && modal.querySelector('#agy-swarm-stage');
    if (stageEl && stageEl.style) {
      stageEl.style.transform = `translate(${swarmPanX.toFixed(1)}px, ${swarmPanY.toFixed(1)}px) scale(${swarmZoom.toFixed(3)})`;
    }
    const zoomLbl = modal.querySelector && modal.querySelector('#agy-swarm-zoom-lbl');
    if (zoomLbl) {
      zoomLbl.textContent = `${Math.round(swarmZoom * 100)}%`;
    }
  }

  function fitSwarmCanvasToViewport(modal, svgW, svgH) {
    if (!modal) return;
    const vp = modal.querySelector && modal.querySelector('#agy-swarm-viewport');
    const vpW = (vp && vp.clientWidth) ? vp.clientWidth : 820;
    const vpH = (vp && vp.clientHeight) ? vp.clientHeight : 440;
    const scaleX = (vpW - 24) / Math.max(1, svgW);
    const scaleY = (vpH - 24) / Math.max(1, svgH);
    const fit = Math.max(0.45, Math.min(1.15, Math.min(scaleX, scaleY)));
    swarmZoom = Number(fit.toFixed(3));
    const drawW = svgW * swarmZoom;
    const drawH = svgH * swarmZoom;
    swarmPanX = Math.max(12, Math.round((vpW - drawW) / 2));
    swarmPanY = Math.max(12, Math.round((vpH - drawH) / 2));
    applySwarmCanvasTransform(modal);
  }

  function renderSwarmModal(modal, stats, modelName) {
    if (!modal) return;
    const s = stats || DEFAULT_ZERO_STATS;
    const convId = getConversationIdFromLocation() || '';
    const subagents = Array.isArray(s.subagents) ? s.subagents : [];
    const layout = computeSwarmLayout(s, convId, selectedSwarmNodeId);

    const renderKey = [
      convId,
      modelName,
      selectedSwarmNodeId || '',
      s.grandTotalTokens,
      s.apiCost,
      s.subagentCount,
      subagents.map((x) => `${x.id}:${x.steps}:${x.isActive ? 1 : 0}:${x.lastTool || ''}`).join(',')
    ].join('|');

    if (modal.dataset && modal.dataset.renderKey === renderKey) {
      return;
    }
    // Do not rebuild the DOM while the user is dragging the graph (would abort the drag)
    if (swarmIsDragging && modal.dataset && modal.dataset.renderKey) {
      return;
    }
    if (modal.dataset) modal.dataset.renderKey = renderKey;

    const sel = layout.sel || {};
    const statusBadge = sel.isActive
      ? '<span class="agy-wp-menu-pill is-on">ACTIVE</span>'
      : '<span class="agy-wp-menu-pill is-off">DONE</span>';
    const shortSelId = sel.id && sel.id.length > 14 ? `${sel.id.slice(0, 10)}…` : (sel.id || '');

    const bodyHtml = layout.empty
      ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(243,244,246,0.58);font-size:13px;gap:6px;">
           <div style="font-size:26px;opacity:0.75;">🕸</div>
           <div>В этом чате субагенты ещё не запускались</div>
           <div style="font-size:11.5px;opacity:0.65;">Как только агент вызовет субагентов, здесь появится интерактивное дерево роя</div>
         </div>`
      : `
        <div id="agy-swarm-viewport" style="position:relative;flex:1;overflow:hidden;border-radius:10px;background:rgba(5,6,11,0.72);border:1px solid rgba(255,255,255,0.08);cursor:grab;">
          <div id="agy-swarm-stage" style="position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;">
            <svg width="${layout.svgW}" height="${layout.svgH}" viewBox="0 0 ${layout.svgW} ${layout.svgH}" style="display:block;">
              ${layout.svgInner}
            </svg>
          </div>
          <div style="position:absolute;bottom:8px;right:10px;font-size:10px;color:rgba(243,244,246,0.45);pointer-events:none;">
            Перетаскивайте фон · Колёсико: масштаб · Клик по узлу: детали
          </div>
        </div>

        <div class="agy-pop-stat-card" style="margin-top:10px;padding:9px 12px;background:rgba(var(--agy-accent-rgb, 198, 52, 60), 0.11);border-color:rgba(var(--agy-accent-rgb, 198, 52, 60), 0.34);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <span style="font-weight:700;color:#f8f0e8;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(sel.role || 'Node')}</span>
              <span style="font-size:11px;color:rgba(243,244,246,0.60);">${sel.depth ? `Уровень S${sel.depth}` : 'Корень чата'}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              ${statusBadge}
              ${sel.id ? `<button type="button" id="agy-swarm-copy-id" data-copy-id="${escapeAttr(sel.id)}" class="agy-wp-menu-chip" style="padding:2px 8px;font-size:11px;" title="Скопировать ID: ${escapeAttr(sel.id)}">${escapeAttr(shortSelId)} 📋</button>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11.5px;color:rgba(243,244,246,0.86);">
            <span>Токены: <strong style="color:#ffffff;">${escapeAttr(sel.tokens || '0')}</strong> · API: <strong style="color:#ffffff;">${escapeAttr(sel.cost || '$0.00')}</strong> · Шаги: <strong style="color:#ffffff;">${sel.steps || 0}</strong> · Время: <strong style="color:#ffffff;">${escapeAttr(sel.workTime || '0s')}</strong></span>
            <span style="color:rgba(243,244,246,0.68);">Последнее действие: <strong style="color:#f8f0e8;">${escapeAttr(sel.lastTool || '—')}</strong></span>
          </div>
        </div>
      `;

    modal.innerHTML = `
      <div id="antigravity-swarm-card" style="
        width: min(1040px, 90vw);
        height: min(720px, 84vh);
        display: flex;
        flex-direction: column;
        padding: 14px 16px;
        border-radius: 14px;
        background: rgba(11, 12, 19, 0.96);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.52);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.82);
        color: #f3f4f6;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-sizing: border-box;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-shrink:0;">
          <div style="display:flex;flex-direction:column;min-width:0;">
            <span style="font-weight:700;color:#f8f0e8;font-size:14px;">Карта роя субагентов</span>
            <span style="font-size:11px;color:rgba(243,244,246,0.66);">
              Узлов: ${subagents.length + 1} (1 + ${subagents.length}) · Глубина: ${layout.maxDepth} · Активно: ${layout.activeCount} · Всего: ${escapeAttr(s.grandTotalTokens || '0')} tok (${escapeAttr(s.apiCost || '$0.00')})
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            ${layout.empty ? '' : `
              <button type="button" id="agy-swarm-zoom-out" class="agy-wp-menu-chip" title="Уменьшить">−</button>
              <button type="button" id="agy-swarm-zoom-fit" class="agy-wp-menu-chip" title="Вписать весь граф в окно"><span id="agy-swarm-zoom-lbl">${Math.round(swarmZoom * 100)}%</span> · Вписать</button>
              <button type="button" id="agy-swarm-zoom-in" class="agy-wp-menu-chip" title="Увеличить">+</button>
            `}
            <button type="button" id="agy-swarm-close" class="agy-wp-menu-chip" style="padding:3px 9px;" title="Закрыть (Esc)">✕</button>
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
          requestAnimationFrame(() => fitSwarmCanvasToViewport(modal, layout.svgW, layout.svgH));
        } else {
          fitSwarmCanvasToViewport(modal, layout.svgW, layout.svgH);
        }
      } else {
        applySwarmCanvasTransform(modal);
      }

      const vp = modal.querySelector && modal.querySelector('#agy-swarm-viewport');
      if (vp) {
        let isDragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let origPanX = 0;
        let origPanY = 0;

        vp.onmousedown = (e) => {
          if (e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest('[data-swarm-node]')) return;
          isDragging = true;
          swarmIsDragging = true;
          moved = false;
          startX = e.clientX;
          startY = e.clientY;
          origPanX = swarmPanX;
          origPanY = swarmPanY;
          vp.style.cursor = 'grabbing';
        };
        vp.onmousemove = (e) => {
          if (!isDragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
          swarmPanX = origPanX + dx;
          swarmPanY = origPanY + dy;
          applySwarmCanvasTransform(modal);
        };
        const endDrag = () => {
          isDragging = false;
          swarmIsDragging = false;
          vp.style.cursor = 'grab';
        };
        vp.onmouseup = endDrag;
        vp.onmouseleave = endDrag;

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

      const zOut = modal.querySelector && modal.querySelector('#agy-swarm-zoom-out');
      if (zOut) {
        zOut.onclick = (e) => {
          e.stopPropagation();
          swarmZoom = Math.max(0.28, Number((swarmZoom * 0.85).toFixed(3)));
          applySwarmCanvasTransform(modal);
        };
      }
      const zIn = modal.querySelector && modal.querySelector('#agy-swarm-zoom-in');
      if (zIn) {
        zIn.onclick = (e) => {
          e.stopPropagation();
          swarmZoom = Math.min(2.4, Number((swarmZoom * 1.18).toFixed(3)));
          applySwarmCanvasTransform(modal);
        };
      }
      const zFit = modal.querySelector && modal.querySelector('#agy-swarm-zoom-fit');
      if (zFit) {
        zFit.onclick = (e) => {
          e.stopPropagation();
          fitSwarmCanvasToViewport(modal, layout.svgW, layout.svgH);
        };
      }

      const swarmNodes = modal.querySelectorAll ? modal.querySelectorAll('[data-swarm-node]') : [];
      for (const sn of swarmNodes) {
        sn.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const nid = sn.dataset ? sn.dataset.swarmNode : '';
          if (nid && nid !== selectedSwarmNodeId) {
            selectedSwarmNodeId = nid;
            if (modal.dataset) modal.dataset.renderKey = '';
            renderSwarmModal(modal, lastStatsData, modelName);
          }
        };
      }

      const swarmCopyBtn = modal.querySelector && modal.querySelector('#agy-swarm-copy-id');
      if (swarmCopyBtn) {
        swarmCopyBtn.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const cid = swarmCopyBtn.dataset ? swarmCopyBtn.dataset.copyId : '';
          if (cid && copyTextToClipboard(cid)) {
            const orig = swarmCopyBtn.textContent;
            swarmCopyBtn.textContent = 'Скопировано ✓';
            setTimeout(() => {
              if (swarmCopyBtn.isConnected) swarmCopyBtn.textContent = orig;
            }, 1100);
          }
        };
      }
    }
  }

  function toggleSwarmModal(stats, modelName) {
    ensureMilkThemeStyles();
    installWallpaperMenuDismissListeners();
    closeTokenPopover();
    closeWallpaperMenu();
    let modal = document.getElementById('antigravity-swarm-modal');
    if (modal && modal.style && modal.style.display !== 'none') {
      closeSwarmModal();
      return;
    }
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'antigravity-swarm-modal';
      modal.style.cssText = [
        'position: fixed',
        'inset: 0',
        'z-index: 10020',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'background: rgba(5, 6, 12, 0.72)',
        'backdrop-filter: blur(6px)',
        '-webkit-backdrop-filter: blur(6px)'
      ].join(';');
      modal.onclick = () => closeSwarmModal();
      (document.body || document.documentElement).appendChild(modal);
    }
    swarmInitializedView = false;
    swarmIsDragging = false;
    if (modal.dataset) modal.dataset.renderKey = '';
    modal.style.display = 'flex';
    renderSwarmModal(modal, stats, modelName);
  }

  function renderTokenPopover(popover, stats, modelName) {
    if (!popover) return;
    const s = stats || DEFAULT_ZERO_STATS;
    const convId = getConversationIdFromLocation() || '';
    const shortConv = convId ? (convId.length > 12 ? `${convId.slice(0, 8)}…` : convId) : 'Нет чата';
    const progressColor = s.percent > 85 ? '#ef4444' : s.percent > 65 ? '#f59e0b' : '#22c55e';
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
      subagents.length,
      inspSummary.total,
      inspSummary.approxTokens,
      inspFiles.length
    ].join('|');

    if (popover.dataset && popover.dataset.renderKey === renderKey) {
      return;
    }
    if (popover.dataset) popover.dataset.renderKey = renderKey;
    popover.style.width = '304px';

    const subRowsHtml = subagents.map((sub, idx) => {
      const roleText = escapeAttr(sub.role || `Subagent #${idx + 1}`);
      const subIdAttr = escapeAttr(sub.id || '');
      const costPart = sub.cost ? ` · ${escapeAttr(sub.cost)}` : '';
      const subMeta = `${escapeAttr(sub.tokens || '0')} tok${costPart} · ${escapeAttr(sub.workTime || '0s')}`;
      return `
        <button type="button" class="agy-pop-sub-row" data-sub-id="${subIdAttr}" title="ЛКМ: скопировать ID субагента (${subIdAttr})">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:118px;font-weight:600;color:#f8f0e8;">${roleText}</span>
          <span style="color:rgba(243,244,246,0.75);font-size:10.5px;flex-shrink:0;">${subMeta}</span>
        </button>
      `;
    }).join('');

    const subSectionHtml = subagents.length > 0 ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;font-size:10.5px;color:rgba(243,244,246,0.68);">
          <span>Субагенты (${s.subagentCount || subagents.length})</span>
          <span>${escapeAttr(s.subagentTotalTokens)} tok · ${escapeAttr(s.apiCostSubagents || '$0.00')}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;max-height:96px;overflow-y:auto;padding-right:2px;">
          ${subRowsHtml}
        </div>
      </div>
    ` : '';

    const costDetails = `In ${escapeAttr(s.apiCostInput || '$0.00')} · Кэш ${escapeAttr(s.apiCostCache || '$0.00')} · Out ${escapeAttr(s.apiCostOutput || '$0.00')}`;

    const overviewHtml = `
      <div style="margin-bottom:9px;">
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;margin-bottom:4px;">
          <span style="color:rgba(243,244,246,0.78);">Заполнение окна</span>
          <strong style="color:#ffffff;font-weight:600;">${escapeAttr(s.contextTokens)} / ${escapeAttr(s.modelLimitLabel)} (${s.exactPercent}%)</strong>
        </div>
        <div style="width:100%;height:6px;border-radius:9999px;background:rgba(255,255,255,0.10);overflow:hidden;">
          <div style="width:${barWidth}%;height:100%;border-radius:9999px;background:${progressColor};transition:width 0.25s ease;"></div>
        </div>
      </div>

      <div class="agy-pop-stat-card" style="margin-bottom:7px;background:rgba(var(--agy-accent-rgb, 198, 52, 60), 0.12);border-color:rgba(var(--agy-accent-rgb, 198, 52, 60), 0.34);">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span class="agy-pop-stat-lbl">Стоимость по API</span>
          <span style="font-size:12.5px;font-weight:700;color:#ffffff;">${escapeAttr(s.apiCost || '$0.00')}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:10px;color:rgba(243,244,246,0.70);margin-top:2px;">
          <span>${costDetails}</span>
        </div>
        <div style="font-size:9.5px;color:rgba(243,244,246,0.52);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(s.pricingLabel || 'Gemini API')}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:9px;">
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Вход шага (In / Кэш)</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.lastInput)} / ${escapeAttr(s.lastCache)}</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Кэш (шаг / сессия)</span>
          <span class="agy-pop-stat-val">${s.cacheHit}% / ${s.sessionCacheHit}%</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Сгенерировано (Out)</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.totalOutput)} tok</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Всего прогнано</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.grandTotalTokens)} tok</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Ходы / Ответов ИИ</span>
          <span class="agy-pop-stat-val">${s.turns} / ${s.plannerSteps} <span style="opacity:0.65;font-weight:400;">(${s.steps})</span></span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Активное время</span>
          <span class="agy-pop-stat-val">${escapeAttr(s.totalWorkTime)}</span>
        </div>
      </div>

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:10.5px;color:rgba(243,244,246,0.72);margin-bottom:4px;">
          <span>Скорость: <strong style="color:#f8f0e8;">${s.speed} tok/s</strong></span>
          <span>мин ${minSpeed} · пик ${peakSpeed} tok/s</span>
        </div>
        ${buildSpeedSparklineSvg(speeds)}
      </div>
      ${subSectionHtml}
    `;

    const topToolsHtml = topTools.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${topTools.map((t) => `<span class="agy-pop-tool-chip">${escapeAttr(t.name)} ×${t.count}</span>`).join('')}</div>`
      : '';

    const filesRowsHtml = inspFiles.length > 0
      ? inspFiles.map((f) => {
          const isHot = (f.reads || 0) >= 3 && (f.edits || 0) === 0;
          const badgeR = f.reads > 0 ? `<span style="opacity:0.8;">R×${f.reads}</span>` : '';
          const badgeE = f.edits > 0 ? `<span style="color:rgb(var(--agy-secondary-rgb, 248, 224, 192));font-weight:700;">E×${f.edits}</span>` : '';
          const badges = [badgeR, badgeE].filter(Boolean).join(' ');
          return `
            <button type="button" class="agy-pop-sub-row${isHot ? ' is-warn' : ''}" data-file-path="${escapeAttr(f.path)}" title="${escapeAttr(f.path)} (ЛКМ: скопировать путь)">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;font-weight:${f.edits > 0 ? '600' : '500'};color:${f.edits > 0 ? '#f8f0e8' : 'rgba(243,244,246,0.88)'};">${escapeAttr(f.name)}</span>
              <span style="display:flex;gap:5px;font-size:10px;flex-shrink:0;">${badges}</span>
            </button>
          `;
        }).join('')
      : `<div style="padding:10px;text-align:center;color:rgba(243,244,246,0.48);font-size:10.5px;border:1px dashed rgba(255,255,255,0.10);border-radius:7px;">Файлы в этом чате ещё не читались</div>`;

    const contextHtml = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px;">
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Чтение</span>
          <span class="agy-pop-stat-val">${inspSummary.reads}</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Правки</span>
          <span class="agy-pop-stat-val">${inspSummary.edits}</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Команды</span>
          <span class="agy-pop-stat-val">${inspSummary.cmds}</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">Веб</span>
          <span class="agy-pop-stat-val">${inspSummary.web}</span>
        </div>
        <div class="agy-pop-stat-card">
          <span class="agy-pop-stat-lbl">MCP / Суб</span>
          <span class="agy-pop-stat-val">${inspSummary.mcp} / ${inspSummary.subagents}</span>
        </div>
        <div class="agy-pop-stat-card" title="Примерный объём ответов инструментов (символы / 4)">
          <span class="agy-pop-stat-lbl">Вывод тулзов</span>
          <span class="agy-pop-stat-val">~${escapeAttr(inspSummary.approxTokens || '0')}</span>
        </div>
      </div>
      ${topToolsHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:10.5px;color:rgba(243,244,246,0.68);margin-bottom:5px;">
        <span>Файлы в контексте (${inspFiles.length})</span>
        <span>клик — копировать путь</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;max-height:175px;overflow-y:auto;padding-right:2px;">
        ${filesRowsHtml}
      </div>
    `;

    const __popScrolls = popover.querySelectorAll
      ? Array.from(popover.querySelectorAll('div')).filter((d) => d.style && d.style.overflowY === 'auto').map((d) => d.scrollTop)
      : [];
    popover.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">
        <div style="display:flex;flex-direction:column;min-width:0;">
          <span style="font-weight:700;color:#f8f0e8;font-size:12px;">Монитор сессии</span>
          <span style="font-size:10.5px;color:rgba(243,244,246,0.62);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeAttr(modelName || 'Авто-модель')} · ${escapeAttr(s.modelLimitLabel)}</span>
        </div>
        ${convId ? `<button type="button" id="agy-pop-copy-conv" class="agy-wp-menu-chip" title="Скопировать ID чата: ${escapeAttr(convId)}">${escapeAttr(shortConv)} 📋</button>` : ''}
      </div>

      <div style="display:flex;gap:4px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <button type="button" class="agy-wp-menu-chip${popoverActiveTab === 'overview' ? ' is-active' : ''}" data-pop-tab="overview" style="flex:1;padding:3px 6px;">Обзор · ${escapeAttr(s.apiCost || '$0.00')}</button>
        <button type="button" class="agy-wp-menu-chip${popoverActiveTab === 'context' ? ' is-active' : ''}" data-pop-tab="context" style="flex:1;padding:3px 6px;">Инспектор (${inspSummary.total})</button>
      </div>

      ${popoverActiveTab === 'context' ? contextHtml : overviewHtml}
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

    const copyBtn = popover.querySelector && popover.querySelector('#agy-pop-copy-conv');
    if (copyBtn && convId) {
      copyBtn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        if (copyTextToClipboard(convId)) {
          copyBtn.textContent = 'Скопировано ✓';
          setTimeout(() => {
            if (copyBtn.isConnected) copyBtn.textContent = `${shortConv} 📋`;
          }, 1200);
        }
      };
    }

    const subBtns = popover.querySelectorAll ? popover.querySelectorAll('.agy-pop-sub-row') : [];
    for (const btn of subBtns) {
      btn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const val = btn.dataset ? (btn.dataset.subId || btn.dataset.filePath || '') : '';
        if (val && copyTextToClipboard(val)) {
          const firstSpan = btn.querySelector && btn.querySelector('span');
          const orig = firstSpan ? firstSpan.textContent : '';
          if (firstSpan) firstSpan.textContent = 'Скопировано ✓';
          setTimeout(() => {
            if (firstSpan && firstSpan.isConnected) firstSpan.textContent = orig;
          }, 1100);
        }
      };
    }
  }

  function toggleTokenPopover(bar, stats, modelName) {
    if (!bar) return;
    ensureMilkThemeStyles();
    installWallpaperMenuDismissListeners();
    let popover = document.getElementById('antigravity-token-popover');
    if (popover && popover.style && popover.style.display !== 'none') {
      closeTokenPopover();
      return;
    }
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'antigravity-token-popover';
      popover.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
    }
    if (popover.parentElement !== bar) {
      bar.appendChild(popover);
    }
    if (popover.dataset) popover.dataset.renderKey = '';
    renderTokenPopover(popover, stats, modelName);
    popover.style.display = 'block';
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
  let isCheckingWallpaper = false;
  let wallpaperTransitionRestoreTimer = 0;
  let backdropScanSignature = '';
  let backdropScanSkips = 0;

  let wallpaperTransparentNodes = [];
  let wallpaperClearedGradients = [];
  let milkBackdropNodes = [];
  let milkSidebarEl = null;
  let milkHeaderEl = null;
  let milkActiveSidebarItem = null;
  let wallpaperPaletteCache = new Map();

  const FX_PREFS_STORAGE_KEY = 'agy_milk_fx_prefs_v1';
  const DEFAULT_FX_PREFS = {
    autoRotate: false,
    particles: true,
    crt: true,
    parallax: true,
    spotlight: true,
    vhsSwitch: true,
    scrimOpacity: 100,
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
  }

  function applyScrimStyle(inChat) {
    const scrim = document.getElementById('antigravity-wp-scrim');
    if (!scrim) return;
    const rawPct = typeof fxPrefs.scrimOpacity === 'number' && !Number.isNaN(fxPrefs.scrimOpacity)
      ? fxPrefs.scrimOpacity
      : 100;
    const mult = Math.max(0, Math.min(1.5, rawPct / 100));
    const a = (base) => (base * mult).toFixed(3);
    scrim.style.background = inChat
      ? `radial-gradient(circle at center, rgba(10,10,14,${a(0.22)}) 0%, rgba(10,10,14,${a(0.54)}) 100%)`
      : `radial-gradient(circle at center, rgba(10,10,14,${a(0.12)}) 0%, rgba(10,10,14,${a(0.48)}) 100%), linear-gradient(to top, rgba(10,10,14,${a(0.82)}) 0%, rgba(10,10,14,${a(0.10)}) 38%, rgba(10,10,14,${a(0.18)}) 100%)`;
    scrim.style.backdropFilter = 'none';
  }

  let fxPrefs = loadFxPrefs();
  let wpMenuCloseTimer = 0;
  let wpMenuOpenTimer = 0;
  let wpMenuPinned = false;

  // Fixed crimson/red Milk palette used uniformly across all wallpapers
  const RED_PALETTE = {
    accent: '198, 52, 60',
    bright: '255, 68, 82',
    secondary: '248, 224, 192',
    spotlight: '245, 165, 145',
    dust: '224, 64, 76'
  };
  const PALETTE_PRESETS = [RED_PALETTE];
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

  function extractPaletteFromImage() {
    applyDynamicPalette();
    return currentDynamicPalette;
  }

  function ensureMilkThemeStyles() {
    if (!document.documentElement || !document.documentElement.style || !document.documentElement.style.getPropertyValue || !document.documentElement.style.getPropertyValue('--agy-accent-rgb')) {
      applyDynamicPalette(currentDynamicPalette);
    }
    let style = document.getElementById('antigravity-milk-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'antigravity-milk-style';
      (document.head || document.documentElement || document.body).appendChild(style);
    }
    const nextCss = `
      @keyframes agy-milk-input-pulse {
        0%, 100% {
          border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.52);
          box-shadow: 0 0 12px rgba(var(--agy-accent-rgb, 198, 52, 60), 0.24);
        }
        50% {
          border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.92);
          box-shadow: 0 0 24px rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.42);
        }
      }
      ::selection {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.38) !important;
        color: #fbf2ea !important;
      }
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(var(--agy-accent-rgb, 198, 52, 60), 0.30);
        border-radius: 9999px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.62);
      }
      .agy-milk-dialog-box {
        background-color: rgba(10, 11, 18, 0.89) !important;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.42) !important;
        border-radius: 12px !important;
        padding: 14px 20px !important;
        box-sizing: border-box !important;
        min-width: 0 !important;
        overflow-x: clip !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55) !important;
        transition: border-color 0.45s ease, box-shadow 0.45s ease;
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
        background-color: rgba(7, 8, 14, 0.74) !important;
        border: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.26) !important;
        border-radius: 8px !important;
      }
      .agy-milk-dialog-box :not(pre) > code {
        background-color: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.16) !important;
        border-radius: 4px !important;
      }
      .agy-milk-input-box {
        background-color: rgba(10, 11, 18, 0.92) !important;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-color: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.48) !important;
        transition: border-color 0.35s ease, box-shadow 0.35s ease;
      }
      .agy-milk-input-box.agy-milk-thinking {
        animation: agy-milk-input-pulse 1.8s ease-in-out infinite !important;
      }
      .agy-milk-input-box.agy-milk-done {
        border-color: rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.85) !important;
        box-shadow: 0 0 22px rgba(var(--agy-secondary-rgb, 248, 224, 192), 0.28) !important;
      }
      [role="menu"],
      [role="listbox"],
      [data-radix-popper-content-wrapper] > [role="dialog"],
      .monaco-menu-container {
        background-color: rgba(11, 12, 19, 0.94) !important;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.36) !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65) !important;
      }
      .agy-milk-sidebar {
        border-right: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.24) !important;
        background-image: linear-gradient(180deg, rgba(var(--agy-accent-rgb, 173, 50, 51), 0.06) 0%, transparent 45%) !important;
        transition: border-color 0.45s ease;
      }
      .agy-milk-sidebar a,
      .agy-milk-sidebar button {
        transition: background-color 0.18s ease, border-color 0.25s ease;
      }
      .agy-milk-sidebar a:hover,
      .agy-milk-sidebar button:hover {
        background-color: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.11) !important;
      }
      .agy-milk-sidebar-active {
        border-left: 2px solid rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.90) !important;
        background-color: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.16) !important;
        box-shadow: inset 8px 0 16px -10px rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.55) !important;
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
        border-bottom: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.22) !important;
        background-image: linear-gradient(90deg, rgba(var(--agy-accent-rgb, 173, 50, 51), 0.06) 0%, transparent 65%) !important;
        transition: border-color 0.45s ease;
      }
      #antigravity-wallpaper-ctrl {
        border-color: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.45) !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
      }
      #antigravity-wallpaper-ctrl:hover,
      #antigravity-token-pill:hover,
      #antigravity-swarm-btn:hover {
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.78) !important;
      }
      #antigravity-token-popover {
        position: absolute;
        bottom: 34px;
        right: 8px;
        z-index: 10001;
        width: 304px;
        padding: 11px 12px;
        border-radius: 12px;
        background: rgba(11, 12, 19, 0.95);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.46);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.72);
        color: #f3f4f6;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11.5px;
        user-select: none;
        box-sizing: border-box;
      }
      .agy-pop-stat-card {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 5px 7px;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.07);
      }
      .agy-pop-stat-lbl {
        font-size: 10px;
        color: rgba(243, 244, 246, 0.58);
      }
      .agy-pop-stat-val {
        font-size: 11.5px;
        font-weight: 600;
        color: #f8f0e8;
      }
      .agy-pop-sub-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        width: 100%;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .agy-pop-sub-row:hover {
        background: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.18);
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.55);
      }
      .agy-pop-sub-row.is-warn {
        border-color: rgba(245, 158, 11, 0.45);
        background: rgba(245, 158, 11, 0.08);
      }
      .agy-pop-tool-chip {
        padding: 2px 6px;
        border-radius: 5px;
        font-size: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.10);
        color: rgba(243, 244, 246, 0.84);
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
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.16);
        outline: none;
        cursor: pointer;
      }
      .agy-wp-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: rgb(var(--agy-accent-bright-rgb, 255, 68, 82));
        border: 1.5px solid #f8f0e8;
        cursor: pointer;
      }
      #antigravity-wallpaper-menu {
        position: absolute;
        bottom: 42px;
        right: 16px;
        z-index: 10000;
        min-width: 244px;
        max-width: 282px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(11, 12, 19, 0.94);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(var(--agy-accent-rgb, 173, 50, 51), 0.44);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.70);
        color: #f3f4f6;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11.5px;
        user-select: none;
        box-sizing: border-box;
      }
      .agy-wp-menu-chip {
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(243, 244, 246, 0.82);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .agy-wp-menu-chip:hover {
        background: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.22);
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.65);
        color: #ffffff;
      }
      .agy-wp-menu-chip.is-active {
        background: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.36);
        border-color: rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.92);
        color: #ffffff;
      }
      .agy-wp-menu-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 4px 6px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: rgba(243, 244, 246, 0.88);
        font-size: 11.5px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease;
      }
      .agy-wp-menu-toggle:hover {
        background: rgba(255, 255, 255, 0.06);
      }
      .agy-wp-menu-pill {
        padding: 1px 6px;
        border-radius: 9999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }
      .agy-wp-menu-pill.is-on {
        background: rgba(var(--agy-accent-rgb, 173, 50, 51), 0.34);
        border: 1px solid rgba(var(--agy-accent-bright-rgb, 255, 68, 82), 0.72);
        color: rgb(var(--agy-secondary-rgb, 248, 224, 192));
      }
      .agy-wp-menu-pill.is-off {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: rgba(156, 163, 175, 0.85);
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
    `;
    if (style.textContent !== nextCss) {
      style.textContent = nextCss;
    }
  }

  function clearChatMessageBackdrops() {
    for (const node of milkBackdropNodes) {
      try {
        if (node && node.classList) node.classList.remove('agy-milk-dialog-box');
      } catch (_) {}
    }
    milkBackdropNodes = [];
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
          milkSidebarEl.addEventListener('mouseover', (e) => {
            if (!e || !e.target) return;
            clearActionStripInRow(e.target);
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => clearActionStripInRow(e.target));
            }
          }, { passive: true });
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

      // 2. Detect & theme top header bar
      let nextHeader = typeof document.querySelector === 'function'
        ? document.querySelector('header, [role="banner"]')
        : null;
      if (!nextHeader && stage) {
        const searchRoots = [stage.parentElement, stage.parentElement && stage.parentElement.parentElement, stage];
        for (const root of searchRoots) {
          if (!root || !root.children) continue;
          for (const ch of Array.from(root.children)) {
            if (!ch || ch === stage || ch === milkSidebarEl || ch === box) continue;
            if (ch.id === 'antigravity-wallpaper-layer' || ch.id === 'antigravity-wallpaper-ctrl' || ch.id === 'antigravity-wallpaper-menu') continue;
            if (ch.contains && (ch.contains(stage) || (box && ch.contains(box)))) continue;
            const r = typeof ch.getBoundingClientRect === 'function' ? ch.getBoundingClientRect() : null;
            if (r && r.top <= 48 && r.height >= 24 && r.height <= 56 && r.width >= 360) {
              nextHeader = ch;
              break;
            }
          }
          if (nextHeader) break;
        }
      }
      if (milkHeaderEl && milkHeaderEl !== nextHeader && milkHeaderEl.classList) {
        milkHeaderEl.classList.remove('agy-milk-header');
      }
      if (nextHeader && nextHeader.classList) {
        nextHeader.classList.add('agy-milk-header');
        milkHeaderEl = nextHeader;
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
      if (node.id === 'antigravity-wallpaper-layer' || node.id === 'antigravity-wallpaper-ctrl' || node.id === 'antigravity-wallpaper-menu' || node.id === 'antigravity-wp-fx-canvas') continue;
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

  function ensureChatMessageBackdrop(stage, box, inChat) {
    ensureMilkThemeStyles();
    if (box && box.classList) {
      box.classList.add('agy-milk-input-box');
    }
    if (!inChat) {
      clearChatMessageBackdrops();
      return;
    }
    const targets = findChatMessageTargets(stage, box);
    const nextSet = new Set(targets);
    for (const prev of milkBackdropNodes) {
      if (!nextSet.has(prev) && prev && prev.classList) {
        try { prev.classList.remove('agy-milk-dialog-box'); } catch (_) {}
      }
    }
    for (const el of targets) {
      if (el && el.classList && !el.classList.contains('agy-milk-dialog-box')) {
        el.classList.add('agy-milk-dialog-box');
      }
      constrainTablesInDialogBox(el);
    }
    milkBackdropNodes = targets;
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
        if (ch && ch.id !== 'antigravity-wallpaper-layer' && ch.id !== 'antigravity-wallpaper-ctrl' && ch.id !== 'antigravity-wallpaper-menu' && ch.id !== 'antigravity-wp-fx-canvas' && ch !== box && (!box.contains || !box.contains(ch))) {
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
      if (el.classList && (el.classList.contains('agy-milk-dialog-box') || el.classList.contains('agy-milk-input-box'))) continue;
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
      if (node.id === 'antigravity-wallpaper-layer' || node.id === 'antigravity-wallpaper-ctrl' || node.id === 'antigravity-wallpaper-menu' || node.id === 'antigravity-wp-fx-canvas') return;
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
      if (!child || child === milkSidebarEl || child === milkHeaderEl) continue;
      if (child.id === 'antigravity-wallpaper-layer' || child.id === 'antigravity-wallpaper-ctrl' || child.id === 'antigravity-wallpaper-menu' || child.id === 'antigravity-wp-fx-canvas') continue;
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
        vid.play && vid.play().catch && vid.play().catch(() => {});
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
    if (isAppInactive() || getConversationIdFromLocation()) return;
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
    if (isAppInactive()) {
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
    if (enableHomeCrt && fxPrefs.crt) {
      if (crt) crt.style.display = 'block';
      if (!fxGlitchWaitTimer && !fxGlitchEndTimer) {
        scheduleNextHomeGlitch();
      }
    } else {
      stopHomeGlitchOnly();
    }
    if (spotlight) {
      spotlight.style.display = fxPrefs.spotlight ? 'block' : 'none';
      if (!fxPrefs.spotlight) spotlight.style.opacity = '0';
    }
    const vhsActive = fxChannelSwitchUntil > Date.now();
    const showCanvas = Boolean(fxPrefs.particles || vhsActive || (enableHomeCrt && fxPrefs.crt));
    if (canvas) {
      canvas.style.display = showCanvas ? 'block' : 'none';
    }
    const needsRaf = Boolean(fxPrefs.particles || fxPrefs.parallax || fxPrefs.spotlight || vhsActive);
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

  async function ensureHomeWallpaper() {
    if (isCheckingWallpaper) return;
    isCheckingWallpaper = true;
    try {
      ensureMilkThemeStyles();
      const convId = getConversationIdFromLocation();
      const inChat = Boolean(convId);
      let layer = document.getElementById('antigravity-wallpaper-layer');
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
        clearChatMessageBackdrops();
        restoreStageBackdrops();
        return;
      }

      ensureSidebarAndHeaderTheme(stage, box, convId);

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

      if (!ctrl || ctrl.parentElement !== stage) {
        if (!ctrl) {
          ctrl = document.createElement('button');
          ctrl.id = 'antigravity-wallpaper-ctrl';
          ctrl.type = 'button';
          ctrl.style.cssText = [
            'position: absolute',
            'top: auto',
            'bottom: 12px',
            'right: 16px',
            'z-index: 9999',
            'padding: 3px 9px',
            'border-radius: 9999px',
            'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'font-size: 11px',
            'font-weight: 600',
            'color: rgba(243, 244, 246, 0.85)',
            'background: rgba(15, 15, 20, 0.55)',
            'border: 1px solid rgba(255, 255, 255, 0.14)',
            'backdrop-filter: blur(8px)',
            'cursor: pointer',
            'opacity: 0.65',
            'transition: opacity 0.15s ease, background 0.15s ease, bottom 0.2s ease, border-color 0.25s ease'
          ].join(';');
          ctrl.onmouseenter = () => {
            ctrl.style.opacity = '1';
            if (wpMenuCloseTimer) {
              clearTimeout(wpMenuCloseTimer);
              wpMenuCloseTimer = 0;
            }
            if (wpMenuOpenTimer) clearTimeout(wpMenuOpenTimer);
            wpMenuOpenTimer = setTimeout(() => {
              wpMenuOpenTimer = 0;
              openWallpaperMenu(ctrl.parentElement, false);
            }, 140);
          };
          ctrl.onmouseleave = () => {
            ctrl.style.opacity = '0.65';
            if (wpMenuOpenTimer) {
              clearTimeout(wpMenuOpenTimer);
              wpMenuOpenTimer = 0;
            }
            scheduleCloseWallpaperMenu();
          };
          ctrl.oncontextmenu = (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (e && e.stopPropagation) e.stopPropagation();
            if (wpMenuOpenTimer) {
              clearTimeout(wpMenuOpenTimer);
              wpMenuOpenTimer = 0;
            }
            if (wpMenuCloseTimer) {
              clearTimeout(wpMenuCloseTimer);
              wpMenuCloseTimer = 0;
            }
            openWallpaperMenu(ctrl.parentElement, true);
          };
          ctrl.onclick = async (e) => {
            e.stopPropagation();
            const curInChat = Boolean(getConversationIdFromLocation());
            if (curInChat && fxPrefs.chatWpFile) {
              fxPrefs.chatWpFile = '';
              saveFxPrefs();
            } else if (!curInChat && fxPrefs.homeWpFile) {
              fxPrefs.homeWpFile = '';
              saveFxPrefs();
            }
            await refreshWallpaperList(true);
            if (wallpaperFiles.length > 0) {
              await showWallpaperAt(wallpaperIndex + 1);
            }
          };
        }
        stage.appendChild(ctrl);
      }

      let wpMenu = document.getElementById('antigravity-wallpaper-menu');
      if (wpMenu && wpMenu.parentElement !== stage) {
        stage.appendChild(wpMenu);
      }

      ctrl.style.top = 'auto';
      ctrl.style.bottom = '12px';

      // Heavy style scan (getComputedStyle over many nodes): only when the DOM/size/chat actually changed,
      // plus a forced refresh every ~5th tick as a safety net.
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
      if (needsRemount || scanSig !== backdropScanSignature || backdropScanSkips >= 4) {
        backdropScanSignature = scanSig;
        backdropScanSkips = 0;
        clearLargeOpaqueBackdrops(stage, box);
      } else {
        backdropScanSkips++;
      }
      ensureChatMessageBackdrop(stage, box, inChat);
      ensureStageChildrenAbove(stage);
      layer.style.display = 'block';
      if (layer.classList) {
        if (isWindowBlurred) layer.classList.add('agy-wp-sleeping');
        else layer.classList.remove('agy-wp-sleeping');
      }
      ctrl.style.display = files.length > 0 ? 'block' : 'none';
      syncHomeAtmosphereFx(!isAppInactive(), !inChat && !isAppInactive(), layer);

      const vids = layer.querySelectorAll ? layer.querySelectorAll('video') : [];
      for (const v of vids) {
        if (v.parentElement && v.parentElement.style && v.parentElement.style.opacity === '1' && v.paused && v.play) {
          v.play().catch(() => {});
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

  function updateWallpaperCtrlLabel(fileName) {
    const ctrl = document.getElementById('antigravity-wallpaper-ctrl');
    if (ctrl && wallpaperFiles.length > 0) {
      const inChat = Boolean(getConversationIdFromLocation());
      const curFile = fileName || wallpaperFiles[wallpaperIndex] || '';
      const isPinnedHere = Boolean(curFile && ((inChat && fxPrefs.chatWpFile === curFile) || (!inChat && fxPrefs.homeWpFile === curFile)));
      const pauseTag = isPinnedHere ? ' 📌' : (fxPrefs.autoRotate ? '' : ' ⏸');
      ctrl.textContent = `${wallpaperIndex + 1}/${wallpaperFiles.length}${pauseTag}`;
      ctrl.title = `Обои: ${curFile}${isPinnedHere ? ' [Закреплено]' : ''} (ЛКМ: сменить · Наведение/ПКМ: настройки)`;
    }
    const menu = document.getElementById('antigravity-wallpaper-menu');
    if (menu && menu.style && menu.style.display !== 'none') {
      renderWallpaperMenu(menu);
    }
  }

  function closeWallpaperMenu() {
    wpMenuPinned = false;
    if (wpMenuCloseTimer) {
      clearTimeout(wpMenuCloseTimer);
      wpMenuCloseTimer = 0;
    }
    const menu = document.getElementById('antigravity-wallpaper-menu');
    if (menu && menu.style) {
      menu.style.display = 'none';
    }
  }

  function scheduleCloseWallpaperMenu() {
    if (wpMenuPinned) return;
    if (wpMenuCloseTimer) clearTimeout(wpMenuCloseTimer);
    wpMenuCloseTimer = setTimeout(() => {
      wpMenuCloseTimer = 0;
      if (!wpMenuPinned) closeWallpaperMenu();
    }, 260);
  }

  function installWallpaperMenuDismissListeners() {
    if (!window.__antigravity_menu_outside_click) {
      window.__antigravity_menu_outside_click = (e) => {
        const t = e && e.target;
        const menu = document.getElementById('antigravity-wallpaper-menu');
        if (menu && menu.style && menu.style.display !== 'none') {
          const ctrl = document.getElementById('antigravity-wallpaper-ctrl');
          if (!t || ((!menu.contains || !menu.contains(t)) && (!ctrl || !ctrl.contains || !ctrl.contains(t)))) {
            closeWallpaperMenu();
          }
        }
        const pop = document.getElementById('antigravity-token-popover');
        if (pop && pop.style && pop.style.display !== 'none') {
          const pill = document.getElementById('antigravity-token-pill');
          if (!t || ((!pop.contains || !pop.contains(t)) && (!pill || !pill.contains || !pill.contains(t)))) {
            closeTokenPopover();
          }
        }
      };
      document.addEventListener('mousedown', window.__antigravity_menu_outside_click, true);
    }
    if (!window.__antigravity_menu_keydown) {
      window.__antigravity_menu_keydown = (e) => {
        if (e && e.key === 'Escape') {
          closeWallpaperMenu();
          closeTokenPopover();
          closeSwarmModal();
        }
      };
      document.addEventListener('keydown', window.__antigravity_menu_keydown, true);
    }
  }

  function renderWallpaperMenu(menu) {
    if (!menu) return;
    menu.innerHTML = '';

    const currentFile = wallpaperFiles[wallpaperIndex] || '';
    const inChat = Boolean(getConversationIdFromLocation());

    // Header row: Обои count + Refresh + Auto-rotate toggle
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;';
    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;color:#f8f0e8;font-size:11.5px;flex:1;';
    title.textContent = `Сцена (${wallpaperFiles.length > 0 ? wallpaperIndex + 1 : 0}/${wallpaperFiles.length})`;
    hdr.appendChild(title);

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'agy-wp-menu-chip';
    refreshBtn.style.padding = '1px 6px';
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Обновить список обоев из папки';
    refreshBtn.onclick = async (e) => {
      e.stopPropagation();
      await refreshWallpaperList(true);
      updateWallpaperCtrlLabel();
      renderWallpaperMenu(menu);
    };
    hdr.appendChild(refreshBtn);

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = `agy-wp-menu-pill ${fxPrefs.autoRotate ? 'is-on' : 'is-off'}`;
    autoBtn.style.cursor = 'pointer';
    autoBtn.textContent = fxPrefs.autoRotate ? 'Авто: ВКЛ' : 'Авто: ПАУЗА';
    autoBtn.onclick = (e) => {
      e.stopPropagation();
      fxPrefs.autoRotate = !fxPrefs.autoRotate;
      if (fxPrefs.autoRotate) wallpaperLastSwitchMs = Date.now();
      saveFxPrefs();
      updateWallpaperCtrlLabel();
    };
    hdr.appendChild(autoBtn);
    menu.appendChild(hdr);

    // Wallpaper selector chips + Pin for Home / Chat
    if (wallpaperFiles.length > 0) {
      const chipsWrap = document.createElement('div');
      chipsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);';
      for (let i = 0; i < wallpaperFiles.length; i++) {
        const fname = wallpaperFiles[i];
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `agy-wp-menu-chip${i === wallpaperIndex ? ' is-active' : ''}`;
        const isHomePin = fxPrefs.homeWpFile === fname;
        const isChatPin = fxPrefs.chatWpFile === fname;
        const pinBadge = (isHomePin || isChatPin)
          ? ` ${isHomePin ? 'H' : ''}${isChatPin ? 'C' : ''}`
          : '';
        chip.textContent = `${i + 1}${pinBadge}`;
        chip.title = fname + (isHomePin ? ' [Закреплено: Home]' : '') + (isChatPin ? ' [Закреплено: Чат]' : '');
        chip.onclick = async (e) => {
          e.stopPropagation();
          if (inChat && fxPrefs.chatWpFile && fxPrefs.chatWpFile !== fname) {
            fxPrefs.chatWpFile = '';
            saveFxPrefs();
          } else if (!inChat && fxPrefs.homeWpFile && fxPrefs.homeWpFile !== fname) {
            fxPrefs.homeWpFile = '';
            saveFxPrefs();
          }
          await showWallpaperAt(i);
          renderWallpaperMenu(menu);
        };
        chipsWrap.appendChild(chip);
      }
      menu.appendChild(chipsWrap);

      // Pin controls for current wallpaper
      const pinRow = document.createElement('div');
      pinRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);';
      const pinLbl = document.createElement('span');
      pinLbl.style.cssText = 'font-size:10.5px;color:rgba(243,244,246,0.72);';
      pinLbl.textContent = 'Закрепить текущие:';
      pinRow.appendChild(pinLbl);

      const pinBtns = document.createElement('div');
      pinBtns.style.cssText = 'display:flex;gap:4px;';

      const homePinActive = Boolean(currentFile && fxPrefs.homeWpFile === currentFile);
      const pinHomeBtn = document.createElement('button');
      pinHomeBtn.type = 'button';
      pinHomeBtn.className = `agy-wp-menu-chip${homePinActive ? ' is-active' : ''}`;
      pinHomeBtn.textContent = 'Home';
      pinHomeBtn.title = fxPrefs.homeWpFile
        ? `На главном экране: ${fxPrefs.homeWpFile} (нажмите, чтобы переключить/снять)`
        : 'Закрепить текущие обои для главного экрана';
      pinHomeBtn.onclick = (e) => {
        e.stopPropagation();
        fxPrefs.homeWpFile = homePinActive ? '' : currentFile;
        saveFxPrefs();
        updateWallpaperCtrlLabel(currentFile);
      };

      const chatPinActive = Boolean(currentFile && fxPrefs.chatWpFile === currentFile);
      const pinChatBtn = document.createElement('button');
      pinChatBtn.type = 'button';
      pinChatBtn.className = `agy-wp-menu-chip${chatPinActive ? ' is-active' : ''}`;
      pinChatBtn.textContent = 'Чат';
      pinChatBtn.title = fxPrefs.chatWpFile
        ? `В чатах: ${fxPrefs.chatWpFile} (нажмите, чтобы переключить/снять)`
        : 'Закрепить текущие обои для экранов чата';
      pinChatBtn.onclick = (e) => {
        e.stopPropagation();
        fxPrefs.chatWpFile = chatPinActive ? '' : currentFile;
        saveFxPrefs();
        updateWallpaperCtrlLabel(currentFile);
      };

      pinBtns.appendChild(pinHomeBtn);
      pinBtns.appendChild(pinChatBtn);
      pinRow.appendChild(pinBtns);
      menu.appendChild(pinRow);
    }

    // Scrim opacity slider
    const scrimVal = typeof fxPrefs.scrimOpacity === 'number' && !Number.isNaN(fxPrefs.scrimOpacity)
      ? Math.max(0, Math.min(150, Math.round(fxPrefs.scrimOpacity)))
      : 100;
    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);';
    const sliderHdr = document.createElement('div');
    sliderHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:11px;color:rgba(243,244,246,0.84);';
    const sliderLbl = document.createElement('span');
    sliderLbl.textContent = 'Затемнение фона';
    const sliderNum = document.createElement('span');
    sliderNum.style.cssText = 'font-weight:600;color:#f8f0e8;';
    sliderNum.textContent = `${scrimVal}%`;
    sliderHdr.appendChild(sliderLbl);
    sliderHdr.appendChild(sliderNum);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '150';
    slider.step = '5';
    slider.value = String(scrimVal);
    slider.className = 'agy-wp-slider';
    slider.oninput = (e) => {
      e.stopPropagation();
      const v = Number(slider.value);
      fxPrefs.scrimOpacity = v;
      sliderNum.textContent = `${v}%`;
      applyScrimStyle(inChat);
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
      const lbl = document.createElement('span');
      lbl.textContent = item.label;
      const pill = document.createElement('span');
      const isOn = Boolean(fxPrefs[item.key]);
      pill.className = `agy-wp-menu-pill ${isOn ? 'is-on' : 'is-off'}`;
      pill.textContent = isOn ? 'ON' : 'OFF';
      row.appendChild(lbl);
      row.appendChild(pill);
      row.onclick = (e) => {
        e.stopPropagation();
        fxPrefs[item.key] = !fxPrefs[item.key];
        saveFxPrefs();
        renderWallpaperMenu(menu);
        const layer = document.getElementById('antigravity-wallpaper-layer');
        syncHomeAtmosphereFx(!isAppInactive(), !inChat && !isAppInactive(), layer);
      };
      menu.appendChild(row);
    }

    // Open wallpapers folder button
    if (window.antigravityTokenBridge && typeof window.antigravityTokenBridge.openWallpapersDir === 'function') {
      const footer = document.createElement('div');
      footer.style.cssText = 'margin-top:7px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.08);display:flex;';
      const openDirBtn = document.createElement('button');
      openDirBtn.type = 'button';
      openDirBtn.className = 'agy-wp-menu-chip';
      openDirBtn.style.cssText = 'width:100%;padding:4px 8px;display:flex;align-items:center;justify-content:center;gap:5px;';
      openDirBtn.textContent = '📂 Открыть папку обоев';
      openDirBtn.onclick = (e) => {
        e.stopPropagation();
        window.antigravityTokenBridge.openWallpapersDir().catch(() => {});
      };
      footer.appendChild(openDirBtn);
      menu.appendChild(footer);
    }
  }

  function openWallpaperMenu(stage, pinned) {
    if (!stage) return;
    installWallpaperMenuDismissListeners();
    if (pinned) wpMenuPinned = true;
    if (wpMenuCloseTimer) {
      clearTimeout(wpMenuCloseTimer);
      wpMenuCloseTimer = 0;
    }
    let menu = document.getElementById('antigravity-wallpaper-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'antigravity-wallpaper-menu';
      menu.onmouseenter = () => {
        if (wpMenuCloseTimer) {
          clearTimeout(wpMenuCloseTimer);
          wpMenuCloseTimer = 0;
        }
      };
      menu.onmouseleave = () => {
        scheduleCloseWallpaperMenu();
      };
      menu.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };
    }
    if (menu.parentElement !== stage) {
      stage.appendChild(menu);
    }
    renderWallpaperMenu(menu);
    menu.style.display = 'block';
  }

  // Instant navigation listeners for SPA URL changes & New Conversation clicks
  function handlePossibleNavigation() {
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
    window.__antigravity_stats_interval = setInterval(ensureTokenBar, 1000);
    window.__antigravity_wallpaper_timer = setInterval(ensureHomeWallpaper, 3000);
    ensureTokenBar();
    ensureHomeWallpaper();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
