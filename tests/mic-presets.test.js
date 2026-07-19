'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMicPresets() {
    const context = { window: {} };
    const source = fs.readFileSync(path.resolve(__dirname, '../src/frontend/mic-presets.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'mic-presets.js' });
    return context.window.AppMicPresets;
}

describe('microphone capture modes', () => {
    test('exposes only the three user-facing microphone choices', () => {
        const config = loadMicPresets();

        expect(Object.keys(config.captureModes)).toEqual(['smartphone', 'personal', 'tabletop']);
        expect(config.defaultMobile).toBe('smartphone');
        expect(config.defaultDesktop).toBe('personal');
    });

    test.each([
        ['pin_mic', 'personal'],
        ['wired_headset', 'personal'],
        ['large_group', 'tabletop'],
        ['echo_room', 'tabletop']
    ])('migrates legacy preset %s to %s', (legacy, expected) => {
        const config = loadMicPresets();
        expect(config.normalizePresetKey(legacy)).toBe(expected);
    });

    test('reverberant mode enables echo processing and lengthens speech release', () => {
        const config = loadMicPresets();
        const normal = config.resolvePreset('tabletop', false);
        const reverberant = config.resolvePreset('tabletop', true);

        expect(reverberant.constraints.echoCancellation).toBe(true);
        expect(reverberant.constraints.noiseSuppression).toBe(true);
        expect(reverberant.constraints.autoGainControl).toBe(false);
        expect(reverberant.vad.releaseFrames).toBeGreaterThan(normal.vad.releaseFrames);
        expect(reverberant.thresholds.min).toBeLessThanOrEqual(normal.thresholds.min);
    });
});
