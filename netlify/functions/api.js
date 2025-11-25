// // netlify/functions/api.js
// const serverless = require('serverless-http');
// const express = require('express');
// const multer = require('multer');
// const fs = require('fs');
// const path = require('path');
// const cors = require('cors');
// const fetch = require('node-fetch');

// // PDF parse
// let pdfParseLib = require('pdf-parse');
// if (typeof pdfParseLib !== 'function' && pdfParseLib.default) pdfParseLib = pdfParseLib.default;

// const app = express();

// // Configurazione upload
// const uploadDir = path.join(__dirname, '..', 'uploads');
// if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, uploadDir),
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });
// const upload = multer({ storage });

// app.use(cors());
// app.use(express.json({ limit: '10mb' }));

// function extractJSON(text) {
//   try {
//     let cleanText = text.trim();
//     cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '').trim();
//     const firstOpen = cleanText.indexOf('{');
//     const lastClose = cleanText.lastIndexOf('}');
//     if (firstOpen !== -1 && lastClose !== -1) {
//       cleanText = cleanText.substring(firstOpen, lastClose + 1);
//       return JSON.parse(cleanText);
//     }
//     throw new Error("Parentesi JSON {} non trovate dopo la pulizia.");
//   } catch (e) {
//     console.error("FALLIMENTO PARSING JSON. Contenuto AI Originale:", text);
//     console.error("Errore di parsing:", e.message);
//     return null;
//   }
// }

// app.post('/extract-text', upload.single('file'), async (req, res) => {
//   console.log('Chiamata all\'API: extract-text');
  
//   if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
//   const filePath = req.file.path;

//   try {
//     let extractedText = "";
//     if (req.file.mimetype === 'application/pdf') {
//       const dataBuffer = fs.readFileSync(filePath);
//       const data = await pdfParseLib(dataBuffer);
//       extractedText = data.text;
//     } else if (req.file.mimetype.includes('word') || req.file.mimetype.includes('officedocument')) {
//       const mammoth = require('mammoth');
//       const result = await mammoth.extractRawText({ path: filePath });
//       extractedText = result.value;
//     } else {
//       extractedText = fs.readFileSync(filePath, 'utf8');
//     }

//     extractedText = extractedText.replace(/\r\n/g, '\n');
//     res.json({ text: extractedText.substring(0, 60000) });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: 'Errore lettura file' });
//   } finally {
//     setTimeout(() => { if (fs.existsSync(filePath)) fs.unlink(filePath, () => {}); }, 2000);
//   }
// });

// app.post('/generate-quiz', async (req, res) => {
//   const { text, config } = req.body;

//   const systemPrompt = `
//   Sei un'API che risponde SOLO in JSON. Non scrivere altro testo.
//   Analizza il testo fornito ${config.topic ? "concentrandoti su: " + config.topic : "nella sua interezza"}.

//   PARAMETRI:
//   - Lingua Output: ${config.language}
//   - Difficoltà: ${config.difficulty}
//   - Numero Domande: ${config.numQuestions}
//   - Tipo: ${config.questionType}
//   - Opzioni (se multipla): ${config.numOptions || 4}

//   ISTRUZIONI LATEX:
//   - Se incontri formule matematiche, DEVI scriverle in formato KaTeX/LaTeX.
//   - Usa il delimitatore singolo '$' per le formule inline (es: $E=mc^2$).
//   - Usa il doppio delimitatore '$$' per blocchi.

//   FORMATO JSON OBBLIGATORIO:
//   Devi restituire SOLO un oggetto JSON valido:
//   {
//     "language": "${config.language}",
//     "quiz": [
//       {
//         "domanda": "Testo domanda...",
//         "risposte": ["A", "B", ...],
//         "corretta": "A"
//       }
//     ]
//   }
//   Se tipo = "open_ended", "risposte" deve essere [].
//   `;

//   try {
//     let rawRes = "";

