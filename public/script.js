// Variabili globali
let extractedTextContent = "";
let currentQuizData = [];
let currentQuizAnswers = [];
// NUOVA VARIABILE: Storico delle domande per il file corrente
let questionHistory = [];

// Costanti Globali
const MAX_FILE_SIZE_MB = 10;
const BYTES = 1024;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * BYTES * BYTES;

// Configurazione KaTeX
const katexConfig = {
  delimiters: [
    { left: "$$", right: "$$", display: true },
    { left: "$", right: "$", display: false },
  ],
  throwOnError: false,
};

let isFileLoaded = false;

// --- ELEMENTI DOM (Selezione completa e sicura) ---
const fileInput = document.getElementById("fileInput");
const previewCard = document.getElementById("previewCard");
const previewTextDiv = document.getElementById("previewText");
const extractedTextCountElement = document.getElementById("extractedTextCount");
const configForm = document.getElementById("configForm");
const typeSelect = document.getElementById("typeSelect");
const optionsContainer = document.getElementById("optionsContainer");
const quizForm = document.getElementById("quizForm");
const generateBtn = document.getElementById("generateBtn");
const loadingSpinner = document.getElementById("loadingSpinner");
const quizArea = document.getElementById("quizArea");
const questionsContainer = document.getElementById("questionsContainer");
const submitQuizBtn = document.getElementById("submitQuizBtn");

const mermaidArea = document.getElementById("mermaidArea");
const extractMermaidBtn = document.getElementById("extractMermaidBtn");
// --------------------------------------------------

// Funzione helper per mostrare messaggi (sostituire alert())
function alertMessage(message, type = "info") {
  const color =
    type === "error" ? "red" : type === "success" ? "green" : "blue";
  console.error(
    `[MESSAGGIO ${type.toUpperCase()}] %c${message}`,
    `color: ${color}; font-weight: bold;`
  );
  alert(message);
}

// Gestione tipo risposta (Multipla/Aperta)
if (typeSelect && optionsContainer) {
  typeSelect.addEventListener("change", (e) => {
    e.target.value === "multiple_choice"
      ? optionsContainer.classList.remove("d-none")
      : optionsContainer.classList.add("d-none");
  });
}

