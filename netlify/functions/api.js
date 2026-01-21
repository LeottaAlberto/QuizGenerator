const serverless = require("serverless-http");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

// Logging di Inizializzazione Garantito (per debug)
console.log("--- INIZIALIZZAZIONE FUNZIONE API AVVIATA ---");

// PDF parse
let pdfParseLib = require("pdf-parse");
if (typeof pdfParseLib !== "function" && pdfParseLib.default)
  pdfParseLib = pdfParseLib.default;

// *** NUOVO LOG DI VERIFICA ***
if (!pdfParseLib) {
  console.error(
    "ERRORE: La libreria pdf-parse non è stata caricata correttamente.",
  );
} else {
  console.log("pdf-parse caricata con successo.");
}
// ****************************

const app = express();

app.use(cors());

// IMPORTANTISSIMO: Aumenta il limite per i file Base64! Aumentato a 50MB per sicurezza.
app.use(express.json({ limit: "50mb" }));

// Helper per il parsing JSON (invariato)
function extractJSON(text) {
  try {
    let cleanText = text.trim();
    cleanText = cleanText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const firstOpen = cleanText.indexOf("{");
    const lastClose = cleanText.lastIndexOf("}");
    if (firstOpen !== -1 && lastClose !== -1) {
      cleanText = cleanText.substring(firstOpen, lastClose + 1);
      return JSON.parse(cleanText);
    }
    throw new Error("Parentesi JSON {} non trovate dopo la pulizia.");
  } catch (e) {
    console.error(
      "FALLIMENTO PARSING JSON. Contenuto:",
      text.substring(0, 500) + "...",
    );
    return null;
  }
}

// Router API
const router = express.Router();

// -----------------------------------------------------------------
// ROUTE 1: ESTRAZIONE TESTO (Gestisce Base64 inviato via JSON)
// -----------------------------------------------------------------
router.post("/extract-text", async (req, res) => {
  // Aggiunto un try...catch generale per catturare errori non previsti
  try {
    console.log("--- Chiamata all'API: extract-text ---");

    // Il frontend DEVE inviare { file: base64String, filename: string, mimetype: string }
    const { file: base64Data, filename, mimetype } = req.body;

    if (!base64Data || !mimetype) {
      console.error(
        "Corpo della richiesta NON CONTIENE Base64 (req.body mancante o malformato).",
      );
      return res
        .status(400)
        .json({ error: "Richiesta non valida: dati file Base64 mancanti." });
    }

    if (mimetype === "application/pdf" && !pdfParseLib) {
      return res.status(500).json({
        error:
          "Errore di configurazione del server: libreria PDF non disponibile.",
      });
    }

    // Decodifica Base64 in Buffer
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(base64Data, "base64");
      console.log(
        `Buffer creato con successo, dimensione: ${fileBuffer.length} bytes`,
      );
    } catch (e) {
      console.error("Errore decodifica Base64:", e.message);
      return res
        .status(400)
        .json({ error: "Impossibile decodificare il file Base64." });
    }

    // Processa il Buffer
    try {
      let extractedText = "";

      if (mimetype === "application/pdf") {
        console.log("Tentativo di parsing PDF...");
        // *** INIZIO MODIFICA PER GESTIONE ERRORI PDF ***
        try {
          // Passa un oggetto opzioni vuoto per mantenere la stabilità e la compatibilità
          const options = {};
          const data = await pdfParseLib(fileBuffer, options);
          extractedText = data.text || ""; // Assicura che sia una stringa vuota in caso di null

          // Controllo cruciale: se il testo è vuoto nonostante il parsing sia terminato
          if (extractedText.trim() === "") {
            console.error(
              "AVVISO: pdf-parse ha restituito testo vuoto. Il PDF potrebbe essere una scansione o contenere solo elementi matematici non estraibili.",
            );
            // Lanciamo un errore che verrà catturato dal blocco esterno
            throw new Error(
              "Il parser PDF ha restituito testo vuoto. Il file potrebbe essere una scansione o non contenere testo standard (solo formule/immagini).",
            );
          }

          console.log(
            `Parsing PDF completato. Lunghezza estratta: ${extractedText.length}`,
          );
        } catch (pdfError) {
          // Gestisce gli errori interni di pdf-parse (es. file corrotto, password protetta)
          console.error(
            "ERRORE CRITICO durante il parsing PDF:",
            pdfError.message,
          );
          // Rilancia un errore descrittivo che verrà catturato dal blocco esterno
          throw new Error(
            "Errore durante l'analisi del PDF. Controlla il file (potrebbe essere corrotto o protetto).",
          );
        }
        // *** FINE MODIFICA ***
      } else if (
        mimetype.includes("word") ||
        mimetype.includes("officedocument")
      ) {
        const mammoth = require("mammoth");
        console.log("Tentativo di parsing DOCX...");
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = result.value;
        console.log("Parsing DOCX completato.");
      } else {
        // File di testo semplice
        extractedText = fileBuffer.toString("utf8");
      }

      extractedText = extractedText.replace(/\r\n/g, "\n");
      // Limita a 60K caratteri per evitare di superare il limite di token di Gemini
      res.json({ text: extractedText.substring(0, 60000) });
    } catch (error) {
      console.error("Errore lettura file/parsing (interno):", error.message);
      res.status(500).json({
        error:
          "Errore durante la lettura o il parsing del file: " + error.message,
      });
    }
  } catch (generalError) {
    // CATTURA GLI ERRORI CHE HANNO SUPERATO I BLOCCHI INTERNI (es. Time-out o Errori di ambiente)
    console.error(
      "Errore FATALE non gestito nell'endpoint /extract-text:",
      generalError.message,
    );
    // Assicuriamo una risposta JSON valida anche per errori catastrofici
    res.status(500).json({
      error:
        "Errore interno del server non gestito. Probabile timeout o esaurimento della memoria.",
    });
  }
});

