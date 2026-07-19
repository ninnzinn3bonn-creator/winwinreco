(function initMicPresetsNamespace() {
    const captureModes = {
        smartphone: {
            key: 'smartphone',
            label: 'スマホ本体',
            shortLabel: 'スマホ',
            description: '内蔵マイクで近くの声を録ります。',
            recommendedFor: 'iPhone / Android の内蔵マイク',
            bestPractices: [
                '口元から 15〜20cm を目安に持ちます。',
                'スピーカー音量は必要最小限にします。'
            ],
            constraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.009,
                max: 0.85,
                adaptiveFloor: 0.005,
                adaptiveCeiling: 0.018,
                noiseMultiplier: 2.6
            },
            vad: {
                attackFrames: 1,
                minActiveFrames: 1,
                releaseFrames: 7,
                crestMin: 1.1,
                crestMax: 30
            },
            stt: {
                microphoneDistance: 'NEARFIELD',
                recordingDeviceType: 'SMARTPHONE'
            }
        },
        personal: {
            key: 'personal',
            label: 'ピン・ヘッドセット',
            shortLabel: '個人マイク',
            description: '口元に近い個人用マイクで録ります。',
            recommendedFor: 'ピンマイク、有線イヤホンマイク、ヘッドセット',
            bestPractices: [
                'マイクは口元 5〜10cm に固定します。',
                '衣擦れやケーブルの接触音を避けます。'
            ],
            constraints: {
                echoCancellation: false,
                noiseSuppression: true,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.008,
                max: 0.9,
                adaptiveFloor: 0.004,
                adaptiveCeiling: 0.016,
                noiseMultiplier: 2.4
            },
            vad: {
                attackFrames: 1,
                minActiveFrames: 1,
                releaseFrames: 6,
                crestMin: 1.2,
                crestMax: 24
            },
            stt: {
                microphoneDistance: 'NEARFIELD',
                recordingDeviceType: 'OTHER_INDOOR_DEVICE'
            }
        },
        tabletop: {
            key: 'tabletop',
            label: '卓上マイク',
            shortLabel: '卓上',
            description: '中央に置いたマイクで複数人の声を録ります。',
            recommendedFor: '卓上マイク、代表マイク、会議室全体',
            bestPractices: [
                'マイクを参加者の中央に置きます。',
                '発言が重ならないよう、少し間を置きます。'
            ],
            constraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.005,
                max: 0.88,
                adaptiveFloor: 0.0025,
                adaptiveCeiling: 0.01,
                noiseMultiplier: 2.2
            },
            vad: {
                attackFrames: 1,
                minActiveFrames: 1,
                releaseFrames: 10,
                crestMin: 1.0,
                crestMax: 35
            },
            stt: {
                microphoneDistance: 'FARFIELD',
                recordingDeviceType: 'OTHER_INDOOR_DEVICE'
            }
        }
    };

    const legacyPresetMap = {
        smartphone: 'smartphone',
        pin_mic: 'personal',
        wired_headset: 'personal',
        large_group: 'tabletop',
        echo_room: 'tabletop',
        personal: 'personal',
        tabletop: 'tabletop'
    };

    function normalizePresetKey(key) {
        return legacyPresetMap[key] || null;
    }

    function resolvePreset(key, reverberant = false) {
        const normalizedKey = normalizePresetKey(key) || 'personal';
        const base = captureModes[normalizedKey];
        const constraints = { ...base.constraints };
        const thresholds = { ...base.thresholds };
        const vad = { ...base.vad };

        if (reverberant) {
            constraints.echoCancellation = true;
            constraints.noiseSuppression = true;
            constraints.autoGainControl = false;
            thresholds.min = Math.max(thresholds.adaptiveFloor, thresholds.min * 0.85);
            vad.releaseFrames += 4;
            vad.crestMin = Math.min(vad.crestMin, 0.95);
            vad.crestMax = Math.max(vad.crestMax, 40);
        }

        return {
            ...base,
            key: normalizedKey,
            label: reverberant ? `${base.label}（反響あり）` : base.label,
            description: reverberant
                ? `${base.description}反響を抑え、語尾を長めに保持します。`
                : base.description,
            constraints,
            thresholds,
            vad,
            reverberant: !!reverberant
        };
    }

    const requirements = [
        'HTTPS もしくは localhost で開く',
        '最新の Safari / Chrome 系ブラウザを使う',
        'スマホは画面スリープ前にマイク設定を済ませる',
        '反響が強い部屋ではマイクを話者に近づける'
    ];

    window.AppMicPresets = {
        defaultDesktop: 'personal',
        defaultMobile: 'smartphone',
        presets: captureModes,
        captureModes,
        normalizePresetKey,
        resolvePreset,
        legacyEchoPreset: 'echo_room',
        requirements
    };
})();
