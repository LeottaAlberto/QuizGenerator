// Variabili globali
let extractedTextContent = "";
let currentQuizData = [];
let currentQuizAnswers = [];

// Configurazione KaTeX
const katexConfig = {
    delimiters: [
        {left: "$$", right: "$$", display: true},
        {left: "$", right: "$", display: false}
    ],
    throwOnError: false
};

// --- ELEMENTI DOM (Selezione completa e sicura) ---
const fileInput = document.getElementById('fileInput');
const previewCard = document.getElementById('previewCard');
const previewTextDiv = document.getElementById('previewText');
const extractedTextCountElement = document.getElementById('extractedTextCount');
const configForm = document.getElementById('configForm');
const typeSelect = document.getElementById('typeSelect');
const optionsContainer = document.getElementById('optionsContainer');
const quizForm = document.getElementById('quizForm');
const generateBtn = document.getElementById('generateBtn');
const loadingSpinner = document.getElementById('loadingSpinner');
const quizArea = document.getElementById('quizArea');
const questionsContainer = document.getElementById('questionsContainer');
const submitQuizBtn = document.getElementById('submitQuizBtn');
// --------------------------------------------------

// Funzione helper per mostrare messaggi (sostituire alert())
function alertMessage(message, type = 'info') {
    const color = type === 'error' ? 'red' : type === 'success' ? 'green' : 'blue';
    console.error(`[MESSAGGIO ${type.toUpperCase()}] %c${message}`, `color: ${color}; font-weight: bold;`);
    alert(message);
}

// Gestione tipo risposta (Multipla/Aperta)
if (typeSelect && optionsContainer) {
    typeSelect.addEventListener('change', (e) => {
        e.target.value === 'multiple_choice' ? optionsContainer.classList.remove('d-none') : optionsContainer.classList.add('d-none');
    });
}

// --- FUNZIONE FORMATTAZIONE TESTO (Rende il PDF leggibile) ---
function formatExtractedText(rawText) {
    // 1. Divide per righe vuote (paragrafi logici)
    const paragraphs = rawText.split(/\n\s*\n/);
    let html = "";

    paragraphs.forEach(para => {
        const cleanPara = para.trim();
        if (!cleanPara) return;

        // Euristica per i Titoli: Corti (< 80 char) e non finiscono con punteggiatura classica (.,;)
        // Oppure sono tutti in maiuscolo
        const isTitle = (cleanPara.length < 80 && !/[.,;]$/.test(cleanPara)) || 
                         (cleanPara === cleanPara.toUpperCase() && cleanPara.length < 100);

        if (isTitle) {
            // Titolo: Font più grande
            html += `<h4 class="doc-title mt-4 mb-2">${cleanPara}</h4>`;
        } else {
            // Paragrafo normale
            html += `<p class="doc-text mb-3">${cleanPara}</p>`;
        }
    });
    return html;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        // Legge il file come Data URL (contiene l'header MIME e i dati Base64)
        reader.readAsDataURL(file); 
        reader.onload = () => {
            // Rimuove l'header "data:application/pdf;base64," per inviare solo i dati Base64
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = error => reject(error);
    });
}

// 1. CARICAMENTO FILE
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 1. Converti in Base64
        let base64Data;
        try {
            base64Data = await fileToBase64(file);
        } catch (error) {
            console.error("Errore lettura file Base64:", error);
            alertMessage('Errore nella lettura del file.', 'error');
            return;
        }

        if (previewCard) previewCard.style.display = 'block';
        if (previewTextDiv) previewTextDiv.innerHTML = '<div class="text-center p-3 text-muted">Extraction in progress...</div>';

        try {
            // 2. Costruisci il payload JSON (NON FormData)
            const payload = { 
                file: base64Data, 
                filename: file.name,
                mimetype: file.type 
            };

            const response = await fetch('/api/extract-text', {
                method: 'POST',
                // IMPORTANTISSIMO: L'header DEVE essere application/json
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Errore di rete o server');
            }

            const data = await response.json();
            
            extractedTextContent = data.text ? data.text.trim() : "";
            
            if (!extractedTextContent) {
                 // Errore specifico se il testo è vuoto (probabilmente PDF non contenente testo leggibile)
                throw new Error("Il file non contiene testo estraibile o il testo è vuoto. Prova un altro PDF.");
            }

            // Aggiorna l'interfaccia con il testo estratto
            if (previewTextDiv) {
                const formattedHtml = formatExtractedText(extractedTextContent.substring(0, 2000));
                
                if (formattedHtml.trim()) {
                    // Visualizzazione Formattata
                    previewTextDiv.innerHTML = formattedHtml + '... (Testo completo estratto nel backend)';
                } else {
                    // Fallback se la formattazione non produce output visibile
                    previewTextDiv.innerHTML = `
                        <p class="text-warning fw-bold">Attenzione: La formattazione automatica del testo è fallita.</p>
                        <p class="text-muted">Mostriamo i primi 500 caratteri grezzi per diagnostica:</p>
                        <pre class="doc-text bg-light p-2 rounded">${extractedTextContent.substring(0, 500)}...</pre>
                    `;
                }
            }
            
            // Usiamo l'elemento DOM selezionato all'inizio
            if (extractedTextCountElement) {
                extractedTextCountElement.textContent = `${extractedTextContent.length} caratteri`;
            }
            
            if (configForm) configForm.style.display = 'block';

            //alertMessage('Testo estratto con successo!', 'success'); // Messaggio di successo

        } catch (error) {
            console.error('Errore durante l\'estrazione:', error);
            alertMessage(`Errore estrazione testo: ${error.message}`, 'error');
            if (previewTextDiv) previewTextDiv.textContent = 'Errore durante l\'estrazione del testo.';
            if (configForm) configForm.style.display = 'none';
        }
    });
} else {
    console.error("L'elemento fileInput non è stato trovato. Assicurati che l'ID sia 'fileInput'.");
}


