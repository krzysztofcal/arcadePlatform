(function (window, document) {
  function ready(fn) {
    if (!document || typeof document.addEventListener !== 'function') return;
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      try { fn(); } catch (_) {}
      return;
    }
    document.addEventListener('DOMContentLoaded', function handler() {
      document.removeEventListener('DOMContentLoaded', handler);
      try { fn(); } catch (_) {}
    });
  }

  function getParam(name) {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get(name);
    } catch (_) {
      return null;
    }
  }

  function makePopupRenderer(logs, strings) {
    return function openXpLogWindow() {
      let popup = null;
      try {
        popup = window.open('about:blank', '_blank');
      } catch (_) {
        popup = null;
      }
      if (!popup || popup.closed) {
        return false;
      }
      try {
        const doc = popup.document;
        const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + strings.popupTitle + '</title><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<style>body{font-family:monospace;background:#050910;color:#e6ecff;margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;}header{font-size:14px;margin-bottom:12px;opacity:0.8;}pre{margin:0;background:#0b1020;padding:12px;border:1px solid rgba(230,236,255,0.2);display:flex;flex-direction:column;gap:2px;}button{cursor:pointer;font-family:inherit;font-size:13px;border:1px solid rgba(230,236,255,0.3);background:#142040;color:#fff;padding:6px 10px;border-radius:4px;margin-bottom:12px;}button:focus{outline:2px solid rgba(255,255,255,0.4);outline-offset:1px;}.log-line{display:block;white-space:pre-wrap;word-break:break-word;line-height:1.35;}.log-line:empty::after{content:"\\00a0";}.line--error{color:#ff4d4f;font-weight:600;}.line--warn{color:#ffa940;}</style></head><body><header>'
          + strings.popupGenerated + ' ' + new Date().toISOString() + '</header><button id="copyXpLogsBtn" type="button">' + strings.copyButton + '</button><pre id="xpDiagnosticsLog">' + strings.loading + '</pre>'
          + '<script>(function(){function render(lines){var box=document.getElementById("xpDiagnosticsLog");if(!box)return;box.textContent="";var frag=document.createDocumentFragment();for(var i=0;i<lines.length;i+=1){var line=document.createElement("div");line.className="log-line";line.textContent=lines[i];frag.appendChild(line);}box.appendChild(frag);}function getText(){var el=document.getElementById("xpDiagnosticsLog");if(!el)return"";return el.innerText||el.textContent||"";}function fallbackCopy(text){return new Promise(function(resolve,reject){try{var textarea=document.createElement("textarea");textarea.value=text;textarea.setAttribute("readonly","readonly");textarea.style.position="absolute";textarea.style.left="-9999px";document.body.appendChild(textarea);textarea.select();var ok=false;try{ok=document.execCommand("copy");}catch(err){ok=false;}textarea.remove();if(ok){resolve();return;}reject(new Error("execCommand_failed"));}catch(error){reject(error);}});}function copyLogs(){var text=getText();if(!text){return Promise.reject(new Error("empty_log"));}if(navigator&&navigator.clipboard&&typeof navigator.clipboard.writeText==="function"){return navigator.clipboard.writeText(text);}return fallbackCopy(text);}var btn=document.getElementById("copyXpLogsBtn");if(btn){var baseLabel=btn.textContent||"Copy";var timer=null;function reset(){if(timer){clearTimeout(timer);}timer=setTimeout(function(){btn.textContent=baseLabel;},1600);}btn.addEventListener("click",function(){copyLogs().then(function(){btn.textContent="' + strings.copied + '";reset();}).catch(function(){btn.textContent="' + strings.copyFailed + '";reset();});});}window.addEventListener("message",function(evt){if(!evt||!evt.data||evt.data.type!=="xpLogs")return;render(evt.data.lines||[]);});})();<' + '/script></body></html>';
        doc.open();
        doc.write(html);
        doc.close();

        const lines = [];
        logs.forEach(function (entry, index) {
          const parts = [];
          parts.push('[' + (index + 1) + '] ' + entry.timestamp);
          parts.push('    ' + entry.message);
          if (entry.data && typeof entry.data === 'object') {
            parts.push('    Data: ' + JSON.stringify(entry.data, null, 2).split('\n').join('\n    '));
          } else if (entry.data) {
            parts.push('    Data: ' + entry.data);
          }
          parts.push('');
          lines.push.apply(lines, parts);
        });

        popup.postMessage({ type: 'xpLogs', lines: lines }, '*');
        return true;
      } catch (_) {
        try { popup.close(); } catch (_) {}
        return false;
      }
    };
  }

  function renderInlineLogs(logs, xpDiagOutput, strings) {
    if (!xpDiagOutput) return;
    let output = strings.inlineHeader.replace('%COUNT%', logs.length) + '\n';
    output += '='.repeat(60) + '\n\n';

    logs.forEach(function (entry, index) {
      output += '[' + (index + 1) + '] ' + entry.timestamp + '\n';
      output += '    ' + entry.message + '\n';
      if (entry.data && typeof entry.data === 'object') {
        output += '    Data: ' + JSON.stringify(entry.data, null, 2).split('\n').join('\n    ') + '\n';
      } else if (entry.data) {
        output += '    Data: ' + entry.data + '\n';
      }
      output += '\n';
    });

    xpDiagOutput.textContent = output;
    xpDiagOutput.style.display = 'block';
    xpDiagOutput.scrollTop = xpDiagOutput.scrollHeight;
  }

  function init(options) {
    const config = options || {};
    const selectors = config.selectors || {};
    const tapWindow = typeof config.tapWindowMs === 'number' ? config.tapWindowMs : 3000;
    const tapCount = typeof config.tapCount === 'number' ? config.tapCount : 5;
    const strings = config.messages || {};
    const landingBackHref = config.landingBackHref || '';

    const texts = {
      openedDiagnostics: strings.openedDiagnostics || 'Opened diagnostics in a new tab',
      downloadedFile: strings.downloadedFile || 'Downloaded file',
      diagnosticsUnavailable: strings.diagnosticsUnavailable || 'Diagnostics unavailable',
      unlocked: strings.unlocked || 'Debug unlocked for 24h',
      xpUnavailable: strings.xpUnavailable || 'XP diagnostics unavailable',
      xpEmpty: strings.xpEmpty || 'No diagnostic logs available',
      xpDisplayedWithCount: strings.xpDisplayedWithCount || 'XP diagnostics displayed (%COUNT% entries)',
      xpOpened: strings.xpOpened || 'Opened XP diagnostics in a new tab',
      xpError: strings.xpError || 'Error dumping XP diagnostics',
      popupTitle: strings.popupTitle || 'XP Diagnostics',
      popupGenerated: strings.popupGenerated || 'XP diagnostics generated',
      copyButton: strings.copyButton || 'Copy all logs',
      copied: strings.copied || 'Copied!',
      copyFailed: strings.copyFailed || 'Copy failed',
      loading: strings.loading || 'Loading…',
      inlineHeader: strings.inlineHeader || 'XP DIAGNOSTIC LOGS (%COUNT% entries)',
    };

    ready(function onReady() {
      try {
        if (landingBackHref && getParam('origin') === 'landing') {
          const backLink = document.getElementById(selectors.backLinkId || 'backLink');
          if (backLink) {
            backLink.href = landingBackHref;
          }
        }
      } catch (_) {}

      const dumpButton = document.getElementById(selectors.dumpButtonId || 'debugDumpButton');
      const xpDumpButton = document.getElementById(selectors.xpDumpButtonId || 'xpDumpButton');
      const xpDiagOutput = document.getElementById(selectors.xpDiagOutputId || 'xpDiagOutput');
      const toast = document.getElementById(selectors.toastId || 'debugToast');
      const title = document.querySelector(selectors.titleSelector || 'main h1');
      let toastTimer = null;
      let visibilityRefreshTimer = null;
      let taps = [];

      function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('is-visible');
        if (toastTimer) {
          clearTimeout(toastTimer);
        }
        toastTimer = window.setTimeout(function () {
          toast.classList.remove('is-visible');
        }, 2400);
      }

      function isAdmin() {
        try {
          return !!(window.KLog && typeof window.KLog.isAdmin === 'function' && window.KLog.isAdmin());
        } catch (_) {
          return false;
        }
      }

      function ensureRecorder() {
        if (!isAdmin()) return;
        try {
          if (!window.KLog || typeof window.KLog.start !== 'function') return;
          const status = typeof window.KLog.status === 'function' ? window.KLog.status() : null;
          const level = status && typeof status.level === 'number' ? status.level : 0;
          const startedAt = status && typeof status.startedAt === 'number' ? status.startedAt : 0;
          if (!status || level <= 0 || !startedAt) {
            window.KLog.start(1);
          }
        } catch (_) {}
      }

      function updateVisibility() {
        const hasRecorder = !!(window.KLog && typeof window.KLog.isAdmin === 'function');
        if (dumpButton) {
          if (!hasRecorder) {
            dumpButton.hidden = true;
          } else {
            const active = isAdmin();
            dumpButton.hidden = !active;
            if (active) {
              ensureRecorder();
            }
          }
        }

        const hasXP = !!(window.XP && typeof window.XP.getDiagnosticLogs === 'function');
        if (xpDumpButton) {
          const active = isAdmin();
          xpDumpButton.hidden = !(hasXP && active);
        }

        const needsRefresh = (!hasRecorder || !hasXP);
        if (needsRefresh && !visibilityRefreshTimer) {
          visibilityRefreshTimer = window.setTimeout(function () {
            visibilityRefreshTimer = null;
            updateVisibility();
          }, 800);
        }
      }

      if (dumpButton) {
        dumpButton.addEventListener('click', function () {
          if (!window.KLog) return;
          ensureRecorder();
          const attempt = window.KLog.dumpToClipboard ? window.KLog.dumpToClipboard() : false;
          Promise.resolve(attempt)
            .then(function (opened) {
              if (opened) {
                showToast(texts.openedDiagnostics);
                return;
              }
              const downloaded = window.KLog.downloadFile ? window.KLog.downloadFile() : false;
              if (downloaded) {
                showToast(texts.downloadedFile);
              } else {
                showToast(texts.diagnosticsUnavailable);
              }
            })
            .catch(function () {
              const downloaded = window.KLog && window.KLog.downloadFile ? window.KLog.downloadFile() : false;
              if (downloaded) {
                showToast(texts.downloadedFile);
              } else {
                showToast(texts.diagnosticsUnavailable);
              }
            });
        });
      }

      if (xpDumpButton) {
        xpDumpButton.addEventListener('click', function () {
          if (!window.XP || typeof window.XP.getDiagnosticLogs !== 'function') {
            showToast(texts.xpUnavailable);
            return;
          }
          try {
            const logs = window.XP.getDiagnosticLogs();
            if (!logs || logs.length === 0) {
              showToast(texts.xpEmpty);
              if (xpDiagOutput) {
                xpDiagOutput.style.display = 'none';
              }
              return;
            }

            const openXpLogWindow = makePopupRenderer(logs, {
              popupTitle: texts.popupTitle,
              popupGenerated: texts.popupGenerated,
              copyButton: texts.copyButton,
              copied: texts.copied,
              copyFailed: texts.copyFailed,
              loading: texts.loading,
            });

            const opened = openXpLogWindow();
            if (opened) {
              showToast(texts.xpOpened);
              return;
            }

            renderInlineLogs(logs, xpDiagOutput, texts);
            showToast(texts.xpDisplayedWithCount.replace('%COUNT%', logs.length));
          } catch (_) {
            showToast(texts.xpError);
          }
        });
      }

      function unlockAdmin() {
        if (!window.KLog || typeof window.KLog.enableAdmin !== 'function') return false;
        const enabled = window.KLog.enableAdmin(24 * 60 * 60 * 1000);
        if (enabled) {
          showToast(texts.unlocked);
          updateVisibility();
          ensureRecorder();
        }
        return enabled;
      }

      if (title) {
        function recordTap() {
          const now = Date.now();
          taps = taps.filter(function (ts) { return (now - ts) <= tapWindow; });
          taps.push(now);
          if (taps.length >= tapCount) {
            taps = [];
            unlockAdmin();
          }
        }
        title.addEventListener('pointerdown', recordTap, { passive: true });
        if (!window.PointerEvent) {
          title.addEventListener('click', recordTap);
          title.addEventListener('touchstart', recordTap, { passive: true });
        }
        title.addEventListener('keydown', function (event) {
          if (!event) return;
          if (event.key === 'Enter' || event.key === ' ') {
            recordTap();
          }
        });
        if (!title.hasAttribute('tabindex')) {
          title.setAttribute('tabindex', '0');
        }
      }

      window.addEventListener('klog:admin', updateVisibility);
      updateVisibility();
      window.setTimeout(updateVisibility, 250);
    });
  }

  window.AboutDebug = { init: init };
})(window, document);
