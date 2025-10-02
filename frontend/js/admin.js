// frontend/js/admin.js

document.addEventListener('DOMContentLoaded', () => {
    const adminSection = document.getElementById('dashboardSection');
    const fluxSettingsForm = document.getElementById('fluxSettingsForm');
    const historyContainer = document.getElementById('historyContainer');

    // Hill Climbing State
    let hillClimbingState = {
        baseParams: null,
        tattooImage: null,
        skinImage: null,
        mask: null,
        activeGroupIndex: 0,
        paramIndex: 0,
        paramGroups: {
            'Core Blend & Appearance': ['bakeTuning.brightness', 'bakeTuning.gamma', 'bakeTuning.overlayOpacity', 'bakeTuning.softlightOpacity', 'bakeTuning.multiplyOpacity'],
            'Sizing & Scaling': ['behaviorFlags.globalScaleUp', 'engineSizeBias.kontext', 'engineSizeBias.fill']
        }
    };

    // --- Authentication ---
    if (!STATE.token) {
        window.location.href = 'index.html';
        return;
    }

    if (!STATE.user || !STATE.user.is_admin) {
         alert('You are not authorized to view this page.');
         window.location.href = 'index.html';
         return;
    }

    adminSection.style.display = 'block';

    // --- Fetch and Populate Settings ---
    const fetchSettings = async () => {
        try {
            const response = await fetch(`${CONFIG.API_URL}/admin/flux-settings`, {
                headers: {
                    'Authorization': `Bearer ${STATE.token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch settings: ${response.statusText}`);
            }

            const settings = await response.json();
            console.log('Fetched settings:', settings); // Log the settings to the console
            populateForm(settings);

        } catch (error) {
            console.error('Error fetching settings:', error);
            utils.showError('Could not load FLUX settings.');
        }
    };

    const populateForm = (settings) => {
        if (!settings) {
            utils.showError("Received invalid settings from server.");
            return;
        }

        document.getElementById('prompt').value = settings.prompt;
        document.getElementById('adaptiveScaleEnabled').checked = settings.behaviorFlags.adaptiveScaleEnabled;
        document.getElementById('adaptiveEngineEnabled').checked = settings.behaviorFlags.adaptiveEngineEnabled;
        document.getElementById('fluxEngineDefault').value = settings.behaviorFlags.fluxEngineDefault;

        // Set slider values and then set up the display text
        const setupSliderWithValue = (sliderId, displayId, value) => {
            const slider = document.getElementById(sliderId);
            const display = document.getElementById(displayId);
            if (slider && display) {
                slider.value = value;
                display.textContent = value;
                slider.addEventListener('input', () => {
                    display.textContent = slider.value;
                });
            }
        };

        setupSliderWithValue('globalScaleUp', 'globalScaleUpValue', settings.behaviorFlags.globalScaleUp);
        setupSliderWithValue('engineKontextSizeBias', 'engineKontextSizeBiasValue', settings.engineSizeBias.kontext);
        setupSliderWithValue('engineFillSizeBias', 'engineFillSizeBiasValue', settings.engineSizeBias.fill);
        setupSliderWithValue('modelMaskGrowPct', 'modelMaskGrowPctValue', settings.maskGrow.pct);
        setupSliderWithValue('modelMaskGrowMin', 'modelMaskGrowMinValue', settings.maskGrow.min);
        setupSliderWithValue('modelMaskGrowMax', 'modelMaskGrowMaxValue', settings.maskGrow.max);
        setupSliderWithValue('bakeTattooBrightness', 'bakeTattooBrightnessValue', settings.bakeTuning.brightness);
        setupSliderWithValue('bakeTattooGamma', 'bakeTattooGammaValue', settings.bakeTuning.gamma);
        setupSliderWithValue('bakeOverlayOpacity', 'bakeOverlayOpacityValue', settings.bakeTuning.overlayOpacity);
        setupSliderWithValue('bakeSoftlightOpacity', 'bakeSoftlightOpacityValue', settings.bakeTuning.softlightOpacity);
        setupSliderWithValue('bakeMultiplyOpacity', 'bakeMultiplyOpacityValue', settings.bakeTuning.multiplyOpacity);
    };

    // --- Form Submission ---
    fluxSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(fluxSettingsForm);
        const settings = {
            prompt: formData.get('prompt'),
            behaviorFlags: {
                adaptiveScaleEnabled: document.getElementById('adaptiveScaleEnabled').checked,
                adaptiveEngineEnabled: document.getElementById('adaptiveEngineEnabled').checked,
                globalScaleUp: parseFloat(formData.get('globalScaleUp')),
                fluxEngineDefault: formData.get('fluxEngineDefault'),
            },
            engineSizeBias: {
                kontext: parseFloat(formData.get('engineKontextSizeBias')),
                fill: parseFloat(formData.get('engineFillSizeBias')),
            },
            maskGrow: {
                pct: parseFloat(formData.get('modelMaskGrowPct')),
                min: parseInt(formData.get('modelMaskGrowMin')),
                max: parseInt(formData.get('modelMaskGrowMax')),
            },
            bakeTuning: {
                brightness: parseFloat(formData.get('bakeTattooBrightness')),
                gamma: parseFloat(formData.get('bakeTattooGamma')),
                overlayOpacity: parseFloat(formData.get('bakeOverlayOpacity')),
                softlightOpacity: parseFloat(formData.get('bakeSoftlightOpacity')),
                multiplyOpacity: parseFloat(formData.get('bakeMultiplyOpacity')),
            }
        };

        try {
            const response = await fetch(`${CONFIG.API_URL}/admin/flux-settings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${STATE.token}`
                },
                body: JSON.stringify(settings)
            });

            if (!response.ok) {
                throw new Error('Failed to save settings');
            }

            alert('Settings saved successfully!');
            fetchHistory(); // Refresh history
        } catch (error) {
            console.error('Error saving settings:', error);
            utils.showError('Could not save FLUX settings.');
        }
    });

    // --- History ---
    const fetchHistory = async () => {
        try {
            const response = await fetch(`${CONFIG.API_URL}/admin/flux-settings/history`, {
                headers: {
                    'Authorization': `Bearer ${STATE.token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch history');
            }

            const history = await response.json();
            displayHistory(history);

        } catch (error) {
            console.error('Error fetching history:', error);
            utils.showError('Could not load settings history.');
        }
    };

    const displayHistory = (history) => {
        historyContainer.innerHTML = '';
        if (history.length === 0) {
            historyContainer.innerHTML = '<p>No history found.</p>';
            return;
        }

        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Changed By</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        `;
        const tbody = table.querySelector('tbody');

        history.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(item.changed_at).toLocaleString()}</td>
                <td>${item.users.username}</td>
                <td><button class="btn btn-sm btn-outline" data-history-id="${item.id}">Rollback</button></td>
            `;
            tbody.appendChild(tr);
        });

        historyContainer.appendChild(table);
    };

    historyContainer.addEventListener('click', async (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.historyId) {
            const historyId = e.target.dataset.historyId;
            if (confirm('Are you sure you want to rollback to this version?')) {
                try {
                    const response = await fetch(`${CONFIG.API_URL}/admin/flux-settings/rollback/${historyId}`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${STATE.token}`
                        }
                    });

                    if (!response.ok) {
                        throw new Error('Failed to rollback settings');
                    }

                    alert('Settings rolled back successfully!');
                    fetchSettings(); // Refresh form with rolled back settings
                    fetchHistory(); // Refresh history
                } catch (error) {
                    console.error('Error rolling back settings:', error);
                    utils.showError('Could not rollback settings.');
                }
            }
        }
    });

    // --- Hill Climbing ---
    const setupCanvasBtn = document.getElementById('setupCanvasBtn');
    const drawingSection = document.getElementById('drawingSection');
    const startHillClimbingBtn = document.getElementById('startHillClimbing');
    const hillClimbingWorkspace = document.getElementById('hillClimbingWorkspace');
    const hillClimbingResults = document.getElementById('hillClimbingResults');
    const currentTestInfo = document.getElementById('currentTestInfo');
    const lockAndTestNextBtn = document.getElementById('lockAndTestNext');

    setupCanvasBtn.addEventListener('click', () => {
        const tattooImageFile = document.getElementById('tattooImage').files[0];
        const skinImageFile = document.getElementById('skinImage').files[0];

        if (!tattooImageFile || !skinImageFile) {
            utils.showError('Please select both a tattoo and a skin image.');
            return;
        }

        hillClimbingState.tattooImage = tattooImageFile;
        hillClimbingState.skinImage = skinImageFile;

        const tattooUrl = URL.createObjectURL(tattooImageFile);
        const skinUrl = URL.createObjectURL(skinImageFile);

        drawingSection.style.display = 'block';
        adminDrawing.init('adminDrawingCanvas', skinUrl, tattooUrl);
    });

    document.getElementById('adminRotationSlider').addEventListener('input', (e) => adminDrawing.setRotation(e.target.value));
    document.getElementById('adminSizeSlider').addEventListener('input', (e) => adminDrawing.setScale(e.target.value / 100));

    startHillClimbingBtn.addEventListener('click', async () => {
        hillClimbingState.mask = adminDrawing.generateMask();

        // Get the current form values as the starting point
        const formData = new FormData(fluxSettingsForm);
        hillClimbingState.baseParams = {
            prompt: formData.get('prompt'),
            tattooAngle: 0,
            tattooScale: 1.0,
            behaviorFlags: {
                adaptiveScaleEnabled: document.getElementById('adaptiveScaleEnabled').checked,
                adaptiveEngineEnabled: document.getElementById('adaptiveEngineEnabled').checked,
                globalScaleUp: parseFloat(formData.get('globalScaleUp')),
                fluxEngineDefault: formData.get('fluxEngineDefault'),
            },
            engineSizeBias: {
                kontext: parseFloat(formData.get('engineKontextSizeBias')),
                fill: parseFloat(formData.get('engineFillSizeBias')),
            },
            maskGrow: {
                pct: parseFloat(formData.get('modelMaskGrowPct')),
                min: parseInt(formData.get('modelMaskGrowMin')),
                max: parseInt(formData.get('modelMaskGrowMax')),
            },
            bakeTuning: {
                brightness: parseFloat(formData.get('bakeTattooBrightness')),
                gamma: parseFloat(formData.get('bakeTattooGamma')),
                overlayOpacity: parseFloat(formData.get('bakeOverlayOpacity')),
                softlightOpacity: parseFloat(formData.get('bakeSoftlightOpacity')),
                multiplyOpacity: parseFloat(formData.get('bakeMultiplyOpacity')),
            }
        };

        drawingSection.style.display = 'none';
        hillClimbingWorkspace.style.display = 'block';
        runHillClimbIteration();
    });

    const runHillClimbIteration = async () => {
        const activeGroupKey = Object.keys(hillClimbingState.paramGroups)[hillClimbingState.activeGroupIndex];
        const activeGroup = hillClimbingState.paramGroups[activeGroupKey];
        const paramToTest = activeGroup[hillClimbingState.paramIndex];
        currentTestInfo.textContent = `Testing Group: ${activeGroupKey} - Parameter: ${paramToTest}`;

        const formData = new FormData();
        formData.append('tattooImage', hillClimbingState.tattooImage);
        formData.append('skinImage', hillClimbingState.skinImage);
        formData.append('jsonData', JSON.stringify({
            baseParams: hillClimbingState.baseParams,
            activeGroup: activeGroupKey,
            paramIndex: hillClimbingState.paramIndex,
            mask: hillClimbingState.mask
        }));

        try {
            const response = await fetch(`${CONFIG.API_URL}/admin/hill-climb`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${STATE.token}` },
                body: formData
            });

            if (!response.ok) {
                throw new Error('Hill climb generation failed');
            }

            const results = await response.json();
            displayHillClimbResults(results);
        } catch (error) {
            console.error('Hill climb error:', error);
            utils.showError('Failed to generate hill climb variations.');
        }
    };

    const displayHillClimbResults = (results) => {
        hillClimbingResults.innerHTML = '';
        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            resultItem.innerHTML = `
                <img src="${result.imageUrl}" alt="${result.label}">
                <button class="btn btn-sm btn-primary" data-params='${JSON.stringify(result.params)}'>Choose</button>
            `;
            hillClimbingResults.appendChild(resultItem);
        });
    };

    hillClimbingResults.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const chosenParams = JSON.parse(e.target.dataset.params);

            // If "no change" was chosen, move to the next parameter in the group
            if (JSON.stringify(chosenParams) === JSON.stringify(hillClimbingState.baseParams)) {
                const activeGroup = hillClimbingState.paramGroups[Object.keys(hillClimbingState.paramGroups)[hillClimbingState.activeGroupIndex]];
                hillClimbingState.paramIndex = (hillClimbingState.paramIndex + 1) % activeGroup.length;
            } else {
                hillClimbingState.baseParams = chosenParams;
            }

            runHillClimbIteration();
        }
    });

    lockAndTestNextBtn.addEventListener('click', () => {
        hillClimbingState.activeGroupIndex = (hillClimbingState.activeGroupIndex + 1) % Object.keys(hillClimbingState.paramGroups).length;
        hillClimbingState.paramIndex = 0; // Reset param index for new group
        runHillClimbIteration();
    });

    // --- Preset Management ---
    const savePresetBtn = document.getElementById('savePreset');
    const presetNameInput = document.getElementById('presetName');
    const presetsList = document.getElementById('presetsList');
    const uploadPresetInput = document.getElementById('uploadPreset');

    const fetchPresets = async () => {
        try {
            const response = await fetch(`${CONFIG.API_URL}/admin/presets`, {
                headers: { 'Authorization': `Bearer ${STATE.token}` }
            });
            const presets = await response.json();
            displayPresets(presets);
        } catch (error) {
            utils.showError('Failed to fetch presets.');
        }
    };

    const displayPresets = (presets) => {
        presetsList.innerHTML = '';
        presets.forEach(preset => {
            const presetEl = document.createElement('div');
            presetEl.innerHTML = `
                <span>${preset.preset_name}</span>
                <button data-id="${preset.id}" class="load-preset">Load</button>
                <button data-id="${preset.id}" class="download-preset">Download CSV</button>
                <button data-id="${preset.id}" class="set-default">Set as Default</button>
            `;
            presetsList.appendChild(presetEl);
        });
    };

    savePresetBtn.addEventListener('click', async () => {
        const presetName = presetNameInput.value;
        if (!presetName) {
            utils.showError('Please enter a name for the preset.');
            return;
        }
        try {
            await fetch(`${CONFIG.API_URL}/admin/presets`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${STATE.token}`
                },
                body: JSON.stringify({
                    preset_name: presetName,
                    parameters: hillClimbingState.baseParams
                })
            });
            fetchPresets();
        } catch (error) {
            utils.showError('Failed to save preset.');
        }
    });

    presetsList.addEventListener('click', async (e) => {
        const { id } = e.target.dataset;
        if (e.target.classList.contains('load-preset')) {
            try {
                const response = await fetch(`${CONFIG.API_URL}/admin/presets`, {
                    headers: { 'Authorization': `Bearer ${STATE.token}` }
                });
                const presets = await response.json();
                const preset = presets.find(p => p.id == id);
                if (preset) {
                    hillClimbingState.baseParams = preset.parameters;
                    populateForm(preset.parameters);
                    alert(`Preset "${preset.preset_name}" loaded.`);
                }
            } catch (error) {
                utils.showError('Failed to load preset.');
            }
        } else if (e.target.classList.contains('set-default')) {
            try {
                await fetch(`${CONFIG.API_URL}/admin/presets/${id}/set-default`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${STATE.token}` }
                });
                alert('Default settings updated.');
            } catch (error) {
                utils.showError('Failed to set default settings.');
            }
        } else if (e.target.classList.contains('download-preset')) {
            try {
                const response = await fetch(`${CONFIG.API_URL}/admin/presets/${id}/download`, {
                    headers: { 'Authorization': `Bearer ${STATE.token}` }
                });
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `${e.target.parentElement.querySelector('span').textContent}.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
            } catch (error) {
                utils.showError('Failed to download preset.');
            }
        }
    });

    uploadPresetInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const csv = event.target.result;
                const lines = csv.split('\n').slice(1); // Skip header row
                const params = {
                    behaviorFlags: {},
                    engineSizeBias: {},
                    maskGrow: {},
                    bakeTuning: {}
                };
                lines.forEach(line => {
                    const [key, value] = line.split(',');
                    if (key.includes('.')) {
                        const [mainKey, subKey] = key.split('.');
                        if (params[mainKey]) {
                            params[mainKey][subKey] = isNaN(value) ? value : parseFloat(value);
                        }
                    } else {
                        params[key] = value;
                    }
                });
                hillClimbingState.baseParams = params;
                populateForm(params);
                alert('Preset loaded from CSV.');
            };
            reader.readAsText(file);
        }
    });

    // --- Initialize ---
    fetchSettings();
    fetchHistory();
    fetchPresets();
});