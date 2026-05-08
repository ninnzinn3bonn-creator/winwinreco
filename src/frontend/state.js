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
            progress: null  // { completed: number, total: number } | null
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
        // F4: ready メッセージで受け取るホスト指定の STT 設定。
        roomSttProvider: '',
        roomSttLanguage: '',
        dictionary: [],
        extractedTerms: []
    }
};
