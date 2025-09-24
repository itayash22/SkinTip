// frontend/js/admin.js
const utils = {
    showError: (message) => {
        alert(`Error: ${message}`);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const adminSection = document.getElementById('dashboardSection');
    const fluxSettingsForm = document.getElementById('fluxSettingsForm');
    const historyContainer = document.getElementById('historyContainer');

    // --- Authentication ---
    if (!STATE.token) {
        window.location.href = 'index.html';
        return;
    }

    const decodedToken = jwt_decode(STATE.token);
    if (!decodedToken || !STATE.user.is_admin) {
         alert('You are not authorized to view this page.');
         window.location.href = 'index.html';
         return;
    }

    adminSection.style.display = 'block';

    // --- UI Helpers ---
    const setupRangeSlider = (sliderId, displayId) => {
        const slider = document.getElementById(sliderId);
        const display = document.getElementById(displayId);
        if (slider && display) {
            display.textContent = slider.value;
            slider.addEventListener('input', () => {
                display.textContent = slider.value;
            });
        }
    };

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

        // Explicitly set each slider and its corresponding display value
        const updateSlider = (sliderId, displayId, value) => {
            const slider = document.getElementById(sliderId);
            const display = document.getElementById(displayId);
            if (slider && display) {
                slider.value = value;
                display.textContent = value;
            }
        };

        updateSlider('globalScaleUp', 'globalScaleUpValue', settings.behaviorFlags.globalScaleUp);
        updateSlider('engineKontextSizeBias', 'engineKontextSizeBiasValue', settings.engineSizeBias.kontext);
        updateSlider('engineFillSizeBias', 'engineFillSizeBiasValue', settings.engineSizeBias.fill);
        updateSlider('modelMaskGrowPct', 'modelMaskGrowPctValue', settings.maskGrow.pct);
        updateSlider('modelMaskGrowMin', 'modelMaskGrowMinValue', settings.maskGrow.min);
        updateSlider('modelMaskGrowMax', 'modelMaskGrowMaxValue', settings.maskGrow.max);
        updateSlider('bakeTattooBrightness', 'bakeTattooBrightnessValue', settings.bakeTuning.brightness);
        updateSlider('bakeTattooGamma', 'bakeTattooGammaValue', settings.bakeTuning.gamma);
        updateSlider('bakeOverlayOpacity', 'bakeOverlayOpacityValue', settings.bakeTuning.overlayOpacity);
        updateSlider('bakeSoftlightOpacity', 'bakeSoftlightOpacityValue', settings.bakeTuning.softlightOpacity);
        updateSlider('bakeMultiplyOpacity', 'bakeMultiplyOpacityValue', settings.bakeTuning.multiplyOpacity);
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

    // --- Initialize ---
    fetchSettings();
    fetchHistory();
});