// -----------------------------------------------------------------
// ROUTE 2: GENERAZIONE QUIZ (Chiama Gemini) - MODIFICATA
// -----------------------------------------------------------------
router.post("/generate-quiz", async (req, res) => {
  if (!req.body || !req.body.text || !req.body.config) {
    return res.status(400).json({ error: "Richiesta non valida." });
  }

  const { text, config, previousQuestions } = req.body;

  // Utilizziamo un oggetto JSON per la configurazione
  const configParams = {
    language: config.language || "Italiano",
    difficulty: config.difficulty || "Medio",
    numQuestions: config.numQuestions || 5,
    questionType: config.questionType || "multiple_choice",
    numOptions: config.numOptions || 4,
    topic: config.topic || "nella sua interezza",
  };

  // Costruzione della sezione per evitare duplicati
  const historyContext =
    previousQuestions &&
    Array.isArray(previousQuestions) &&
    previousQuestions.length > 0
      ? `\n### STORICO DOMANDE DA NON RIPETERE (EVITA ANCHE I CONCETTI CORRELATI):\n${previousQuestions.join(" | ")}\n`
      : "";

  const systemPrompt = `
### RUOLO
Sei un'API specializzata nella generazione di quiz educativi. Operi esclusivamente producendo codice JSON valido. 

### ANALISI DEL TESTO E TOPIC
- **Testo da analizzare**: Fornito dall'utente.
- **Focus Topic**: ${configParams.topic === "nella sua interezza" ? "Analizza tutto il testo fornito." : "Concentrati esclusivamente su: " + configParams.topic}
- **Lingua di Output**: ${configParams.language} (Obbligatoria, anche se il testo sorgente è in un'altra lingua).

### CONFIGURAZIONE QUIZ
- **Difficoltà**: ${configParams.difficulty}
- **Numero Domande**: ${configParams.numQuestions}
- **Tipo**: ${configParams.questionType}
- **Opzioni**: ${configParams.numOptions} (solo se multiple_choice)

### REGOLE RIGIDE DI GENERAZIONE (DA SEGUIRE ALLA LETTERA)
1. **No Metadati**: Non numerare le domande (es. NO "1. Qual è...", SI "Qual è..."). Non includere lettere nelle opzioni (es. NO "A) Testo", SI "Testo").
2. **Filtro Qualità**: Ignora slide di glossario, presentazioni iniziali, o pagine di "benvenuto" se incoerenti con il corpo principale.
3. **No Riferimenti ad Esempi**: Non fare mai domande del tipo "Cosa dice l'esempio a pagina X?". Le domande devono essere sui concetti, non sulla struttura del documento.
4. **No Parentesi Indizio**: Non inserire spiegazioni o indizi tra parentesi all'interno di domande o risposte.
5. **Formato Aperto (open_ended)**: Se il tipo è open_ended, l'array "risposte" deve essere [] e il campo "corretta" DEVE contenere una risposta modello esaustiva basata sul testo.

### LOGICA DI DIFFICOLTÀ (TARGET: ${configParams.difficulty})
- **Semplice**: Definizioni e fatti espliciti.
- **Normale**: Collegamento tra concetti o applicazione di regole.
- **Difficile**: Analisi critica, deduzioni logiche e sintesi.
- **Vincolo**: Copri proporzionalmente tutto il testo richiesto adattando la complessità della domanda, non escludendo argomenti.

### GESTIONE STORICO E UNICITÀ (CRUCIALE)
${avoidRepetitionPrompt}
- **Verifica Antiduplicazione**: Confronta ogni domanda generata con lo STORICO fornito.
- **Diversità Semantica**: Se lo storico contiene già una domanda su un concetto, non riproporla nemmeno con parole diverse. Cambia sotto-argomento.
- **Scarto**: Se una domanda viola la diversità, scartala e rigenerala.

### ISTRUZIONI LATEX
- Formule inline: $ formula $
- Formule a blocco: $$ formula $$

### FORMATO JSON DI USCITA (OBBLIGATORIO)
Rispondi SOLO con l'oggetto JSON. Non aggiungere commenti, non aggiungere backtick \`\`\`json. Se violi il formato JSON, il sistema crasha.
{
  "language": "${configParams.language}",
  "quiz": [
    {
      "domanda": "...",
      "risposte": ["...", "..."],
      "corretta": "...",
      "spiegazione": "..."
    }
  ]
}
`;

  try {
    let rawRes = "";

    if (config.aiModel === "gemini") {
      if (!process.env.GEMINI_API_KEY)
        return res.status(500).json({ error: "Manca GEMINI_API_KEY." });

      const modelName = "gemini-1.5-flash"; // Nota: 2.0-flash o 1.5-flash sono i nomi corretti attuali

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: systemPrompt + "\n\nTESTO DA ANALIZZARE:\n" + text },
                ],
              },
            ],
            // AGGIUNTA: Forza Gemini a rispondere in formato JSON a livello di API
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        },
      );

      const data = await response.json();

      if (data.error)
        throw new Error(`Gemini API Error: ${data.error.message}`);

      if (
        !data.candidates ||
        data.candidates.length === 0 ||
        !data.candidates[0].content
      ) {
        throw new Error("Gemini non ha restituito candidati validi.");
      }

      rawRes = data.candidates[0].content.parts[0].text;
    } else {
      return res.status(400).json({ error: "Modello non supportato." });
    }

    // --- PULIZIA E PARSING SICURO ---
    try {
      const cleanJson = rawRes.replace(/```json|```/g, "").trim();
      const jsonObject = JSON.parse(cleanJson);

      // Invio la risposta finale pulita
      res.json(jsonObject);
    } catch (parseError) {
      console.error("Errore parsing JSON. Testo ricevuto:", rawRes);
      throw new Error("L'AI ha risposto con un formato JSON corrotto.");
    }
  } catch (error) {
    console.error("Errore generazione:", error.message);
    res.status(500).json({ error: "Errore AI: " + error.message });
  }
});