// --- FUNZIONE FORMATTAZIONE TESTO (Rende il PDF leggibile) ---
function formatExtractedText(rawText) {
  // 1. Divide per righe vuote (paragrafi logici)
  const paragraphs = rawText.split(/\n\s*\n/);
  let html = "";

  paragraphs.forEach((para) => {
    const cleanPara = para.trim();
    if (!cleanPara) return;

    // Euristica per i Titoli: Corti (< 80 char) e non finiscono con punteggiatura classica (.,;)
    // Oppure sono tutti in maiuscolo
    const isTitle =
      (cleanPara.length < 80 && !/[.,;]$/.test(cleanPara)) ||
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
      const base64String = reader.result.split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
}

// 1. CARICAMENTO FILE
document.addEventListener("DOMContentLoaded", () => {
  if (fileInput)
    fileInput.addEventListener("change", async (e) => checkInputFile(e));
  else
    console.error(
      "L'elemento fileInput non è stato trovato. Assicurati che l'ID sia 'fileInput'."
    );
});

async function checkInputFile(e) {
  const file = e.target.files[0];

  if (!file) return;

  if (file.size > MAX_FILE_SIZE_BYTES) {
    // Pulisce l'input e permette di inserire un nuovo file
    e.target.value = "";
    alertMessage(
      "Il file è troppo grande. Massimo consentito " + MAX_FILE_SIZE_MB + "MB"
    );
    return;
  }

  const fileName = file.name;
  const fileExtension = fileName.split(".").pop();
  isFileLoaded = true;
  // 1. Converti in Base64
  let base64Data;
  try {
    base64Data = await fileToBase64(file);
  } catch (error) {
    console.error("Errore lettura file Base64:", error);
    alertMessage("Errore nella lettura del file.", "error");
    return;
  }

  console.log("File Base64 created" + fileName);

  if (previewCard) previewCard.style.display = "block";
  if (previewTextDiv)
    previewTextDiv.innerHTML =
      '<div class="text-center p-3 text-muted">Extraction in progress...</div>';

  try {
    // 2. Costruisci il payload JSON (NON FormData)
    const payload = {
      file: base64Data,
      filename: file.name,
      mimetype: file.type,
    };

    let response;

    if (fileExtension === "pdf") {
      response = await fetch("/api/extract-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      response = await fetch("/api/extract-mark-down-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Errore di rete o server");
    }

    const data = await response.json();
    extractedTextContent = data.text ? data.text.trim() : "";

    if (!extractedTextContent) {
      // Errore specifico se il testo è vuoto (probabilmente PDF non contenente testo leggibile)
      throw new Error(
        "Il file non contiene testo estraibile o il testo è vuoto. Prova un altro PDF."
      );
    }

    // NUOVA LOGICA: Reset dello storico domande perché è stato caricato un nuovo file
    questionHistory = [];
    console.log("Nuovo file caricato. Storico domande resettato.");

    // Aggiorna l'interfaccia con il testo estratto
    if (previewTextDiv) {
      const formattedHtml = formatExtractedText(extractedTextContent);

      if (formattedHtml.trim()) {
        // Visualizzazione Formattata
        previewTextDiv.innerHTML =
          formattedHtml + "... (Testo completo estratto nel backend)";
      } else {
        // Fallback se la formattazione non produce output visibile
        previewTextDiv.innerHTML = `
                        <p class="text-warning fw-bold">Attenzione: La formattazione automatica del testo è fallita.</p>
                        <p class="text-muted">Mostriamo i primi 500 caratteri grezzi per diagnostica:</p>
                        <pre class="doc-text bg-light p-2 rounded">${extractedTextContent.substring(
                          0,
                          500
                        )}...</pre>
                    `;
      }
    }

    // Usiamo l'elemento DOM selezionato all'inizio
    if (extractedTextCountElement) {
      extractedTextCountElement.textContent = `${extractedTextContent.length} caratteri`;
    }

    if (configForm) configForm.style.display = "block";

    //alertMessage('Testo estratto con successo!', 'success'); // Messaggio di successo
  } catch (error) {
    console.error("Errore durante l'estrazione:", error);
    alertMessage(`Errore estrazione testo: ${error.message}`, "error");
    if (previewTextDiv)
      previewTextDiv.textContent = "Errore durante l'estrazione del testo.";
    if (configForm) configForm.style.display = "none";
  }
}

// 2. GENERAZIONE QUIZ
if (quizForm) {
  quizForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isFileLoaded) {
      alertMessage("Carica un file!");
      return;
    }

    submitQuizBtn.disabled = false;

    if (generateBtn) generateBtn.disabled = true;
    if (loadingSpinner) loadingSpinner.classList.remove("d-none");
    if (quizArea) quizArea.classList.add("d-none");
    if (questionsContainer) questionsContainer.innerHTML = "";

    const config = {
      difficulty: document.getElementById("difficultySelect").value,
      aiModel: document.getElementById("aiSelect").value,
      language: document.getElementById("langSelect").value,
      numQuestions: document.getElementById("numQuestions").value,
      questionType: document.getElementById("typeSelect").value,
      numOptions: document.getElementById("numOptions").value,
      topic: document.getElementById("topicInput").value.trim(),
    };

    try {
      // MODIFICA: Includi lo storico delle domande nel payload
      const response = await fetch("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: extractedTextContent,
          config: config,
          previousQuestions: questionHistory, // Passa lo storico attuale
        }),
      });

      const data = await response.json();

      if (data.quiz) {
        // Salva il quiz completo per un potenziale uso futuro se necessario
        currentQuizData = data.quiz;

        // NUOVA LOGICA: Aggiorna lo storico domande
        data.quiz.forEach((q) => {
          // Aggiungi solo il testo della domanda per risparmiare token
          questionHistory.push(q.domanda);
        });

        // Mantieni solo le ultime 20 domande (FIFO)
        if (questionHistory.length > 20) {
          // Taglia l'array mantenendo gli ultimi 20 elementi
          questionHistory = questionHistory.slice(-20);
        }
        console.log("Storico domande aggiornato:", questionHistory);

        renderQuiz(data.quiz, config.questionType);
        //alertMessage('Quiz generato con successo!', 'success');
      } else {
        // Gestione errore specifica
        quizForm.click();
        alertMessage(
          "Errore: " +
            (data.error ||
              "L'AI non ha generato un JSON valido. Riprova, a volte capita."),
          "error"
        );
        const parag = loadingSpinner.querySelector("p");
        parag.innerText =
          "Attendi ancora qualche secondo. Ci vuole un po' piu' del previsto";
      }
    } catch (err) {
      alertMessage("Errore comunicazione server.", "error");
    } finally {
      if (generateBtn) generateBtn.disabled = false;
      if (loadingSpinner) loadingSpinner.classList.add("d-none");
    }
  });
}

