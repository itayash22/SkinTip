document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin JS loaded.');

    // --- STATE ---
    let csvFileContent = null;
    let tattooImageFile = null;
    let skinImageFile = null;
    let lastCsvFileName = '';

    // --- DOM ELEMENTS ---
    const csvUploadArea = document.getElementById('csvUploadArea');
    const csvFileInput = document.getElementById('csvFileInput');
    const imageUploadContainer = document.querySelector('.image-upload-container');
    const tattooImageInput = document.getElementById('tattooImageInput');
    const skinImageInput = document.getElementById('skinImageInput');
    const runHillFluxBtn = document.getElementById('runHillFluxBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const resultsSection = document.getElementById('resultsSection');
    const resultsHeader = document.getElementById('resultsHeader');
    const infoBanner = document.getElementById('infoBanner');
    const resultsGrid = document.querySelector('.results-grid');
    const feedbackSection = document.getElementById('feedbackSection');

    // --- UTILS ---
    const showLoading = (text) => {
        loadingText.textContent = text || 'Processing...';
        loadingOverlay.style.display = 'flex';
    };

    const hideLoading = () => {
        loadingOverlay.style.display = 'none';
    };

    const showAlert = (message, type = 'error') => {
        // Simple alert for now, can be replaced with a nicer modal
        alert(`[${type.toUpperCase()}] ${message}`);
    };

    const updateRunButtonState = () => {
        if (csvFileContent && tattooImageFile && skinImageFile) {
            runHillFluxBtn.disabled = false;
        } else {
            runHillFluxBtn.disabled = true;
        }
    };

    // --- EVENT LISTENERS ---
    csvUploadArea.addEventListener('click', () => csvFileInput.click());

    csvFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            lastCsvFileName = file.name;
            const reader = new FileReader();
            reader.onload = (e) => {
                csvFileContent = e.target.result;
                csvUploadArea.querySelector('p').textContent = `CSV Loaded: ${file.name}`;
                imageUploadContainer.style.display = 'block';
                updateRunButtonState();
            };
            reader.onerror = () => {
                showAlert('Failed to read the CSV file.');
                csvFileContent = null;
                updateRunButtonState();
            };
            reader.readAsText(file);
        }
    });

    tattooImageInput.addEventListener('change', (event) => {
        tattooImageFile = event.target.files[0];
        updateRunButtonState();
    });

    skinImageInput.addEventListener('change', (event) => {
        skinImageFile = event.target.files[0];
        updateRunButtonState();
    });

    runHillFluxBtn.addEventListener('click', async () => {
        if (!csvFileContent || !tattooImageFile || !skinImageFile) {
            showAlert('Please provide a CSV file, a tattoo image, and a skin image.');
            return;
        }

        // A placeholder for getting the auth token.
        // In a real app, you'd get this from localStorage or a state management solution.
        const token = localStorage.getItem('token');
        if (!token) {
            showAlert('Authentication token not found. Please log in.');
            // Potentially redirect to login page
            return;
        }

        showLoading('Uploading images and processing CSV...');

        const formData = new FormData();
        formData.append('csvData', csvFileContent);
        formData.append('tattooImage', tattooImageFile);
        formData.append('skinImage', skinImageFile);

        try {
            const response = await fetch('/api/admin/hill-climb', {
                method: 'POST',
                headers: {
                    // 'Content-Type' is automatically set by the browser when using FormData
                    'Authorization': `Bearer ${token}`
                },
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.details || errorData.error || 'The server returned an error.');
            }

            const results = await response.json();
            displayResults(results);

        } catch (error) {
            console.error('HillFlux run failed:', error);
            showAlert(`An error occurred: ${error.message}`);
        } finally {
            hideLoading();
        }
    });


    // --- UI RENDERING ---
    function displayResults(data) {
        // Extract round number from the original filename
        const roundMatch = lastCsvFileName.match(/round_(\d+)/i);
        const roundNumber = roundMatch ? parseInt(roundMatch[1], 10) : 'N/A';
        resultsHeader.textContent = `Round ${roundNumber} Results`;

        // Show info banner
        infoBanner.textContent = `Engine Call Mode: ${data.engine_call_mode} | Reason: ${data.engine_switch_reason}`;
        infoBanner.style.display = 'block';

        // Clear previous results
        resultsGrid.innerHTML = '';
        const pickOfTheLitterContainer = document.getElementById('pickOfTheLitter');
        pickOfTheLitterContainer.innerHTML = '';


        // Populate results grid and feedback radio buttons
        data.images.forEach((imageResult, index) => {
            const paramsHtml = `<pre>${JSON.stringify(imageResult.params, null, 2)}</pre>`;
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            resultItem.innerHTML = `
                <img src="${imageResult.url}" alt="Generated image for ${imageResult.image_id}">
                <div class="params">
                    <h4>${imageResult.image_id}</h4>
                    ${paramsHtml}
                    <button class="btn btn-secondary btn-sm copy-btn" data-params='${JSON.stringify(imageResult.params)}'>Copy Params</button>
                </div>
            `;
            resultsGrid.appendChild(resultItem);

            // Populate radio buttons
            const radioLabel = document.createElement('label');
            const radioButton = document.createElement('input');
            radioButton.type = 'radio';
            radioButton.name = 'pickOfTheLitter';
            radioButton.value = imageResult.image_id;
            if (index === 0) {
                radioButton.checked = true; // Default check the first one
            }
            radioLabel.appendChild(radioButton);
            radioLabel.append(` ${imageResult.image_id}`);
            pickOfTheLitterContainer.appendChild(radioLabel);
        });

        // Show the results and feedback sections
        resultsSection.style.display = 'block';
        feedbackSection.style.display = 'block';

        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    // --- FEEDBACK FORM HANDLING ---
    const feedbackForm = document.getElementById('feedbackForm');
    feedbackForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        showLoading('Updating CSV...');

        const formData = new FormData(event.target);
        const pickOfTheLitter = formData.get('pickOfTheLitter');
        const iterationFeedback = document.getElementById('iterationFeedback').value;

        const token = localStorage.getItem('token');
        if (!token) {
            showAlert('Authentication token not found. Please log in.');
            hideLoading();
            return;
        }

        try {
            const response = await fetch('/api/admin/update-csv', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    csvData: csvFileContent,
                    pickOfTheLitter,
                    iterationFeedback
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.details || 'Failed to update CSV.');
            }

            const { updatedCsvString } = await response.json();

            // Trigger download
            const roundMatch = lastCsvFileName.match(/round_(\d+)/i);
            const roundNumber = roundMatch ? roundMatch[1] : 'unknown';
            const updatedFileName = `hillflux_round_${roundNumber}_updated.csv`;

            const blob = new Blob([updatedCsvString], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', updatedFileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            showAlert(`Failed to update and download CSV: ${error.message}`);
        } finally {
            hideLoading();
        }
    });

    // --- COPY PARAMS BUTTON HANDLING ---
    resultsGrid.addEventListener('click', (event) => {
        if (event.target.classList.contains('copy-btn')) {
            const button = event.target;
            const paramsString = button.dataset.params;

            if (!navigator.clipboard) {
                showAlert('Clipboard API not available in this browser.', 'warning');
                return;
            }

            if (!paramsString) {
                showAlert('No parameters found to copy.', 'error');
                return;
            }

            // The data-params attribute is already a JSON string.
            // For a slightly nicer format, we can parse and re-stringify it.
            try {
                const paramsObject = JSON.parse(paramsString);
                const formattedParams = JSON.stringify(paramsObject, null, 2);

                navigator.clipboard.writeText(formattedParams).then(() => {
                    const originalText = button.textContent;
                    button.textContent = 'Copied!';
                    button.disabled = true;
                    setTimeout(() => {
                        button.textContent = originalText;
                        button.disabled = false;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy params:', err);
                    showAlert('Failed to copy parameters to clipboard.');
                });
            } catch (e) {
                console.error('Failed to parse params from data attribute:', e);
                showAlert('Could not copy malformed parameter data.');
            }
        }
    });
});