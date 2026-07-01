(function initMicPresetsNamespace() {
    /*
     * Each preset bundles three layers of configuration:
     *
     *   constraints  — getUserMedia audio constraints (echo cancellation,
     *                  noise suppression, AGC, sample rate, channel count)
     *   thresholds   — RMS gate (open above min, clip at max). Values are
     *                  on a 0..1 scale matching the WebAudio float buffer.
     *   vad          — front-end voice activity detector behavior:
     *                    attackFrames     — consecutive speech-like frames
     *                                       required to open the gate (1
     *                                       frame ≈ 85 ms at 48 kHz / 4096).
     *                    minActiveFrames  — minimum sustained active frames
     *                                       before audio is sent. 1 = no
     *                                       drop. 3 ≈ 250 ms.
     *                    crestMin/Max     — peak/RMS ratio bounds for a
     *                                       speech-like frame. Distant /
     *                                       reverberant audio has a low
     *                                       crest, so far-field presets
     *                                       use loose bounds.
     *   stt          — backend STT metadata hints. These field names mirror
     *                  the old Google recognizer config, but production STT
     *                  is fixed to ElevenLabs Scribe.
     *
     * Tuning rationale (from STT best-practices + field testing):
     *   - Close mics (pin/wired): NEARFIELD, no AGC/NS, tight VAD, useEnhanced.
     *   - Tabletop / far group:   FARFIELD, AGC+NS on, loose VAD (catch
     *                             quiet voices), low threshold.
     *   - Echo room:              FARFIELD, echo cancellation on, medium VAD.
     *   - Smartphone handheld:    NEARFIELD, default platform processing.
     */
    const presets = {
        smartphone: {
            key: 'smartphone',
            label: 'スマホ本体',
            shortLabel: 'スマホ',
            description: 'iPhone / Android の内蔵マイク向けです。移動中や手持ちでも使いやすい設定です。',
            recommendedFor: 'スマホ単体、外出先、イヤホンなし',
            bestPractices: [
                '口元から 15〜20cm を目安に持ち、スピーカー音量は低めにします。',
                'ブラウザは最新の Safari / Chrome を使い、HTTPS で開きます。',
                '反響が強い場所では壁や机から少し離れて話します。'
            ],
            constraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.012,
                max: 0.85
            },
            vad: {
                attackFrames: 1,
                minActiveFrames: 2,
                crestMin: 1.3,
                crestMax: 14
            },
            stt: {
                microphoneDistance: 'NEARFIELD',
                recordingDeviceType: 'SMARTPHONE'
            }
        },
        pin_mic: {
            key: 'pin_mic',
            label: 'ピンマイク',
            shortLabel: 'ピンマイク',
            description: '口元のピンマイクやヘッドセット向けです。音声が最も安定しやすい推奨モードです。',
            recommendedFor: '1人1マイク、口元マイク、USB ヘッドセット',
            bestPractices: [
                'マイクは口元 5〜10cm を目安に固定し、衣擦れが入らない位置にします。',
                '近接マイクでは前処理を増やしすぎない方が、音声認識に渡す声の輪郭が安定します。',
                '机の振動やケーブル接触音を避けるため、衣服やスタンドに固定します。'
            ],
            constraints: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.01,
                max: 0.9
            },
            vad: {
                attackFrames: 2,
                minActiveFrames: 2,
                crestMin: 1.6,
                crestMax: 14
            },
            stt: {
                microphoneDistance: 'NEARFIELD',
                recordingDeviceType: 'OTHER_INDOOR_DEVICE'
            }
        },
        echo_room: {
            key: 'echo_room',
            label: '反響のある部屋',
            shortLabel: '反響室',
            description: '会議室や硬い壁の部屋など、反響と回り込みが気になる環境向けです。',
            recommendedFor: '会議室、教室、壁が硬い部屋',
            bestPractices: [
                '話者の近くにマイクを寄せ、スピーカー音はなるべく絞ります。',
                '反響が大きい場合は、端末内蔵マイクより外部マイクを優先します。',
                'エコー低減を使いながら、不要な大声や机の反射音を避けます。'
            ],
            constraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.014,
                max: 0.78
            },
            vad: {
                attackFrames: 1,
                minActiveFrames: 2,
                crestMin: 1.2,
                crestMax: 18
            },
            stt: {
                microphoneDistance: 'FARFIELD',
                recordingDeviceType: 'OTHER_INDOOR_DEVICE'
            }
        },
        large_group: {
            key: 'large_group',
            label: '大人数 / 卓上',
            shortLabel: '卓上',
            description: 'やや離れた声も拾いたい卓上マイク・代表マイク向けです。遠くの声でも拾えるよう VAD を緩めています。',
            recommendedFor: '卓上マイク、複数人が順番に話す場面',
            bestPractices: [
                '1台で全員を拾うより、できれば代表マイクを中央に置き、順番に話します。',
                '被り話しは誤認識が増えるため、発言の切れ目を作ると精度が上がります。',
                'マイクから遠い人は身を乗り出して話すか、別マイクを使う方が安定します。'
            ],
            constraints: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
            },
            // Lower min threshold so faint distant speech opens the gate;
            // higher max so we don't clip when someone leans in.
            thresholds: {
                min: 0.006,
                max: 0.88
            },
            // Loose VAD: 1 frame attack, no min-active filter, generous
            // crest range. Distant / reverberant audio has low crest factor
            // (~1.2) so the previous 1.6 floor was rejecting real speech.
            vad: {
                attackFrames: 1,
                minActiveFrames: 1,
                crestMin: 1.05,
                crestMax: 30
            },
            stt: {
                microphoneDistance: 'FARFIELD',
                recordingDeviceType: 'OTHER_INDOOR_DEVICE'
            }
        },
        wired_headset: {
            key: 'wired_headset',
            label: '有線ヘッドセット',
            shortLabel: '有線',
            description: '口元に近い有線ヘッドセット向けです。スマホでも安定しやすい構成です。',
            recommendedFor: 'スマホ + 有線イヤホンマイク、PC + ヘッドセット',
            bestPractices: [
                '口元 3〜5cm に固定し、息が直接当たりすぎない位置にします。',
                '端末のスピーカーではなく、イヤホン出力を使うと回り込みを減らせます。',
                '会議前にメーターで入力レベルを見て、赤い線を越えすぎないようにします。'
            ],
            constraints: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 16000
            },
            thresholds: {
                min: 0.011,
                max: 0.86
            },
            vad: {
                attackFrames: 2,
                minActiveFrames: 2,
                crestMin: 1.6,
                crestMax: 14
            },
            stt: {
                microphoneDistance: 'NEARFIELD',
                recordingDeviceType: 'OTHER_INDOOR_DEVICE'
            }
        }
    };

    const requirements = [
        'HTTPS もしくは localhost で開く',
        '最新の Safari / Chrome 系ブラウザを使う',
        'スマホは画面スリープ前にマイク確認を済ませる',
        '可能なら 1人1マイク。口元マイクが最も安定',
        '反響が強い部屋では外部マイクを優先'
    ];

    window.AppMicPresets = {
        defaultDesktop: 'pin_mic',
        defaultMobile: 'smartphone',
        presets,
        requirements
    };
})();
