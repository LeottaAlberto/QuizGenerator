// Variabili globali
let extractedTextContent = "";
let currentQuizData = [];

// Configurazione KaTeX
const katexConfig = {
    delimiters: [
        {left: "$$", right: "$$", display: true},
        {left: "$", right: "$", display: false}
    ],
    throwOnError: false
};

// Elementi DOM
const fileInput = document.getElementById('fileInput');
const previewTextDiv = document.getElementById('previewText'); // Assicurati che nell'HTML sia un DIV, non <p>
const quizArea = document.getElementById('quizArea');
const questionsContainer = document.getElementById('questionsContainer');
const loadingSpinner = document.getElementById('loadingSpinner');

// Gestione tipo risposta (Multipla/Aperta)
document.getElementById('typeSelect').addEventListener('change', (e) => {
    const opts = document.getElementById('optionsContainer');
    e.target.value === 'multiple_choice' ? opts.classList.remove('d-none') : opts.classList.add('d-none');
});

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

// 1. CARICAMENTO FILE
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    document.getElementById('previewCard').style.display = 'block';
    previewTextDiv.innerHTML = '<div class="text-center p-3 text-muted">Extraction in progress...</div>';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/extract-text', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        console.log(data);
        
        if (data.text) {
            extractedTextContent = data.text;
            // Applica la formattazione intelligente
            previewTextDiv.innerHTML = formatExtractedText(data.text);
            // Riconosci formule matematiche nell'anteprima
            renderMathInElement(previewTextDiv, katexConfig);
        } else {
            previewTextDiv.textContent = "Errore lettura testo.";
        }
    } catch (err) {
        console.error(err);
        previewTextDiv.textContent = "Errore server.";
    }
});

// 2. GENERAZIONE QUIZ
document.getElementById('quizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!extractedTextContent) { alert("Carica un file!"); return; }

    document.getElementById('generateBtn').disabled = true;
    loadingSpinner.classList.remove('d-none');
    quizArea.classList.add('d-none');
    questionsContainer.innerHTML = '';

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
            renderQuiz(data.quiz, config.questionType);
        } else {
            // Gestione errore specifica
            alert("Errore: " + (data.error || "L'AI non ha generato un JSON valido. Riprova, a volte capita."));
        }
    } catch (err) {
        alert("Errore comunicazione server.");
    } finally {
        document.getElementById('generateBtn').disabled = false;
        loadingSpinner.classList.add('d-none');
    }
});

// Funzioni Helper Quiz
function shuffleArray(arr) { return arr.sort(() => Math.random() - 0.5); }

function renderQuiz(quiz, type) {
    quizArea.classList.remove('d-none');
    
    quiz.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'question-card shadow-sm p-4 mb-3 bg-white rounded border-start border-primary border-4';
        
        // Titolo Domanda
        const title = document.createElement('div');
        title.className = 'h5 mb-3 fw-bold';
        title.textContent = `${idx+1}. ${q.domanda}`;
        card.appendChild(title);

        // Soluzione (Nascosta)
        const solDiv = document.createElement('div');
        solDiv.className = 'solution-box alert alert-info mt-3 d-none';
        solDiv.innerHTML = `<strong>Risposta:</strong> ${q.corretta}`;

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

        card.appendChild(solDiv);
        questionsContainer.appendChild(card);
    });

    // Render Math
    renderMathInElement(questionsContainer, katexConfig);
    quizArea.scrollIntoView({behavior: 'smooth'});
}

document.getElementById('submitQuizBtn').addEventListener('click', (e) => {
    document.querySelectorAll('.solution-box').forEach(el => el.classList.remove('d-none'));
    document.querySelectorAll('input[type="radio"]').forEach(inp => {
        inp.disabled = true;
        const lbl = inp.nextElementSibling;
        if (inp.dataset.correct) lbl.style.color = "green", lbl.style.fontWeight = "bold";
        else if (inp.checked) lbl.style.color = "red", lbl.style.textDecoration = "line-through";
    });
    e.target.disabled = true;
    // Re-render math nelle soluzioni appena svelate
    renderMathInElement(questionsContainer, katexConfig);
});