//     if (config.aiModel === 'gemini') {
//       if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Manca GEMINI_API_KEY nel file .env" });
//       const modelName = "gemini-2.5-flash";
//       const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
//         method: 'POST', headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + "\n\nTESTO:\n" + text }] }] })
//       });
//       const data = await response.json();
//       if (data.error) {
//         console.error("Errore Gemini API:", JSON.stringify(data.error));
//         throw new Error(`Gemini Error: ${data.error.message}`);
//       }
//       rawRes = data.candidates[0].content.parts[0].text;
//     } else {
//       const ollamaModel = "llama3.1";
//       const response = await fetch('http://127.0.0.1:11434/api/generate', {
//         method: 'POST', headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           model: ollamaModel,
//           prompt: systemPrompt + "\n\nTESTO:\n" + text,
//           stream: false,
//           format: "json"
//         })
//       });
//       if (!response.ok) {
//         const errText = await response.text();
//         console.error("Errore Ollama Raw:", errText);
//         throw new Error(`Ollama Error: ${response.status} ${response.statusText}`);
//       }
//       const data = await response.json();
//       rawRes = data.response;
//     }

//     const json = extractJSON(rawRes);
//     if (!json) throw new Error("Risposta AI non valida (Vedi log server)");

//     res.json(json);
//   } catch (error) {
//     console.error("Errore generazione:", error.message);
//     res.status(500).json({ error: "Errore AI: " + error.message });
//   }
// });

// module.exports.handler = serverless(app);

// netlify/functions/api.js
const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// Logging di Inizializzazione Garantito (per debug)
console.log("--- INIZIALIZZAZIONE FUNZIONE API AVVIATA ---");

// PDF parse
let pdfParseLib = require('pdf-parse');
if (typeof pdfParseLib !== 'function' && pdfParseLib.default) pdfParseLib = pdfParseLib.default;

const app = express();

app.use(cors());

// IMPORTANTISSIMO: Aumenta il limite per i file Base64!
app.use(express.json({ limit: '10mb' })); 

// Helper per il parsing JSON (invariato)
function extractJSON(text) {
    try {
        let cleanText = text.trim();
        cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '').trim();
        const firstOpen = cleanText.indexOf('{');
        const lastClose = cleanText.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1) {
            cleanText = cleanText.substring(firstOpen, lastClose + 1);
            return JSON.parse(cleanText);
        }
        throw new Error("Parentesi JSON {} non trovate dopo la pulizia.");
    } catch (e) {
        console.error("FALLIMENTO PARSING JSON. Contenuto:", text.substring(0, 500) + '...');
        return null;
    }
}

// Router API
const router = express.Router();

// -----------------------------------------------------------------
// ROUTE 1: ESTRAZIONE TESTO (Gestisce Base64 inviato via JSON)
// -----------------------------------------------------------------
router.post('/extract-text', async (req, res) => {
    console.log('--- Chiamata all\'API: extract-text ---');

    // Il frontend DEVE inviare { file: base64String, filename: string, mimetype: string }
    const { file: base64Data, filename, mimetype } = req.body; 

    if (!base64Data || !mimetype) {
        console.error("Corpo della richiesta NON CONTIENE Base64 (req.body mancante o malformato).");
        return res.status(400).json({ error: "Richiesta non valida: dati file Base64 mancanti." });
    }

    // Decodifica Base64 in Buffer
    let fileBuffer;
    try {
        fileBuffer = Buffer.from(base64Data, 'base64');
        console.log(`Buffer creato con successo, dimensione: ${fileBuffer.length} bytes`); 
    } catch (e) {
        console.error("Errore decodifica Base64:", e.message);
        return res.status(400).json({ error: "Impossibile decodificare il file Base64." });
    }
    
    // Processa il Buffer
    try {
        let extractedText = "";

        if (mimetype === 'application/pdf') {
            console.log('Tentativo di parsing PDF...');
            const data = await pdfParseLib(fileBuffer);
            extractedText = data.text;
            console.log('Parsing PDF completato.');
        } else if (mimetype.includes('word') || mimetype.includes('officedocument')) {
            const mammoth = require('mammoth');
            console.log('Tentativo di parsing DOCX...');
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            extractedText = result.value;
            console.log('Parsing DOCX completato.');
        } else {
            // File di testo semplice
            extractedText = fileBuffer.toString('utf8');
        }

        extractedText = extractedText.replace(/\r\n/g, '\n');
        // Limita a 60K caratteri per evitare di superare il limite di token di Gemini
        res.json({ text: extractedText.substring(0, 60000) });
        
    } catch (error) {
        console.error("Errore lettura file/parsing:", error.message);
        res.status(500).json({ error: 'Errore durante la lettura o il parsing del file: ' + error.message });
    }
});

