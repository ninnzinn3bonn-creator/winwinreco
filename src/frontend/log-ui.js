(function initLogUiModule() {
    const { state } = window.AppState;
    const dom = window.AppDom;
    const { formatTime, escapeHtml, highlightText, shortenText, reqIncludes, readApiResponse } = window.AppUtils;

    function normalizeUtterance(raw) {
        return {
            id: raw.id,
            participant_id: raw.participant_id,
            display_name: raw.display_name || 'Unknown',
            transcript: raw.transcript || '',
            raw_transcript: raw.raw_transcript || raw.transcript || '',
            timestamp: raw.timestamp || raw.started_at,
            is_starred: !!raw.is_starred,
            memo_text: raw.memo_text || raw.memory_note || '',
            memory_note: raw.memo_text || raw.memory_note || '',
            starred_at: raw.starred_at || null,
            transcript_source: raw.transcript_source || 'stt',
            corrected_at: raw.corrected_at || null
        };
    }

    function upsertUtterance(raw) {
        const utterance = normalizeUtterance(raw);
        const existing = state.activityItems.find((item) => item.type === 'utterance' && item.data.id === utterance.id);
        if (existing) {
            existing.data = { ...existing.data, ...utterance };
            existing.timestamp = utterance.timestamp;
        } else {
            state.activityItems.push({
                type: 'utterance',
                id: utterance.id,
                timestamp: utterance.timestamp,
                data: utterance
            });
        }
        state.activityItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    function getVisibleItems() {
        const query = state.filters.query.trim().toLowerCase();
        return state.activityItems.filter((item) => {
            if (item.type === 'system') {
                return !state.filters.starredOnly && !state.filters.mineOnly && !state.filters.notedOnly
                    && (!query || item.text.toLowerCase().includes(query));
            }
            const utterance = item.data;
            const haystack = [
                utterance.display_name,
                utterance.transcript,
                utterance.raw_transcript,
                utterance.memo_text
            ].join(' ').toLowerCase();

            if (query && !haystack.includes(query)) return false;
            if (state.filters.starredOnly && !utterance.is_starred) return false;
            if (state.filters.mineOnly && utterance.participant_id !== state.participantId) return false;
            if (state.filters.notedOnly && !utterance.memo_text.trim()) return false;
            return true;
        });
    }

    function getVisibleUtteranceCount() {
        return getVisibleItems().filter((item) => item.type === 'utterance').length;
    }

    function getAllUtterances() {
        return state.activityItems.filter((item) => item.type === 'utterance').map((item) => item.data);
    }

    function toggleFilter(key) {
        state.filters[key] = !state.filters[key];
        syncFilterControls();
        renderAllLogs();
    }

    function clearSearch() {
        state.filters.query = '';
        syncFilterControls();
        renderAllLogs();
    }

    function syncFilterControls() {
        dom.filterInputs.forEach((input) => {
            input.value = state.filters.query;
        });
        dom.filterButtons.starred.forEach((button) => button.classList.toggle('active', state.filters.starredOnly));
        dom.filterButtons.mine.forEach((button) => button.classList.toggle('active', state.filters.mineOnly));
        dom.filterButtons.noted.forEach((button) => button.classList.toggle('active', state.filters.notedOnly));
    }

    function getUtteranceById(id) {
        const entry = state.activityItems.find((item) => item.type === 'utterance' && item.data.id === id);
        return entry ? entry.data : null;
    }

    function getStarredUtterances() {
        return state.activityItems
            .filter((item) => item.type === 'utterance' && item.data.is_starred)
            .map((item) => item.data)
            .sort((a, b) => new Date(b.starred_at || b.timestamp).getTime() - new Date(a.starred_at || a.timestamp).getTime());
    }

    function openTranscriptModal(id) {
        const utterance = getUtteranceById(id);
        if (!utterance) return;
        closeMemoModal({ preserveDraft: true });
        state.activeModalUtteranceId = id;
        state.transcriptDrafts[id] = utterance.transcript || '';
        renderEditModal();
        window.AppMeetingUi?.updateLogWorkState?.();
    }

    function closeTranscriptModal() {
        if (state.activeModalUtteranceId) {
            delete state.transcriptDrafts[state.activeModalUtteranceId];
        }
        state.activeModalUtteranceId = null;
        renderEditModal();
        window.AppMeetingUi?.updateLogWorkState?.();
    }

    function openMemoModal(id) {
        const utterance = getUtteranceById(id);
        if (!utterance) return;
        closeTranscriptModal();
        state.activeMemoUtteranceId = id;
        state.noteDrafts[id] = utterance.memo_text || utterance.memory_note || '';
        renderMemoModal();
        window.AppMeetingUi?.updateLogWorkState?.();
    }

    function closeMemoModal(options = {}) {
        if (state.activeMemoUtteranceId && !options.preserveDraft) {
            delete state.noteDrafts[state.activeMemoUtteranceId];
        }
        state.activeMemoUtteranceId = null;
        renderMemoModal();
        window.AppMeetingUi?.updateLogWorkState?.();
    }

    function renderEditModal() {
        const utterance = state.activeModalUtteranceId ? getUtteranceById(state.activeModalUtteranceId) : null;
        if (!utterance) {
            dom.editModalOverlay.classList.add('hidden');
            dom.editModalOverlay.setAttribute('aria-hidden', 'true');
            if (!state.activeMemoUtteranceId) document.body.classList.remove('modal-open');
            dom.editModalSpeaker.innerText = '-';
            dom.editModalTime.innerText = '--:--';
            dom.editModalOriginal.innerText = '';
            dom.editModalTextarea.value = '';
            return;
        }

        dom.editModalOverlay.classList.remove('hidden');
        dom.editModalOverlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        dom.editModalSpeaker.innerText = utterance.display_name;
        dom.editModalTime.innerText = formatTime(utterance.timestamp);
        dom.editModalOriginal.innerText = utterance.raw_transcript || utterance.transcript || '';
        dom.editModalTextarea.value = state.transcriptDrafts[utterance.id] ?? utterance.transcript ?? '';
    }

    function renderMemoModal() {
        const utterance = state.activeMemoUtteranceId ? getUtteranceById(state.activeMemoUtteranceId) : null;
        if (!utterance) {
            dom.memoModalOverlay.classList.add('hidden');
            dom.memoModalOverlay.setAttribute('aria-hidden', 'true');
            if (!state.activeModalUtteranceId) document.body.classList.remove('modal-open');
            dom.memoModalSpeaker.innerText = '-';
            dom.memoModalTime.innerText = '--:--';
            dom.memoModalOriginal.innerText = '';
            dom.memoModalTextarea.value = '';
            return;
        }

        dom.memoModalOverlay.classList.remove('hidden');
        dom.memoModalOverlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        dom.memoModalSpeaker.innerText = utterance.display_name;
        dom.memoModalTime.innerText = formatTime(utterance.timestamp);
        dom.memoModalOriginal.innerText = utterance.transcript || '';
        dom.memoModalTextarea.value = state.noteDrafts[utterance.id] ?? utterance.memo_text ?? utterance.memory_note ?? '';
    }

    async function updateUtteranceMemory(id, updates, options = {}) {
        try {
            const res = await fetch(`/rooms/${state.roomId}/logs/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(window.AppMain.authedBody(updates))
            });
            const updated = await readApiResponse(res);
            if (!res.ok) throw new Error(updated.error || 'ログ更新に失敗しました');
            upsertUtterance(updated);
            state.noteDrafts[id] = updated.memo_text || updated.memory_note || '';
            state.transcriptDrafts[id] = updated.transcript || '';
            if (options.closeModal) {
                state.activeModalUtteranceId = null;
                delete state.transcriptDrafts[id];
            }
            if (options.closeMemoModal) {
                state.activeMemoUtteranceId = null;
                delete state.noteDrafts[id];
            }
            if (reqIncludes(updates, 'transcript')) {
                state.meetingInsights.dirty = true;
            }
            renderAllLogs();
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'Failed to update log', error.message);
            window.AppToast.error('ログ更新に失敗しました', { detail: error.message });
        }
    }

    async function saveTranscriptFromModal() {
        const utteranceId = state.activeModalUtteranceId;
        if (!utteranceId) return;
        const transcript = (state.transcriptDrafts[utteranceId] ?? '').trim();
        await updateUtteranceMemory(utteranceId, { transcript, transcript_source: 'user' }, { closeModal: true });
    }

    async function saveMemoFromModal() {
        const utteranceId = state.activeMemoUtteranceId;
        if (!utteranceId) return;
        const memoText = (state.noteDrafts[utteranceId] ?? '').trim();
        await updateUtteranceMemory(utteranceId, { memo_text: memoText }, { closeMemoModal: true });
    }

    function createUtteranceElement(utterance) {
        const article = document.createElement('article');
        article.className = `utterance${utterance.participant_id === state.participantId ? ' self' : ''}${utterance.is_starred ? ' starred' : ''}${utterance.id === state.focusedUtteranceId ? ' focused' : ''}`;
        article.dataset.utteranceId = utterance.id;

        const time = formatTime(utterance.timestamp);
        const sourceLabel = utterance.transcript_source === 'user'
            ? '手動編集'
            : utterance.transcript_source === 'ai'
                ? 'AI補正'
                : '生ログ';
        const rawDiffers = utterance.raw_transcript && utterance.raw_transcript !== utterance.transcript;

        article.innerHTML = `
            <div class="utterance-meta">
                <div>
                    <div class="speaker-name">${escapeHtml(utterance.display_name)}</div>
                    <div class="utterance-time">${time}</div>
                </div>
                <div class="timestamp">${utterance.is_starred ? '★ ' : ''}${sourceLabel}</div>
            </div>
            <div class="text">${highlightText(utterance.transcript, state.filters.query)}</div>
            ${rawDiffers ? `<div class="note-preview">RAW: ${highlightText(utterance.raw_transcript, state.filters.query)}</div>` : ''}
            ${utterance.memo_text ? `<div class="note-preview">メモ: ${highlightText(utterance.memo_text, state.filters.query)}</div>` : ''}
            <div class="utterance-actions">
                <button class="icon-toggle ${utterance.is_starred ? 'active' : ''}" data-action="star">${utterance.is_starred ? '★ 重要' : '☆ 重要'}</button>
                <button class="icon-toggle" data-action="note">メモ</button>
                <button class="icon-toggle" data-action="edit">編集</button>
            </div>
        `;

        article.tabIndex = 0;
        article.addEventListener('click', (event) => {
            if (event.target.closest('button, textarea')) return;
            const textEl = article.querySelector('.text');
            if (textEl && textEl.contains(event.target)) {
                startInlineUtteranceEdit(article, utterance);
            }
        });
        article.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startInlineUtteranceEdit(article, utterance);
            }
        });

        article.querySelector('[data-action="star"]').onclick = (event) => {
            event.stopPropagation();
            updateUtteranceMemory(utterance.id, { is_starred: !utterance.is_starred });
        };
        article.querySelector('[data-action="note"]').onclick = (event) => {
            event.stopPropagation();
            openMemoModal(utterance.id);
        };
        article.querySelector('[data-action="edit"]').onclick = (event) => {
            event.stopPropagation();
            startInlineUtteranceEdit(article, utterance);
        };

        return article;
    }

    function startInlineUtteranceEdit(article, utterance) {
        const textEl = article.querySelector('.text');
        if (!textEl || textEl.classList.contains('is-editing')) return;
        const original = utterance.transcript || '';
        textEl.classList.add('is-editing');
        textEl.setAttribute('contenteditable', 'true');
        textEl.setAttribute('spellcheck', 'true');
        textEl.textContent = original;
        textEl.focus();
        try {
            const range = document.createRange();
            range.selectNodeContents(textEl);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (_) {
            /* ignore */
        }

        let finished = false;
        const cleanup = () => {
            finished = true;
            textEl.classList.remove('is-editing');
            textEl.removeAttribute('contenteditable');
        };
        const commit = async () => {
            if (finished) return;
            const next = (textEl.textContent || '').trim();
            cleanup();
            if (next === original.trim()) {
                renderAllLogs();
                return;
            }
            try {
                await updateUtteranceMemory(utterance.id, { transcript: next, transcript_source: 'user' });
            } catch (err) {
                window.AppToast.error('保存に失敗しました', { detail: err && err.message });
            }
        };
        const cancel = () => {
            if (finished) return;
            cleanup();
            textEl.textContent = original;
            renderAllLogs();
        };

        textEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commit();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
            }
        });
        textEl.addEventListener('blur', () => commit(), { once: true });
    }

    function createProvisionalElement(provisional) {
        const article = document.createElement('article');
        article.className = `utterance provisional${provisional.participant_id === state.participantId ? ' self' : ''}`;
        article.dataset.provisionalParticipant = provisional.participant_id;
        article.innerHTML = `
            <div class="utterance-meta">
                <div>
                    <div class="speaker-name">${escapeHtml(provisional.display_name || '')}</div>
                </div>
                <div class="timestamp">認識中…</div>
            </div>
            <div class="text">${escapeHtml(provisional.text)}</div>
        `;
        return article;
    }

    function showProvisional(msg) {
        const participantId = msg.participant_id;
        const text = msg.text || '';
        const displayName = msg.display_name || '';
        state.provisionalCards[participantId] = { participant_id: participantId, display_name: displayName, text };

        const containers = [dom.timeline].filter(Boolean);
        containers.forEach((container) => {
            const existing = container.querySelector(`[data-provisional-participant="${participantId}"]`);
            if (existing) {
                const textEl = existing.querySelector('.text');
                if (textEl && textEl.textContent !== text) textEl.textContent = text;
            } else {
                container.appendChild(createProvisionalElement(state.provisionalCards[participantId]));
                scrollLogToLatest(container);
            }
        });
    }

    function clearProvisional(participantId) {
        delete state.provisionalCards[participantId];
        const containers = [dom.timeline].filter(Boolean);
        containers.forEach((container) => {
            const existing = container.querySelector(`[data-provisional-participant="${participantId}"]`);
            if (existing) existing.remove();
        });
    }

    function renderConversationList(container, includeSystemMessages) {
        if (!container) return;
        const previousScrollTop = container.scrollTop;
        const previousScrollHeight = container.scrollHeight;
        const items = getVisibleItems().filter((item) => includeSystemMessages || item.type === 'utterance');
        container.innerHTML = '';

        if (items.length === 0 && Object.keys(state.provisionalCards).length === 0) {
            container.innerHTML = '<span class="placeholder-text">該当するログはありません。</span>';
        } else if (items.length === 0) {
            // provisional cards only — render them below
        } else {
            items.forEach((item) => {
                if (item.type === 'system') {
                    const system = document.createElement('div');
                    system.className = 'system-message';
                    system.innerText = item.text;
                    container.appendChild(system);
                    return;
                }
                container.appendChild(createUtteranceElement(item.data));
            });
        }

        // provisional cards always at the bottom
        Object.values(state.provisionalCards).forEach((p) => {
            container.appendChild(createProvisionalElement(p));
        });

        if (state.isWorkingOnLog) {
            const heightDelta = container.scrollHeight - previousScrollHeight;
            container.scrollTop = previousScrollTop + Math.max(heightDelta, 0);
        }
    }

    function renderStarredLogs(container) {
        if (!container) return;
        const starred = getStarredUtterances();
        container.innerHTML = '';
        if (starred.length === 0) {
            container.innerHTML = '<span class="placeholder-text">重要ログはまだありません。</span>';
            return;
        }
        starred.forEach((utterance) => {
            const card = document.createElement('button');
            card.className = `memory-card${utterance.id === state.focusedUtteranceId ? ' active' : ''}`;
            card.type = 'button';
            card.innerHTML = `
                <div class="memory-card-header">
                    <strong>${escapeHtml(utterance.display_name)}</strong>
                    <time>${formatTime(utterance.timestamp)}</time>
                </div>
                <div class="memory-card-text">${highlightText(shortenText(utterance.transcript, 90), state.filters.query)}</div>
                ${utterance.memo_text ? `<div class="note-preview">メモ: ${highlightText(shortenText(utterance.memo_text, 70), state.filters.query)}</div>` : ''}
            `;
            card.onclick = () => focusUtterance(utterance.id);
            container.appendChild(card);
        });
    }

    function focusUtterance(id) {
        state.focusedUtteranceId = id;
        renderAllLogs();
        requestAnimationFrame(() => {
            const logRoot = dom.summaryScreen.classList.contains('active') && document.getElementById('panel-log').classList.contains('active')
                ? dom.summaryLog
                : dom.timeline;
            const target = logRoot.querySelector(`[data-utterance-id="${id}"]`);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    function renderAllLogs() {
        window.AppMeetingUi?.updateLogWorkState?.();
        renderConversationList(dom.timeline, true);
        renderConversationList(dom.summaryLog, false);
        renderStarredLogs(document.getElementById('starred-log-list'));
        renderStarredLogs(document.getElementById('summary-starred-log-list'));
        renderEditModal();
        renderMemoModal();
        window.AppSharedAi?.renderMeetingInsights?.();
        window.AppSharedAi?.renderAiWorkspace?.();
        window.AppSharedAi?.renderMinutesWorkspace?.();
        window.AppSharedAi?.renderMeetingAnalysis?.();

        const countText = `${getVisibleUtteranceCount()}件`;
        const allUtterances = getAllUtterances();
        const starredCount = getStarredUtterances().length;
        const editedCount = allUtterances.filter((utterance) => utterance.transcript_source !== 'stt').length;

        document.getElementById('log-match-count').innerText = countText;
        document.getElementById('summary-match-count').innerText = countText;
        document.getElementById('starred-count').innerText = String(starredCount);
        document.getElementById('summary-total-count').innerText = String(allUtterances.length);
        document.getElementById('summary-starred-count').innerText = String(starredCount);
        document.getElementById('summary-edited-count').innerText = String(editedCount);
    }

    function scrollLogToLatest(container, options = {}) {
        // force=true はボタン押下など明示的な操作。それ以外は
        // ① 編集中 または ② ユーザーが上にスクロール中 なら自動スクロールしない (F2)。
        if (!options.force && (state.isWorkingOnLog || state.logAtBottom === false)) return;
        const containerScrolls = container && (container.scrollHeight - container.clientHeight) > 8;
        if (containerScrolls) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            return;
        }
        const target = container && container.lastElementChild;
        if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'end' });
            return;
        }
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    }

    window.AppLogUi = {
        normalizeUtterance,
        upsertUtterance,
        showProvisional,
        clearProvisional,
        getVisibleItems,
        getVisibleUtteranceCount,
        getAllUtterances,
        toggleFilter,
        clearSearch,
        syncFilterControls,
        getUtteranceById,
        getStarredUtterances,
        openTranscriptModal,
        closeTranscriptModal,
        openMemoModal,
        closeMemoModal,
        renderEditModal,
        renderMemoModal,
        updateUtteranceMemory,
        saveTranscriptFromModal,
        saveMemoFromModal,
        createUtteranceElement,
        renderConversationList,
        renderStarredLogs,
        focusUtterance,
        renderAllLogs,
        scrollLogToLatest
    };
})();
