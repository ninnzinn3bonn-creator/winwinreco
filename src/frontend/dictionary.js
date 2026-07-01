(function initDictionaryModule() {
    const { state } = window.AppState;
    const { escapeHtml, readApiResponse } = window.AppUtils;
    // Same wording as live/post-meeting AI loading. The dictionary extractor
    // runs before the meeting starts, so it is the most visible place where
    // provider wording can drift if kept as a one-off string.
    const AI_LOADING_TEXT = 'GroqでAI解析中です...';

    async function loadDictionary() {
        // Dictionary controls are no longer rendered on the setup screen while
        // ElevenLabs Scribe is the fixed STT provider. When the DOM target is
        // absent, this module stays idle instead of calling dictionary APIs.
        if (!window.AppDom?.dictionaryList) return;
        try {
            const res = await fetch('/api/dictionary');
            const data = await readApiResponse(res);
            state.dictionary = Array.isArray(data) ? data : [];
            renderDictionary();
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'Failed to load dictionary', error.message);
        }
    }

    function renderDictionary() {
        const container = window.AppDom.dictionaryList;
        if (!container) return;
        container.innerHTML = '';
        if (state.dictionary.length === 0) {
            container.innerHTML = '<span class="placeholder-text">登録された用語はありません。</span>';
            return;
        }
        state.dictionary.forEach((item) => {
            const div = document.createElement('div');
            div.className = 'dict-item';
            div.innerHTML = `
                <strong>${escapeHtml(item.term)}</strong>
                ${item.reading ? `<span class="muted">(${escapeHtml(item.reading)})</span>` : ''}
                <button class="btn-dict-del" data-id="${item.id}" title="削除">×</button>
            `;
            div.querySelector('.btn-dict-del').onclick = () => deleteDictionaryTerm(item.id);
            container.appendChild(div);
        });
    }

    async function addDictionaryTerm() {
        const termInput = window.AppDom.dictTerm;
        const readingInput = window.AppDom.dictReading;
        const term = termInput.value.trim();
        const reading = readingInput.value.trim();
        if (!term) return window.AppToast.warn('用語を入力してください');

        try {
            const res = await fetch('/api/dictionary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ term, reading })
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || '追加に失敗しました');
            termInput.value = '';
            readingInput.value = '';
            await loadDictionary();
        } catch (error) {
            window.AppToast.error('追加に失敗しました', { detail: error.message });
        }
    }

    async function deleteDictionaryTerm(id) {
        if (!confirm('この用語を削除しますか？')) return;
        try {
            const res = await fetch(`/api/dictionary/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('削除に失敗しました');
            await loadDictionary();
        } catch (error) {
            window.AppToast.error('削除に失敗しました', { detail: error.message });
        }
    }

    async function extractTermsFromText() {
        const text = window.AppDom.dictBulkText.value.trim();
        if (!text) return window.AppToast.warn('解析するテキストを入力してください');

        const btn = window.AppDom.btnDictExtract;
        const resultsArea = window.AppDom.extractResultsArea;
        const originalText = btn.innerText;

        btn.disabled = true;
        btn.innerText = AI_LOADING_TEXT;
        resultsArea.classList.add('hidden');

        try {
            const res = await fetch('/api/dictionary/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    ai_config: { provider: 'groq', model: 'openai/gpt-oss-120b' }
                })
            });
            const data = await readApiResponse(res);
            if (!res.ok) throw new Error(data.error || '抽出に失敗しました');

            const existingTerms = (state.dictionary || []).map((item) => item.term);
            state.extractedTerms = (data.terms || []).filter((item) => !existingTerms.includes(item.term));

            if (state.extractedTerms.length === 0) {
                window.AppToast.info('新しい専門用語は見つかりませんでした（すべて登録済みか、適切な単語が検出されませんでした）。');
            } else {
                renderExtractResults();
            }
        } catch (error) {
            window.AppMain?.AppDebug?.log('error', 'Extraction failed', error.message);
            window.AppToast.error('解析に失敗しました', { detail: error.message });
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }

    function renderExtractResults() {
        const area = window.AppDom.extractResultsArea;
        const list = window.AppDom.extractList;
        if (!area || !list) return;

        list.innerHTML = '';
        state.extractedTerms.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'extract-item';
            const checkboxId = `extract-cb-${index}`;
            div.innerHTML = `
                <label for="${checkboxId}">
                    <input type="checkbox" id="${checkboxId}" checked data-index="${index}">
                    <span class="term">${escapeHtml(item.term)}</span>
                    <span class="reading">(${escapeHtml(item.reading)})</span>
                </label>
            `;
            list.appendChild(div);
        });
        area.classList.remove('hidden');
    }

    async function addSelectedTerms() {
        const checkboxes = window.AppDom.extractList.querySelectorAll('input[type="checkbox"]:checked');
        if (checkboxes.length === 0) return window.AppToast.warn('追加する用語を選択してください');

        const selectedIndices = Array.from(checkboxes).map((cb) => parseInt(cb.dataset.index, 10));
        const toAdd = selectedIndices.map((index) => state.extractedTerms[index]);

        let successCount = 0;
        for (const item of toAdd) {
            try {
                const res = await fetch('/api/dictionary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item)
                });
                if (res.ok) successCount += 1;
            } catch (error) {
                console.error(`Failed to add: ${item.term}`, error);
            }
        }

        window.AppToast.success(`${successCount}件の用語を辞書に追加しました。`);
        window.AppDom.extractResultsArea.classList.add('hidden');
        window.AppDom.dictBulkText.value = '';
        await loadDictionary();
    }

    async function guessReadingForInput() {
        const term = window.AppDom.dictTerm.value.trim();
        if (!term || term.length < 2) return;
        if (window.AppDom.dictReading.value.trim()) return;

        try {
            const res = await fetch('/api/dictionary/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: term,
                    ai_config: { provider: 'groq', model: 'openai/gpt-oss-120b' }
                })
            });
            const data = await readApiResponse(res);
            if (res.ok && data.terms && data.terms.length > 0) {
                const found = data.terms.find((item) => item.term === term) || data.terms[0];
                if (found && found.reading) {
                    window.AppDom.dictReading.value = found.reading;
                }
            }
        } catch (_) {
            // silent
        }
    }

    window.AppDictionary = {
        loadDictionary,
        renderDictionary,
        addDictionaryTerm,
        deleteDictionaryTerm,
        extractTermsFromText,
        renderExtractResults,
        addSelectedTerms,
        guessReadingForInput
    };
})();