function shuffleArray(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function renderQuiz(quiz, type) {
  if (quizArea) quizArea.classList.remove("d-none");

  quiz.forEach((q, idx) => {
    const card = document.createElement("div");
    card.className =
      "question-card shadow-sm p-4 mb-3 bg-white rounded border-start border-primary border-4";

    // Titolo Domanda
    const title = document.createElement("div");
    title.className = "h5 mb-3 fw-bold";
    title.textContent = `${idx + 1}. ${q.domanda}`;
    card.appendChild(title);

    const solDiv = document.createElement("div");
    solDiv.className = "solution-box alert alert-info mt-3 d-none";

    let solutionHtml = `<strong>Risposta Corretta:</strong> ${q.corretta}`;

    // add explenation if it exists
    if (q.spiegazione) {
      solutionHtml += `<hr class="my-2"><strong>Spiegazione (dal testo):</strong> ${q.spiegazione}`;
    }

    solDiv.innerHTML = solutionHtml;

    currentQuizAnswers.push({ card, solDiv });

    if (type === "multiple_choice" && q.risposte.length > 0) {
      const opts = q.risposte.map((r) => ({
        txt: r,
        correct: r === q.corretta,
      }));
      shuffleArray(opts).forEach((opt, i) => {
        const div = document.createElement("div");
        div.className = "form-check";
        div.innerHTML = `
                    <input class="form-check-input" type="radio" name="q${idx}" id="q${idx}_${i}" ${
          opt.correct ? 'data-correct="true"' : ""
        }>
                    <label class="form-check-label" for="q${idx}_${i}">${
          opt.txt
        }</label>
                `;
        card.appendChild(div);
      });
    } else {
      card.innerHTML += `<textarea class="form-control" rows="2" placeholder="Rispondi qui..."></textarea>`;
    }

    if (questionsContainer) questionsContainer.appendChild(card);
  });

  // Render Math
  if (questionsContainer && typeof renderMathInElement !== "undefined") {
    renderMathInElement(questionsContainer, katexConfig);
  }
  if (quizArea) quizArea.scrollIntoView({ behavior: "smooth" });
}

if (submitQuizBtn) {
  submitQuizBtn.addEventListener("click", (e) => {
    currentQuizAnswers.forEach((element) => {
      element.card.appendChild(element.solDiv);
    });

    document
      .querySelectorAll(".solution-box")
      .forEach((el) => el.classList.remove("d-none"));
    document.querySelectorAll('input[type="radio"]').forEach((inp) => {
      inp.disabled = true;
      const lbl = inp.nextElementSibling;
      if (inp.dataset.correct)
        (lbl.style.color = "green"), (lbl.style.fontWeight = "bold");
      else if (inp.checked)
        (lbl.style.color = "red"), (lbl.style.textDecoration = "line-through");
    });
    e.target.disabled = true;
    // Re-render math nelle soluzioni appena svelate
    if (questionsContainer && typeof renderMathInElement !== "undefined") {
      renderMathInElement(questionsContainer, katexConfig);
    }
  });
}

// --- NUOVA LOGICA: ESTRAZIONE E RENDER MERMAID ---
if (extractMermaidBtn && mermaidArea) {
  extractMermaidBtn.addEventListener("click", async () => {
    if (!extractedTextContent) {
      alertMessage(
        "Carica prima un file e attendi l'estrazione del testo!",
        "info"
      );
      return;
    }

    mermaidArea.innerHTML =
      '<div class="text-center p-3 text-muted">Ricerca e renderizzazione Mermaid in corso...</div>';

    try {
      const response = await fetch("/api/extract-mermaid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: extractedTextContent }),
      });

      const data = await response.json();

      if (data.mermaid && data.mermaid.length > 0) {
        mermaidArea.innerHTML = ""; // Pulisce l'area
        mermaid.initialize({ startOnLoad: false, theme: "default" });

        for (const [index, mermaidCode] of data.mermaid.entries()) {
          const id = `mermaid-chart-${index}`;
          const container = document.createElement("div");
          container.className =
            "mermaid-output-card shadow-sm p-4 mb-3 bg-white rounded";

          const title = document.createElement("h5");
          title.className = "text-primary mb-3";
          title.textContent = `Diagramma #${index + 1}`;

          container.appendChild(title);

          mermaidArea.appendChild(container);
          try {
            const { svg } = await mermaid.render(id, mermaidCode);
            container.innerHTML += svg;
          } catch (renderError) {
            console.error(renderError);
          }
        }
      } else {
        mermaidArea.innerHTML =
          '<div class="text-center p-3 text-warning">Nessun blocco di codice Mermaid trovato nel file (cerca ````mermaid ... ````).</div>';
      }
    } catch (error) {
      console.erro("asdasasd");
      alertMessage(
        `Errore di comunicazione per l'estrazione Mermaid: ${error.message}`,
        "error"
      );
      mermaidArea.innerHTML =
        '<div class="text-center p-3 text-danger">Errore durante la comunicazione con il server.</div>';
    }
  });
}
