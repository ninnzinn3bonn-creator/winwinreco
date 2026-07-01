window.AppState = {
    state: {
        roomId: null,
        participantId: null,
        controlToken: null,
        userId: null,
        displayName: null,
        isHost: false,
        ws: null,
        stream: null,
        audioContext: null,
        audioSource: null,
        micAnalyser: null,
        micMonitorFrame: null,
        processor: null,
        watchdogInterval: null,
        lastAudioProcessTime: 0,
        isMuted: false,
        wakeLockSentinel: null,
        voiceGate: {
            threshold: 0.012,
            maxThreshold: 0.78,
            releaseFrames: 6,
            remainingFrames: 0,
            speaking: false
        },
        micPresetKey: 'pin_mic',
        micSensitivity: 'standard',
        mobileMenuOpen: false,
        mobileMemoryCollapsed: false,
        mobileAiCollapsed: false,
        summaryMobileMenuOpen: false,
        summaryStatsCollapsed: false,
        summarySidebarCollapsed: false,
        summaryAiControlsCollapsed: false,
        activityItems: [],
        provisionalCards: {},
        // Product decision (2026-06-29): GIJIRO now runs with a fixed AI/STT
        // provider pair. Keep these values as the frontend source of truth so
        // old localStorage values from the former selectable UI cannot quietly
        // switch a room back to Gemini or Google STT.
        fixedAiProvider: 'groq',
        fixedAiModel: 'openai/gpt-oss-120b',
        fixedSttProvider: 'elevenlabs',
        fixedSttBatchModel: 'scribe_v2',
        fixedSttRealtimeModel: 'scribe_v2_realtime',
        aiProvider: 'groq',
        aiModel: 'openai/gpt-oss-120b',
        usePastMeetings: true,
        filters: {
            query: '',
            starredOnly: false,
            mineOnly: false,
            notedOnly: false
        },
        meetingInsights: {
            minutes: '',
            summary: '',
            todo: '',
            speakerSummaries: [],
            actions: [],
            status: 'idle',
            dirty: false,
            updatedAt: null,
            loading: false,
            pollTimer: null
        },
        aiWorkspace: {
            mode: '',
            title: '',
            instruction: '',
            result: '',
            savedAt: null,
            loading: false,
            progress: null  // { completed: number, total: number } | null
        },
        minutesWorkspace: {
            result: '',
            loading: false,
            updatedAt: null,
            progress: null,  // { completed: number, total: number } | null
            // 議事録本文とは別に、チャンク生成の成否を保持する。
            // 本文内の placeholder だけに依存するとユーザーが部分失敗を見落とすため、
            // UI 警告と再生成導線はこのメタ情報を唯一の判定材料にする。
            chunkMeta: { total: 0, failed: 0, status: [] }
        },
        liveMeetingAnalysis: {
            loadingKey: '',
            status: '',
            outputs: {
                summary: '',
                todo: '',
                agreements: '',
                topics: ''
            }
        },
        editorDirty: { aiResult: 0, aiInstruction: 0, minutes: 0 },
        activeModalUtteranceId: null,
        activeMemoUtteranceId: null,
        noteDrafts: {},
        transcriptDrafts: {},
        focusedUtteranceId: null,
        isWorkingOnLog: false,
        logAtBottom: true,   // false = ユーザーが上にスクロール中 → 自動スクロール抑制
        unreadUtterances: 0, // logAtBottom=false の間に届いた新規 utterance 件数 (FAB バッジ用)
        // F4: ready メッセージで受け取るホスト指定の STT 設定。
        roomSttProvider: '',
        roomSttLanguage: '',
        dictionary: [],
        extractedTerms: [],
        // Fix B-4: フロント空転検知用タイムスタンプ
        lastAudioSentAt: 0,
        lastTranscriptAt: 0,
        transcriptStallWatchdog: null
    }
};
