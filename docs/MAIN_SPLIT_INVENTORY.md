# `src/frontend/main.js` 関数インベントリ

`src/frontend/main.js` のトップレベル関数を、分割プランに沿って移動候補ごとに整理した初版です。行番号は 2026-05-05 時点の現行ファイルを基準にしています。

| 関数名 | 現在の行 | 想定移動先 Phase | 備考 |
|---|---:|---|---|
| `updateMicStatus` | 89 | 2a (`audio.js`) | |
| `sendMicPresetMetadataToServer` | 98 | 2a (`audio.js`) | プリセット送信補助 |
| `getMicPresetConfig` | 119 | 2a (`audio.js`) | |
| `renderMicPresetUi` | 123 | 2a (`audio.js`) | |
| `authCredParams` | 153 | `main.js` 残留 | 認証補助 |
| `withAuthQuery` | 160 | `main.js` 残留 | 認証補助 |
| `authedBody` | 166 | `main.js` 残留 | 認証補助 |
| `loadDictionary` | 174 | 1 (`dictionary.js`) | |
| `renderDictionary` | 185 | 1 (`dictionary.js`) | |
| `addDictionaryTerm` | 206 | 1 (`dictionary.js`) | |
| `deleteDictionaryTerm` | 229 | 1 (`dictionary.js`) | |
| `extractTermsFromText` | 242 | 1 (`dictionary.js`) | 追加辞書フロー |
| `renderExtractResults` | 284 | 1 (`dictionary.js`) | 追加辞書フロー |
| `addSelectedTerms` | 307 | 1 (`dictionary.js`) | 追加辞書フロー |
| `guessReadingForInput` | 334 | 1 (`dictionary.js`) | 追加辞書フロー |
| `switchTab` | 360 | 5 (`meeting-ui.js`) | |
| `pickInitialSummaryTab` | 379 | 5 (`meeting-ui.js`) | |
| `ensureLocalUserId` | 388 | `main.js` 残留 | |
| `toggleFilter` | 401 | 3 (`log-ui.js`) | |
| `clearSearch` | 407 | 3 (`log-ui.js`) | |
| `syncFilterControls` | 413 | 3 (`log-ui.js`) | |
| `updateLogWorkState` | 422 | 5 (`meeting-ui.js`) | |
| `addMemo` | 426 | 5 (`meeting-ui.js`) | log-ui と境界再確認 |
| `toggleMobileMeetingMenu` | 432 | 5 (`meeting-ui.js`) | |
| `toggleMobileMemoryPanel` | 437 | 5 (`meeting-ui.js`) | |
| `toggleMobileAiPanel` | 442 | 5 (`meeting-ui.js`) | |
| `updateMuteButton` | 447 | 2b (`audio.js`) | |
| `syncMuteUi` | 451 | 2b (`audio.js`) | |
| `renderMobileMeetingControls` | 477 | 5 (`meeting-ui.js`) | |
| `renderSummaryMobileControls` | 521 | 5 (`meeting-ui.js`) | |
| `toggleSummaryMobileMenu` | 565 | 5 (`meeting-ui.js`) | |
| `toggleSummaryStats` | 570 | 5 (`meeting-ui.js`) | |
| `toggleSummarySidebar` | 575 | 5 (`meeting-ui.js`) | |
| `toggleSummaryAiControls` | 580 | 5 (`meeting-ui.js`) | |
| `setMicSensitivity` | 585 | 2a (`audio.js`) | |
| `applyMicPreset` | 604 | 2a (`audio.js`) | |
| `updateMicThresholdControls` | 642 | 2a (`audio.js`) | |
| `syncMicThresholdsFromUi` | 662 | 2a (`audio.js`) | |
| `bindStreamState` | 677 | 2a (`audio.js`) | |
| `stopMicMonitor` | 695 | 2a (`audio.js`) | |
| `startMicMonitor` | 706 | 2a (`audio.js`) | |
| `ensureAudioNodes` | 729 | 2a (`audio.js`) | |
| `requestWakeLock` | 743 | 2a (`audio.js`) | |
| `releaseWakeLock` | 758 | 2a (`audio.js`) | |
| `runMicCheck` | 770 | 2a (`audio.js`) | |
| `reconnectMic` | 776 | 2a (`audio.js`) | |
| `syncMicrophonePermissionState` | 791 | 2a (`audio.js`) | |
| `addSystemMessage` | 809 | 5 (`meeting-ui.js`) | |
| `normalizeUtterance` | 819 | 3 (`log-ui.js`) | |
| `upsertUtterance` | 836 | 3 (`log-ui.js`) | |
| `getVisibleItems` | 855 | 3 (`log-ui.js`) | |
| `getVisibleUtteranceCount` | 880 | 3 (`log-ui.js`) | |
| `getAllUtterances` | 884 | 3 (`log-ui.js`) | |
| `renderAllLogs` | 890 | 3 (`log-ui.js`) | |
| `renderMinutesWorkspace` | 916 | 4 (`shared-ai.js`) | |
| `getUtteranceById` | 941 | 3 (`log-ui.js`) | |
| `renderMeetingInsights` | 946 | 4 (`shared-ai.js`) | |
| `scheduleInsightsPoll` | 976 | 4 (`shared-ai.js`) | |
| `syncSharedResultsIntoEditors` | 987 | 4 (`shared-ai.js`) | |
| `loadMeetingInsights` | 1026 | 4 (`shared-ai.js`) | |
| `runDirectAnalysis` | 1060 | 4 (`shared-ai.js`) | |
| `renderMeetingAnalysis` | 1103 | 4 (`shared-ai.js`) | |
| `runMeetingAnalysis` | 1133 | 4 (`shared-ai.js`) | |
| `runSharedResult` | 1198 | 4 (`shared-ai.js`) | |
| `runSummaryInsights` | 1276 | 4 (`shared-ai.js`) | |
| `runActionInsights` | 1280 | 4 (`shared-ai.js`) | |
| `runMinutesGeneration` | 1284 | 4 (`shared-ai.js`) | |
| `ensureMeetingInsights` | 1342 | 4 (`shared-ai.js`) | |
| `loadCustomAiResult` | 1346 | 4 (`shared-ai.js`) | |
| `generateCustomAiResult` | 1367 | 4 (`shared-ai.js`) | |
| `scrollToPageEdge` | 1412 | 5 (`meeting-ui.js`) | |
| `getStarredUtterances` | 1419 | 3 (`log-ui.js`) | |
| `openTranscriptModal` | 1426 | 3 (`log-ui.js`) | |
| `closeTranscriptModal` | 1436 | 3 (`log-ui.js`) | |
| `openMemoModal` | 1445 | 3 (`log-ui.js`) | |
| `closeMemoModal` | 1455 | 3 (`log-ui.js`) | |
| `renderEditModal` | 1464 | 3 (`log-ui.js`) | |
| `renderMemoModal` | 1486 | 3 (`log-ui.js`) | |
| `createUtteranceElement` | 1508 | 3 (`log-ui.js`) | |
| `startInlineUtteranceEdit` | 1578 | 3 (`log-ui.js`) | インライン編集補助 |
| `renderConversationList` | 1639 | 3 (`log-ui.js`) | |
| `renderStarredLogs` | 1668 | 3 (`log-ui.js`) | |
| `focusUtterance` | 1693 | 3 (`log-ui.js`) | |
| `renderAiWorkspace` | 1705 | 4 (`shared-ai.js`) | |
| `setAiWorkspace` | 1732 | 4 (`shared-ai.js`) | |
| `scheduleAiWorkspacePersist` | 1749 | 4 (`shared-ai.js`) | 保存補助 |
| `persistAiWorkspaceNow` | 1755 | 4 (`shared-ai.js`) | 保存補助 |
| `setupMeetingTitle` | 1784 | 5 (`meeting-ui.js`) | |
| `saveMeetingTitle` | 1798 | 5 (`meeting-ui.js`) | |
| `clearInsightsPoll` | 1829 | 4 (`shared-ai.js`) | |
| `isEditorDirty` | 1841 | 4 (`shared-ai.js`) | |
| `getFormattedAiWorkspaceText` | 1846 | 4 (`shared-ai.js`) | |
| `getFormattedMinutesText` | 1853 | 4 (`shared-ai.js`) | |
| `copyAiWorkspaceResult` | 1857 | 4 (`shared-ai.js`) | |
| `downloadAiWorkspaceResult` | 1870 | 4 (`shared-ai.js`) | |
| `copyMinutesResult` | 1878 | 4 (`shared-ai.js`) | |
| `downloadMinutesResult` | 1892 | 4 (`shared-ai.js`) | |
| `reqIncludes` | 1901 | `utils.js` 移管候補 | 純粋関数 |
| `readApiResponse` | 1905 | `utils.js` 移管候補 | 純粋関数 |
| `updateUtteranceMemory` | 1916 | 3 (`log-ui.js`) | |
| `saveTranscriptFromModal` | 1946 | 3 (`log-ui.js`) | |
| `saveMemoFromModal` | 1953 | 3 (`log-ui.js`) | |
| `downloadMinutes` | 1960 | 5 (`meeting-ui.js`) | |
| `copyRoomId` | 1965 | 5 (`meeting-ui.js`) | |
| `prepareAudio` | 1973 | 2b (`audio.js`) | |
| `joinRoom` | 2022 | 5 (`meeting-ui.js`) | |
| `createRoom` | 2031 | 5 (`meeting-ui.js`) | |
| `joinRoomProcess` | 2065 | 5 (`meeting-ui.js`) | |
| `showMeetingScreen` | 2113 | 5 (`meeting-ui.js`) | |
| `autoConnectMicIfPermitted` | 2143 | 5 (`meeting-ui.js`) | |
| `showSummaryScreen` | 2163 | 5 (`meeting-ui.js`) | |
| `loadRoomLogs` | 2200 | 5 (`meeting-ui.js`) | |
| `initWebSocket` | 2213 | 5 (`meeting-ui.js`) | |
| `scrollLogToLatest` | 2258 | 3 (`log-ui.js`) | |
| `vibrateSafe` | 2300 | 5 (`meeting-ui.js`) | |
| `getTimelineContainer` | 2310 | 5 (`meeting-ui.js`) | |
| `getCurrentVisibleUtterance` | 2316 | 3 (`log-ui.js`) | ジャンプ補助 |
| `jumpToUtteranceId` | 2349 | 3 (`log-ui.js`) | ジャンプ補助 |
| `jumpToTimestampOffset` | 2358 | 3 (`log-ui.js`) | ジャンプ補助 |
| `jumpToStarRelative` | 2380 | 3 (`log-ui.js`) | ジャンプ補助 |
| `dispatchJumpAction` | 2402 | 3 (`log-ui.js`) | ジャンプ補助 |
| `openJumpPalette` | 2421 | 5 (`meeting-ui.js`) | UI 補助 |
| `closeJumpPalette` | 2431 | 5 (`meeting-ui.js`) | UI 補助 |
| `clearLongPressTimer` | 2440 | 5 (`meeting-ui.js`) | UI 補助 |
| `setupJumpPalette` | 2447 | 5 (`meeting-ui.js`) | UI 補助 |
| `startRecording` | 2579 | 2b (`audio.js`) | コールバック注入予定 |
| `stopRecording` | 2676 | 2b (`audio.js`) | |
| `toggleMute` | 2699 | 2b (`audio.js`) | |
| `endRoom` | 2710 | 5 (`meeting-ui.js`) | |
| `checkApiStatus` | 2729 | `main.js` 残留 | |
| `initializeSetupUi` | 2783 | `main.js` 残留 | |
| `getScreenSection` | 2901 | `main.js` 残留 | 画面遷移補助 |
| `setFlowProgressStep` | 2905 | `main.js` 残留 | 画面遷移補助 |
| `activateOnlySection` | 2910 | `main.js` 残留 | 画面遷移補助 |
| `showWelcomeScreen` | 2928 | `main.js` 残留 | |
| `showSetupScreenActive` | 2936 | `main.js` 残留 | |
| `autoStartMicCheckOnSetup` | 2949 | `main.js` 残留 | |
| `setWelcomeFormVisible` | 2972 | `main.js` 残留 | |
| `setupOnboardingScreens` | 3011 | `main.js` 残留 | |
| `resolveInitialScreen` | 3065 | `main.js` 残留 | |
| `applyParticipantModeFromUrl` | 3087 | `main.js` 残留 | |
| `initAuthAndRender` | 3114 | `main.js` 残留 | |
| `bootstrap` | 3126 | `main.js` 残留 | |
| `refreshHomeButtonHint` | 3177 | `main.js` 残留 | |
| `setupTapCounter` | 3192 | `main.js` 残留 | |
| `setupGlobalModalEscape` | 3235 | `main.js` 残留 | |

## メモ

- `sendMicPresetMetadataToServer`、辞書抽出系、ジャンプパレット系、会議タイトル系など、分割プラン初版に未記載の補助関数も現行実装に合わせて追加しています。
- `reqIncludes` / `readApiResponse` は純粋関数寄りなので、将来的な `utils.js` 移管候補として扱っています。