// 2. GENERAZIONE QUIZ
if (quizForm) {
    quizForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!extractedTextContent) { alertMessage("Carica un file!"); return; }

        if (generateBtn) generateBtn.disabled = true;
        if (loadingSpinner) loadingSpinner.classList.remove('d-none');
        if (quizArea) quizArea.classList.add('d-none');
        if (questionsContainer) questionsContainer.innerHTML = '';

        const config = {
            difficulty: document.getElementById('difficultySelect').value,
            aiModel: document.getElementById('aiSelect').value,
            language: document.getElementById('langSelect').value,
            numQuestions: document.getElementById('numQuestions').value,
            questionType: document.getElementById('typeSelect').value,
            numOptions: document.getElementById('numOptions').value,
            topic: document.getElementById('topicInput').value.trim()
        };

        try {
            const response = await fetch('/api/generate-quiz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: extractedTextContent, config })
            });

            const data = await response.json();

            if (data.quiz) {
                // Salva il quiz completo per un potenziale uso futuro se necessario
                currentQuizData = data.quiz; 
                renderQuiz(data.quiz, config.questionType);
                //alertMessage('Quiz generato con successo!', 'success');
            } else {
                // Gestione errore specifica
                alertMessage("Errore: " + (data.error || "L'AI non ha generato un JSON valido. Riprova, a volte capita."), 'error');
            }
        } catch (err) {
            alertMessage("Errore comunicazione server.", 'error');
        } finally {
            if (generateBtn) generateBtn.disabled = false;
            if (loadingSpinner) loadingSpinner.classList.add('d-none');
        }
    });
}


// Funzioni Helper Quiz
function shuffleArray(arr) { return arr.sort(() => Math.random() - 0.5); }

// *** FUNZIONE renderQuiz MODIFICATA ***
function renderQuiz(quiz, type) {
    if (quizArea) quizArea.classList.remove('d-none');
    
    quiz.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'question-card shadow-sm p-4 mb-3 bg-white rounded border-start border-primary border-4';
        
        // Titolo Domanda
        const title = document.createElement('div');
        title.className = 'h5 mb-3 fw-bold';
        title.textContent = `${idx+1}. ${q.domanda}`;
        card.appendChild(title);

        // Soluzione (Nascosta) - AGGIORNATA
        const solDiv = document.createElement('div');
        solDiv.className = 'solution-box alert alert-info mt-3 d-none';
        
        let solutionHtml = `<strong>Risposta Corretta:</strong> ${q.corretta}`;

        // Aggiungi la spiegazione se presente
        if (q.spiegazione) {
            solutionHtml += `<hr class="my-2"><strong>Spiegazione (dal testo):</strong> ${q.spiegazione}`;
        }
        
        solDiv.innerHTML = solutionHtml;
        // FINE AGGIORNAMENTO

        currentQuizAnswers.push({card,solDiv});

        if (type === 'multiple_choice' && q.risposte.length > 0) {
            const opts = q.risposte.map(r => ({ txt: r, correct: r === q.corretta }));
            shuffleArray(opts).forEach((opt, i) => {
                const div = document.createElement('div');
                div.className = 'form-check';
                div.innerHTML = `
                    <input class="form-check-input" type="radio" name="q${idx}" id="q${idx}_${i}" ${opt.correct ? 'data-correct="true"' : ''}>
                    <label class="form-check-label" for="q${idx}_${i}">${opt.txt}</label>
                `;
                card.appendChild(div);
            });
        } else {
            card.innerHTML += `<textarea class="form-control" rows="2" placeholder="Rispondi qui..."></textarea>`;
        }

        // card.appendChild(solDiv);
        if (questionsContainer) questionsContainer.appendChild(card);
    });

    // Render Math
    // NOTA: Se 'renderMathInElement' non è definito, questa linea fallirà. 
    // Assicurati che la libreria KaTeX sia inclusa nel tuo HTML.
    if (questionsContainer && typeof renderMathInElement !== 'undefined') {
        renderMathInElement(questionsContainer, katexConfig);
    }
    if (quizArea) quizArea.scrollIntoView({behavior: 'smooth'});
}

if (submitQuizBtn) {
    submitQuizBtn.addEventListener('click', (e) => {
        
        currentQuizAnswers.forEach((element) => {
            element.card.appendChild(element.solDiv)
        })

        document.querySelectorAll('.solution-box').forEach(el => el.classList.remove('d-none'));
        document.querySelectorAll('input[type="radio"]').forEach(inp => {
            inp.disabled = true;
            const lbl = inp.nextElementSibling;
            if (inp.dataset.correct) lbl.style.color = "green", lbl.style.fontWeight = "bold";
            else if (inp.checked) lbl.style.color = "red", lbl.style.textDecoration = "line-through";
        });
        e.target.disabled = true;
        // Re-render math nelle soluzioni appena svelate
        if (questionsContainer && typeof renderMathInElement !== 'undefined') {
            renderMathInElement(questionsContainer, katexConfig);
        }
    });
}