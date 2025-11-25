require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

// Gestione importazione pdf-parse sicura
let pdfParseLib = require('pdf-parse');
if (typeof pdfParseLib !== 'function' && pdfParseLib.default) pdfParseLib = pdfParseLib.default;

const app = express();

// Configurazione Cartella Uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- NUOVA FUNZIONE ESTRAZIONE JSON PIÙ POTENTE ---
// --- NUOVA FUNZIONE ESTRAZIONE JSON PIÙ POTENTE ---
function extractJSON(text) {
    try {
        // Pulizia iniziale aggressiva di spazi e caratteri invisibili
        let cleanText = text.trim(); 
        
        // 1. Rimuovi markdown code blocks ```json ... ```
        cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '');
        
        // Nuova pulizia dopo la rimozione del markdown
        cleanText = cleanText.trim(); 
        
        // 2. Cerca la prima graffa aperta e l'ultima chiusa
        const firstOpen = cleanText.indexOf('{');
        const lastClose = cleanText.lastIndexOf('}');
        
        if (firstOpen !== -1 && lastClose !== -1) {
            // Estrae solo la parte tra le graffe
            cleanText = cleanText.substring(firstOpen, lastClose + 1);
            return JSON.parse(cleanText);
        }
        throw new Error("Parentesi JSON {} non trovate dopo la pulizia.");
    } catch (e) {
        console.error("FALLIMENTO PARSING JSON. Contenuto AI Originale:", text);
        console.error("Errore di parsing:", e.message);
        return null; 
    }
}
// ... (il resto del server.js)

// Endpoint Estrazione Testo
app.post('/api/extract-text', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
    const filePath = req.file.path;

    try {
        let extractedText = "";
        if (req.file.mimetype === 'application/pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdfParseLib(dataBuffer);
            extractedText = data.text;
        } else if (req.file.mimetype.includes('word') || req.file.mimetype.includes('officedocument')) {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ path: filePath });
            extractedText = result.value;
        } else {
            extractedText = fs.readFileSync(filePath, 'utf8');
        }

        // Pulizia base
        extractedText = extractedText.replace(/\r\n/g, '\n'); 
        
        res.json({ text: extractedText.substring(0, 60000) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Errore lettura file' });
    } finally {
        setTimeout(() => { if (fs.existsSync(filePath)) fs.unlink(filePath, ()=>{}); }, 2000);
    }
});

// Endpoint Generazione Quiz
app.post('/api/generate-quiz', async (req, res) => {
    const { text, config } = req.body;
    
    const systemPrompt = `
    Sei un'API che risponde SOLO in JSON. Non scrivere altro testo.
    Analizza il testo fornito ${config.topic ? "concentrandoti su: " + config.topic : "nella sua interezza"}.
    
    PARAMETRI:
    - Lingua Output: ${config.language}
    - Difficoltà: ${config.difficulty}
    - Numero Domande: ${config.numQuestions}
    - Tipo: ${config.questionType}
    - Opzioni (se multipla): ${config.numOptions || 4}

    ISTRUZIONI LATEX:
    - Se incontri formule matematiche, DEVI scriverle in formato KaTeX/LaTeX.
    - Usa il delimitatore singolo '$' per le formule inline (es: $E=mc^2$).
    - Usa il doppio delimitatore '$$' per blocchi.

    FORMATO JSON OBBLIGATORIO:
    Devi restituire SOLO un oggetto JSON valido:
    {
      "language": "${config.language}",
      "quiz": [
        {
          "domanda": "Testo domanda...",
          "risposte": ["A", "B", ...], 
          "corretta": "A"
        }
      ]
    }
    Se tipo = "open_ended", "risposte" deve essere [].
    `;

    try {
        let rawRes = "";
        
        // --- BLOCCO GEMINI ---
        if (config.aiModel === 'gemini') {
            if(!process.env.GEMINI_API_KEY) return res.status(500).json({error: "Manca GEMINI_API_KEY nel file .env"});
            
            // FIX: Usiamo il nome del modello stabile supportato dalla v1beta
            const modelName = "gemini-2.5-flash"; 
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + "\n\nTESTO:\n" + text }] }] })
            });
            
            const data = await response.json();
            
            // Controllo Errori Gemini
            if (data.error) {
                console.error("Errore Gemini API:", JSON.stringify(data.error));
                throw new Error(`Gemini Error: ${data.error.message}. Riprova con gemini-1.5-flash o gemini-2.5-flash.`);
            }
            if(!data.candidates) throw new Error("Gemini non ha restituito candidati.");
            
            rawRes = data.candidates[0].content.parts[0].text

        // --- BLOCCO OLLAMA ---
        } else {
            // Verifica che modello usare (default llama3)
            const ollamaModel = "llama3.1";

            const response = await fetch('http://127.0.0.1:11434/api/generate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: ollamaModel, 
                    prompt: systemPrompt + "\n\nTESTO:\n" + text, 
                    stream: false, 
                    format: "json" 
                })
            });
            
            if (!response.ok) {
                const errText = await response.text();
                console.error("Errore Ollama Raw:", errText);
                throw new Error(`Ollama Error: ${response.status} ${response.statusText}. Assicurati di aver eseguito 'ollama pull ${ollamaModel}'`);
            }

            const data = await response.json();
            rawRes = data.response;
        }

        const json = extractJSON(rawRes);
        if (!json) throw new Error("Risposta AI non valida (Vedi log server)");
        
        res.json(json);

    } catch (error) {
        console.error("Errore generazione:", error.message);
        res.status(500).json({ error: "Errore AI: " + error.message });
    }
});

app.listen(3000, () => console.log("Server attivo su http://localhost:3000"));