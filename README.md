# InPhoto Ore

Registro ore del team InPhoto Studio. Ogni persona ha il suo account e compila la propria giornata a fasce di 30 minuti (00:00–24:00), scegliendo cliente e progetto. L'amministratore vede il resoconto di tutti, lo filtra per periodo, persona, cliente, progetto o testo e lo esporta in Excel.

## Ruoli

| | Operatore | Amministratore |
|---|---|---|
| Compila le proprie fasce | ✓ | ✓ |
| Riepilogo delle proprie ore | ✓ | ✓ |
| Aggiunge, rinomina e archivia clienti e progetti, assegna le tipologie (Foto, Video…) | ✓ | ✓ |
| Gestisce l'elenco delle tipologie | | ✓ |
| Elimina clienti e progetti mai usati | | ✓ |
| Resoconto di tutto il team ed export Excel | | ✓ |
| Crea account, reimposta password, disattiva o elimina persone (le ore restano) | | ✓ |

Le fasce segnate come **pranzo** non contano nelle ore né nei resoconti.

## Come è fatta

- **Sito statico** (`index.html`, `styles.css`, `app.js`): nessun passaggio di build, pubblicato con GitHub Pages.
- **Supabase** per accessi e dati:
  - `supabase/schema.sql`: tabelle `profiles`, `clients`, `projects`, `entries` e regole di accesso (RLS). Ognuno legge e scrive solo le proprie fasce; l'amministratore le legge tutte.
  - `supabase/functions/admin-users`: funzione che crea e gestisce gli account con la chiave segreta, che non esce mai dal server. Finché non esiste un amministratore, permette di creare il primo.
- **`config.js`**: indirizzo del progetto Supabase e chiave *publishable*. Può stare nel browser, perché i dati sono protetti dalle regole RLS.
- **Excel**: generato nel browser con `xlsx-js-style`. Contiene i fogli Filtri, Dettaglio, Per cliente, Per progetto, Per persona, Per giorno, Cliente × persona e Progetto × persona.

## Messa online (una volta sola)

1. In Supabase esegui `supabase/schema.sql` e pubblica la funzione `admin-users` con *Verify JWT* disattivato: la funzione controlla da sola chi la chiama.
2. In Authentication → Sign In / Providers disattiva "Allow new users to sign up".
3. Compila `config.js` con l'URL del progetto e la chiave publishable.
4. GitHub → Settings → Pages → *Deploy from a branch*, `main`, cartella `/`.
5. Apri il sito: al primo avvio chiede di creare l'account amministratore.
