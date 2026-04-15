(function initDomCache() {
    const dom = {
        setupScreen: document.getElementById('setup-screen'),
        meetingScreen: document.getElementById('meeting-screen'),
        summaryScreen: document.getElementById('summary-screen'),
        timeline: document.getElementById('timeline'),
        summaryLog: document.getElementById('summary-log'),
        roomInfo: document.getElementById('room-info'),
        summaryInfo: document.getElementById('summary-info'),
        selfInfo: document.getElementById('self-info'),
        aiWorkspaceStatus: document.getElementById('ai-workspace-status'),
        minutesWorkspaceStatus: document.getElementById('minutes-workspace-status'),
        aiOutputTitle: document.getElementById('ai-output-title'),
        customAiInstruction: document.getElementById('custom-ai-instruction'),
        aiOutputEditor: document.getElementById('ai-output-editor'),
        minutesOutputEditor: document.getElementById('minutes-output-editor'),
        meetingAiStatus: document.getElementById('meeting-ai-status'),
        micCheckStatus: document.getElementById('mic-check-status'),
        micLevelBar: document.getElementById('mic-level-bar'),
        setupMicSensitivity: document.getElementById('mic-sensitivity'),
        meetingMicSensitivity: document.getElementById('meeting-mic-sensitivity'),
        setupMicMinThreshold: document.getElementById('mic-min-threshold'),
        setupMicMaxThreshold: document.getElementById('mic-max-threshold'),
        setupMicMinThresholdValue: document.getElementById('mic-min-threshold-value'),
        setupMicMaxThresholdValue: document.getElementById('mic-max-threshold-value'),
        meetingMicMinThreshold: document.getElementById('meeting-mic-min-threshold'),
        meetingMicMaxThreshold: document.getElementById('meeting-mic-max-threshold'),
        meetingMicMinThresholdValue: document.getElementById('meeting-mic-min-threshold-value'),
        meetingMicMaxThresholdValue: document.getElementById('meeting-mic-max-threshold-value'),
        micMeterShell: document.getElementById('mic-meter-shell'),
        mobileMeetingMenu: document.getElementById('mobile-meeting-menu'),
        summaryMobileMenu: document.getElementById('summary-mobile-menu'),
        editModalOverlay: document.getElementById('edit-modal-overlay'),
        editModalSpeaker: document.getElementById('edit-modal-speaker'),
        editModalTime: document.getElementById('edit-modal-time'),
        editModalOriginal: document.getElementById('edit-modal-original'),
        editModalTextarea: document.getElementById('edit-modal-textarea'),
        memoModalOverlay: document.getElementById('memo-modal-overlay'),
        memoModalSpeaker: document.getElementById('memo-modal-speaker'),
        memoModalTime: document.getElementById('memo-modal-time'),
        memoModalOriginal: document.getElementById('memo-modal-original'),
        memoModalTextarea: document.getElementById('memo-modal-textarea'),
        aiProviderSelect: document.getElementById('ai-provider'),
        aiModelInput: document.getElementById('ai-model'),
        meetingAiEditors: {
            summary: document.getElementById('meeting-ai-summary'),
            todo: document.getElementById('meeting-ai-todo'),
            agreements: document.getElementById('meeting-ai-agreements'),
            topics: document.getElementById('meeting-ai-topics')
        },
        meetingAiButtons: {
            summary: document.getElementById('btn-meeting-summary'),
            todo: document.getElementById('btn-meeting-todo'),
            agreements: document.getElementById('btn-meeting-agreements'),
            topics: document.getElementById('btn-meeting-topics')
        },
        filterInputs: [
            document.getElementById('log-search'),
            document.getElementById('summary-search')
        ],
        filterButtons: {
            starred: [document.getElementById('filter-starred'), document.getElementById('summary-filter-starred')],
            mine: [document.getElementById('filter-mine'), document.getElementById('summary-filter-mine')],
            noted: [document.getElementById('filter-noted'), document.getElementById('summary-filter-noted')]
        }
    };

    window.AppDom = dom;
})();
