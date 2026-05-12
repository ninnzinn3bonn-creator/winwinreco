/**
 * AppToast — 右下に積み上がるトースト通知モジュール
 *
 * window.AppToast.info(msg, opts)     // 3秒で自動消滅
 * window.AppToast.success(msg, opts)  // 4秒
 * window.AppToast.warn(msg, opts)     // 5秒
 * window.AppToast.error(msg, opts)    // 8秒
 *
 * opts: {
 *   detail?: string | Error,   // 「詳細を表示」折りたたみ内に表示
 *   durationMs?: number,       // 上書き (ms)
 *   sticky?: boolean           // true なら自動消滅しない (× クリック必須)
 * }
 *
 * window.AppToast.dismissAll()        // 全トーストを即時除去
 */
(function initToastModule() {
    const DEFAULTS = {
        info: 3000,
        success: 4000,
        warn: 5000,
        error: 8000
    };

    function getContainer() {
        let el = document.getElementById('app-toast-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'app-toast-container';
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        return el;
    }

    function detailText(detail) {
        if (!detail) return '';
        if (detail instanceof Error) return detail.message;
        return String(detail);
    }

    function show(level, msg, opts) {
        opts = opts || {};
        const container = getContainer();
        const duration = opts.durationMs != null
            ? opts.durationMs
            : (opts.sticky ? 0 : DEFAULTS[level]);
        const sticky = !!opts.sticky || duration === 0;
        const detail = detailText(opts.detail);

        const toast = document.createElement('div');
        toast.className = `app-toast app-toast--${level}`;
        toast.setAttribute('role', 'alert');

        // Message line
        const msgEl = document.createElement('div');
        msgEl.className = 'app-toast__msg';
        msgEl.textContent = msg;
        toast.appendChild(msgEl);

        // Optional detail block
        if (detail) {
            const details = document.createElement('details');
            details.className = 'app-toast__details';
            const summary = document.createElement('summary');
            summary.textContent = '詳細を表示';
            const pre = document.createElement('pre');
            pre.className = 'app-toast__detail-text';
            pre.textContent = detail;
            details.appendChild(summary);
            details.appendChild(pre);
            toast.appendChild(details);
        }

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'app-toast__close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '閉じる');
        closeBtn.textContent = '×';
        toast.appendChild(closeBtn);

        container.appendChild(toast);

        let timerId = null;
        let remaining = duration;
        let startedAt = null;

        function dismiss() {
            if (!toast.parentNode) return;
            clearTimeout(timerId);
            toast.classList.add('app-toast--leaving');
            toast.addEventListener('animationend', () => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, { once: true });
            // Fallback remove in case animationend doesn't fire (no animation)
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 400);
        }

        function startTimer(ms) {
            startedAt = Date.now();
            timerId = setTimeout(dismiss, ms);
        }

        function pauseTimer() {
            if (!timerId) return;
            clearTimeout(timerId);
            timerId = null;
            remaining = Math.max(0, remaining - (Date.now() - startedAt));
        }

        function resumeTimer() {
            if (timerId || remaining <= 0) return;
            startTimer(remaining);
        }

        closeBtn.addEventListener('click', dismiss);

        // Hover pauses the auto-dismiss timer (spec: detail hover)
        if (!sticky) {
            toast.addEventListener('mouseenter', pauseTimer);
            toast.addEventListener('mouseleave', resumeTimer);
            startTimer(remaining);
        }

        return toast;
    }

    window.AppToast = {
        info:    (msg, opts) => show('info',    msg, opts),
        success: (msg, opts) => show('success', msg, opts),
        warn:    (msg, opts) => show('warn',    msg, opts),
        error:   (msg, opts) => show('error',   msg, opts),
        dismissAll() {
            const container = getContainer();
            Array.from(container.children).forEach((child) => {
                if (child.parentNode) child.parentNode.removeChild(child);
            });
        }
    };
})();