// -----------------------------------------------------------------
// ROUTE 3: ESTRAZIONE E RITORNO CODICE MERMAID
// -----------------------------------------------------------------
router.post("/extract-mermaid", async (req, res) => {
  try {
    const { text } = req.body;
    // const regex = /(graph|sequenceDiagram|gantt|classDiagram|stateDiagram|pie)\s*([\s\S]*?)(\n\n|\Z)/g;

    const mermaidRegex = /```mermaid\s*([\s\S]*?)```/g;
    let match;
    const mermaidCodeBlocks = [];

    while ((match = mermaidRegex.exec(text)) !== null) {
      mermaidCodeBlocks.push(match[1].trim());
    }

    // Restituisce un array di stringhe, dove ogni stringa è un blocco Mermaid puro
    res.json({ mermaid: mermaidCodeBlocks });
  } catch (error) {
    console.error("Errore estrazione Mermaid:", error.message);
    res
      .status(500)
      .json({ error: "Errore interno durante l'estrazione di Mermaid." });
  }
});

// -----------------------------------------------------------------
// ROUTE 4: ESTRAZIONE CONTENUTO MARKDOWN (Testo + Mermaid)
// -----------------------------------------------------------------
router.post("/extract-mark-down-text", async (req, res) => {
  try {
    // Il frontend DEVE inviare { file: base64String, filename: string, mimetype: string }
    const { file: base64Data, filename } = req.body;

    if (!base64Data) {
      console.error(
        "Richiesta extract-mark-down-text non valida: dati Base64 mancanti.",
      );
      return res
        .status(400)
        .json({ error: "Richiesta non valida: dati file Base64 mancanti." });
    }

    // 1. Decodifica Base64 in Buffer
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(base64Data, "base64");
    } catch (e) {
      console.error("Errore decodifica Base64:", e.message);
      return res
        .status(400)
        .json({ error: "Impossibile decodificare il file Base64." });
    }

    // 2. Converti il Buffer in stringa di testo
    let extractedText = fileBuffer.toString("utf8");
    extractedText = extractedText.replace(/\r\n/g, "\n"); // Normalizza a capo

    // 3. Estrazione Codice Mermaid (Opzionale ma utile)
    const mermaidRegex = /```mermaid\s*([\s\S]*?)```/g;
    let match;
    const mermaidCodeBlocks = [];

    while ((match = mermaidRegex.exec(extractedText)) !== null) {
      mermaidCodeBlocks.push(match[1].trim());
    }

    // 4. Restituisce il testo completo e l'array di blocchi Mermaid
    // Limitiamo il testo per l'AI, come fai in /extract-text
    res.json({
      text: extractedText,
      mermaid: mermaidCodeBlocks,
    });
  } catch (error) {
    console.error(
      "Errore FATALE in /extract-mark-down-content:",
      error.message,
    );
    res.status(500).json({
      error:
        "Errore interno del server durante la lettura del file Markdown: " +
        error.message,
    });
  }
});

// Applichiamo il router alla base path per Netlify
app.use("/", router);
app.use("/api", router); // Per chiamata /api/xyz
app.use("/.netlify/functions/api", router); // Per fallback di Netlify

module.exports.handler = serverless(app);
