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
        aiProvider: 'gemini',
        aiModel: 'gemini-2.5-flash',
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
            loading: false
        },
        minutesWorkspace: {
            result: '',
            loading: false,
            updatedAt: null
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
        activeModalUtteranceId: null,
        activeMemoUtteranceId: null,
        noteDrafts: {},
        transcriptDrafts: {},
        focusedUtteranceId: null,
        isWorkingOnLog: false,
        dictionary: []
    }
};
