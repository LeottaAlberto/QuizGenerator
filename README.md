# 🤖 AI Document Quizzer Generator

Generatore di quiz intelligente che analizza documenti in formato PDF, DOCX, TXT o MD e crea test a risposta multipla o aperta, utilizzando il modello Gemini di Google. Il sistema supporta la visualizzazione di formule matematiche tramite KaTeX sia nell'anteprima che nelle domande generate.

# ✨ Caratteristiche Principali

Input Flessibile: Supporto per file .pdf, .docx, .txt, .md.

Motori AI: Utilizza l'API cloud di Gemini 2.5 Flash per l'analisi e la generazione dei quiz.

Robustezza Estrazione: Implementa una logica di estrazione PDF pagina per pagina per prevenire timeout del server su file complessi.

Formattazione Intelligente: L'anteprima del testo estratto supporta la renderizzazione di formule matematiche/scientifiche in formato $\LaTeX$ / KaTeX.

Quiz Personalizzati: Generazione di quiz su un Argomento Specifico o sull'Intero Documento.

Stack Tecnologico: Frontend (HTML, CSS, JavaScript) e Backend (Node.js/Express come Netlify Functions).

# 🚀 Setup e Installazione

Il progetto è configurato per essere eseguito in locale tramite la CLI di Netlify e distribuito direttamente su Netlify.

Prerequisiti

È necessario avere installato:

Node.js (versione 18 o superiore consigliata).

npm (Gestore di pacchetti di Node.js).

Netlify CLI (richiesto per l'avvio locale e il debug delle funzioni serverless):

```bash
npm install netlify-cli -g
```

# Steps

Installazione delle Dipendenze
Apri il terminale nella cartella principale del progetto ed esegui:
```bash
npm install

```
Questo comando installerà tutte le librerie necessarie (Express, pdf-parse, mammoth, node-fetch, ecc.).

Configurazione delle Variabili d'Ambiente (.env)
Per connetterti all'API di Gemini, devi configurare la tua chiave API. Crea un file chiamato .env nella cartella principale e inserisci la tua chiave API come segue:

GEMINI_API_KEY=LA_TUA_CHIAVE_API_DI_GOOGLE_QUI


Avvio del Server Locale (Tramite Netlify Dev)
Avvia il server locale che esegue sia l'interfaccia utente che le funzioni serverless:
```bash
netlify dev
```

L'applicazione sarà disponibile all'indirizzo http://localhost:8888.

# Uso dell'Applicazione

Carica Documento: Seleziona un file e l'anteprima si aggiornerà formattando il testo estratto. Attenzione: I file molto grandi potrebbero superare il limite di timeout di 30 secondi di Netlify.

Configura: Seleziona la difficoltà e il numero di domande. Lascia il campo Argomento (Opzionale) vuoto per generare domande su tutto il documento.

Genera Quiz: Clicca sul pulsante per inviare il testo all'AI e ricevere il quiz in formato JSON.

Rispondi e Verifica: Usa il pulsante "Verifica Risposte" per vedere le soluzioni.
