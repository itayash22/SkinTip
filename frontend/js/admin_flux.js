document.addEventListener('DOMContentLoaded', () => {
    const csvFileInput = document.getElementById('csv-file-input');
    const submitCsvButton = document.getElementById('submit-csv-button');
    const loadingIndicator = document.getElementById('loading-indicator');
    const resultsSection = document.getElementById('results-section');
    const infoBanner = document.getElementById('info-banner');
    const imagesContainer = document.getElementById('images-container');
    const pickOfTheLitterOptions = document.getElementById('pick-of-the-litter-options');
    const iterationFeedbackInput = document.getElementById('iteration-feedback-input');
    const submitFeedbackButton = document.getElementById('submit-feedback-button');
    const copyParamsButton = document.getElementById('copy-params-button');

    let originalCsvData = null;
    let originalFileName = '';
    let testResults = null;

    submitCsvButton.addEventListener('click', async () => {
        const file = csvFileInput.files[0];
        if (!file) {
            alert('Please select a CSV file.');
            return;
        }

        originalFileName = file.name;
        const reader = new FileReader();
        reader.onload = async (event) => {
            originalCsvData = event.target.result;

            loadingIndicator.style.display = 'block';
            resultsSection.style.display = 'none';
            submitCsvButton.disabled = true;

            try {
                const response = await fetch('/hillflux-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ csvData: originalCsvData, fileName: originalFileName })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'An error occurred during testing.');
                }

                testResults = await response.json();
                displayResults(testResults);

            } catch (error) {
                alert(`Error: ${error.message}`);
            } finally {
                loadingIndicator.style.display = 'none';
                submitCsvButton.disabled = false;
            }
        };
        reader.readAsText(file);
    });

    function displayResults(data) {
        // Clear previous results
        imagesContainer.innerHTML = '';
        pickOfTheLitterOptions.innerHTML = '';
        infoBanner.textContent = '';

        // Display info banner
        const roundNumber = originalFileName.match(/round_(\d+)/)[1];
        infoBanner.textContent = `Round ${roundNumber} — Engine: ${data.engineCallMode} | Focus: ${data.engineSwitchReason}`;

        // Display images and create radio buttons
        data.results.forEach((result, index) => {
            const imageId = `image_${index + 1}`;

            const imageContainer = document.createElement('div');
            imageContainer.classList.add('image-result');

            const img = document.createElement('img');
            img.src = result.output_url;
            imageContainer.appendChild(img);

            const params = document.createElement('p');
            params.textContent = `Params: scale=${result.params.global_scale_up}, mask_grow_pct=${result.params.model_mask_grow_pct}, brightness=${result.params.bake_tattoo_brightness}`;
            imageContainer.appendChild(params);

            imagesContainer.appendChild(imageContainer);

            const radioLabel = document.createElement('label');
            const radioButton = document.createElement('input');
            radioButton.type = 'radio';
            radioButton.name = 'pick-of-the-litter';
            radioButton.value = imageId;
            radioLabel.appendChild(radioButton);
            radioLabel.appendChild(document.createTextNode(imageId));
            pickOfTheLitterOptions.appendChild(radioLabel);
        });

        resultsSection.style.display = 'block';
        copyParamsButton.style.display = 'none'; // Hide until a selection is made
    }

    submitFeedbackButton.addEventListener('click', async () => {
        const selectedImage = document.querySelector('input[name="pick-of-the-litter"]:checked');
        if (!selectedImage) {
            alert('Please select the best image.');
            return;
        }

        const feedback = iterationFeedbackInput.value;
        if (!feedback) {
            alert('Please provide feedback.');
            return;
        }

        try {
            const response = await fetch('/update-hillflux-csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csvData: originalCsvData,
                    pickOfTheLitter: selectedImage.value,
                    iterationFeedback: feedback,
                    fileName: originalFileName
                })
            });

            if (!response.ok) {
                throw new Error('Failed to update CSV.');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            const updatedFileName = originalFileName.replace('.csv', '_updated.csv');
            a.download = updatedFileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            alert('Updated CSV downloaded successfully!');

        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    });

    pickOfTheLitterOptions.addEventListener('change', () => {
        copyParamsButton.style.display = 'inline-block';
    });

    copyParamsButton.addEventListener('click', () => {
        const selectedImage = document.querySelector('input[name="pick-of-the-litter"]:checked');
        if (!selectedImage || !testResults) {
            alert('Please select an image first.');
            return;
        }

        const selectedImageId = selectedImage.value;
        const selectedResult = testResults.results.find(r => r.image_id === selectedImageId);

        if (selectedResult) {
            localStorage.setItem('copiedFluxParams', JSON.stringify(selectedResult.params));
            alert('Parameters copied to clipboard (localStorage)!');
        } else {
            alert('Could not find parameters for the selected image.');
        }
    });
});