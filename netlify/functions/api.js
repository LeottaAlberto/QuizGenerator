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
    "ERRORE: La libreria pdf-parse non è stata caricata correttamente."
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
      text.substring(0, 500) + "..."
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
        "Corpo della richiesta NON CONTIENE Base64 (req.body mancante o malformato)."
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
        `Buffer creato con successo, dimensione: ${fileBuffer.length} bytes`
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
              "AVVISO: pdf-parse ha restituito testo vuoto. Il PDF potrebbe essere una scansione o contenere solo elementi matematici non estraibili."
            );
            // Lanciamo un errore che verrà catturato dal blocco esterno
            throw new Error(
              "Il parser PDF ha restituito testo vuoto. Il file potrebbe essere una scansione o non contenere testo standard (solo formule/immagini)."
            );
          }

          console.log(
            `Parsing PDF completato. Lunghezza estratta: ${extractedText.length}`
          );
        } catch (pdfError) {
          // Gestisce gli errori interni di pdf-parse (es. file corrotto, password protetta)
          console.error(
            "ERRORE CRITICO durante il parsing PDF:",
            pdfError.message
          );
          // Rilancia un errore descrittivo che verrà catturato dal blocco esterno
          throw new Error(
            "Errore durante l'analisi del PDF. Controlla il file (potrebbe essere corrotto o protetto)."
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
      generalError.message
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
  // ⚠️ Controllo per il crash 'Cannot read properties of undefined' (Punto 1.B)
  if (!req.body || !req.body.text || !req.body.config) {
    console.error("Richiesta generate-quiz malformata. Body:", req.body);
    return res.status(400).json({
      error: "Richiesta non valida: 'text' o 'config' mancanti nel corpo.",
    });
  }

  // MODIFICA: Estraiamo anche previousQuestions
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
  let avoidRepetitionPrompt = "";
  if (
    previousQuestions &&
    Array.isArray(previousQuestions) &&
    previousQuestions.length > 0
  ) {
    avoidRepetitionPrompt = `
ATTENZIONE - STORICO DOMANDE:
Ho già generato le seguenti domande per questo utente. È FONDAMENTALE che tu generi NUOVE domande diverse da queste (sia nel testo che nel concetto).
Devi assolutamente evitare domande uguali o simili a quelle che sono già state generate in precendeza. Devi assolutamente e obbligatoriamente considerare lo storico
ELENCO DOMANDE DA EVITARE:
${JSON.stringify(previousQuestions)}
`;
  }

  const systemPrompt = `
Sei un'API che risponde SOLO ed esclusivamente in JSON, non in altri formati. Non scrivere altro testo.
Analizza il testo fornito ${
    configParams.topic !== "nella sua interezza"
      ? "concentrandoti su: " + configParams.topic
      : configParams.topic
  }.

PARAMETRI:
- Lingua Output: ${configParams.language}
- Difficoltà: ${configParams.difficulty}
- Numero Domande: ${configParams.numQuestions}
- Tipo: ${configParams.questionType}
- Opzioni (se multipla): ${configParams.numOptions}

${avoidRepetitionPrompt}
ISTRUZIONE FONDAMENTALE:
- Evita di fare domande su esempi o su informazioni palesemente incoerenti con le tematiche del TESTO fornito.
- Evita di fare domande o risposte con dei riferimenti alla risposta corretta; questo lo puoi fare evitando di specificare concetti tra parentesi.
- L'inizio della domande deve essere la domanda stessa, senza numeri iniziali o lettere. 
Esempio: 1) L'impero Romano (Questo non va bene)
Esempio: L'impero Romano (Questo va benissimo)
- Cerca sempre la coerenza delle domande rispetto al TESTO fornito
Esempio: se nel testo trovi delle slide in cui c'è un glossario o una presentazione che è totalmente diversa dalle tematiche trattate nel resto del TESTO, ignora quelle slide. 
Esempio: se controllando il testo vedi che ci sono esempi esplicitati come tali o capisci che ci sono degli esempi sotto delle definizioni non fare domande inerenti a quegli esempi. 
Della serie: 'All'esempio a slide x cosa viene riportato?' questa è una tipologia di domande che non deve mai comparire

ISTRUZIONI CRUCIALI PER LA GIUSTIFICAZIONE:
- Per ogni domanda, devi fornire una **spiegazione dettagliata (giustificazione)** della risposta corretta.
- La spiegazione **DEVE** essere basata *esclusivamente* sul contenuto del TESTO fornito. Idealmente, cita la frase o il concetto chiave dal testo.
- Inserisci la spiegazione nel nuovo campo **"spiegazione"** per ogni oggetto domanda.

ISTRUZIONI LATEX:
- Se incontri formule matematiche, DEVI scriverle in formato KaTeX/LaTeX.
- Usa il delimitatore singolo '$' per le formule inline (es: $E=mc^2$).
- Usa il doppio delimitatore '$$' per blocchi.

ISTRUZIONI PER LA DIFFICOLTÀ (RELATIVA AL TESTO)
- La difficoltà è determinata dalla profondità del ragionamento richiesto rispetto ai contenuti forniti, non dall'esclusione di argomenti complessi.
- Semplice: Domande dirette su definizioni, fatti o singoli concetti espliciti.
- Normale: Domande che richiedono di collegare più informazioni o applicare una regola a un caso pratico.
- Difficile: Domande che richiedono analisi critica, deduzioni logiche o sintesi di concetti complessi.
- VINCOLO DI COPERTURA: Il quiz deve obbligatoriamente toccare tutto il contenuto del file o tutti gli argomenti selezionati. La difficoltà deve adattare il modo in cui viene posta la domanda, senza mai escludere parti del testo o temi scelti.
- Esempio pratico (Testo sulle operazioni di base): 
    Se viene richiesta una difficoltà normale, le domande avranno una percentuale più alta di probabilità di presentare quesiti che richiedono l'applicazione combinata di due operazioni (es. un problema a due passaggi) 
    o la comprensione della relazione logica tra esse (es. la divisione come operazione inversa della moltiplicazione). 

FORMATO JSON OBBLIGATORIO:
Devi restituire SOLO un oggetto JSON valido:
{
  "language": "${configParams.language}",
  "quiz": [
    {
      "domanda": "Testo domanda...",
      "risposte": ["A", "B", ...],
      "corretta": "Riportare l'opzione corretta",
      "spiegazione": "La risposta è '...'."
    }
  ]
}
Se tipo = "open_ended", "risposte" deve essere un array vuoto [] e "corretta" deve essere una stringa vuota "" (o una risposta modello).

REGOLE IMPERATIVE PER LA GENERAZIONE DI NUOVE DOMANDE
1. Verifica della Storia (Storico Precedente):
-Se è disponibile uno storico delle domande generate o delle interazioni precedenti, ogni nuova domanda prodotta DEVE essere sottoposta a un controllo di conformità.
-CONFORMITÀ: La domanda generata DEVE rispettare e mantenere tutti i requisiti, i vincoli e le specifiche stabiliti dalle istruzioni o dalle richieste utente precedenti.
2. Gestione delle Violazioni:
-In caso di violazione o mancata aderenza a uno qualsiasi dei requisiti storici, la domanda prodotta deve essere immediatamente SCARTATA.
-Si DEVE procedere alla RIGENERAZIONE di una nuova domanda completamente differente, sia nel tema che nella formulazione.
3. Unicità e Originalità del Contenuto:
-È STRETTAMENTE VIETATO proporre domande identiche o altamente simili (per concetto, struttura o semantica) a quelle già presenti nello storico delle domande. 
L'obiettivo è massimizzare la varietà e l'originalità.
`;

  try {
    let rawRes = "";

    if (config.aiModel === "gemini") {
      if (!process.env.GEMINI_API_KEY)
        return res.status(500).json({ error: "Manca GEMINI_API_KEY." });

      const modelName = "gemini-2.5-flash"; // Flash è più veloce ed economico per questo task

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: systemPrompt + "\n\nTESTO:\n" + text }] },
            ],
          }),
        }
      );

      const data = await response.json(); // <-- Dati ricevuti (e loggati)

      if (data.error)
        throw new Error(`Gemini API Error: ${data.error.message}`);

      // Gestione dei candidati (Safety filters)
      if (
        !data.candidates ||
        data.candidates.length === 0 ||
        !data.candidates[0].content
      ) {
        throw new Error(
          "Gemini non ha restituito candidati validi (bloccato dai filtri di sicurezza?). Risposta completa nel log."
        );
      }

      rawRes = data.candidates[0].content.parts[0].text;
    } else {
      return res.status(400).json({
        error: "Ollama locale non funziona su Netlify Cloud. Usa Gemini.",
      });
    }

    const json = extractJSON(rawRes);
    if (!json)
      throw new Error("Risposta AI non valida (probabile testo non JSON)");
    res.json(json);
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
        "Richiesta extract-mark-down-text non valida: dati Base64 mancanti."
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
      error.message
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