// -----------------------------------------------------------------
// ROUTE 2: GENERAZIONE QUIZ (Chiama Gemini)
// -----------------------------------------------------------------
router.post('/generate-quiz', async (req, res) => {
    // ⚠️ Controllo per il crash 'Cannot read properties of undefined' (Punto 1.B)
    if (!req.body || !req.body.text || !req.body.config) {
        console.error("Richiesta generate-quiz malformata. Body:", req.body);
        return res.status(400).json({ error: "Richiesta non valida: 'text' o 'config' mancanti nel corpo." });
    }
    
    const { text, config } = req.body;

    // Utilizziamo un oggetto JSON per la configurazione
    const configParams = {
        language: config.language || 'Italiano',
        difficulty: config.difficulty || 'Medio',
        numQuestions: config.numQuestions || 5,
        questionType: config.questionType || 'multiple_choice',
        numOptions: config.numOptions || 4,
        topic: config.topic || 'nella sua interezza'
    };

    const systemPrompt = `
Sei un'API che risponde SOLO in JSON. Non scrivere altro testo.
Analizza il testo fornito ${configParams.topic !== 'nella sua interezza' ? "concentrandoti su: " + configParams.topic : configParams.topic}.

PARAMETRI:
- Lingua Output: ${configParams.language}
- Difficoltà: ${configParams.difficulty}
- Numero Domande: ${configParams.numQuestions}
- Tipo: ${configParams.questionType}
- Opzioni (se multipla): ${configParams.numOptions}

ISTRUZIONI LATEX:
- Se incontri formule matematiche, DEVI scriverle in formato KaTeX/LaTeX.
- Usa il delimitatore singolo '$' per le formule inline (es: $E=mc^2$).
- Usa il doppio delimitatore '$$' per blocchi.

FORMATO JSON OBBLIGATORIO:
Devi restituire SOLO un oggetto JSON valido:
{
  "language": "${configParams.language}",
  "quiz": [
    {
      "domanda": "Testo domanda...",
      "risposte": ["A", "B", ...],
      "corretta": "A"
    }
  ]
}
Se tipo = "open_ended", "risposte" deve essere un array vuoto [].
`;

    try {
        let rawRes = "";

        if (config.aiModel === 'gemini') {
            if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Manca GEMINI_API_KEY." });
            
            const modelName = "gemini-2.5-flash"; // Flash è più veloce ed economico per questo task
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: systemPrompt + "\n\nTESTO:\n" + text }] }] 
                })
            });
            
            const data = await response.json(); // <-- Dati ricevuti (e loggati)

            // *** LOG ESSENZIALE PER DEBUG ***
            console.log("RISPOSTA RAW COMPLETA DA GEMINI:", JSON.stringify(data)); 
            // *******************************

            if (data.error) throw new Error(`Gemini API Error: ${data.error.message}`);
            
            // Gestione dei candidati (Safety filters)
            if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
                 throw new Error("Gemini non ha restituito candidati validi (bloccato dai filtri di sicurezza?). Risposta completa nel log."); 
            }
            
            rawRes = data.candidates[0].content.parts[0].text;
            
        } else {
            return res.status(400).json({ error: "Ollama locale non funziona su Netlify Cloud. Usa Gemini." });
        }

        const json = extractJSON(rawRes);
        if (!json) throw new Error("Risposta AI non valida (probabile testo non JSON)");
        res.json(json);
    } catch (error) {
        console.error("Errore generazione:", error.message);
        res.status(500).json({ error: "Errore AI: " + error.message });
    }
});


// Applichiamo il router alla base path per Netlify
app.use('/', router);
app.use('/api', router); // Per chiamata /api/xyz
app.use('/.netlify/functions/api', router); // Per fallback di Netlify

module.exports.handler = serverless(app);
